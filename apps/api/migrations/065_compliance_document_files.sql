-- Long-lived compliance file metadata + per-tenant library quota.
-- Separate from document_artifacts (short-lived waiver PDF hot store).

ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS byte_size integer NOT NULL DEFAULT 0
    CHECK (byte_size >= 0),
  ADD COLUMN IF NOT EXISTS storage_key text;

CREATE INDEX IF NOT EXISTS compliance_documents_storage_usage
  ON compliance_documents(tenant_id)
  WHERE storage_key IS NOT NULL;

UPDATE tenants
SET config = config || jsonb_build_object(
  'documentLibrary',
  jsonb_build_object('quotaBytes', 1073741824)
)
WHERE NOT (config ? 'documentLibrary');
