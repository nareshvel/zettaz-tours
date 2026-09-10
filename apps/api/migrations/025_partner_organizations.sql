CREATE TABLE partner_organizations (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  status text NOT NULL CHECK(status IN ('active','inactive')) DEFAULT 'active',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,name)
);
ALTER TABLE partner_organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON partner_organizations
  USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);
INSERT INTO app_modules(code,name,description,sort_order)
VALUES ('partners','Partners','Tenant reseller and hotel organizations',47)
ON CONFLICT(code) DO NOTHING;
INSERT INTO permissions(code,module_code,name,description) VALUES
 ('partner.manage','partners','Manage partners','Create and manage tenant partner organizations'),
 ('partner.collection.record','partners','Record partner claims','Record an unverified partner collection claim'),
 ('partner.collection.verify','partners','Verify partner claims','Accept or reject a partner collection claim'),
 ('partner.statement.read','partners','Read partner statements','Read partner obligations and statement lines')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_code)
SELECT r.tenant_id,r.id,p.code FROM tenant_roles r JOIN permissions p ON p.code=ANY(CASE r.code
 WHEN 'owner' THEN ARRAY['partner.manage','partner.collection.record','partner.collection.verify','partner.statement.read']
 WHEN 'admin' THEN ARRAY['partner.manage']
 WHEN 'reservations' THEN ARRAY['partner.collection.record']
 WHEN 'finance' THEN ARRAY['partner.collection.record','partner.collection.verify','partner.statement.read']
 WHEN 'auditor' THEN ARRAY['partner.statement.read']
 WHEN 'partner_manager' THEN ARRAY['partner.manage']
 ELSE ARRAY[]::text[] END) ON CONFLICT DO NOTHING;
