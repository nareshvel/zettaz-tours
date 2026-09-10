CREATE TABLE payment_adjustments (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  payment_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('void','reversal')),
  reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 120),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500),
  occurred_at timestamptz NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,payment_id),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES payments(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,actor_id)
);

ALTER TABLE payment_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON payment_adjustments
  USING(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant',true),'')::uuid);
CREATE TRIGGER payment_adjustments_append_only BEFORE UPDATE OR DELETE ON payment_adjustments
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

INSERT INTO permissions(code,module_code,name,description) VALUES
 ('payment.correct','reservations','Correct payments','Void pending manual entries or record an external reversal')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(tenant_id,role_id,permission_code)
SELECT tenant_id,id,'payment.correct' FROM tenant_roles WHERE code IN ('owner','finance')
ON CONFLICT DO NOTHING;
