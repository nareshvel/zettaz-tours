import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Actor, id } from "../../../packages/shared/src/contracts";
import { LimitsService } from "./limits";
import { Database, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";
import { InventoryService } from "./inventory";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const boardQuery = z.object({ date: day }).strict();
// Zod v4: .omit() cannot be called on a schema that already has .refine().
// Solution: share the raw object, derive the update shape first, then add .refine() to both.
const pickupLocationLatLonCheck = (location: { latitude?: number; longitude?: number }) =>
  (location.latitude === undefined && location.longitude === undefined) ||
  (location.latitude !== undefined && location.longitude !== undefined);
const LAT_LON_MSG = "Latitude and longitude must be provided together";
const _pickupLocationBase = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["hotel", "port", "meeting_point", "other"]),
  notes: z.string().trim().max(500).default(""),
  address: z.string().trim().max(300).default(""),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  mapUrl: z.string().url().max(2048).or(z.literal("")).default(""),
  visibility: z.enum(["internal", "guest"]).default("internal"),
});
export const pickupLocationSchema = _pickupLocationBase
  .refine(pickupLocationLatLonCheck, LAT_LON_MSG)
  .strict();
export const pickupLocationUpdateSchema = _pickupLocationBase
  .omit({ slug: true })
  .refine(pickupLocationLatLonCheck, LAT_LON_MSG)
  .strict();
