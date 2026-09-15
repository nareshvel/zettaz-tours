-- SECURITY DEFINER functions for partner settlement operations.
-- These run as zettaz_owner so they can write to multiple tables
-- in one atomic transaction while the runtime role stays unprivileged.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. link_booking_to_partner
--    Attributes a booking to a partner, calculates commission, and creates
--    the immutable snapshot in partner_booking_links.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION link_booking_to_partner(
  p_tenant_id       uuid,
  p_partner_id      uuid,
  p_booking_id      uuid,
  p_gross_amount_minor bigint,
  p_pax_count       int,
  p_source          text DEFAULT 'manual',
  p_external_ref    text DEFAULT NULL,
  p_created_by      uuid DEFAULT NULL
)
RETURNS partner_booking_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner      partner_organizations%ROWTYPE;
  v_commission   bigint;
  v_link         partner_booking_links%ROWTYPE;
BEGIN
  -- Fetch partner and validate tenant ownership
  SELECT * INTO v_partner
  FROM partner_organizations
  WHERE id = p_partner_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_not_found';
  END IF;

  IF v_partner.commission_direction IS NULL THEN
    RAISE EXCEPTION 'partner_commission_not_configured';
  END IF;

  -- Calculate commission based on type
  v_commission := CASE v_partner.commission_type
    WHEN 'percentage'       THEN ROUND(p_gross_amount_minor * v_partner.commission_rate)
    WHEN 'flat_per_booking' THEN v_partner.commission_amount_minor
    WHEN 'flat_per_pax'     THEN v_partner.commission_amount_minor * p_pax_count
    WHEN 'net_rate'         THEN 0
    ELSE 0
  END;

  -- Insert link (unique index prevents duplicates on same booking+partner)
  INSERT INTO partner_booking_links (
    tenant_id,
    partner_id,
    booking_id,
    gross_amount_minor,
    pax_count,
    commission_type,
    commission_rate,
    commission_amount_minor,
    commission_direction,
    currency,
    source,
    external_ref,
    created_by
  ) VALUES (
    p_tenant_id,
    p_partner_id,
    p_booking_id,
    p_gross_amount_minor,
    p_pax_count,
    v_partner.commission_type,
    v_partner.commission_rate,
    v_commission,
    v_partner.commission_direction,
    v_partner.commission_currency,
    p_source,
    p_external_ref,
    p_created_by
  )
  RETURNING * INTO v_link;

  RETURN v_link;
END;
$$;

GRANT EXECUTE ON FUNCTION link_booking_to_partner TO zettaz_runtime;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. generate_partner_settlement
--    Aggregates unsettled booking links for a partner in a period into a
--    new settlement record, marks the links as settled, and returns the
--    settlement row.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_partner_settlement(
  p_tenant_id    uuid,
  p_partner_id   uuid,
  p_period_start date,
  p_period_end   date,
  p_created_by   uuid DEFAULT NULL
)
RETURNS partner_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner     partner_organizations%ROWTYPE;
  v_settlement  partner_settlements%ROWTYPE;
  v_agg         RECORD;
