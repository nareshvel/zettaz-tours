CREATE TABLE waiver_templates (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, version integer NOT NULL,
  title text NOT NULL, body text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,version)
);
CREATE TABLE waiver_signatures (
  tenant_id uuid NOT NULL, id uuid NOT NULL, booking_id uuid NOT NULL, template_id uuid NOT NULL,
  template_version integer NOT NULL, signer_name text NOT NULL, signer_capacity text NOT NULL,
  recorded_by uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id),
  FOREIGN KEY(tenant_id,template_id) REFERENCES waiver_templates(tenant_id,id),
  FOREIGN KEY(tenant_id,recorded_by) REFERENCES memberships(tenant_id,actor_id)
);
CREATE INDEX waiver_signatures_booking ON waiver_signatures(tenant_id,booking_id,occurred_at);
ALTER TABLE waiver_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE waiver_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY waiver_templates_tenant ON waiver_templates USING (tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK (tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY waiver_signatures_tenant ON waiver_signatures USING (tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK (tenant_id=current_setting('app.tenant_id',true)::uuid);
