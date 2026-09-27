import { Controller, Get, Injectable, Query } from "@nestjs/common";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database, type Tx } from "./database";
import { Access, CurrentActor, parse } from "./http";

/** Every report accepts a closed date range (max ~13 months) and a date basis. */
const reportQuery = z
  .object({
    from: z.string().date(),
    to: z.string().date(),
    basis: z.enum(["departure", "booked"]).default("departure"),
  })
  .strict()
  .refine((v) => v.from <= v.to, "From date must not follow to date")
  .refine(
    (v) => Date.parse(v.to) - Date.parse(v.from) <= 400 * 86_400_000,
    "Choose a range of 400 days or less",
  );
type ReportInput = z.infer<typeof reportQuery>;

/**
 * Date filter for a booking row `b` joined to departure `d`.
 * departure = departure local date; booked = booking created_at in tenant timezone.
 */
function dateFilter(basis: ReportInput["basis"]) {
  return basis === "booked"
    ? `(b.created_at AT TIME ZONE t.timezone)::date BETWEEN $2 AND $3`
    : `d.local_date BETWEEN $2 AND $3`;
}

/** Latest immutable price snapshot per booking, with its currency. */
const SNAPSHOT = `LEFT JOIN LATERAL (
    SELECT (s.quote->>'totalMinor')::bigint AS total_minor,
           COALESCE(s.quote->>'currency', t.reporting_currency) AS currency
    FROM price_snapshots s WHERE s.tenant_id=b.tenant_id AND s.booking_id=b.id
    ORDER BY s.version DESC LIMIT 1) snap ON true`;

/** Settled payments that were not voided or reversed (adjustments are whole-payment). */
const PAID = `COALESCE((SELECT SUM(p.amount_minor) FROM payments p
    WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='settled'
    AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)`;

function shiftRange(from: string, to: string) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    from: iso(Date.parse(from) - days * 86_400_000),
    to: iso(Date.parse(from) - 86_400_000),
  };
}

@Injectable()
export class ReportService {
  constructor(private readonly db: Database) {}

  private async tenant(tx: Tx, actor: Actor) {
    const {
      rows: [row],
    } = await tx.query(
      `SELECT COALESCE(reporting_currency, base_currency, 'XCD') AS currency, timezone
       FROM tenants WHERE id=$1`,
      [actor.tenantId],
    );
    return row as { currency: string; timezone: string };
  }

