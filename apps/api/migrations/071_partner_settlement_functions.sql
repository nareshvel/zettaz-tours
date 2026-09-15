-- 071: SECURITY DEFINER functions for partner settlement operations.
-- All three functions run as zettaz_owner to cross the RLS boundary atomically.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. link_booking_to_partner
--    Computes the commission for a booking and inserts a partner_booking_links row.
--    Raises an exception if the partner's commission is not configured.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION link_booking_to_partner(
  p_tenant_id             uuid,
  p_partner_id            uuid,
  p_booking_id            uuid,
  p_gross_amount_minor    bigint,
  p_pax_count             int,
  p_source                text,
  p_external_ref          text,
  p_created_by            uuid
)
RETURNS partner_booking_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner   partner_organizations%ROWTYPE;
  v_comm      bigint;
  v_link      partner_booking_links%ROWTYPE;
BEGIN
  SELECT * INTO v_partner
    FROM partner_organizations
   WHERE tenant_id = p_tenant_id AND id = p_partner_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_partner.commission_type IS NULL OR v_partner.commission_direction IS NULL THEN
    RAISE EXCEPTION 'commission_not_configured' USING ERRCODE = 'P0001';
  END IF;

  -- Compute commission amount in minor units
  v_comm := CASE v_partner.commission_type
    WHEN 'percentage'       THEN ROUND(p_gross_amount_minor * v_partner.commission_rate)::bigint
    WHEN 'flat_per_booking' THEN v_partner.commission_amount_minor
    WHEN 'flat_per_pax'     THEN v_partner.commission_amount_minor * p_pax_count
    WHEN 'net_rate'         THEN 0   -- gross minus net-rate price; caller passes commission as gross_amount_minor difference
    ELSE 0
  END;

  INSERT INTO partner_booking_links (
    tenant_id, partner_id, booking_id,
    gross_amount_minor, pax_count,
    commission_type, commission_rate, commission_amount_minor,
    commission_direction, currency,
    source, external_ref, created_by
  ) VALUES (
    p_tenant_id, p_partner_id, p_booking_id,
    p_gross_amount_minor, COALESCE(p_pax_count, 1),
    v_partner.commission_type, v_partner.commission_rate, v_comm,
    v_partner.commission_direction, v_partner.commission_currency,
    COALESCE(p_source, 'manual'), p_external_ref, p_created_by
  )
  RETURNING * INTO v_link;

  RETURN v_link;
END;
$$;

GRANT EXECUTE ON FUNCTION link_booking_to_partner(uuid,uuid,uuid,bigint,int,text,text,uuid)
  TO zettaz_runtime;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. generate_partner_settlement
--    Creates a partner_settlements row for a date range and marks the
--    contributing partner_booking_links rows as settled.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_partner_settlement(
  p_tenant_id    uuid,
  p_partner_id   uuid,
  p_period_start date,
  p_period_end   date,
  p_created_by   uuid
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
   WHERE tenant_id = p_tenant_id AND id = p_partner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Aggregate unsettled links whose departure start date falls in the period.
  -- bookings have no starts_at; schedule time lives on departures.
  SELECT
    COUNT(*)::int                         AS booking_count,
    COALESCE(SUM(pbl.gross_amount_minor), 0)   AS gross_minor,
    COALESCE(SUM(pbl.commission_amount_minor), 0) AS commission_minor
  INTO v_agg
    FROM partner_booking_links pbl
    JOIN bookings b
      ON b.tenant_id = pbl.tenant_id AND b.id = pbl.booking_id
    JOIN departures d
      ON d.tenant_id = b.tenant_id AND d.id = b.departure_id
   WHERE pbl.tenant_id  = p_tenant_id
     AND pbl.partner_id = p_partner_id
     AND pbl.settlement_id IS NULL
     AND pbl.unlinked_at   IS NULL
     AND d.starts_at::date BETWEEN p_period_start AND p_period_end;

  IF v_agg.booking_count = 0 THEN
    RAISE EXCEPTION 'no_unsettled_bookings_in_period' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO partner_settlements (
    tenant_id, partner_id,
    period_start, period_end,
    booking_count, gross_amount_minor, commission_amount_minor, net_amount_minor,
    commission_direction, currency,
    due_date,
    created_by
  ) VALUES (
    p_tenant_id, p_partner_id,
    p_period_start, p_period_end,
    v_agg.booking_count, v_agg.gross_minor, v_agg.commission_minor,
    CASE v_partner.commission_direction
      WHEN 'partner_owes_tenant' THEN v_agg.gross_minor - v_agg.commission_minor
      ELSE v_agg.commission_minor
    END,
    v_partner.commission_direction,
    v_partner.commission_currency,
    CURRENT_DATE + COALESCE(v_partner.payment_terms_days, 30),
    p_created_by
  )
  RETURNING * INTO v_settlement;

  -- Mark contributing links as settled
  UPDATE partner_booking_links pbl
     SET settlement_id = v_settlement.id,
         settled_at    = clock_timestamp()
    FROM bookings b
    JOIN departures d
      ON d.tenant_id = b.tenant_id AND d.id = b.departure_id
   WHERE b.tenant_id    = pbl.tenant_id
     AND b.id           = pbl.booking_id
     AND pbl.tenant_id  = p_tenant_id
     AND pbl.partner_id = p_partner_id
     AND pbl.settlement_id IS NULL
     AND pbl.unlinked_at   IS NULL
     AND d.starts_at::date BETWEEN p_period_start AND p_period_end;

  RETURN v_settlement;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_partner_settlement(uuid,uuid,date,date,uuid)
  TO zettaz_runtime;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. advance_settlement_status
--    Moves a settlement through its lifecycle states with validation.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION advance_settlement_status(
  p_tenant_id         uuid,
  p_settlement_id     uuid,
  p_new_status        text,
  p_payment_ref       text    DEFAULT NULL,
  p_invoice_number    text    DEFAULT NULL,
  p_invoice_pdf       text    DEFAULT NULL,
  p_void_reason       text    DEFAULT NULL,
  p_notes             text    DEFAULT NULL
)
RETURNS partner_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    partner_settlements%ROWTYPE;
  v_result partner_settlements%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM partner_settlements
   WHERE id = p_settlement_id AND tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.status = 'void' THEN
    RAISE EXCEPTION 'settlement_already_voided' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.status = 'paid' AND p_new_status <> 'void' THEN
    RAISE EXCEPTION 'settlement_already_paid' USING ERRCODE = 'P0001';
  END IF;

  UPDATE partner_settlements SET
    status           = p_new_status,
    payment_ref      = COALESCE(p_payment_ref, payment_ref),
    invoice_number   = COALESCE(p_invoice_number, invoice_number),
    invoice_pdf_path = COALESCE(p_invoice_pdf, invoice_pdf_path),
    void_reason      = CASE WHEN p_new_status = 'void' THEN p_void_reason ELSE void_reason END,
    voided_at        = CASE WHEN p_new_status = 'void' THEN clock_timestamp() ELSE voided_at END,
    paid_at          = CASE WHEN p_new_status = 'paid' THEN clock_timestamp() ELSE paid_at END,
    notes            = COALESCE(p_notes, notes)
  WHERE id = p_settlement_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_result;

  -- If voided, release the linked bookings back to unsettled
  IF p_new_status = 'void' THEN
    UPDATE partner_booking_links
       SET settlement_id = NULL, settled_at = NULL
     WHERE settlement_id = p_settlement_id AND tenant_id = p_tenant_id;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION advance_settlement_status(uuid,uuid,text,text,text,text,text,text)
  TO zettaz_runtime;
