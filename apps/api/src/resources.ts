import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { FLEET_KIND_IDS } from "../../../packages/shared/src/fleet";
import { Database, record } from "./database";
import {
  absoluteLibraryPath,
  assertLibraryQuota,
  DocumentLibraryService,
  type UploadedLibraryFile,
} from "./document-library";
import { Access, CurrentActor, keySchema, parse } from "./http";

const resourceSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_-]{1,49}$/),
    name: z.string().trim().min(1).max(120),
    type: z.enum(FLEET_KIND_IDS),
    capacity: z.number().int().positive().max(100000).nullable().default(null),
    make: z.string().trim().max(80).default(""),
    model: z.string().trim().max(80).default(""),
    identifier: z.string().trim().max(80).default(""),
    notes: z.string().trim().max(1000).default(""),
  })
  .strict();
const resourceUpdateSchema = resourceSchema
  .extend({
    active: z.boolean(),
  })
  .strict();
const crewSchema = z
  .object({
    actorId: z.string().uuid(),
    operationalName: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(1000).default(""),
  })
  .strict();
const crewUpdateSchema = z
  .object({
    operationalName: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(1000).default(""),
    active: z.boolean(),
  })
  .strict();
const documentSchema = z
  .object({
    resourceId: z.string().uuid().optional(),
    crewActorId: z.string().uuid().optional(),
    documentType: z.string().trim().min(1).max(80),
    expiresOn: z.string().date(),
    evidencePath: z.string().trim().max(500).default(""),
    notes: z.string().trim().max(1000).default(""),
  })
  .refine(
    (value) => Boolean(value.resourceId) !== Boolean(value.crewActorId),
    "Select exactly one resource or crew member",
  )
  .strict();
const documentUpdateSchema = z
  .object({
    documentType: z.string().trim().min(1).max(80),
    expiresOn: z.string().date(),
    evidencePath: z.string().trim().max(500).default(""),
    notes: z.string().trim().max(1000).default(""),
  })
  .strict();
const assignmentSchema = z
  .object({
    departureId: z.string().uuid(),
    resourceId: z.string().uuid().optional(),
    crewActorId: z.string().uuid().optional(),
    assignmentRole: z.string().trim().min(1).max(80),
    overrideReason: z.string().trim().min(8).max(1000).optional(),
  })
  .refine(
    (value) => Boolean(value.resourceId) !== Boolean(value.crewActorId),
    "Select exactly one resource or crew member",
  )
  .strict();
const assignmentUpdateSchema = z
  .object({
    assignmentRole: z.string().trim().min(1).max(80),
  })
  .strict();

/** Multipart form fields arrive as strings; JSON bodies pass through. */
function coerceDocumentBody(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const body = { ...(raw as Record<string, unknown>) };
  for (const key of ["evidencePath", "notes", "documentType", "expiresOn"]) {
    if (body[key] === undefined || body[key] === null) continue;
    body[key] = String(body[key]);
  }
  for (const key of ["resourceId", "crewActorId"]) {
    if (body[key] === "" || body[key] === undefined) delete body[key];
  }
  return body;
}