  private async commercial(tx: Tx, actor: Actor, input: ReportInput) {
    const {
      rows: [c],
    } = await tx.query(
      `WITH t AS (SELECT id, COALESCE(reporting_currency, base_currency, 'XCD') AS reporting_currency, timezone FROM tenants WHERE id=$1),
       scoped AS (
         SELECT b.id, b.state, COALESCE(snap.total_minor,0) AS total_minor,
           snap.currency = t.reporting_currency OR snap.currency IS NULL AS same_ccy,
           ${PAID} AS paid_minor,
           COALESCE((SELECT SUM(c.amount_minor) FROM partner_collection_claims c
             JOIN partner_claim_decisions x ON x.tenant_id=c.tenant_id AND x.claim_id=c.id AND x.decision='accepted'
             WHERE c.tenant_id=b.tenant_id AND c.booking_id=b.id),0) AS partner_credit_minor,
           COALESCE((SELECT SUM(o.amount_minor) FROM partner_obligations o
             WHERE o.tenant_id=b.tenant_id AND o.booking_id=b.id),0) AS partner_due_minor
         FROM bookings b
         JOIN t ON t.id=b.tenant_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         ${SNAPSHOT}
         WHERE b.tenant_id=$1 AND ${dateFilter(input.basis)}
       )
       SELECT COUNT(*)::int AS bookings,
         COUNT(*) FILTER(WHERE state='confirmed')::int AS confirmed,
         COUNT(*) FILTER(WHERE state='held')::int AS held,
         COUNT(*) FILTER(WHERE state='cancelled')::int AS cancelled,
         COUNT(*) FILTER(WHERE NOT same_ccy)::int AS other_currency,
         COALESCE(SUM(total_minor) FILTER(WHERE state='confirmed' AND same_ccy),0)::text AS booked_minor,
         COALESCE(SUM(paid_minor) FILTER(WHERE state='confirmed' AND same_ccy),0)::text AS received_minor,
         COALESCE(SUM(paid_minor) FILTER(WHERE state<>'confirmed' AND same_ccy),0)::text AS received_unconfirmed_minor,
         COALESCE(SUM(partner_credit_minor) FILTER(WHERE state='confirmed' AND same_ccy),0)::text AS partner_credit_minor,
         COALESCE(SUM(GREATEST(total_minor-paid_minor-partner_credit_minor,0)) FILTER(WHERE state='confirmed' AND same_ccy),0)::text AS guest_balance_minor,
         COALESCE(SUM(partner_due_minor) FILTER(WHERE same_ccy),0)::text AS partner_due_minor
       FROM scoped`,
      [actor.tenantId, input.from, input.to],
    );
    return {
      bookings: c.bookings as number,
      confirmed: c.confirmed as number,
      held: c.held as number,
      cancelled: c.cancelled as number,
      otherCurrency: c.other_currency as number,
      bookedMinor: Number(c.booked_minor),
      receivedMinor: Number(c.received_minor),
      receivedUnconfirmedMinor: Number(c.received_unconfirmed_minor),
      partnerCreditMinor: Number(c.partner_credit_minor),
      guestBalanceMinor: Number(c.guest_balance_minor),
      partnerDueMinor: Number(c.partner_due_minor),
    };
  }

  overview(actor: Actor, raw: unknown) {
    const input = parse(reportQuery, raw);
    return this.db.transaction(actor, async (tx: Tx) => {
      const tenant = await this.tenant(tx, actor);
      const commercial = await this.commercial(tx, actor, input);
      const previous = await this.commercial(tx, actor, {
        ...input,
        ...shiftRange(input.from, input.to),
      });
      const {
        rows: [operations],
      } = await tx.query(
        `SELECT COUNT(*)::int AS departures,
          COUNT(*) FILTER(WHERE d.operational_status='weather_hold')::int AS weather_holds,
          COUNT(*) FILTER(WHERE d.operational_status='closed')::int AS closed,
          COUNT(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM departure_assignments a
            WHERE a.tenant_id=d.tenant_id AND a.departure_id=d.id AND a.status='active'))::int AS unassigned,
          COALESCE(SUM((SELECT COUNT(*) FROM bookings b WHERE b.tenant_id=d.tenant_id
            AND b.departure_id=d.id AND b.state='confirmed' AND b.pickup->>'kind'='unresolved')),0)::int AS unresolved_pickups
         FROM departures d WHERE d.tenant_id=$1 AND d.local_date BETWEEN $2 AND $3`,
        [actor.tenantId, input.from, input.to],
      );
      // Full calendar series so zero-activity days are visible, not silently skipped.
      const { rows: days } = await tx.query(
        `SELECT g.day::date::text AS date,
           COUNT(DISTINCT d.id)::int AS departures,
           COUNT(b.id) FILTER(WHERE b.state='confirmed')::int AS confirmed_bookings,
           COALESCE(SUM(h.seats) FILTER(WHERE b.state='confirmed'),0)::int AS guests
         FROM generate_series($2::date, $3::date, interval '1 day') g(day)
         LEFT JOIN departures d ON d.tenant_id=$1 AND d.local_date=g.day::date
         LEFT JOIN bookings b ON b.tenant_id=d.tenant_id AND b.departure_id=d.id
         LEFT JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         GROUP BY g.day ORDER BY g.day`,
        [actor.tenantId, input.from, input.to],
      );
      return {
        range: { from: input.from, to: input.to },
        basis: input.basis,
        currency: tenant.currency,
        commercial,
        previous: {
          range: shiftRange(input.from, input.to),
          confirmed: previous.confirmed,
          bookedMinor: previous.bookedMinor,
          receivedMinor: previous.receivedMinor,
        },
        operations: {
          departures: operations.departures,
          weatherHolds: operations.weather_holds,
          closed: operations.closed,
          unassigned: operations.unassigned,
          unresolvedPickups: operations.unresolved_pickups,
        },
        days,
      };
    });
  }

