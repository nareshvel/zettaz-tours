CREATE TABLE connector_accounts (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
  connector_code text NOT NULL CHECK(connector_code IN ('wp_travel_engine')),
  public_inbound_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK(status IN ('disabled','enabled')) DEFAULT 'disabled',
  secret_ciphertext text NOT NULL,
  secret_key_version text NOT NULL,
  created_by uuid NOT NULL REFERENCES staff_users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,connector_code)
);
CREATE TABLE webhook_inbox (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
  connector_account_id uuid NOT NULL, external_event_id text NOT NULL,
  payload_hash text NOT NULL, payload jsonb NOT NULL, status text NOT NULL CHECK(status IN ('received','quarantined','processed')),
  failure_reason text NOT NULL DEFAULT '', received_at timestamptz NOT NULL DEFAULT clock_timestamp(), processed_at timestamptz,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,connector_account_id,external_event_id),
  FOREIGN KEY(tenant_id,connector_account_id) REFERENCES connector_accounts(tenant_id,id)
);
CREATE INDEX webhook_inbox_review ON webhook_inbox(tenant_id,status,received_at DESC,id);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['connector_accounts','webhook_inbox'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid)',t); END LOOP; END $$;
INSERT INTO app_modules(code,name,description,sort_order) VALUES ('integrations','Integrations','Inbound connector accounts and review inbox',48) ON CONFLICT(code) DO NOTHING;
INSERT INTO permissions(code,module_code,name,description) VALUES ('integration.manage','integrations','Manage integrations','Create and configure tenant connector accounts'),('integration.inbox.read','integrations','Read integration inbox','Review inbound connector events') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_code)
SELECT r.tenant_id,r.id,p.code FROM tenant_roles r JOIN permissions p ON p.code=ANY(CASE r.code WHEN 'owner' THEN ARRAY['integration.manage','integration.inbox.read'] WHEN 'admin' THEN ARRAY['integration.manage','integration.inbox.read'] WHEN 'auditor' THEN ARRAY['integration.inbox.read'] ELSE ARRAY[]::text[] END) ON CONFLICT DO NOTHING;
