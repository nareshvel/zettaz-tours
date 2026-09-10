CREATE TABLE external_mappings (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, connector_account_id uuid NOT NULL,
  entity_type text NOT NULL CHECK(entity_type IN ('product','option')),
  external_id text NOT NULL, internal_product_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES staff_users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,connector_account_id,entity_type,external_id),
  FOREIGN KEY(tenant_id,connector_account_id) REFERENCES connector_accounts(tenant_id,id),
  FOREIGN KEY(tenant_id,internal_product_id) REFERENCES products(tenant_id,id)
);
ALTER TABLE external_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON external_mappings USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);
