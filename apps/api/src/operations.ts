import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
} from "@nestjs/common";
import { Actor, id } from "../../../packages/shared/src/contracts";
import { Database } from "./database";
import { Access, CurrentActor, parse } from "./http";
import { Body, Headers, Post, BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { keySchema } from "./http";
import { record } from "./database";

const itineraryPointSchema = z
  .object({
    departureId: z.string().uuid(),
    sequence: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().max(240).default(""),
    directions: z.string().trim().max(1000).default(""),
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    mapUrl: z.string().url().max(1000).or(z.literal("")).default(""),
    visibility: z.enum(["internal", "guest"]).default("internal"),
  })
  .strict()
  .refine(
    (v) => (v.latitude === null) === (v.longitude === null),
    "Latitude and longitude must be supplied together",
  );

@Injectable()
export class OutboxService {
  constructor(private readonly db: Database) {}
  drain(actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id FROM outbox_events WHERE tenant_id=$1 AND delivered_at IS NULL ORDER BY occurred_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`,
        [actor.tenantId],
      );
      for (const row of rows) {
        // Local durable consumer only. External consumers need their own retry/deduplication port.
        await tx.query(
          `INSERT INTO event_receipts VALUES($1,$2,'local-observer-v1') ON CONFLICT DO NOTHING`,
          [actor.tenantId, row.id],
        );
        await tx.query(
          "UPDATE outbox_events SET delivered_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, row.id],
        );
      }
      return { delivered: rows.length };
    });
  }
}
@Controller("ops/v1")
export class OperationsController {
  constructor(private readonly db: Database) {}
  @Get("departures/:id/manifest")
  @Access("manifest.read")
  manifest(@CurrentActor() actor: Actor, @Param("id") value: string) {
    const departureId = parse(id, value);
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [departure],
      } = await tx.query(
        `SELECT d.id,d.starts_at,d.capacity,d.operational_status,d.operational_reason,d.operational_version,
          p.name AS product_name,tr.state AS trip_run_state,plan.version AS plan_version
         FROM departures d
         JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         LEFT JOIN trip_runs tr ON tr.tenant_id=d.tenant_id AND tr.departure_id=d.id
         LEFT JOIN departure_pickup_plans plan ON plan.tenant_id=d.tenant_id AND plan.departure_id=d.id
         WHERE d.tenant_id=$1 AND d.id=$2`,
        [actor.tenantId, departureId],
      );
      if (!departure) throw new NotFoundException();
      const { rows: bookings } = await tx.query(
        `SELECT b.id AS booking_id,b.lead_name,b.pickup,b.stay,h.party,
        c.state AS checkin_state,c.version AS checkin_version,
        (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size,
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
          ORDER BY s.booking_version DESC,s.partner_id DESC LIMIT 1) AS collection_mode,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',p.id,
          'name',p.name,
          'category',p.category,
          'is_minor',p.is_minor,
          'identity_pending',p.identity_pending,
          'checkin_state',latest.state,
          'waiver_signed',EXISTS(
            SELECT 1 FROM waiver_signatures w
            WHERE w.tenant_id=p.tenant_id AND w.booking_id=p.booking_id AND w.passenger_id=p.id
          )
        ) ORDER BY p.created_at,p.id)
          FROM booking_passengers p LEFT JOIN LATERAL (SELECT state FROM passenger_checkins x WHERE x.tenant_id=p.tenant_id AND x.passenger_id=p.id ORDER BY x.occurred_at DESC,x.id DESC LIMIT 1) latest ON true
          WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.superseded_at IS NULL),'[]'::jsonb) AS passengers
        FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
        LEFT JOIN booking_checkins c ON c.tenant_id=b.tenant_id AND c.booking_id=b.id
        WHERE b.tenant_id=$1 AND b.departure_id=$2 AND b.state='confirmed' ORDER BY b.id`,
        [actor.tenantId, departureId],
      );
      const enriched = bookings.map((booking) => {
        const totalMinor = Number(booking.total_minor);
        const paidMinor = Number(booking.paid_minor);
        const partnerCreditMinor = Number(booking.partner_credit_minor);
        const partnerClears =
          booking.collection_mode === "partner_invoice" ||
          booking.collection_mode === "partner_collects_for_tenant";
        const guestBalanceMinor = partnerClears
          ? 0
          : Math.max(0, totalMinor - paidMinor - partnerCreditMinor);
        return {
          ...booking,
          total_minor: totalMinor,
          paid_minor: paidMinor,
          partner_credit_minor: partnerCreditMinor,
          guest_balance_minor: guestBalanceMinor,
        };
      });
      const { rows: itinerary } = await tx.query(
        "SELECT id,sequence,name,address,directions,latitude,longitude,map_url,visibility FROM departure_itinerary_points WHERE tenant_id=$1 AND departure_id=$2 ORDER BY sequence",
        [actor.tenantId, departureId],
      );
      return { departure, bookings: enriched, itinerary };
    });
  }
  @Post("departures/:id/itinerary")
  @Access("operations.write")
  itinerary(
    @CurrentActor() actor: Actor,
    @Param("id") departureId: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    const input = parse(itineraryPointSchema, {
      ...(body as object),
      departureId: parse(id, departureId),
    });
    return this.db.command(
      actor,
      "departure.itinerary.add",
      parse(keySchema, key),
      input,
      async (tx) => {
        const exists = await tx.query(
          "SELECT 1 FROM departures WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, input.departureId],
        );
        if (!exists.rows[0])
          throw new BadRequestException("Departure is unavailable");
        const pointId = randomUUID();
        await tx.query(
          "INSERT INTO departure_itinerary_points(tenant_id,id,departure_id,sequence,name,address,directions,latitude,longitude,map_url,visibility,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            actor.tenantId,
            pointId,
            input.departureId,
            input.sequence,
            input.name,
            input.address,
            input.directions,
            input.latitude,
            input.longitude,
            input.mapUrl,
            input.visibility,
            actor.actorId,
          ],
        );
        await record(
          tx,
          actor,
          "departure.itinerary_point_added",
          pointId,
          null,
          input,
        );
        return { id: pointId, ...input };
      },
    );
  }
  @Get("audit")
  @Access("audit.read")
  audit(@CurrentActor() actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            `SELECT ae.id,ae.actor_id,ae.action,ae.aggregate_id,ae.reason,ae.occurred_at,
                    m.role AS actor_role,s.name AS actor_name
              FROM audit_events ae
              LEFT JOIN memberships m ON m.tenant_id=ae.tenant_id AND m.actor_id=ae.actor_id
              LEFT JOIN staff_users s ON s.id=ae.actor_id
              WHERE ae.tenant_id=$1
              ORDER BY ae.occurred_at DESC,ae.id LIMIT 100`,
            [actor.tenantId],
          )
        ).rows,
    );
  }
}
