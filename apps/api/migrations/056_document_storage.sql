-- Hot document artifacts: short-lived PDF copies before archive sync-out.
-- Production hot retention is capped at 7 days unless a purchased storage plan
-- extends it later. Successful archive sync deletes the hot object immediately.

CREATE TABLE document_artifacts (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  document_type text NOT NULL CHECK(document_type IN ('waiver','manifest','pickup_list','receipt')),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  content_hash text NOT NULL,
  hot_provider text NOT NULL CHECK(hot_provider IN ('filesystem','s3')),
  hot_path text,
  byte_size integer NOT NULL CHECK(byte_size >= 0),
  retention_expires_at timestamptz NOT NULL,
  archive_provider text NOT NULL CHECK(archive_provider IN ('none','google_drive','onedrive','dropbox')),
  archive_status text NOT NULL CHECK(archive_status IN (
    'hot_only','sync_pending','synced','sync_blocked','purged'
  )) DEFAULT 'hot_only',
  archive_ref text,
  archive_error text,
  purged_at timestamptz,
  created_by uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  synced_at timestamptz,
  PRIMARY KEY(tenant_id,id)
);
CREATE INDEX document_artifacts_retention
  ON document_artifacts(tenant_id,retention_expires_at)
  WHERE purged_at IS NULL AND hot_path IS NOT NULL;
CREATE INDEX document_artifacts_sync
  ON document_artifacts(tenant_id,archive_status)
  WHERE archive_status IN ('sync_pending','sync_blocked');

ALTER TABLE document_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON document_artifacts
  USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);

-- Backfill tenant config defaults for document storage (≤7 day hot retention).
UPDATE tenants
SET config = config || jsonb_build_object(
  'documentStorage',
  jsonb_build_object(
    'hotProvider', 'filesystem',
    'archiveProvider', 'none',
    'hotRetentionDays', 7
  )
)
WHERE NOT (config ? 'documentStorage');
