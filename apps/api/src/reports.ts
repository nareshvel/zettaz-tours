import { Controller, Get, Injectable, Query } from "@nestjs/common";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database } from "./database";
import { Access, CurrentActor, parse } from "./http";

const reportQuery = z
  .object({ from: z.string().date(), to: z.string().date() })
  .strict()
  .refine(
    (value) => value.from <= value.to,
    "From date must not follow to date",
  );

@Injectable()
export class ReportService {
  constructor(private readonly db: Database) {}
  overview(actor: Actor, raw: unknown) {
    const input = parse(reportQuery, raw);
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [tenant],
      } = await tx.query("SELECT base_currency FROM tenants WHERE id=$1", [
        actor.tenantId,
      ]);
      const currency = tenant.base_currency ?? "XCD";
      const {
        rows: [commercial],
      } = await tx.query(
        `WITH scoped AS (
           SELECT b.id,b.state,
             COALESCE((SELECT (quote->>'totalMinor')::bigint FROM price_snapshots s
               WHERE s.tenant_id=b.tenant_id AND s.booking_id=b.id ORDER BY version DESC LIMIT 1),0) AS total_minor,
             COALESCE((SELECT SUM(p.amount_minor) FROM payments p
               WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='settled'
               AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0) AS paid_minor,
             COALESCE((SELECT SUM(c.amount_minor) FROM partner_collection_claims c
               JOIN partner_claim_decisions x ON x.tenant_id=c.tenant_id AND x.claim_id=c.id AND x.decision='accepted'
               WHERE c.tenant_id=b.tenant_id AND c.booking_id=b.id),0) AS partner_credit_minor,
             COALESCE((SELECT SUM(o.amount_minor) FROM partner_obligations o
               WHERE o.tenant_id=b.tenant_id AND o.booking_id=b.id),0) AS partner_due_minor
           FROM bookings b JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
           WHERE b.tenant_id=$1 AND d.local_date BETWEEN $2 AND $3
         )
         SELECT COUNT(*)::int AS bookings,
           COUNT(*) FILTER(WHERE state='confirmed')::int AS confirmed,
           COUNT(*) FILTER(WHERE state='cancelled')::int AS cancelled,
           COALESCE(SUM(total_minor) FILTER(WHERE state='confirmed'),0)::text AS booked_minor,
           COALESCE(SUM(paid_minor),0)::text AS received_minor,
           COALESCE(SUM(GREATEST(total_minor-paid_minor-partner_credit_minor,0)) FILTER(WHERE state='confirmed'),0)::text AS guest_balance_minor,
           COALESCE(SUM(partner_due_minor),0)::text AS partner_due_minor
         FROM scoped`,
        [actor.tenantId, input.from, input.to],
      );
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
      const { rows: days } = await tx.query(
        `SELECT d.local_date::text AS date,COUNT(DISTINCT d.id)::int AS departures,
          COUNT(b.id) FILTER(WHERE b.state='confirmed')::int AS confirmed_bookings,
          COALESCE(SUM(h.seats) FILTER(WHERE b.state='confirmed'),0)::int AS guests
         FROM departures d
         LEFT JOIN bookings b ON b.tenant_id=d.tenant_id AND b.departure_id=d.id
         LEFT JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         WHERE d.tenant_id=$1 AND d.local_date BETWEEN $2 AND $3
         GROUP BY d.local_date ORDER BY d.local_date`,
        [actor.tenantId, input.from, input.to],
      );
      return {
        range: input,
        currency,
        commercial: {
          bookings: commercial.bookings,
          confirmed: commercial.confirmed,
          cancelled: commercial.cancelled,
          bookedMinor: Number(commercial.booked_minor),
          receivedMinor: Number(commercial.received_minor),
          guestBalanceMinor: Number(commercial.guest_balance_minor),
          partnerDueMinor: Number(commercial.partner_due_minor),
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
}
