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
        `SELECT d.id,d.starts_at,d.local_date,p.name AS product_name,
          array_agg(a.assignment_role ORDER BY a.assignment_role) AS assignment_roles
         FROM departure_assignments a
         JOIN departures d ON d.tenant_id=a.tenant_id AND d.id=a.departure_id
         JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         JOIN crew_profiles c ON c.tenant_id=a.tenant_id AND c.membership_actor_id=a.crew_actor_id AND c.active
         WHERE a.tenant_id=$1 AND a.crew_actor_id=$2 AND a.status='active' AND d.local_date=$3
         GROUP BY d.id,d.starts_at,d.local_date,p.name ORDER BY d.starts_at,d.id`,
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
              b.pickup,b.stay
             FROM bookings b
             JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
             LEFT JOIN booking_checkins c ON c.tenant_id=b.tenant_id AND c.booking_id=b.id
             WHERE b.tenant_id=$1 AND b.departure_id=ANY($2::uuid[]) AND b.state='confirmed'
             ORDER BY b.departure_id,b.id`,
            [actor.tenantId, departureIds],
          )
        : { rows: [] };
      return {
        date,
        waiverTemplate:
          (
            await tx.query(
              "SELECT id,version,title,body FROM waiver_templates WHERE tenant_id=$1 AND active ORDER BY version DESC LIMIT 1",
              [actor.tenantId],
            )
          ).rows[0] ?? null,
        trips: trips.map((trip) => ({
          ...trip,
          guests: guests.filter((guest) => guest.departure_id === trip.id),
        })),
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