BEGIN
  SELECT * INTO v_partner
  FROM partner_organizations
  WHERE id = p_partner_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_not_found';
  END IF;

  -- Aggregate unsettled links in the period
  SELECT
    COUNT(*)                        AS booking_count,
    COALESCE(SUM(gross_amount_minor), 0)      AS gross_total,
    COALESCE(SUM(commission_amount_minor), 0) AS commission_total,
    MAX(commission_direction)       AS direction,
    MAX(currency)                   AS currency
  INTO v_agg
  FROM partner_booking_links pbl
  JOIN bookings b ON b.id = pbl.booking_id
  WHERE pbl.tenant_id    = p_tenant_id
    AND pbl.partner_id   = p_partner_id
    AND pbl.settlement_id IS NULL
    AND pbl.unlinked_at  IS NULL
    AND b.starts_at::date BETWEEN p_period_start AND p_period_end;

  IF v_agg.booking_count = 0 THEN
    RAISE EXCEPTION 'no_unsettled_bookings_in_period';
  END IF;

  -- Create the settlement record
  INSERT INTO partner_settlements (
    tenant_id,
    partner_id,
    period_start,
    period_end,
    booking_count,
    gross_amount_minor,
    commission_amount_minor,
    net_amount_minor,
    commission_direction,
    currency,
    due_date,
    created_by
  ) VALUES (
    p_tenant_id,
    p_partner_id,
    p_period_start,
    p_period_end,
    v_agg.booking_count,
    v_agg.gross_total,
    v_agg.commission_total,
    v_agg.gross_total - v_agg.commission_total,
    v_agg.direction,
    v_agg.currency,
    p_period_end + (v_partner.payment_terms_days || ' days')::interval,
    p_created_by
  )
  RETURNING * INTO v_settlement;

  -- Stamp the booking links with the new settlement id
  UPDATE partner_booking_links pbl
  SET
    settlement_id = v_settlement.id,
    settled_at    = clock_timestamp()
  FROM bookings b
  WHERE pbl.tenant_id    = p_tenant_id
    AND pbl.partner_id   = p_partner_id
    AND pbl.settlement_id IS NULL
    AND pbl.unlinked_at  IS NULL
    AND pbl.booking_id   = b.id
    AND b.starts_at::date BETWEEN p_period_start AND p_period_end;

  RETURN v_settlement;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_partner_settlement TO zettaz_runtime;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. advance_settlement_status
--    Moves a settlement through its lifecycle.  Validates the transition,
--    sets paid_at / voided_at where appropriate.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION advance_settlement_status(
  p_tenant_id      uuid,
  p_settlement_id  uuid,
  p_new_status     text,
  p_payment_ref    text  DEFAULT NULL,
  p_invoice_number text  DEFAULT NULL,
  p_invoice_pdf    text  DEFAULT NULL,
  p_void_reason    text  DEFAULT NULL,
  p_notes          text  DEFAULT NULL
)
RETURNS partner_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement  partner_settlements%ROWTYPE;
  v_allowed     text[];
BEGIN
  SELECT * INTO v_settlement
  FROM partner_settlements
  WHERE id = p_settlement_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found';
  END IF;

  -- Validate allowed transitions
  v_allowed := CASE v_settlement.status
    WHEN 'draft'     THEN ARRAY['invoiced', 'void']
    WHEN 'invoiced'  THEN ARRAY['sent', 'paid', 'void']
    WHEN 'sent'      THEN ARRAY['paid', 'overdue', 'void']
    WHEN 'overdue'   THEN ARRAY['paid', 'void']
    WHEN 'paid'      THEN ARRAY['void']   -- voiding a paid settlement is allowed (rare)
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_new_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid_status_transition: % → %', v_settlement.status, p_new_status;
  END IF;

  UPDATE partner_settlements SET
    status         = p_new_status,
    payment_ref    = COALESCE(p_payment_ref,    payment_ref),
    invoice_number = COALESCE(p_invoice_number, invoice_number),
    invoice_pdf_path = COALESCE(p_invoice_pdf,  invoice_pdf_path),
    void_reason    = CASE WHEN p_new_status = 'void' THEN p_void_reason ELSE void_reason END,
    voided_at      = CASE WHEN p_new_status = 'void' THEN clock_timestamp() ELSE voided_at END,
    paid_at        = CASE WHEN p_new_status = 'paid' THEN clock_timestamp() ELSE paid_at END,
    notes          = COALESCE(p_notes, notes)
  WHERE id = p_settlement_id
  RETURNING * INTO v_settlement;

  RETURN v_settlement;
END;
$$;

GRANT EXECUTE ON FUNCTION advance_settlement_status TO zettaz_runtime;
