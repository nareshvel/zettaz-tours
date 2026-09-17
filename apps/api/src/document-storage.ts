import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Actor,
  TenantConfig,
} from "../../../packages/shared/src/contracts";
import { Database, record } from "./database";
import { textPdf } from "./pdf";

type HotProvider = "filesystem" | "s3";
type ArchiveProvider = "none" | "google_drive" | "onedrive" | "dropbox";

type WaiverCapture = {
  id: string;
  bookingId: string;
  passengerId: string;
  templateId: string;
  templateVersion: number;
  signerName: string;
  signerCapacity: string;
  stay: unknown;
  capturedAt: string;
};

function hotRoot() {
  return (
    process.env.DOCUMENT_HOT_ROOT?.trim() ||
    path.resolve(process.cwd(), ".local/document-hot")
  );
}

function storageConfig(config: TenantConfig["documentStorage"] | undefined) {
  return {
    hotProvider: (config?.hotProvider ?? "filesystem") as HotProvider,
    archiveProvider: (config?.archiveProvider ?? "none") as ArchiveProvider,
    hotRetentionDays: Math.min(7, Math.max(1, config?.hotRetentionDays ?? 7)),
  };
}

@Injectable()
export class DocumentStorageService {
  private readonly log = new Logger(DocumentStorageService.name);
  constructor(private readonly db: Database) {}

