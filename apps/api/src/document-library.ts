import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Actor,
  TenantConfig,
} from "../../../packages/shared/src/contracts";
import { Database } from "./database";

export const LIBRARY_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const LIBRARY_DEFAULT_QUOTA_BYTES = 1073741824;

const CONTENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type LibrarySubjectKind = "crew" | "resource";

export type UploadedLibraryFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

export function libraryRoot() {
  return (
    process.env.DOCUMENT_LIBRARY_ROOT?.trim() ||
    path.resolve(process.cwd(), ".local/document-library")
  );
}

export function libraryQuotaBytes(
  config: TenantConfig["documentLibrary"] | undefined,
) {
  const raw = config?.quotaBytes;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  return LIBRARY_DEFAULT_QUOTA_BYTES;
}

export function assertLibraryFile(file: UploadedLibraryFile) {
  const ext = CONTENT_TYPES[file.mimetype];
  if (!ext)
    throw new BadRequestException(
      "Upload a PDF, JPG, PNG, or WebP file under 10 MB",
    );
  if (file.size <= 0 || file.size > LIBRARY_MAX_FILE_BYTES)
    throw new BadRequestException(
      "Upload a PDF, JPG, PNG, or WebP file under 10 MB",
    );
  return ext;
}

export function assertLibraryQuota(
  usedBytes: number,
  incoming: number,
  quota: number,
) {
  if (usedBytes + incoming > quota)
    throw new PayloadTooLargeException(
      "Document library storage quota exceeded. Remove files or increase the allowance.",
    );
}

export function relativeStorageKey(
  tenantId: string,
  kind: LibrarySubjectKind,
  subjectId: string,
  fileId: string,
  ext: string,
) {
  return path.posix.join(
    tenantId,
    "compliance",
    kind,
    subjectId,
    `${fileId}.${ext}`,
  );
}

export function absoluteLibraryPath(storageKey: string) {
  const root = libraryRoot();
  const absolute = path.resolve(root, storageKey);
  if (!absolute.startsWith(path.resolve(root) + path.sep))
    throw new BadRequestException("Invalid storage key");
  return absolute;
}

@Injectable()
export class DocumentLibraryService {
  constructor(private readonly db: Database) {}

  usage(actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [tenant],
      } = await tx.query("SELECT config FROM tenants WHERE id=$1", [
        actor.tenantId,
      ]);
      const quotaBytes = libraryQuotaBytes(
        (tenant?.config as TenantConfig | undefined)?.documentLibrary,
      );
      const {
        rows: [row],
      } = await tx.query(
        `SELECT COALESCE(SUM(byte_size),0)::int AS used_bytes,
                COUNT(*) FILTER (WHERE storage_key IS NOT NULL)::int AS file_count
           FROM compliance_documents WHERE tenant_id=$1`,
        [actor.tenantId],
      );
      return {
        usedBytes: Number(row?.used_bytes ?? 0),
        quotaBytes,
        fileCount: Number(row?.file_count ?? 0),
      };
    });
  }

  async writeSubjectFile(
    tenantId: string,
    kind: LibrarySubjectKind,
    subjectId: string,
    file: UploadedLibraryFile,
  ) {
    const ext = assertLibraryFile(file);
    const fileId = randomUUID();
    const storageKey = relativeStorageKey(
      tenantId,
      kind,
      subjectId,
      fileId,
      ext,
    );
    const absolute = absoluteLibraryPath(storageKey);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, file.buffer);
    return {
      storageKey,
      fileName: path
        .basename(file.originalname || `document.${ext}`)
        .slice(0, 200),
      contentType: file.mimetype,
      byteSize: file.size,
    };
  }

  async deleteStoredFile(storageKey: string | null | undefined) {
    if (!storageKey) return;
    try {
      await unlink(absoluteLibraryPath(storageKey));
    } catch {
      /* missing file is fine after delete */
    }
  }
}
