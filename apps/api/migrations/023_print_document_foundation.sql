CREATE TABLE print_templates (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  template_key text NOT NULL,
  version integer NOT NULL,
  document_type text NOT NULL CHECK(document_type IN ('manifest','pickup_list','receipt','waiver')),
  name text NOT NULL,
  output_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK(status IN ('draft','published','archived')),
  is_default boolean NOT NULL DEFAULT false,
  published_by uuid NOT NULL REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,template_key,version)
);
CREATE UNIQUE INDEX one_published_default_template_per_document
  ON print_templates(tenant_id,document_type)
  WHERE is_default AND status='published';

CREATE TABLE printer_routes (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  station text NOT NULL,
  document_type text NOT NULL CHECK(document_type IN ('manifest','pickup_list','receipt','waiver')),
  template_id uuid,
  destination_type text NOT NULL CHECK(destination_type IN ('browser','agent')),
  destination_key text NOT NULL DEFAULT '',
  fallback_policy text NOT NULL CHECK(fallback_policy IN ('browser','hold')) DEFAULT 'browser',
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,station,document_type),
  FOREIGN KEY(tenant_id,template_id) REFERENCES print_templates(tenant_id,id)
);

CREATE TABLE print_jobs (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  document_type text NOT NULL CHECK(document_type IN ('manifest','pickup_list','receipt','waiver')),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  template_id uuid,
  route_id uuid,
  destination_type text NOT NULL CHECK(destination_type IN ('browser','agent')),
  status text NOT NULL CHECK(status IN ('requested','rendered','delivered','failed','cancelled')),
  rendered_artifact_path text,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  error_detail text,
  requested_by uuid NOT NULL REFERENCES staff_users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,template_id) REFERENCES print_templates(tenant_id,id),
  FOREIGN KEY(tenant_id,route_id) REFERENCES printer_routes(tenant_id,id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['print_templates','printer_routes','print_jobs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid)',t);
  END LOOP;
END $$;

INSERT INTO app_modules(code,name,description,sort_order)
VALUES ('print','Print & documents','Versioned operational documents and print jobs',46)
ON CONFLICT(code) DO NOTHING;
INSERT INTO permissions(code,module_code,name,description) VALUES
  ('print.templates.manage','print','Manage print templates','Publish and manage operational document templates'),
  ('print.jobs.create','print','Request print jobs','Request an auditable document output'),
  ('print.jobs.read','print','View print jobs','View tenant print job history')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_code)
SELECT r.tenant_id,r.id,p.code
FROM tenant_roles r JOIN permissions p ON p.code=ANY(CASE r.code
  WHEN 'owner' THEN ARRAY['print.templates.manage','print.jobs.create','print.jobs.read']
  WHEN 'admin' THEN ARRAY['print.templates.manage','print.jobs.create','print.jobs.read']
  WHEN 'dispatcher' THEN ARRAY['print.jobs.create','print.jobs.read']
  ELSE ARRAY[]::text[] END)
ON CONFLICT DO NOTHING;
