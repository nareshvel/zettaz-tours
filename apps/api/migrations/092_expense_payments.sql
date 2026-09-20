-- 092: Expense payments (vendor cash-out). A bill stays on expenses; money
-- that actually left is an append-only payment row. Void never deletes.

CREATE TABLE expense_payments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expense_id    uuid        NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  amount_minor  bigint      NOT NULL CHECK (amount_minor > 0),
  currency      char(3)     NOT NULL,
  paid_on       date        NOT NULL,
  paid_at       timestamptz NOT NULL DEFAULT now(),
  method        text        NOT NULL CHECK (method IN ('cash','bank_transfer','card','other')),
  reference     text,
  notes         text,
  recorded_by   uuid        NOT NULL,
  voided_at     timestamptz,
  void_reason   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON expense_payments(tenant_id, expense_id);
CREATE INDEX ON expense_payments(tenant_id, paid_on DESC);

ALTER TABLE expense_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY expense_payments_tenant ON expense_payments
  USING (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);
