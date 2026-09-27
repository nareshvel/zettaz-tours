-- 098: Partner settlement accuracy.
-- * Period uses the departure's local date (was the UTC date of starts_at).
-- * Cancelled bookings are not settled.
-- * Net amount, direction and currency come from the booking-link snapshots,
--   and one settlement never mixes directions or currencies.
-- Idempotent: CREATE OR REPLACE.

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
    COUNT(DISTINCT pbl.commission_direction)::int AS direction_count,
    MIN(pbl.commission_direction)         AS direction,
    COUNT(DISTINCT pbl.currency)::int     AS currency_count,
    MIN(pbl.currency)                     AS currency,
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
     AND d.local_date BETWEEN p_period_start AND p_period_end
     AND b.state <> 'cancelled';

  IF v_agg.booking_count = 0 THEN
    RAISE EXCEPTION 'no_unsettled_bookings_in_period' USING ERRCODE = 'P0001';
  END IF;

  -- Net must follow the terms frozen on each booking link, not the partner's
  -- current setting. Refuse to mix directions or currencies in one settlement.
  IF v_agg.direction_count > 1 THEN
    RAISE EXCEPTION 'mixed_commission_directions_in_period' USING ERRCODE = 'P0001';
  END IF;
  IF v_agg.currency_count > 1 THEN
    RAISE EXCEPTION 'mixed_currencies_in_period' USING ERRCODE = 'P0001';
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
    CASE v_agg.direction
      WHEN 'partner_owes_tenant' THEN v_agg.gross_minor - v_agg.commission_minor
      ELSE v_agg.commission_minor
    END,
    v_agg.direction,
    v_agg.currency,
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
     AND d.local_date BETWEEN p_period_start AND p_period_end
     AND b.state <> 'cancelled';

  RETURN v_settlement;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_partner_settlement(uuid,uuid,date,date,uuid)
  TO zettaz_runtime;