  async captureWaiverPdf(actor: Actor, waiver: WaiverCapture) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [tenant],
      } = await tx.query("SELECT name,config FROM tenants WHERE id=$1", [
        actor.tenantId,
      ]);
      if (!tenant) return null;
      const storage = storageConfig(
        (tenant.config as TenantConfig).documentStorage,
      );
      const {
        rows: [passenger],
      } = await tx.query(
        `SELECT p.name,p.category,b.lead_name,d.starts_at,pr.name AS product_name
         FROM booking_passengers p
         JOIN bookings b ON b.tenant_id=p.tenant_id AND b.id=p.booking_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         JOIN products pr ON pr.tenant_id=d.tenant_id AND pr.id=d.product_id
         WHERE p.tenant_id=$1 AND p.id=$2`,
        [actor.tenantId, waiver.passengerId],
      );
      const {
        rows: [template],
      } = await tx.query(
        "SELECT title,body FROM waiver_templates WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, waiver.templateId],
      );
      const lines = [
        `${tenant.name} · Signed waiver`,
        `Template: ${template?.title ?? "Waiver"} v${waiver.templateVersion}`,
        `Passenger: ${passenger?.name ?? waiver.passengerId}`,
        `Category: ${passenger?.category ?? ""}`,
        `Lead: ${passenger?.lead_name ?? ""}`,
        `Departure: ${passenger?.product_name ?? ""} · ${passenger?.starts_at ?? ""}`,
        `Signer: ${waiver.signerName} (${waiver.signerCapacity})`,
        `Captured: ${waiver.capturedAt}`,
        `Stay: ${JSON.stringify(waiver.stay)}`,
        "",
        String(template?.body ?? ""),
        "",
        "Signature evidence is retained as vector strokes in the database.",
        "This PDF is a short-lived hot copy for archive sync-out.",
      ];
      const {
        rows: [existing],
      } = await tx.query(
        `SELECT id FROM document_artifacts
         WHERE tenant_id=$1 AND source_type='waiver_signature' AND source_id=$2
         ORDER BY created_at DESC LIMIT 1`,
        [actor.tenantId, waiver.id],
      );
      if (existing) return existing as { id: string };
      const bytes = textPdf("Signed waiver", lines);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const artifactId = randomUUID();
      const retentionDays = storage.hotRetentionDays;
      const retentionExpiresAt = new Date(
        Date.now() + retentionDays * 86400000,
      ).toISOString();
      const relativeKey = path.join(
        String(actor.tenantId),
        "waivers",
        `${artifactId}.pdf`,
      );
      const absolutePath = path.join(hotRoot(), relativeKey);
      await mkdir(path.dirname(absolutePath), { recursive: true });

      if (storage.hotProvider === "s3") {
        const bucket = process.env.DOCUMENT_S3_BUCKET?.trim();
        const endpoint = process.env.DOCUMENT_S3_ENDPOINT?.trim();
        if (!bucket || !endpoint) {
          // Keep a filesystem mirror so boarding is not blocked; sync remains blocked until S3 is configured.
          await writeFile(absolutePath, bytes);
          this.log.warn(
            "documentStorage.hotProvider=s3 but DOCUMENT_S3_BUCKET/ENDPOINT missing; wrote filesystem hot copy",
          );
        } else {
          // S3 PutObject adapter lands with credentials. Until then mirror locally under the S3 key layout.
          await writeFile(absolutePath, bytes);
          this.log.warn(
            "S3 hot provider selected; object mirrored locally pending signed PutObject adapter",
          );
        }
      } else {
        await writeFile(absolutePath, bytes);
      }

      const archiveStatus =
        storage.archiveProvider === "none" ? "hot_only" : "sync_pending";
      const result = {
        id: artifactId,
        documentType: "waiver" as const,
        sourceType: "waiver_signature",
        sourceId: waiver.id,
        contentHash: hash,
        hotProvider: storage.hotProvider,
        hotPath: relativeKey,
        byteSize: bytes.byteLength,
        retentionExpiresAt,
        archiveProvider: storage.archiveProvider,
        archiveStatus,
      };
      await tx.query(
        `INSERT INTO document_artifacts(
          tenant_id,id,document_type,source_type,source_id,content_hash,hot_provider,hot_path,byte_size,
          retention_expires_at,archive_provider,archive_status,created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          actor.tenantId,
          result.id,
          result.documentType,
          result.sourceType,
          result.sourceId,
          result.contentHash,
          result.hotProvider,
          result.hotPath,
          result.byteSize,
          result.retentionExpiresAt,
          result.archiveProvider,
          result.archiveStatus,
          actor.actorId,
        ],
      );
      await record(
        tx,
        actor,
        "document.artifact_created",
        result.id,
        null,
        result,
      );
      if (result.archiveStatus === "sync_pending") {
        await tx.query(
          `INSERT INTO outbox_events(tenant_id,id,type,aggregate_id,payload) VALUES($1,$2,$3,$4,$5)`,
          [
            actor.tenantId,
            randomUUID(),
            "document.archive_requested",
            result.id,
            JSON.stringify({
              version: 1,
              artifactId: result.id,
              archiveProvider: result.archiveProvider,
            }),
          ],
        );
      }
      return result;
    });
  }

  async waiverPdf(actor: Actor, passengerId: string) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [signature],
      } = await tx.query(
        `SELECT id FROM waiver_signatures
         WHERE tenant_id=$1 AND passenger_id=$2
         ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        [actor.tenantId, passengerId],
      );
      if (!signature) throw new NotFoundException("No signed waiver");
      const {
        rows: [artifact],
      } = await tx.query(
        `SELECT hot_path FROM document_artifacts
         WHERE tenant_id=$1 AND source_type='waiver_signature' AND source_id=$2
           AND hot_path IS NOT NULL AND purged_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [actor.tenantId, signature.id],
      );
      if (!artifact?.hot_path)
        throw new NotFoundException(
          "Waiver PDF hot copy is not available. Signature strokes remain on the booking.",
        );
      const bytes = await readFile(path.join(hotRoot(), artifact.hot_path));
      return {
        bytes,
        filename: `waiver-${passengerId.slice(0, 8)}.pdf`,
      };
    });
  }

  async syncPendingArchives(actor: Actor, limit = 25) {
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id,archive_provider,hot_path,content_hash,document_type
         FROM document_artifacts
         WHERE tenant_id=$1 AND archive_status='sync_pending' AND purged_at IS NULL
         ORDER BY created_at,id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [actor.tenantId, limit],
      );
      const outcomes = [];
      for (const row of rows) {
        const sync = await this.archiveOnce(
          row.archive_provider as ArchiveProvider,
          {
            artifactId: row.id,
            hotPath: row.hot_path,
            contentHash: row.content_hash,
            documentType: row.document_type,
          },
        );
        if (sync.ok) {
          await this.deleteHotFile(row.hot_path);
          await tx.query(
            `UPDATE document_artifacts
             SET archive_status='synced', archive_ref=$3, archive_error=NULL, synced_at=clock_timestamp(),
                 hot_path=NULL, purged_at=clock_timestamp()
             WHERE tenant_id=$1 AND id=$2`,
            [actor.tenantId, row.id, sync.ref],
          );
          outcomes.push({ id: row.id, status: "synced" });
        } else {
          await tx.query(
            `UPDATE document_artifacts
             SET archive_status='sync_blocked', archive_error=$3
             WHERE tenant_id=$1 AND id=$2`,
            [actor.tenantId, row.id, sync.error],
          );
          outcomes.push({
            id: row.id,
            status: "sync_blocked",
            error: sync.error,
          });
        }
      }
      return outcomes;
    });
  }

  async purgeExpired(actor: Actor, limit = 50) {
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id,hot_path FROM document_artifacts
         WHERE tenant_id=$1 AND purged_at IS NULL AND hot_path IS NOT NULL
           AND retention_expires_at <= clock_timestamp()
         ORDER BY retention_expires_at,id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [actor.tenantId, limit],
      );
      for (const row of rows) {
        await this.deleteHotFile(row.hot_path);
        await tx.query(
          `UPDATE document_artifacts
           SET hot_path=NULL, purged_at=clock_timestamp(),
               archive_status=CASE WHEN archive_status='synced' THEN archive_status ELSE 'purged' END
           WHERE tenant_id=$1 AND id=$2`,
          [actor.tenantId, row.id],
        );
        await record(
          tx,
          actor,
          "document.artifact_purged",
          row.id,
          { hotPath: row.hot_path },
          { purged: true },
        );
      }
      return { purged: rows.length };
    });
  }

  private async archiveOnce(
    provider: ArchiveProvider,
    input: {
      artifactId: string;
      hotPath: string | null;
      contentHash: string;
      documentType: string;
    },
  ): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
    if (provider === "none")
      return { ok: false, error: "Archive provider is none" };
    const enabled = process.env.DOCUMENT_ARCHIVE_ADAPTERS === "1";
    if (!enabled) {
      return {
        ok: false,
        error: `${provider} adapter is feature-flagged off (set DOCUMENT_ARCHIVE_ADAPTERS=1 when credentials are approved)`,
      };
    }
    // Adapters for Google Drive / OneDrive / Dropbox remain intentionally unimplemented
    // until OAuth app credentials and tenant consent flows are approved.
    return {
      ok: false,
      error: `${provider} archive adapter is not implemented yet`,
    };
  }

  private async deleteHotFile(relativePath: string | null) {
    if (!relativePath) return;
    try {
      await unlink(path.join(hotRoot(), relativePath));
    } catch (error) {
      this.log.warn(
        `Failed to delete hot document ${relativePath}: ${(error as Error).message}`,
      );
    }
  }
}
