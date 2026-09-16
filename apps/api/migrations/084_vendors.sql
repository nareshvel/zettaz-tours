-- Vendor directory for expense entry
CREATE TABLE vendors (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text        NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 200),
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vendors_tenant_name ON vendors(tenant_id, lower(name));
CREATE INDEX ON vendors(tenant_id, is_active, name);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendors_tenant ON vendors
  USING (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);