  salesByProduct(actor: Actor, raw: unknown) {
    const input = parse(reportQuery, raw);
    return this.db.transaction(actor, async (tx: Tx) => {
      const tenant = await this.tenant(tx, actor);
      const { rows } = await tx.query(
        `WITH t AS (SELECT id, COALESCE(reporting_currency, base_currency, 'XCD') AS reporting_currency, timezone FROM tenants WHERE id=$1),
         scoped AS (
           SELECT d.product_id, b.state, h.seats, COALESCE(snap.total_minor,0) AS total_minor,
             snap.currency = t.reporting_currency OR snap.currency IS NULL AS same_ccy,
             ${PAID} AS paid_minor
           FROM bookings b
           JOIN t ON t.id=b.tenant_id
           JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
           JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
           ${SNAPSHOT}
           WHERE b.tenant_id=$1 AND ${dateFilter(input.basis)}
         ),
         cap AS (
           SELECT d.product_id, COUNT(*)::int AS departures, SUM(d.capacity)::int AS capacity
           FROM departures d WHERE d.tenant_id=$1 AND d.local_date BETWEEN $2 AND $3
             AND d.operational_status<>'closed'
           GROUP BY d.product_id
         )
         SELECT p.id AS product_id, p.name,
           COALESCE(cap.departures,0) AS departures, COALESCE(cap.capacity,0) AS capacity,
           COUNT(s.*) FILTER(WHERE s.state='confirmed')::int AS confirmed,
           COUNT(s.*) FILTER(WHERE s.state='cancelled')::int AS cancelled,
           COALESCE(SUM(s.seats) FILTER(WHERE s.state='confirmed'),0)::int AS guests,
           COALESCE(SUM(s.total_minor) FILTER(WHERE s.state='confirmed' AND s.same_ccy),0)::text AS booked_minor,
           COALESCE(SUM(s.paid_minor) FILTER(WHERE s.state='confirmed' AND s.same_ccy),0)::text AS received_minor,
           COUNT(s.*) FILTER(WHERE NOT s.same_ccy)::int AS other_currency
         FROM products p
         LEFT JOIN scoped s ON s.product_id=p.id
         LEFT JOIN cap ON cap.product_id=p.id
         WHERE p.tenant_id=$1
         GROUP BY p.id, p.name, cap.departures, cap.capacity
         HAVING COUNT(s.*)>0 OR COALESCE(cap.departures,0)>0
         ORDER BY SUM(s.total_minor) FILTER(WHERE s.state='confirmed') DESC NULLS LAST, p.name`,
        [actor.tenantId, input.from, input.to],
      );
      return {
        range: { from: input.from, to: input.to },
        basis: input.basis,
        currency: tenant.currency,
        rows: rows.map((r) => ({
          productId: r.product_id,
          name: r.name,
          departures: r.departures,
          capacity: r.capacity,
          confirmed: r.confirmed,
          cancelled: r.cancelled,
          guests: r.guests,
          bookedMinor: Number(r.booked_minor),
          receivedMinor: Number(r.received_minor),
          otherCurrency: r.other_currency,
        })),
      };
    });
  }

