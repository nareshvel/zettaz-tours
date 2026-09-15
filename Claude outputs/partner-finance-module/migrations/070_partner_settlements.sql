-- Partner settlement batches. A settlement groups unsettled partner_booking_links
-- for a partner within a period into one payable/receivable record.
--
-- Denormalised totals (booking_count, gross_amount_minor, commission_amount_minor,
-- net_amount_minor) are computed at generation time and stored here for fast display.
-- They are recalculated on demand but never auto-updated after status = 'paid'.
--
-- Lifecycle: draft → invoiced → sent → paid  (or any state → void)
-- commission_direction mirrors the partner's direction at generation time.

CREATE TABLE IF NOT EXISTS partner_settlements (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  partner_id              uuid        NOT NULL REFERENCES partner_organizations (id),

  -- Period covered by this settlement
  period_start            date        NOT NULL,
  period_end              date        NOT NULL,

  -- Denormalised aggregates (calculated at generation)
  booking_count           int         NOT NULL DEFAULT 0,
  gross_amount_minor      bigint      NOT NULL DEFAULT 0,
  commission_amount_minor bigint      NOT NULL DEFAULT 0,
  net_amount_minor        bigint      NOT NULL DEFAULT 0,  -- gross - commission for partner_owes_tenant
  commission_direction    text        NOT NULL CHECK (commission_direction IN ('partner_owes_tenant', 'tenant_owes_partner')),
  currency                char(3)     NOT NULL DEFAULT 'XCD',

  -- Lifecycle
  status                  text        NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'invoiced', 'sent', 'paid', 'overdue', 'void')),
  due_date                date,
  invoice_number          text,
  invoice_pdf_path        text,   -- path in document library (Track A: manual upload; Track B: auto-generated)
  payment_ref             text,   -- bank transfer ref, Stripe payout ID, cheque number etc.
  paid_at                 timestamptz,
  voided_at               timestamptz,
  void_reason             text,

  notes                   text,

  created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- No overlapping periods for the same partner (prevent double-settlement)
CREATE UNIQUE INDEX IF NOT EXISTS partner_settlements_no_period_overlap
  ON partner_settlements (tenant_id, partner_id, period_start, period_end)
  WHERE status <> 'void';

-- Fast filter: Finance tab summary cards (unsettled / overdue)
CREATE INDEX IF NOT EXISTS partner_settlements_tenant_status
  ON partner_settlements (tenant_id, status, commission_direction);

-- Per-partner settlement history
CREATE INDEX IF NOT EXISTS partner_settlements_partner_created
  ON partner_settlements (tenant_id, partner_id, created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION partner_settlements_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partner_settlements_updated_at ON partner_settlements;
CREATE TRIGGER partner_settlements_updated_at
  BEFORE UPDATE ON partner_settlements
  FOR EACH ROW EXECUTE FUNCTION partner_settlements_set_updated_at();

-- RLS
ALTER TABLE partner_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY partner_settlements_tenant_isolation ON partner_settlements
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON partner_settlements TO zettaz_runtime;
