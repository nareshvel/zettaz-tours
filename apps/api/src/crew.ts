import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";

const todayQuery = z.object({ date: z.string().date().optional() }).strict();
const tripEvent = z
  .object({
    state: z.enum([
      "preparing",
      "en_route_pickup",
      "boarding",
      "departed",
      "at_stop",
      "delayed",
      "completed",
      "cancelled",
      "emergency",
    ]),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();
const departureId = z.string().uuid();

function boardingClearance(
  collectionMode: string | null,
  guestBalanceMinor: number,
) {
  if (
    collectionMode === "partner_invoice" ||
    collectionMode === "partner_collects_for_tenant"
  )
    return "partner" as const;
  return guestBalanceMinor > 0 ? ("due" as const) : ("settled" as const);
}

@Injectable()
export class CrewService {
  constructor(private readonly db: Database) {}
  today(actor: Actor, raw: unknown) {
    const input = parse(todayQuery, raw);
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [tenant],
      } = await tx.query("SELECT timezone FROM tenants WHERE id=$1", [
        actor.tenantId,
      ]);
      const date =
        input.date ?? DateTime.now().setZone(tenant.timezone).toISODate();
      const { rows: trips } = await tx.query(
        `SELECT d.id,d.starts_at,d.local_date,d.operational_status,p.name AS product_name,
          r.state AS trip_run_state,
          array_agg(a.assignment_role ORDER BY a.assignment_role) AS assignment_roles
         FROM departure_assignments a
         JOIN departures d ON d.tenant_id=a.tenant_id AND d.id=a.departure_id
         JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         JOIN crew_profiles c ON c.tenant_id=a.tenant_id AND c.membership_actor_id=a.crew_actor_id AND c.active
         LEFT JOIN trip_runs r ON r.tenant_id=d.tenant_id AND r.departure_id=d.id
         WHERE a.tenant_id=$1 AND a.crew_actor_id=$2 AND a.status='active' AND d.local_date=$3
         GROUP BY d.id,d.starts_at,d.local_date,d.operational_status,p.name,r.state
         ORDER BY d.starts_at,d.id`,
        [actor.tenantId, actor.actorId, date],
      );
      const departureIds = trips.map((trip) => trip.id);
      const { rows: guests } = departureIds.length
        ? await tx.query(
            `SELECT b.departure_id,b.id AS booking_id,b.lead_name,h.party,
              (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size,
              COALESCE(c.state,'not_arrived') AS checkin_state,
              c.version AS checkin_version,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'is_minor',p.is_minor,'identity_pending',p.identity_pending,'checkin_state',latest.state,'waiver_signed',EXISTS(SELECT 1 FROM waiver_signatures w WHERE w.tenant_id=p.tenant_id AND w.passenger_id=p.id)) ORDER BY p.created_at,p.id)
                FROM booking_passengers p LEFT JOIN LATERAL (SELECT state FROM passenger_checkins x WHERE x.tenant_id=p.tenant_id AND x.passenger_id=p.id ORDER BY x.occurred_at DESC,x.id DESC LIMIT 1) latest ON true
                WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.superseded_at IS NULL),'[]'::jsonb) AS passengers,
              b.pickup,b.stay,
              (h.quote->>'totalMinor')::bigint AS total_minor,
              h.quote->>'currency' AS currency,
              COALESCE((SELECT SUM(p.amount_minor) FROM payments p
                WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='settled'
                AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)::bigint AS paid_minor,
              COALESCE((SELECT SUM(cl.amount_minor) FROM partner_collection_claims cl
                JOIN partner_claim_decisions d ON d.tenant_id=cl.tenant_id AND d.claim_id=cl.id AND d.decision='accepted'
                WHERE cl.tenant_id=b.tenant_id AND cl.booking_id=b.id),0)::bigint AS partner_credit_minor,
              (SELECT s.collection_mode FROM booking_partner_snapshots s
                WHERE s.tenant_id=b.tenant_id AND s.booking_id=b.id
                ORDER BY s.booking_version DESC,s.partner_id DESC LIMIT 1) AS collection_mode
             FROM bookings b
             JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
             LEFT JOIN booking_checkins c ON c.tenant_id=b.tenant_id AND c.booking_id=b.id
             WHERE b.tenant_id=$1 AND b.departure_id=ANY($2::uuid[]) AND b.state='confirmed'
             ORDER BY b.departure_id,b.id`,
            [actor.tenantId, departureIds],
          )
        : { rows: [] };
      const { rows: pickupStops } = departureIds.length
        ? await tx.query(
            `SELECT s.departure_id,s.booking_id,s.sequence,s.pickup_at,s.notes,l.name AS location_name,b.lead_name,
              (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
             FROM pickup_stops s
             JOIN pickup_locations l ON l.tenant_id=s.tenant_id AND l.id=s.location_id
             JOIN bookings b ON b.tenant_id=s.tenant_id AND b.id=s.booking_id
             JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
             WHERE s.tenant_id=$1 AND s.departure_id=ANY($2::uuid[])
             ORDER BY s.departure_id,s.sequence`,
            [actor.tenantId, departureIds],
          )
        : { rows: [] };
      const { rows: pickupExceptions } = departureIds.length
        ? await tx.query(
            `SELECT b.departure_id,b.id AS booking_id,b.lead_name,b.pickup->>'kind' AS pickup_kind,
              (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
             FROM bookings b
             JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
             WHERE b.tenant_id=$1 AND b.departure_id=ANY($2::uuid[]) AND b.state='confirmed' AND (
               b.pickup->>'kind'='unresolved' OR (
                 b.pickup->>'kind'='selected' AND NOT EXISTS (
                   SELECT 1 FROM pickup_stops s
                   WHERE s.tenant_id=b.tenant_id AND s.departure_id=b.departure_id AND s.booking_id=b.id
                 )
               )
             )
             ORDER BY b.departure_id,b.pickup->>'kind',b.lead_name,b.id`,
            [actor.tenantId, departureIds],
          )
        : { rows: [] };
      const roster = guests.map((guest) => {
        const totalMinor = Number(guest.total_minor);
        const paidMinor = Number(guest.paid_minor);
        const partnerCreditMinor = Number(guest.partner_credit_minor);
        const partnerClears =
          guest.collection_mode === "partner_invoice" ||
          guest.collection_mode === "partner_collects_for_tenant";
        const guestBalanceMinor = partnerClears
          ? 0
          : Math.max(0, totalMinor - paidMinor - partnerCreditMinor);
        return {
          departure_id: guest.departure_id,
          booking_id: guest.booking_id,
          lead_name: guest.lead_name,
          party_size: guest.party_size,
          checkin_state: guest.checkin_state,
          checkin_version: guest.checkin_version,
          passengers: guest.passengers,
          pickup: guest.pickup,
          stay: guest.stay,
          currency: guest.currency,
          boarding_clearance: boardingClearance(
            guest.collection_mode,
            guestBalanceMinor,
          ),
          guest_balance_minor: guestBalanceMinor,
        };
      });
      return {
        date,
        waiverTemplate:
          (
            await tx.query(
              "SELECT id,version,title,body FROM waiver_templates WHERE tenant_id=$1 AND active ORDER BY version DESC LIMIT 1",
              [actor.tenantId],
            )
          ).rows[0] ?? null,
        trips: trips.map((trip) => {
          const tripGuests = roster.filter(
            (guest) => guest.departure_id === trip.id,
          );
          const passengers = tripGuests.flatMap(
            (guest) => guest.passengers ?? [],
          );
          const boarded = passengers.filter(
            (person: { checkin_state?: string | null }) =>
              person.checkin_state === "boarded",
          ).length;
          const noShow = passengers.filter(
            (person: { checkin_state?: string | null }) =>
              person.checkin_state === "no_show",
          ).length;
          return {
            id: trip.id,
            starts_at: trip.starts_at,
            local_date: trip.local_date,
            product_name: trip.product_name,
            assignment_roles: trip.assignment_roles,
            operational_status: trip.operational_status,
            trip_run_state: trip.trip_run_state,
            boarded_guests: boarded,
            no_show_guests: noShow,
            boarding_pending: Math.max(0, passengers.length - boarded - noShow),
            pickup_stops: pickupStops.filter(
              (stop) => stop.departure_id === trip.id,
            ),
            pickup_exceptions: pickupExceptions.filter(
              (item) => item.departure_id === trip.id,
            ),
            guests: tripGuests.map(
              ({ departure_id: _departureId, ...guest }) => guest,
            ),
          };
        }),
      };
    });
  }
  event(actor: Actor, departure: string, key: string, raw: unknown) {
    const input = parse(tripEvent, raw);
    return this.db.command(
      actor,
      `trip.run:${departure}`,
      key,
      input,
      async (tx) => {
        const assigned = await tx.query(
          "SELECT 1 FROM departure_assignments WHERE tenant_id=$1 AND crew_actor_id=$2 AND departure_id=$3 AND status='active'",
          [actor.tenantId, actor.actorId, departure],
        );
        if (!assigned.rowCount)
          throw new BadRequestException(
            "Crew can update only an assigned departure",
          );
        const prior = (
          await tx.query(
            "SELECT state,version FROM trip_runs WHERE tenant_id=$1 AND departure_id=$2 FOR UPDATE",
            [actor.tenantId, departure],
          )
        ).rows[0] as { state: string; version: number } | undefined;
        if (["completed", "cancelled"].includes(prior?.state ?? ""))
          throw new BadRequestException(
            "Completed or cancelled trip runs cannot be changed",
          );
        const version = (prior?.version ?? 0) + 1;
        await tx.query(
          "INSERT INTO trip_runs(tenant_id,departure_id,state,version,recorded_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,departure_id) DO UPDATE SET state=EXCLUDED.state,version=EXCLUDED.version,recorded_by=EXCLUDED.recorded_by,updated_at=clock_timestamp()",
          [actor.tenantId, departure, input.state, version, actor.actorId],
        );
        const result = {
          id: randomUUID(),
          departureId: departure,
          state: input.state,
          version,
          reason: input.reason ?? null,
        };
        await tx.query(
          "INSERT INTO trip_run_events(tenant_id,id,departure_id,state,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)",
          [
            actor.tenantId,
            result.id,
            departure,
            input.state,
            result.reason,
            actor.actorId,
          ],
        );
        await record(
          tx,
          actor,
          "trip_run.event_recorded",
          departure,
          prior ?? null,
          result,
          input.reason,
        );
        return result;
      },
    );
  }
}

@Controller("crew/v1")
export class CrewController {
  constructor(private readonly service: CrewService) {}
  @Get("today") @Access("crew.trip.read") today(
    @CurrentActor() actor: Actor,
    @Query() query: unknown,
  ) {
    return this.service.today(actor, query);
  }
  @Post("departures/:id/events") @Access("crew.trip.read") event(
    @CurrentActor() actor: Actor,
    @Param("id") value: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.event(
      actor,
      parse(departureId, value),
      parse(keySchema, key),
      body,
    );
  }
}