  bookingSources(actor: Actor, raw: unknown) {
    const input = parse(reportQuery, raw);
    return this.db.transaction(actor, async (tx: Tx) => {
      const tenant = await this.tenant(tx, actor);
      const { rows } = await tx.query(
        `WITH t AS (SELECT id, COALESCE(reporting_currency, base_currency, 'XCD') AS reporting_currency, timezone FROM tenants WHERE id=$1)
         SELECT COALESCE(NULLIF(trim(b.source),''),'unknown') AS source,
           COUNT(*)::int AS bookings,
           COUNT(*) FILTER(WHERE b.state='confirmed')::int AS confirmed,
           COUNT(*) FILTER(WHERE b.state='cancelled')::int AS cancelled,
           COALESCE(SUM(h.seats) FILTER(WHERE b.state='confirmed'),0)::int AS guests,
           COALESCE(SUM(snap.total_minor) FILTER(WHERE b.state='confirmed'
             AND (snap.currency=t.reporting_currency OR snap.currency IS NULL)),0)::text AS booked_minor
         FROM bookings b
         JOIN t ON t.id=b.tenant_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         ${SNAPSHOT}
         WHERE b.tenant_id=$1 AND ${dateFilter(input.basis)}
         GROUP BY 1 ORDER BY 2 DESC`,
        [actor.tenantId, input.from, input.to],
      );
      return {
        range: { from: input.from, to: input.to },
        basis: input.basis,
        currency: tenant.currency,
        rows: rows.map((r) => ({
          source: r.source as string,
          bookings: r.bookings as number,
          confirmed: r.confirmed as number,
          cancelled: r.cancelled as number,
          guests: r.guests as number,
          bookedMinor: Number(r.booked_minor),
        })),
      };
    });
  }

  commissionSummary(actor: Actor, raw: unknown) {
    const input = parse(reportQuery, raw);
    return this.db.transaction(actor, async (tx: Tx) => {
      const tenant = await this.tenant(tx, actor);
      // Commission comes from the snapshot stored on partner_booking_links at link time —
      // never recalculated from current partner terms.
      const { rows } = await tx.query(
        `WITH t AS (SELECT id, timezone FROM tenants WHERE id=$1)
         SELECT po.id AS partner_id, po.name, l.commission_direction AS direction, l.currency,
           COUNT(*)::int AS bookings,
           SUM(l.pax_count)::int AS guests,
           SUM(l.gross_amount_minor)::text AS gross_minor,
           SUM(l.commission_amount_minor)::text AS commission_minor,
           COALESCE(SUM(l.commission_amount_minor) FILTER(WHERE l.settled_at IS NOT NULL),0)::text AS settled_minor
         FROM partner_booking_links l
         JOIN t ON t.id=l.tenant_id
         JOIN partner_organizations po ON po.tenant_id=l.tenant_id AND po.id=l.partner_id
         JOIN bookings b ON b.tenant_id=l.tenant_id AND b.id=l.booking_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         WHERE l.tenant_id=$1 AND l.unlinked_at IS NULL AND b.state<>'cancelled'
           AND ${dateFilter(input.basis)}
         GROUP BY po.id, po.name, l.commission_direction, l.currency
         ORDER BY po.name, l.commission_direction`,
        [actor.tenantId, input.from, input.to],
      );
      return {
        range: { from: input.from, to: input.to },
        basis: input.basis,
        currency: tenant.currency,
        rows: rows.map((r) => {
          const commission = Number(r.commission_minor);
          const settled = Number(r.settled_minor);
          return {
            partnerId: r.partner_id,
            name: r.name,
            direction: r.direction as
              "partner_owes_tenant" | "tenant_owes_partner",
            currency: String(r.currency).trim(),
            bookings: r.bookings,
            guests: r.guests,
            grossMinor: Number(r.gross_minor),
            commissionMinor: commission,
            settledMinor: settled,
            outstandingMinor: commission - settled,
          };
        }),
      };
    });
  }
}

@Controller("reports/v1")
export class ReportController {
  constructor(private readonly service: ReportService) {}
  @Get("overview")
  @Access("bookings.read")
  overview(
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.overview(actor, query);
  }
  @Get("sales-by-product")
  @Access("bookings.read")
  salesByProduct(
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.salesByProduct(actor, query);
  }
  @Get("booking-sources")
  @Access("bookings.read")
  bookingSources(
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.bookingSources(actor, query);
  }
  @Get("commission-summary")
  @Access("partner.statement.read")
  commissionSummary(
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.commissionSummary(actor, query);
  }
}
