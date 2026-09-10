CREATE TABLE assisted_imports (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, source text NOT NULL, status text NOT NULL CHECK(status IN ('draft','validated','quarantined','applied')),
  created_by uuid NOT NULL REFERENCES staff_users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id)
);
CREATE TABLE assisted_import_rows (
  tenant_id uuid NOT NULL, id uuid NOT NULL, import_id uuid NOT NULL, row_number integer NOT NULL CHECK(row_number>0), payload jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('valid','quarantined','applied')), failure_reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,import_id,row_number), FOREIGN KEY(tenant_id,import_id) REFERENCES assisted_imports(tenant_id,id)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['assisted_imports','assisted_import_rows'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid)',t); END LOOP; END $$;
