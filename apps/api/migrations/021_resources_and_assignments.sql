CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE operational_resources (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  capacity integer CHECK(capacity IS NULL OR capacity > 0),
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,code)
);

CREATE TABLE crew_profiles (
  tenant_id uuid NOT NULL,
  membership_actor_id uuid NOT NULL,
  operational_name text NOT NULL,
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,membership_actor_id),
  FOREIGN KEY(tenant_id,membership_actor_id)
    REFERENCES memberships(tenant_id,actor_id)
);

CREATE TABLE compliance_documents (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  resource_id uuid,
  crew_actor_id uuid,
  document_type text NOT NULL,
  expires_on date NOT NULL,
  evidence_path text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  PRIMARY KEY(tenant_id,id),
  CHECK((resource_id IS NOT NULL)::int + (crew_actor_id IS NOT NULL)::int = 1),
  FOREIGN KEY(tenant_id,resource_id) REFERENCES operational_resources(tenant_id,id),
  FOREIGN KEY(tenant_id,crew_actor_id) REFERENCES crew_profiles(tenant_id,membership_actor_id)
);

CREATE TABLE departure_assignments (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  departure_id uuid NOT NULL,
  resource_id uuid,
  crew_actor_id uuid,
  assignment_role text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  override_reason text,
  assigned_by uuid NOT NULL,
  PRIMARY KEY(tenant_id,id),
  CHECK(ends_at > starts_at),
  CHECK((resource_id IS NOT NULL)::int + (crew_actor_id IS NOT NULL)::int = 1),
  CHECK((override_reason IS NULL) OR length(trim(override_reason)) > 0),
  FOREIGN KEY(tenant_id,departure_id) REFERENCES departures(tenant_id,id),
  FOREIGN KEY(tenant_id,resource_id) REFERENCES operational_resources(tenant_id,id),
  FOREIGN KEY(tenant_id,crew_actor_id) REFERENCES crew_profiles(tenant_id,membership_actor_id),
  FOREIGN KEY(tenant_id,assigned_by) REFERENCES memberships(tenant_id,actor_id)
);

ALTER TABLE departure_assignments ADD CONSTRAINT no_overlapping_resource_assignment
  EXCLUDE USING gist (tenant_id WITH =, resource_id WITH =,
    tstzrange(starts_at,ends_at,'[)') WITH &&)
  WHERE (status='active' AND resource_id IS NOT NULL);
ALTER TABLE departure_assignments ADD CONSTRAINT no_overlapping_crew_assignment
  EXCLUDE USING gist (tenant_id WITH =, crew_actor_id WITH =,
    tstzrange(starts_at,ends_at,'[)') WITH &&)
  WHERE (status='active' AND crew_actor_id IS NOT NULL);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['operational_resources','crew_profiles','compliance_documents','departure_assignments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid)',t);
  END LOOP;
END $$;

INSERT INTO permissions(code,module_code,name,description) VALUES
  ('resources.write','operations','Manage resources','Manage operational resources and crew profiles'),
  ('documents.expiry.manage','operations','Manage expiry documents','Record resource and crew compliance documents'),
  ('assignments.write','operations','Manage assignments','Assign crew and resources to departures'),
  ('safety.assignment.override','operations','Override assignment safety block','Override an expiry block with an audited reason')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(tenant_id,role_id,permission_code)
SELECT r.tenant_id,r.id,p.code
FROM tenant_roles r
JOIN permissions p ON p.code=ANY(CASE r.code
  WHEN 'owner' THEN ARRAY['resources.write','documents.expiry.manage','assignments.write','safety.assignment.override']
  WHEN 'admin' THEN ARRAY['resources.write','documents.expiry.manage','assignments.write']
  WHEN 'dispatcher' THEN ARRAY['assignments.write']
  ELSE ARRAY[]::text[] END)
ON CONFLICT DO NOTHING;
