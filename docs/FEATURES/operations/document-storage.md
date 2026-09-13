# Document storage and short-lived PDF retention

## Purpose

Keep signed waiver (and later operational) PDFs off the production server as soon as possible. Hot copies exist only to complete an archive sync-out.

## Policy

- **Waiver evidence is database-first.** Signature strokes, stay snapshot, template version, and consent live in `waiver_signatures`. Staff can review the signed waiver any time from the boarding screen; a PDF hot copy is not required for day-of operations.
- Optional short-lived PDF / drive archive remains available for other operational documents and future export needs, with hot retention **at most 7 days**.
- When a tenant selects Google Drive, OneDrive, or Dropbox for archive sync, successful sync deletes the hot object.
- Longer retention on the platform requires a purchased storage plan. That entitlement is not implemented yet.

## Tenant setting

`TenantConfig.documentStorage`:

| Field | Values | Notes |
| --- | --- | --- |
| `hotProvider` | `filesystem`, `s3` | Filesystem/volume is the default. S3-compatible is labeled and env-gated. |
| `archiveProvider` | `none`, `google_drive`, `onedrive`, `dropbox` | Drive OAuth adapters are feature-flagged. |
| `hotRetentionDays` | 1–7 | Hard-capped at 7. |

Configured under **Settings → Printers & documents**.

## Runtime

- Hot files live under `DOCUMENT_HOT_ROOT` (default `.local/document-hot`).
- Signing a passenger waiver writes `document_artifacts`, records audit, and enqueues `document.archive_requested` when an archive provider is set.
- `npm run outbox:drain` drains outbox events, attempts archive sync, then purges expired hot objects.
- `DOCUMENT_ARCHIVE_ADAPTERS=1` is required before drive adapters may run. Until credentials are approved, sync stays `sync_blocked` and hot purge still applies at expiry.

## Boundary

Database waiver signature strokes remain the authoritative evidence. The PDF is a derived operational copy for archive destinations, not a second source of truth.

## Not the compliance document library

Staff and fleet **compliance documents** (licenses, insurance, inspections) use a separate long-lived store under `DOCUMENT_LIBRARY_ROOT` (default `.local/document-library`), keyed as `{tenantId}/compliance/{crew|resource}/{subjectId}/{fileId}.{ext}`. Metadata and byte sizes live on `compliance_documents`. Tenant quota is `TenantConfig.documentLibrary.quotaBytes` (default 1 GiB) and uploads are hard-blocked when exceeded. See [resources-and-assignments.md](resources-and-assignments.md). Do not route compliance files through `document_artifacts` or the 7-day hot purge.
