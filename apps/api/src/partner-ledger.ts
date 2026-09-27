/**
 * Single source of truth for partner balances (Finance ledger, partner statement,
 * commission summary). Positive amount = partner owes the tenant.
 *
 * Per booking link (commission snapshot frozen at link time):
 *   partner_owes_tenant  → partner collected from the guest, owes gross − commission
 *   tenant_owes_partner  → tenant collected, owes the partner its commission
 * These match exactly what generate_partner_settlement() puts in net_amount_minor,
 * so a paid settlement clears its bookings to zero.
 *
 * Settlements move money only when PAID. A void releases the links (they are owed
 * again); if the settlement had been paid, the void posts a reversal on its void date.
 * Draft / invoiced / sent / overdue settlements and never-paid voids are informational.
 *
 * Links on cancelled bookings are excluded unless they are already inside a
 * settlement (whose totals include them) — keeps balance and settlement in step.
 *
 * Parameters: $1 tenant id, $2 partner id. Needs a CTE `t(id, timezone)` in scope.
 */
export const PARTNER_LEDGER_ENTRIES = `
  SELECT 'booking'::text AS kind, l.id, l.created_at AS event_at,
    p.name || ' · ' || to_char(d.local_date,'DD Mon YYYY') || ' · ' || b.lead_name AS description,
    LEFT(b.id::text,8) AS reference,
    CASE l.commission_direction
      WHEN 'partner_owes_tenant' THEN l.gross_amount_minor - l.commission_amount_minor
      ELSE -l.commission_amount_minor END AS amount_minor,
    l.gross_amount_minor AS gross_minor, l.commission_amount_minor AS commission_minor,
    trim(l.currency) AS currency, l.commission_direction AS direction,
    CASE WHEN l.settlement_id IS NULL THEN 'unsettled' ELSE 'settled' END AS status,
    l.booking_id, l.settlement_id
  FROM partner_booking_links l
  JOIN bookings b ON b.tenant_id=l.tenant_id AND b.id=l.booking_id
  JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
  JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
  WHERE l.tenant_id=$1 AND l.partner_id=$2 AND l.unlinked_at IS NULL
    AND (b.state<>'cancelled' OR l.settlement_id IS NOT NULL)
  UNION ALL
  SELECT 'settlement', s.id, s.paid_at,
    'Settlement paid ' || to_char(s.period_start,'DD Mon') || '–' || to_char(s.period_end,'DD Mon YYYY'),
    COALESCE(s.payment_ref, s.invoice_number, LEFT(s.id::text,8)),
    CASE s.commission_direction WHEN 'partner_owes_tenant' THEN -s.net_amount_minor ELSE s.net_amount_minor END,
    s.gross_amount_minor, s.commission_amount_minor, trim(s.currency), s.commission_direction,
    'paid', NULL::uuid, s.id
  FROM partner_settlements s
  WHERE s.tenant_id=$1 AND s.partner_id=$2 AND s.paid_at IS NOT NULL AND s.status IN ('paid','void')
  UNION ALL
  SELECT 'settlement_reversal', s.id, s.voided_at,
    'Paid settlement voided ' || to_char(s.period_start,'DD Mon') || '–' || to_char(s.period_end,'DD Mon YYYY'),
    COALESCE(s.payment_ref, s.invoice_number, LEFT(s.id::text,8)),
    CASE s.commission_direction WHEN 'partner_owes_tenant' THEN s.net_amount_minor ELSE -s.net_amount_minor END,
    s.gross_amount_minor, s.commission_amount_minor, trim(s.currency), s.commission_direction,
    'void', NULL::uuid, s.id
  FROM partner_settlements s
  WHERE s.tenant_id=$1 AND s.partner_id=$2 AND s.status='void' AND s.paid_at IS NOT NULL AND s.voided_at IS NOT NULL
  UNION ALL
  SELECT 'settlement_info', s.id, COALESCE(s.voided_at, s.created_at),
    'Settlement ' || s.status || ' ' || to_char(s.period_start,'DD Mon') || '–' || to_char(s.period_end,'DD Mon YYYY'),
    COALESCE(s.invoice_number, LEFT(s.id::text,8)),
    0::bigint, s.gross_amount_minor, s.commission_amount_minor, trim(s.currency), s.commission_direction,
    s.status, NULL::uuid, s.id
  FROM partner_settlements s
  WHERE s.tenant_id=$1 AND s.partner_id=$2
    AND (s.status IN ('draft','invoiced','sent','overdue') OR (s.status='void' AND s.paid_at IS NULL))
  UNION ALL
  SELECT 'claim', c.id, c.recorded_at,
    'Collection claim — ' || c.reference, c.reference,
    0::bigint, NULL::bigint, NULL::bigint, trim(c.currency), 'partner_owes_tenant',
    COALESCE(x.decision,'pending'), c.booking_id, NULL::uuid
  FROM partner_collection_claims c
  LEFT JOIN partner_claim_decisions x ON x.tenant_id=c.tenant_id AND x.claim_id=c.id
  WHERE c.tenant_id=$1 AND c.partner_id=$2`;
