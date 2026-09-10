CREATE TABLE app_modules (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  sort_order integer NOT NULL
);
CREATE TABLE permissions (
  code text PRIMARY KEY,
  module_code text NOT NULL REFERENCES app_modules(code),
  name text NOT NULL,
  description text NOT NULL
);
CREATE TABLE tenant_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,code), UNIQUE(tenant_id,name)
);
CREATE TABLE role_permissions (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  role_id uuid NOT NULL REFERENCES tenant_roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code),
  PRIMARY KEY(tenant_id,role_id,permission_code)
);
ALTER TABLE memberships ADD COLUMN role_id uuid REFERENCES tenant_roles(id);
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;

INSERT INTO app_modules(code,name,description,sort_order) VALUES
 ('workspace','Workspace','Overview and operational read access',10),
 ('catalog','Catalog','Products, schedules and rates',20),
 ('reservations','Reservations','Bookings and payment recording',30),
 ('operations','Operations','Manifests and departure operations',40),
 ('settings','Settings','Tenant configuration',50),
 ('identity','Identity','Users and roles',60),
 ('documents','Documents','Waiver templates',70),
 ('audit','Audit','Audit trail access',80)
ON CONFLICT (code) DO NOTHING;
INSERT INTO permissions(code,module_code,name,description) VALUES
 ('catalog.read','catalog','View catalog','View products and schedules'),
 ('catalog.write','catalog','Manage catalog','Create and update products and schedules'),
 ('bookings.read','reservations','View reservations','View bookings and booking details'),
 ('bookings.write','reservations','Manage reservations','Create, amend and cancel bookings'),
 ('payment.write','reservations','Record payments','Record approved manual payments'),
 ('manifest.read','operations','View manifests','View departure manifests and pickup lists'),
 ('operations.write','operations','Manage operations','Manage pickup plans and operational status'),
 ('config.write','settings','Manage tenant settings','Update tenant configuration and branding'),
 ('members.write','identity','Manage users and roles','Manage tenant staff and role assignments'),
 ('waiver.template.publish','documents','Manage waiver templates','Create waiver template versions'),
 ('audit.read','audit','View audit trail','View tenant audit events')
ON CONFLICT (code) DO NOTHING;
INSERT INTO tenant_roles(tenant_id,code,name,is_system)
SELECT DISTINCT tenant_id,role,initcap(replace(role,'_',' ')),true FROM memberships
ON CONFLICT(tenant_id,code) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_code)
SELECT m.tenant_id,r.id,permission_code
FROM memberships m JOIN tenant_roles r ON r.tenant_id=m.tenant_id AND r.code=m.role
CROSS JOIN LATERAL unnest(m.permissions) permission_code
ON CONFLICT DO NOTHING;
UPDATE memberships m SET role_id=r.id FROM tenant_roles r
WHERE r.tenant_id=m.tenant_id AND r.code=m.role AND m.role_id IS NULL;
ALTER TABLE memberships ALTER COLUMN role_id SET NOT NULL;

CREATE OR REPLACE FUNCTION resolve_session(token text)
RETURNS TABLE(actor_id uuid, tenant_id uuid, platform boolean, permissions text[], role text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.actor_id, NULL::uuid, true, ARRAY['tenant.provision']::text[], 'platform'
  FROM platform_sessions s WHERE token_hash=token AND NOT revoked AND expires_at>clock_timestamp()
  UNION ALL
  SELECT s.actor_id,s.tenant_id,false,
    ARRAY(SELECT rp.permission_code FROM role_permissions rp WHERE rp.tenant_id=s.tenant_id AND rp.role_id=m.role_id ORDER BY rp.permission_code),
    r.code
  FROM staff_sessions s JOIN memberships m USING(tenant_id,actor_id)
  JOIN tenant_roles r ON r.id=m.role_id
  WHERE token_hash=token AND NOT revoked AND expires_at>clock_timestamp() AND m.active;
$$;
ALTER TABLE tenant_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON tenant_roles USING (tenant_id=nullif(current_setting('app.tenant',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);
CREATE POLICY tenant_scope ON role_permissions USING (tenant_id=nullif(current_setting('app.tenant',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);
