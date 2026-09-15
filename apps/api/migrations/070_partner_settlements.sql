-- 070: Partner settlement periods.
-- One row per agreed settlement period; bookings are linked via partner_booking_links.

CREATE TABLE IF NOT EXISTS partner_settlements (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_id              uuid        NOT NULL,

  -- period covered
  period_start            date        NOT NULL,
  period_end              date        NOT NULL,

  -- pre-aggregated totals (kept in sync by generate_partner_settlement())
  booking_count           int         NOT NULL DEFAULT 0,
  gross_amount_minor      bigint      NOT NULL DEFAULT 0,
  commission_amount_minor bigint      NOT NULL DEFAULT 0,
  net_amount_minor        bigint      NOT NULL DEFAULT 0,     -- gross ± commission
  commission_direction    text        NOT NULL CHECK (commission_direction IN ('partner_owes_tenant','tenant_owes_partner')),
  currency                char(3)     NOT NULL DEFAULT 'XCD',

  -- lifecycle
  status                  text        NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft','invoiced','sent','paid','overdue','void')),
  due_date                date,
  invoice_number          text,
  invoice_pdf_path        text,
  payment_ref             text,
  paid_at                 timestamptz,
  voided_at               timestamptz,
  void_reason             text,
  notes                   text,

  created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Prevent duplicate overlapping non-void settlements for the same partner
CREATE UNIQUE INDEX IF NOT EXISTS partner_settlements_unique_period
  ON partner_settlements (tenant_id, partner_id, period_start, period_end)
  WHERE status <> 'void';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION partner_settlements_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partner_settlements_updated_at ON partner_settlements;
CREATE TRIGGER partner_settlements_updated_at
  BEFORE UPDATE ON partner_settlements
  FOR EACH ROW EXECUTE FUNCTION partner_settlements_set_updated_at();

-- RLS
ALTER TABLE partner_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_settlements_tenant ON partner_settlements;
CREATE POLICY partner_settlements_tenant ON partner_settlements
  USING (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON partner_settlements TO zettaz_runtime;

-- FK to partner_organizations using its composite PK
ALTER TABLE partner_settlements
  ADD CONSTRAINT ps_partner_fk
  FOREIGN KEY (tenant_id, partner_id) REFERENCES partner_organizations(tenant_id, id);

-- Now that partner_settlements exists, add the deferred FK from partner_booking_links
ALTER TABLE partner_booking_links
  ADD CONSTRAINT pbl_settlement_fk
  FOREIGN KEY (settlement_id) REFERENCES partner_settlements(id);