@Injectable()
export class ResourceService {
  constructor(
    private readonly db: Database,
    private readonly library: DocumentLibraryService,
  ) {}
  listResources(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            "SELECT id,code,name,type,capacity,make,model,identifier,notes,active FROM operational_resources WHERE tenant_id=$1 ORDER BY active DESC,name,id",
            [actor.tenantId],
          )
        ).rows,
    );
  }
  listCrew(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            `SELECT c.membership_actor_id AS actor_id,c.operational_name,c.notes,c.active,
                    s.name,s.email,m.role,
                    COALESCE(tr.name, m.role) AS role_name
               FROM crew_profiles c
               JOIN staff_users s ON s.id=c.membership_actor_id
               JOIN memberships m
                 ON m.tenant_id=c.tenant_id AND m.actor_id=c.membership_actor_id
               LEFT JOIN tenant_roles tr
                 ON tr.tenant_id=m.tenant_id AND tr.id=m.role_id
              WHERE c.tenant_id=$1
              ORDER BY c.active DESC,c.operational_name`,
            [actor.tenantId],
          )
        ).rows,
    );
  }
  documents(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            `SELECT d.id,d.resource_id,d.crew_actor_id,d.document_type,d.expires_on,
                    d.evidence_path,d.notes,d.file_name,d.content_type,d.byte_size,
                    d.storage_key IS NOT NULL AS has_file,
                    CASE
                      WHEN d.resource_id IS NOT NULL THEN 'resource'
                      ELSE 'crew'
                    END AS subject_kind,
                    COALESCE(r.name, s.name, c.operational_name, '') AS subject_name
               FROM compliance_documents d
               LEFT JOIN operational_resources r
                 ON r.tenant_id=d.tenant_id AND r.id=d.resource_id
               LEFT JOIN crew_profiles c
                 ON c.tenant_id=d.tenant_id AND c.membership_actor_id=d.crew_actor_id
               LEFT JOIN staff_users s ON s.id=d.crew_actor_id
              WHERE d.tenant_id=$1
              ORDER BY d.expires_on,d.id`,
            [actor.tenantId],
          )
        ).rows,
    );
  }
  libraryUsage(actor: Actor) {
    return this.library.usage(actor);
  }
  createResource(actor: Actor, key: string, raw: unknown) {
    const input = parse(resourceSchema, raw);
    return this.db.command(actor, "resource.create", key, input, async (tx) => {
      const id = randomUUID();
      await tx.query(
        "INSERT INTO operational_resources(tenant_id,id,code,name,type,capacity,make,model,identifier,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          actor.tenantId,
          id,
          input.code,
          input.name,
          input.type,
          input.capacity,
          input.make,
          input.model,
          input.identifier,
          input.notes,
        ],
      );
      await record(tx, actor, "resource.created", id, null, input);
      return { id, ...input, active: true };
    });
  }
  updateResource(actor: Actor, id: string, key: string, raw: unknown) {
    const input = parse(resourceUpdateSchema, raw);
    return this.db.command(actor, "resource.update", key, input, async (tx) => {
      const {
        rows: [before],
      } = await tx.query(
        "SELECT id,code,name,type,capacity,make,model,identifier,notes,active FROM operational_resources WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [actor.tenantId, id],
      );
      if (!before) throw new NotFoundException("Resource not found");
      try {
        await tx.query(
          `UPDATE operational_resources
              SET code=$3,name=$4,type=$5,capacity=$6,make=$7,model=$8,identifier=$9,notes=$10,active=$11
            WHERE tenant_id=$1 AND id=$2`,
          [
            actor.tenantId,
            id,
            input.code,
            input.name,
            input.type,
            input.capacity,
            input.make,
            input.model,
            input.identifier,
            input.notes,
            input.active,
          ],
        );
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        )
          throw new ConflictException("Resource code already exists");
        throw error;
      }
      await record(tx, actor, "resource.updated", id, before, input);
      return { id, ...input };
    });
  }
  deactivateResource(actor: Actor, id: string, key: string) {
    return this.db.command(
      actor,
      "resource.deactivate",
      key,
      { id },
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT id,code,name,type,capacity,make,model,identifier,notes,active FROM operational_resources WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [actor.tenantId, id],
        );
        if (!before) throw new NotFoundException("Resource not found");
        if (!before.active) return { id, active: false };
        await tx.query(
          "UPDATE operational_resources SET active=false WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, id],
        );
        await record(tx, actor, "resource.deactivated", id, before, {
          active: false,
        });
        return { id, active: false };
      },
    );
  }
  createCrew(actor: Actor, key: string, raw: unknown) {
    const input = parse(crewSchema, raw);
    return this.db.command(
      actor,
      "crew_profile.create",
      key,
      input,
      async (tx) => {
        const member = await tx.query(
          "SELECT active FROM memberships WHERE tenant_id=$1 AND actor_id=$2",
          [actor.tenantId, input.actorId],
        );
        if (!member.rows[0]?.active)
          throw new BadRequestException("Active tenant member required");
        await tx.query(
          "INSERT INTO crew_profiles(tenant_id,membership_actor_id,operational_name,notes) VALUES($1,$2,$3,$4)",
          [actor.tenantId, input.actorId, input.operationalName, input.notes],
        );
        await record(
          tx,
          actor,
          "crew_profile.created",
          input.actorId,
          null,
          input,
        );
        return { ...input, active: true };
      },
    );
  }
  updateCrew(actor: Actor, actorId: string, key: string, raw: unknown) {
    const input = parse(crewUpdateSchema, raw);
    return this.db.command(
      actor,
      "crew_profile.update",
      key,
      input,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT membership_actor_id AS actor_id,operational_name,notes,active FROM crew_profiles WHERE tenant_id=$1 AND membership_actor_id=$2 FOR UPDATE",
          [actor.tenantId, actorId],
        );
        if (!before) throw new NotFoundException("Crew profile not found");
        await tx.query(
          `UPDATE crew_profiles
              SET operational_name=$3,notes=$4,active=$5
            WHERE tenant_id=$1 AND membership_actor_id=$2`,
          [
            actor.tenantId,
            actorId,
            input.operationalName,
            input.notes,
            input.active,
          ],
        );
        await record(tx, actor, "crew_profile.updated", actorId, before, input);
        return { actorId, ...input };
      },
    );
  }
  deactivateCrew(actor: Actor, actorId: string, key: string) {
    return this.db.command(
      actor,
      "crew_profile.deactivate",
      key,
      { actorId },
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT membership_actor_id AS actor_id,operational_name,notes,active FROM crew_profiles WHERE tenant_id=$1 AND membership_actor_id=$2 FOR UPDATE",
          [actor.tenantId, actorId],
        );
        if (!before) throw new NotFoundException("Crew profile not found");
        if (!before.active) return { actorId, active: false };
        await tx.query(
          "UPDATE crew_profiles SET active=false WHERE tenant_id=$1 AND membership_actor_id=$2",
          [actor.tenantId, actorId],
        );
        await record(tx, actor, "crew_profile.deactivated", actorId, before, {
          active: false,
        });
        return { actorId, active: false };
      },
    );
  }
  async createDocument(
    actor: Actor,
    key: string,
    raw: unknown,
    file?: UploadedLibraryFile,
  ) {
    const input = parse(documentSchema, coerceDocumentBody(raw));
    let stored: {
      storageKey: string;
      fileName: string;
      contentType: string;
      byteSize: number;
    } | null = null;
    if (file) {
      const usage = await this.library.usage(actor);
      assertLibraryQuota(usage.usedBytes, file.size, usage.quotaBytes);
      const kind = input.crewActorId ? "crew" : "resource";
      const subjectId = (input.crewActorId ?? input.resourceId)!;
      stored = await this.library.writeSubjectFile(
        actor.tenantId!,
        kind,
        subjectId,
        file,
      );
    }
    try {
      return await this.db.command(
        actor,
        "compliance_document.create",
        key,
        {
          ...input,
          fileName: stored?.fileName ?? null,
          byteSize: stored?.byteSize ?? 0,
        },
        async (tx) => {
          const id = randomUUID();
          await tx.query(
            `INSERT INTO compliance_documents(
               tenant_id,id,resource_id,crew_actor_id,document_type,expires_on,
               evidence_path,notes,file_name,content_type,byte_size,storage_key
             ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              actor.tenantId,
              id,
              input.resourceId ?? null,
              input.crewActorId ?? null,
              input.documentType,
              input.expiresOn,
              input.evidencePath,
              input.notes,
              stored?.fileName ?? null,
              stored?.contentType ?? null,
              stored?.byteSize ?? 0,
              stored?.storageKey ?? null,
            ],
          );
          await record(tx, actor, "compliance_document.created", id, null, {
            ...input,
            hasFile: Boolean(stored),
            byteSize: stored?.byteSize ?? 0,
          });
          return {
            id,
            ...input,
            fileName: stored?.fileName ?? null,
            contentType: stored?.contentType ?? null,
            byteSize: stored?.byteSize ?? 0,
            hasFile: Boolean(stored),
          };
        },
      );
    } catch (error) {
      if (stored) await this.library.deleteStoredFile(stored.storageKey);
      throw error;
    }
  }
  updateDocument(actor: Actor, id: string, key: string, raw: unknown) {
    const input = parse(documentUpdateSchema, coerceDocumentBody(raw));
    return this.db.command(
      actor,
      "compliance_document.update",
      key,
      input,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT id,resource_id,crew_actor_id,document_type,expires_on,evidence_path,notes,file_name,content_type,byte_size,storage_key FROM compliance_documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [actor.tenantId, id],
        );
        if (!before) throw new NotFoundException("Document not found");
        await tx.query(
          `UPDATE compliance_documents
              SET document_type=$3,expires_on=$4,evidence_path=$5,notes=$6
            WHERE tenant_id=$1 AND id=$2`,
          [
            actor.tenantId,
            id,
            input.documentType,
            input.expiresOn,
            input.evidencePath,
            input.notes,
          ],
        );
        await record(
          tx,
          actor,
          "compliance_document.updated",
          id,
          before,
          input,
        );
        return {
          id,
          resourceId: before.resource_id,
          crewActorId: before.crew_actor_id,
          ...input,
          fileName: before.file_name,
          contentType: before.content_type,
          byteSize: before.byte_size,
          hasFile: Boolean(before.storage_key),
        };
      },
    );
  }
  async deleteDocument(actor: Actor, id: string, key: string) {
    const result = await this.db.command(
      actor,
      "compliance_document.delete",
      key,
      { id },
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT id,resource_id,crew_actor_id,document_type,expires_on,evidence_path,notes,file_name,byte_size,storage_key FROM compliance_documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [actor.tenantId, id],
        );
        if (!before) throw new NotFoundException("Document not found");
        await tx.query(
          "DELETE FROM compliance_documents WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, id],
        );
        await record(
          tx,
          actor,
          "compliance_document.deleted",
          id,
          before,
          null,
        );
        return {
          id,
          deleted: true,
          storageKey: before.storage_key as string | null,
        };
      },
    );
    await this.library.deleteStoredFile(result.storageKey);
    return { id: result.id, deleted: true };
  }
  async downloadDocument(actor: Actor, id: string) {
    const row = await this.db.transaction(actor, async (tx) => {
      const {
        rows: [doc],
      } = await tx.query(
        "SELECT id,file_name,content_type,storage_key FROM compliance_documents WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, id],
      );
      return doc as
        | {
            id: string;
            file_name: string | null;
            content_type: string | null;
            storage_key: string | null;
          }
        | undefined;
    });
    if (!row?.storage_key)
      throw new NotFoundException("Document file not found");
    const absolute = absoluteLibraryPath(row.storage_key);
    try {
      await access(absolute);
    } catch {
      throw new NotFoundException("Document file not found");
    }
    const stream = createReadStream(absolute);
    const filename = row.file_name || "document";
    return new StreamableFile(stream, {
      type: row.content_type || "application/octet-stream",
      disposition: `attachment; filename="${filename.replace(/"/g, "")}"`,
    });
  }
  createAssignment(actor: Actor, key: string, raw: unknown) {
    const input = parse(assignmentSchema, raw);
    return this.db.command(
      actor,
      "departure_assignment.create",
      key,
      input,
      async (tx) => {
        const {
          rows: [departure],
        } = await tx.query(
          `SELECT d.starts_at,d.local_date,
            (d.starts_at + make_interval(mins => GREATEST(1, COALESCE(NULLIF(p.definition->>'durationMinutes','')::int, 120)))) AS ends_at
         FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         WHERE d.tenant_id=$1 AND d.id=$2`,
          [actor.tenantId, input.departureId],
        );
        if (!departure)
          throw new BadRequestException("Departure is unavailable");
        if (!departure.ends_at)
          throw new BadRequestException(
            "Departure duration is missing; set duration on the product before assigning",
          );
        const { rows: expired } = await tx.query(
          `SELECT id,document_type FROM compliance_documents WHERE tenant_id=$1
         AND (($2::uuid IS NOT NULL AND resource_id=$2) OR ($3::uuid IS NOT NULL AND crew_actor_id=$3))
         AND expires_on < $4::date`,
          [
            actor.tenantId,
            input.resourceId ?? null,
            input.crewActorId ?? null,
            departure.local_date,
          ],
        );
        if (expired.length && !input.overrideReason)
          throw new ConflictException(
            "Expired compliance document blocks assignment",
          );
        if (
          expired.length &&
          !actor.permissions.includes("safety.assignment.override")
        )
          throw new BadRequestException(
            "An authorized safety override is required for expired documents",
          );
        const overrideReason = expired.length
          ? (input.overrideReason ?? null)
          : null;
        const subject = await tx.query(
          input.resourceId
            ? "SELECT active FROM operational_resources WHERE tenant_id=$1 AND id=$2"
            : "SELECT active FROM crew_profiles WHERE tenant_id=$1 AND membership_actor_id=$2",
          [actor.tenantId, input.resourceId ?? input.crewActorId],
        );
        if (!subject.rows[0])
          throw new BadRequestException("Crew or resource is unavailable");
        if (!subject.rows[0].active)
          throw new BadRequestException(
            "Inactive crew or resources cannot be assigned",
          );
        const id = randomUUID();
        try {
          await tx.query(
            "INSERT INTO departure_assignments(tenant_id,id,departure_id,resource_id,crew_actor_id,assignment_role,starts_at,ends_at,override_reason,assigned_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [
              actor.tenantId,
              id,
              input.departureId,
              input.resourceId ?? null,
              input.crewActorId ?? null,
              input.assignmentRole,
              departure.starts_at,
              departure.ends_at,
              overrideReason,
              actor.actorId,
            ],
          );
        } catch (error) {
          if ((error as { code?: string }).code === "23P01")
            throw new ConflictException(
              "That crew member or asset is already assigned during this time",
            );
          throw error;
        }
        await record(tx, actor, "departure_assignment.created", id, null, {
          ...input,
          overrideReason,
          expiredDocuments: expired.map((document) => document.document_type),
        });
        return {
          id,
          ...input,
          overrideReason: overrideReason ?? undefined,
          startsAt: departure.starts_at,
          endsAt: departure.ends_at,
        };
      },
    );
  }
  assignments(actor: Actor, departureId: string) {
    return this.db.transaction(actor, async (tx) => {
      const { rows: departure } = await tx.query(
        "SELECT local_date FROM departures WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, departureId],
      );
      if (!departure[0])
        throw new BadRequestException("Departure is unavailable");
      const { rows } = await tx.query(
        `SELECT a.id,a.assignment_role,a.status,a.starts_at,a.ends_at,a.override_reason,
          r.id AS resource_id,r.name AS resource_name,r.type AS resource_type,
          c.membership_actor_id AS crew_actor_id,c.operational_name AS crew_name
         FROM departure_assignments a
         LEFT JOIN operational_resources r ON r.tenant_id=a.tenant_id AND r.id=a.resource_id
         LEFT JOIN crew_profiles c ON c.tenant_id=a.tenant_id AND c.membership_actor_id=a.crew_actor_id
         WHERE a.tenant_id=$1 AND a.departure_id=$2 ORDER BY a.starts_at,a.assignment_role,a.id`,
        [actor.tenantId, departureId],
      );
      const subjectIds = rows.flatMap((row) =>
        [row.resource_id, row.crew_actor_id].filter(Boolean),
      );
      const { rows: expiredDocuments } = subjectIds.length
        ? await tx.query(
            `SELECT id,resource_id,crew_actor_id,document_type,expires_on
             FROM compliance_documents WHERE tenant_id=$1 AND expires_on<$2
             AND (resource_id=ANY($3::uuid[]) OR crew_actor_id=ANY($3::uuid[]))`,
            [actor.tenantId, departure[0].local_date, subjectIds],
          )
        : { rows: [] };
      const overriddenSubjects = new Set(
        rows
          .filter((row) => row.override_reason)
          .flatMap((row) =>
            [row.resource_id, row.crew_actor_id].filter(Boolean),
          ),
      );
      const blockingDocuments = expiredDocuments.filter(
        (document) =>
          !overriddenSubjects.has(
            document.resource_id ?? document.crew_actor_id,
          ),
      );
      return {
        items: rows,
        expiredDocuments: blockingDocuments,
        readiness: blockingDocuments.length
          ? "blocked"
          : rows.length
            ? "ready"
            : "unassigned",
      };
    });
  }
  listAssignments(actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT a.id,a.departure_id,a.assignment_role,a.status,a.starts_at,a.ends_at,a.override_reason,
            r.id AS resource_id,r.name AS resource_name,r.capacity AS resource_capacity,
            c.membership_actor_id AS crew_actor_id,c.operational_name AS crew_name,
            d.starts_at AS departure_starts_at,to_char(d.local_date,'YYYY-MM-DD') AS local_date,p.name AS product_name,
            d.capacity AS departure_capacity,
            (d.committed+d.overbooked)::int AS departure_committed
           FROM departure_assignments a
           JOIN departures d ON d.tenant_id=a.tenant_id AND d.id=a.departure_id
           JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
           LEFT JOIN operational_resources r ON r.tenant_id=a.tenant_id AND r.id=a.resource_id
           LEFT JOIN crew_profiles c ON c.tenant_id=a.tenant_id AND c.membership_actor_id=a.crew_actor_id
           WHERE a.tenant_id=$1 AND a.status='active'
           ORDER BY d.starts_at,a.assignment_role,a.id
           LIMIT 200`,
        [actor.tenantId],
      );
      return rows;
    });
  }
  updateAssignment(actor: Actor, id: string, key: string, raw: unknown) {
    const input = parse(assignmentUpdateSchema, raw);
    return this.db.command(
      actor,
      "departure_assignment.update",
      key,
      input,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          `SELECT id,departure_id,resource_id,crew_actor_id,assignment_role,status,override_reason
             FROM departure_assignments WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [actor.tenantId, id],
        );
        if (!before) throw new NotFoundException("Assignment not found");
        if (before.status !== "active")
          throw new BadRequestException(
            "Only active assignments can be edited",
          );
        await tx.query(
          `UPDATE departure_assignments SET assignment_role=$3
             WHERE tenant_id=$1 AND id=$2`,
          [actor.tenantId, id, input.assignmentRole],
        );
        await record(
          tx,
          actor,
          "departure_assignment.updated",
          id,
          before,
          input,
        );
        return { id, assignmentRole: input.assignmentRole };
      },
    );
  }
  cancelAssignment(actor: Actor, id: string, key: string) {
    return this.db.command(
      actor,
      "departure_assignment.cancel",
      key,
      { id },
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          `SELECT id,departure_id,resource_id,crew_actor_id,assignment_role,status,override_reason
             FROM departure_assignments WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [actor.tenantId, id],
        );
        if (!before) throw new NotFoundException("Assignment not found");
        if (before.status !== "active") return { id, status: before.status };
        await tx.query(
          `UPDATE departure_assignments SET status='cancelled'
             WHERE tenant_id=$1 AND id=$2`,
          [actor.tenantId, id],
        );
        await record(tx, actor, "departure_assignment.cancelled", id, before, {
          status: "cancelled",
        });
        return { id, status: "cancelled" };
      },
    );
  }
}
@Controller("ops/v1")
export class ResourceController {
  constructor(private readonly service: ResourceService) {}
  @Get("resources") @Access("resources.write") resources(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.listResources(actor);
  }
  @Get("crew") @Access("resources.write") crew(@CurrentActor() actor: Actor) {
    return this.service.listCrew(actor);
  }
  @Get("compliance-documents") @Access("documents.expiry.manage") documents(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.documents(actor);
  }
  @Get("document-library/usage")
  @Access("documents.expiry.manage")
  libraryUsage(@CurrentActor() actor: Actor) {
    return this.service.libraryUsage(actor);
  }
  @Get("compliance-documents/:id/file")
  @Access("documents.expiry.manage")
  documentFile(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.service.downloadDocument(actor, z.string().uuid().parse(id));
  }
  @Post("resources") @Access("resources.write") resource(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.createResource(actor, parse(keySchema, key), body);
  }
  @Patch("resources/:id") @Access("resources.write") resourceUpdate(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.updateResource(
      actor,
      z.string().uuid().parse(id),
      parse(keySchema, key),
      body,
    );
  }
  @Delete("resources/:id") @Access("resources.write") resourceDelete(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.deactivateResource(
      actor,
      z.string().uuid().parse(id),
      parse(keySchema, key),
    );
  }
  @Post("crew") @Access("resources.write") crewCreate(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.createCrew(actor, parse(keySchema, key), body);
  }
  @Patch("crew/:actorId") @Access("resources.write") crewUpdate(
    @CurrentActor() actor: Actor,
    @Param("actorId") actorId: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.updateCrew(
      actor,
      z.string().uuid().parse(actorId),
      parse(keySchema, key),
      body,
    );
  }
  @Delete("crew/:actorId") @Access("resources.write") crewDelete(
    @CurrentActor() actor: Actor,
    @Param("actorId") actorId: string,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.deactivateCrew(
      actor,
      z.string().uuid().parse(actorId),
      parse(keySchema, key),
    );
  }
  @Post("compliance-documents")
  @Access("documents.expiry.manage")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  document(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
    @UploadedFile()
    file?: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
      size: number;
    },
  ) {
    return this.service.createDocument(
      actor,
      parse(keySchema, key),
      body,
      file,
    );
  }
  @Patch("compliance-documents/:id")
  @Access("documents.expiry.manage")
  documentUpdate(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.updateDocument(
      actor,
      z.string().uuid().parse(id),
      parse(keySchema, key),
      body,
    );
  }
  @Delete("compliance-documents/:id")
  @Access("documents.expiry.manage")
  documentDelete(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.deleteDocument(
      actor,
      z.string().uuid().parse(id),
      parse(keySchema, key),
    );
  }
  @Post("assignments") @Access("assignments.write") assignment(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.createAssignment(actor, parse(keySchema, key), body);
  }
  @Get("assignments") @Access("assignments.write") assignmentList(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.listAssignments(actor);
  }
  @Patch("assignments/:id") @Access("assignments.write") assignmentUpdate(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.updateAssignment(
      actor,
      z.string().uuid().parse(id),
      parse(keySchema, key),
      body,
    );
  }
  @Delete("assignments/:id") @Access("assignments.write") assignmentDelete(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.cancelAssignment(
      actor,
      z.string().uuid().parse(id),
      parse(keySchema, key),
    );
  }
  @Get("departures/:id/assignments") @Access("manifest.read") assignments(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
  ) {
    return this.service.assignments(actor, z.string().uuid().parse(id));
  }
}