export const pickupPlanSchema = z
  .object({
    version: z.number().int().positive().optional(),
    notes: z.string().trim().max(500).default(""),
    stops: z
      .array(
        z
          .object({
            bookingId: id,
            locationId: id,
            pickupAt: z.string().datetime({ offset: true }),
            notes: z.string().trim().max(500).default(""),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
const operationalStatusSchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["open", "weather_hold", "closed"]),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

@Injectable()
export class DispatchService {
  constructor(
    private readonly db: Database,
    private readonly inventory: InventoryService,
  ) {}
  board(actor: Actor, raw: unknown) {
    const query = parse(boardQuery, raw);
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT d.id,d.starts_at,d.capacity,(d.committed+d.overbooked)::int AS committed,d.overbooked,d.operational_status,d.operational_reason,d.operational_version,p.name AS product_name,
        COUNT(b.id) FILTER(WHERE b.state='confirmed')::int AS confirmed_bookings,
        COALESCE(SUM((SELECT SUM(value::int) FROM jsonb_each_text(h.party))) FILTER(WHERE b.state='confirmed'),0)::int AS confirmed_guests,
        COUNT(b.id) FILTER(WHERE b.state='confirmed' AND b.pickup->>'kind'='selected')::int AS pickup_required,
        COUNT(s.id)::int AS pickup_planned,
        COUNT(b.id) FILTER(WHERE b.state='confirmed' AND b.pickup->>'kind'='unresolved')::int AS pickup_unresolved,
        plan.version AS plan_version,plan.notes AS plan_notes
        FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
        LEFT JOIN bookings b ON b.tenant_id=d.tenant_id AND b.departure_id=d.id
        LEFT JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
        LEFT JOIN pickup_stops s ON s.tenant_id=b.tenant_id AND s.booking_id=b.id
        LEFT JOIN departure_pickup_plans plan ON plan.tenant_id=d.tenant_id AND plan.departure_id=d.id
        WHERE d.tenant_id=$1 AND d.local_date=$2
        GROUP BY d.id,d.starts_at,d.capacity,d.committed,d.overbooked,d.operational_status,d.operational_reason,d.operational_version,p.name,plan.version,plan.notes ORDER BY d.starts_at,d.id`,
        [actor.tenantId, query.date],
      );
      return { date: query.date, items: rows };
    });
  }
  locations(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            "SELECT id,slug,name,kind,notes,address,latitude,longitude,map_url,visibility,active FROM pickup_locations WHERE tenant_id=$1 AND active ORDER BY name,id",
            [actor.tenantId],
          )
        ).rows,
    );
  }
  createLocation(actor: Actor, key: string, raw: unknown) {
    const input = parse(pickupLocationSchema, raw);
    return this.db.command(
      actor,
      "pickup_location.create",
      key,
      input,
      async (tx) => {
        const idValue = randomUUID();
        try {
          await tx.query(
            "INSERT INTO pickup_locations(tenant_id,id,slug,name,kind,notes,address,latitude,longitude,map_url,visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            [
              actor.tenantId,
              idValue,
              input.slug,
              input.name,
              input.kind,
              input.notes,
              input.address,
              input.latitude ?? null,
              input.longitude ?? null,
              input.mapUrl,
              input.visibility,
            ],
          );
        } catch {
          throw new ConflictException("Pickup location code already exists");
        }
        await record(
          tx,
          actor,
          "pickup_location.created",
          idValue,
          null,
          input,
        );
        return { id: idValue, ...input, active: true };
      },
    );
  }
  updateLocation(actor: Actor, locationId: string, key: string, raw: unknown) {
    const input = parse(pickupLocationUpdateSchema, raw);
    return this.db.command(
      actor,
      `pickup_location.update:${locationId}`,
      key,
      input,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT id,slug,name,kind,notes,address,latitude,longitude,map_url,visibility,active FROM pickup_locations WHERE tenant_id=$1 AND id=$2 AND active FOR UPDATE",
          [actor.tenantId, locationId],
        );
        if (!before) throw new NotFoundException("Pickup location not found");
        const {
          rows: [row],
        } = await tx.query(
          `UPDATE pickup_locations SET name=$3,kind=$4,notes=$5,address=$6,latitude=$7,longitude=$8,map_url=$9,visibility=$10
           WHERE tenant_id=$1 AND id=$2 RETURNING id,slug,name,kind,notes,address,latitude,longitude,map_url,visibility,active`,
          [
            actor.tenantId,
            locationId,
            input.name,
            input.kind,
            input.notes,
            input.address,
            input.latitude ?? null,
            input.longitude ?? null,
            input.mapUrl,
            input.visibility,
          ],
        );
        await record(
          tx,
          actor,
          "pickup_location.updated",
          locationId,
          before,
          input,
        );
        return row;
      },
    );
  }
  deleteLocation(actor: Actor, locationId: string, key: string) {
    return this.db.command(
      actor,
      `pickup_location.delete:${locationId}`,
      key,
      { locationId },
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT id,slug,name,kind,notes,address,latitude,longitude,map_url,visibility,active FROM pickup_locations WHERE tenant_id=$1 AND id=$2 AND active FOR UPDATE",
          [actor.tenantId, locationId],
        );
        if (!before) throw new NotFoundException("Pickup location not found");
        const {
          rows: [inUse],
        } = await tx.query(
          "SELECT 1 AS used FROM pickup_stops WHERE tenant_id=$1 AND location_id=$2 LIMIT 1",
          [actor.tenantId, locationId],
        );
        if (inUse)
          throw new ConflictException(
            "Location is used on a saved pickup plan. Reassign those stops first.",
          );
        await tx.query(
          "UPDATE pickup_locations SET active=false WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, locationId],
        );
        await record(
          tx,
          actor,
          "pickup_location.deactivated",
          locationId,
          before,
          { active: false },
        );
        return { id: locationId, active: false };
      },
    );
  }
  savePlan(actor: Actor, departureId: string, key: string, raw: unknown) {
    const input = parse(pickupPlanSchema, raw);
    return this.db.command(
      actor,
      `pickup_plan.save:${departureId}`,
      key,
      input,
      async (tx) => {
        const dep = await this.inventory.departure(
          tx,
          actor,
          departureId,
          true,
        );
        const {
          rows: [future],
        } = await tx.query(
          "SELECT $1::timestamptz>clock_timestamp() AS future",
          [dep.starts_at],
        );
        if (!future.future)
          throw new ConflictException("Departure has already started");
        const {
          rows: [prior],
        } = await tx.query(
          "SELECT version,notes FROM departure_pickup_plans WHERE tenant_id=$1 AND departure_id=$2 FOR UPDATE",
          [actor.tenantId, departureId],
        );
        if (prior && input.version !== prior.version)
          throw new ConflictException("Stale pickup plan version");
        if (!prior && input.version !== undefined)
          throw new ConflictException("Pickup plan does not exist yet");
        const ids = input.stops.map((s) => s.bookingId);
        if (new Set(ids).size !== ids.length)
          throw new ConflictException(
            "A booking can appear only once in a pickup plan",
          );
        if (ids.length) {
          const { rows: bookings } = await tx.query(
            `SELECT b.id,b.pickup->>'kind' AS pickup_kind FROM bookings b WHERE b.tenant_id=$1 AND b.departure_id=$2 AND b.state='confirmed' AND b.id=ANY($3::uuid[])`,
            [actor.tenantId, departureId, ids],
          );
          if (
            bookings.length !== ids.length ||
            bookings.some((b) => b.pickup_kind !== "selected")
          )
            throw new ConflictException(
              "Only confirmed bookings with arranged pickup can be planned",
            );
          const { rows: locations } = await tx.query(
            "SELECT id FROM pickup_locations WHERE tenant_id=$1 AND active AND id=ANY($2::uuid[])",
            [actor.tenantId, input.stops.map((s) => s.locationId)],
          );
          if (
            locations.length !==
            new Set(input.stops.map((s) => s.locationId)).size
          )
            throw new ConflictException("Pickup location is not available");
        }
        if (
          input.stops.some(
            (stop) =>
              new Date(stop.pickupAt).getTime() >
              new Date(dep.starts_at).getTime(),
          )
        )
          throw new ConflictException(
            "Pickup time cannot be after departure start",
          );
        const before = prior
            ? { version: prior.version, notes: prior.notes }
            : null,
          version = (prior?.version ?? 0) + 1;
        if (prior)
          await tx.query(
            "UPDATE departure_pickup_plans SET version=$3,notes=$4,updated_at=clock_timestamp(),updated_by=$5 WHERE tenant_id=$1 AND departure_id=$2",
            [actor.tenantId, departureId, version, input.notes, actor.actorId],
          );
        else
          await tx.query(
            "INSERT INTO departure_pickup_plans(tenant_id,departure_id,version,notes,updated_by) VALUES($1,$2,$3,$4,$5)",
            [actor.tenantId, departureId, version, input.notes, actor.actorId],
          );
        await tx.query(
          "DELETE FROM pickup_stops WHERE tenant_id=$1 AND departure_id=$2",
          [actor.tenantId, departureId],
        );
        for (const [i, stop] of input.stops.entries())
          await tx.query(
            "INSERT INTO pickup_stops(tenant_id,id,departure_id,booking_id,location_id,sequence,pickup_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              actor.tenantId,
              randomUUID(),
              departureId,
              stop.bookingId,
              stop.locationId,
              i + 1,
              stop.pickupAt,
              stop.notes,
            ],
          );
        const after = {
          version,
          notes: input.notes,
          stops: input.stops.map((s, i) => ({ ...s, sequence: i + 1 })),
        };
        await record(
          tx,
          actor,
          "pickup_plan.saved",
          departureId,
          before,
          after,
        );
        return after;
      },
    );
  }
  plan(actor: Actor, departureId: string) {
    return this.db.transaction(actor, async (tx) => {
      await this.inventory.departure(tx, actor, departureId);
      const {
        rows: [plan],
      } = await tx.query(
        "SELECT version,notes,updated_at FROM departure_pickup_plans WHERE tenant_id=$1 AND departure_id=$2",
        [actor.tenantId, departureId],
      );
      const { rows: stops } = await tx.query(
        `SELECT s.booking_id,s.location_id,s.sequence,s.pickup_at,s.notes,l.name AS location_name,b.lead_name,
        (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
        FROM pickup_stops s JOIN pickup_locations l ON l.tenant_id=s.tenant_id AND l.id=s.location_id JOIN bookings b ON b.tenant_id=s.tenant_id AND b.id=s.booking_id JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
        WHERE s.tenant_id=$1 AND s.departure_id=$2 ORDER BY s.sequence`,
        [actor.tenantId, departureId],
      );
      const { rows: eligible } = await tx.query(
        `SELECT b.id AS booking_id,b.lead_name,b.pickup,(SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
        FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id WHERE b.tenant_id=$1 AND b.departure_id=$2 AND b.state='confirmed' AND b.pickup->>'kind'='selected' ORDER BY b.id`,
        [actor.tenantId, departureId],
      );
      return { plan: plan ?? null, stops, eligible };
    });
  }
  printableList(actor: Actor, departureId: string) {
    return this.db.transaction(actor, async (tx) => {
      const departure = await this.inventory.departure(tx, actor, departureId);
      const {
        rows: [product],
      } = await tx.query(
        "SELECT p.name FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id WHERE d.tenant_id=$1 AND d.id=$2",
        [actor.tenantId, departureId],
      );
      const {
        rows: [plan],
      } = await tx.query(
        "SELECT version,notes,updated_at FROM departure_pickup_plans WHERE tenant_id=$1 AND departure_id=$2",
        [actor.tenantId, departureId],
      );
      const { rows: stops } = await tx.query(
        `SELECT s.sequence,s.pickup_at,s.notes,l.name AS location_name,b.lead_name,
        (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
        FROM pickup_stops s JOIN pickup_locations l ON l.tenant_id=s.tenant_id AND l.id=s.location_id JOIN bookings b ON b.tenant_id=s.tenant_id AND b.id=s.booking_id JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
        WHERE s.tenant_id=$1 AND s.departure_id=$2 ORDER BY s.sequence`,
        [actor.tenantId, departureId],
      );
      const { rows: exceptions } = await tx.query(
        `SELECT b.id AS booking_id,b.lead_name,b.pickup->>'kind' AS pickup_kind,
        (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
        FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
        WHERE b.tenant_id=$1 AND b.departure_id=$2 AND b.state='confirmed' AND (
          b.pickup->>'kind'='unresolved' OR (
            b.pickup->>'kind'='selected' AND NOT EXISTS (
              SELECT 1 FROM pickup_stops s WHERE s.tenant_id=b.tenant_id AND s.departure_id=b.departure_id AND s.booking_id=b.id
            )
          )
        ) ORDER BY b.pickup->>'kind',b.lead_name,b.id`,
        [actor.tenantId, departureId],
      );
      return {
        departure: {
          id: departure.id,
          starts_at: departure.starts_at,
          product_name: product.name,
        },
        plan: plan ?? null,
        stops,
        exceptions,
      };
    });
  }
  setOperationalStatus(
    actor: Actor,
    departureId: string,
    key: string,
    raw: unknown,
  ) {
    const input = parse(operationalStatusSchema, raw);
    return this.db.command(
      actor,
      `departure.operational_status:${departureId}`,
      key,
      input,
      async (tx) => {
        const dep = await this.inventory.departure(
          tx,
          actor,
          departureId,
          true,
        );
        if (dep.operational_version !== input.version)
          throw new ConflictException("Stale operational status version");
        const {
          rows: [row],
        } = await tx.query(
          "UPDATE departures SET operational_status=$3,operational_reason=$4,operational_version=operational_version+1 WHERE tenant_id=$1 AND id=$2 RETURNING operational_status,operational_reason,operational_version",
          [actor.tenantId, departureId, input.status, input.reason],
        );
        await record(
          tx,
          actor,
          "departure.operational_status_changed",
          departureId,
          {
            status: dep.operational_status,
            reason: dep.operational_reason,
            version: dep.operational_version,
          },
          {
            status: row.operational_status,
            reason: row.operational_reason,
            version: row.operational_version,
          },
        );
        return row;
      },
    );
  }
}
@Controller("ops/v1")
export class DispatchController {
  constructor(private readonly service: DispatchService, private readonly limits: LimitsService) {}
  @Get("board") @Access("manifest.read") board(
    @CurrentActor() a: Actor,
    @Query() q: unknown,
  ) {
    return this.service.board(a, q);
  }
  @Get("pickup-locations") @Access("manifest.read") locations(
    @CurrentActor() a: Actor,
  ) {
    return this.service.locations(a);
  }
  @Post("pickup-locations") @Access("operations.write") async createLocation(
    @CurrentActor() a: Actor,
    @Headers("idempotency-key") k: string,
    @Body() b: unknown,
  ) {
    await this.limits.enforce(a, "locations");
    return this.service.createLocation(a, parse(keySchema, k), b);
  }
  @Patch("pickup-locations/:id") @Access("operations.write") updateLocation(
    @CurrentActor() a: Actor,
    @Param("id") locationId: string,
    @Headers("idempotency-key") k: string,
    @Body() b: unknown,
  ) {
    return this.service.updateLocation(
      a,
      parse(id, locationId),
      parse(keySchema, k),
      b,
    );
  }
  @Delete("pickup-locations/:id") @Access("operations.write") deleteLocation(
    @CurrentActor() a: Actor,
    @Param("id") locationId: string,
    @Headers("idempotency-key") k: string,
  ) {
    return this.service.deleteLocation(
      a,
      parse(id, locationId),
      parse(keySchema, k),
    );
  }
  @Get("departures/:id/pickups") @Access("manifest.read") plan(
    @CurrentActor() a: Actor,
    @Param("id") d: string,
  ) {
    return this.service.plan(a, parse(id, d));
  }
  @Get("departures/:id/pickup-list") @Access("manifest.read") printableList(
    @CurrentActor() a: Actor,
    @Param("id") d: string,
  ) {
    return this.service.printableList(a, parse(id, d));
  }
  @Post("departures/:id/pickups") @Access("operations.write") save(
    @CurrentActor() a: Actor,
    @Param("id") d: string,
    @Headers("idempotency-key") k: string,
    @Body() b: unknown,
  ) {
    return this.service.savePlan(a, parse(id, d), parse(keySchema, k), b);
  }
  @Post("departures/:id/operational-status") @Access("operations.write") status(
    @CurrentActor() a: Actor,
    @Param("id") d: string,
    @Headers("idempotency-key") k: string,
    @Body() b: unknown,
  ) {
    return this.service.setOperationalStatus(
      a,
      parse(id, d),
      parse(keySchema, k),
      b,
    );
  }
}
