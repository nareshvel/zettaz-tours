CREATE TABLE booking_partner_attributions (
  tenant_id uuid NOT NULL REFERENCES tenants(id), booking_id uuid NOT NULL,
  partner_id uuid NOT NULL, external_reference text NOT NULL DEFAULT '',
  collection_mode text NOT NULL CHECK(collection_mode IN ('guest_pays_tenant','partner_collects_for_tenant','partner_invoice')),
  invoice_required boolean NOT NULL DEFAULT false, updated_by uuid NOT NULL REFERENCES staff_users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,booking_id),
  FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id),
  FOREIGN KEY(tenant_id,partner_id) REFERENCES partner_organizations(tenant_id,id)
);
CREATE TABLE booking_partner_snapshots (
  tenant_id uuid NOT NULL REFERENCES tenants(id), booking_id uuid NOT NULL, booking_version integer NOT NULL,
  partner_id uuid NOT NULL, external_reference text NOT NULL, collection_mode text NOT NULL,
  invoice_required boolean NOT NULL, total_minor bigint NOT NULL, currency text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,booking_id,booking_version),
  FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id), FOREIGN KEY(tenant_id,partner_id) REFERENCES partner_organizations(tenant_id,id)
);
CREATE TABLE partner_collection_claims (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, booking_id uuid NOT NULL, partner_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0), currency text NOT NULL, reference text NOT NULL, notes text NOT NULL DEFAULT '',
  recorded_by uuid NOT NULL REFERENCES staff_users(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id), FOREIGN KEY(tenant_id,partner_id) REFERENCES partner_organizations(tenant_id,id)
);
CREATE TABLE partner_claim_decisions (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, claim_id uuid NOT NULL, decision text NOT NULL CHECK(decision IN ('accepted','rejected')),
  reason text NOT NULL, decided_by uuid NOT NULL REFERENCES staff_users(id), decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,claim_id), FOREIGN KEY(tenant_id,claim_id) REFERENCES partner_collection_claims(tenant_id,id)
);
CREATE TABLE partner_obligations (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, booking_id uuid NOT NULL, partner_id uuid NOT NULL,
  claim_id uuid, amount_minor bigint NOT NULL CHECK(amount_minor>0), currency text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('partner_collection','partner_invoice')), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id),
  FOREIGN KEY(tenant_id,partner_id) REFERENCES partner_organizations(tenant_id,id), FOREIGN KEY(tenant_id,claim_id) REFERENCES partner_collection_claims(tenant_id,id)
);
CREATE UNIQUE INDEX one_partner_claim_obligation ON partner_obligations(tenant_id,claim_id) WHERE claim_id IS NOT NULL;
CREATE TRIGGER partner_snapshot_append_only BEFORE UPDATE OR DELETE ON booking_partner_snapshots FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER partner_claim_append_only BEFORE UPDATE OR DELETE ON partner_collection_claims FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER partner_decision_append_only BEFORE UPDATE OR DELETE ON partner_claim_decisions FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER partner_obligation_append_only BEFORE UPDATE OR DELETE ON partner_obligations FOR EACH ROW EXECUTE FUNCTION reject_mutation();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['booking_partner_attributions','booking_partner_snapshots','partner_collection_claims','partner_claim_decisions','partner_obligations'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant'',true),'''')::uuid)',t); END LOOP; END $$;
