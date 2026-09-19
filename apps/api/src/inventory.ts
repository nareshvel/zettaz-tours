import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Actor,
  holdSchema,
  id,
  Quote,
} from "../../../packages/shared/src/contracts";
import { resolveOccupancyClass } from "../../../packages/shared/src/occupancy";
import { Database, record, Tx } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";
import { tenant } from "./tenant";
import { CatalogService } from "./catalog";
import { z } from "zod";

const overbookHoldSchema = holdSchema
  .extend({
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

@Injectable()
export class InventoryService {
  constructor(
    private readonly db: Database,
    private readonly catalog: CatalogService,
  ) {}
  async departure(tx: Tx, actor: Actor, departureId: string, lock = false) {
    const {
      rows: [row],
    } = await tx.query(
      `SELECT *,local_date::text AS local_day FROM departures WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [actor.tenantId, departureId],
    );
    if (!row) throw new NotFoundException();
    return row;
  }
  async requireFixedDeparture(
    tx: Tx,
    actor: Actor,
    departureId: string,
    lock = false,
  ) {
    const dep = await this.departure(tx, actor, departureId, lock);
    const {
      rows: [product],
    } = await tx.query(
      `SELECT p.availability_mode FROM products p
       WHERE p.tenant_id=$1 AND p.id=$2`,
      [actor.tenantId, dep.product_id],
    );
    if ((product?.availability_mode ?? "fixed_departure") !== "fixed_departure")
      throw new BadRequestException(
        "This product is not booked as a shared departure. Use its availability-mode workflow.",
      );
    return dep;
  }
  async availability(
    tx: Tx,
    actor: Actor,
    departureId: string,
    options?: { allowAfterSchedule?: boolean },
  ) {
    // One SQL snapshot prevents a concurrent confirm being counted both as hold and commitment.
    const {
      rows: [r],
    } = await tx.query(
      `SELECT d.capacity,d.capacity_adult,d.capacity_child,d.committed,d.overbooked,
      d.committed_adults,d.overbooked_adults,d.committed_children,d.overbooked_children,
      d.starts_at,d.operational_status,
      GREATEST(0,d.capacity-d.committed-d.overbooked-COALESCE(h.seats,0))::int AS available,
      GREATEST(0,d.capacity_adult-d.committed_adults-d.overbooked_adults-COALESCE(h.adults,0))::int AS available_adults,
      CASE WHEN d.capacity_child IS NULL THEN NULL
           ELSE GREATEST(0,d.capacity_child-d.committed_children-d.overbooked_children-COALESCE(h.children,0))::int
      END AS available_children
      FROM departures d
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(seats),0)::int AS seats,
               COALESCE(SUM(adult_seats),0)::int AS adults,
               COALESCE(SUM(child_seats),0)::int AS children
          FROM holds
         WHERE tenant_id=d.tenant_id AND departure_id=d.id
           AND NOT consumed AND expires_at>clock_timestamp()
      ) h ON true
      WHERE d.tenant_id=$1 AND d.id=$2`,
      [actor.tenantId, departureId],
    );
    if (!r) throw new NotFoundException();
    const pastStart = new Date(r.starts_at).getTime() <= Date.now();
    const closed =
      r.operational_status !== "open" ||
      (pastStart && !options?.allowAfterSchedule);
    return {
      ...r,
      available: closed ? 0 : r.available,
      available_adults: closed ? 0 : r.available_adults,
      available_children: closed
        ? r.available_children == null
          ? null
          : 0
        : r.available_children,
    };
  }
  async hold(tx: Tx, actor: Actor, holdId: string) {
    const {
      rows: [row],
    } = await tx.query(
      "SELECT *,expires_at>clock_timestamp() AS live FROM holds WHERE tenant_id=$1 AND id=$2",
      [actor.tenantId, holdId],
    );
    if (!row) throw new NotFoundException();
    return row;
  }
  async price(
    tx: Tx,
    actor: Actor,
    departureId: string,
    party: Record<string, number>,
  ) {
    const settings = await tenant(tx, actor);
    const dep = await this.departure(tx, actor, departureId);
    const product = await this.catalog.definition(tx, actor, dep.product_id);
    let seats = 0;
    let adultSeats = 0;
    let childSeats = 0;
    const lines: Quote["lines"] = [];
    for (const [category, quantity] of Object.entries(party)) {
      const definition = product.definition.categories.find(
        (c) => c.slug === category,
      );
      if (!definition)
        throw new BadRequestException("Unknown passenger category");
      if (!quantity) continue;
      const rate = product.definition.rates.find(
        (r) =>
          r.category === category &&
          r.startDate <= dep.local_day &&
          r.endDate >= dep.local_day,
      );
      if (!rate) throw new BadRequestException("No applicable seasonal rate");
      const occupancyClass = resolveOccupancyClass(definition);
      if (definition.countsTowardCapacity) seats += quantity;
      if (occupancyClass === "adult") adultSeats += quantity;
      if (occupancyClass === "child") childSeats += quantity;
      lines.push({
        category,
        quantity,
        unitAmountMinor: rate.amountMinor,
        amountMinor: rate.amountMinor * quantity,
      });
    }
    const lineTotalMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
    const bp = BigInt(settings.config.taxBasisPoints);
    const taxInclusive = settings.config.taxInclusive;
    // Integer rational arithmetic, rounded half-up once over the whole party.
    //
    // Exclusive: catalogue amounts are net. Tax is computed on them and added.
    // Inclusive: catalogue amounts already contain tax, so the net is recovered
    //   as amount * 10000 / (10000 + bp) and the tax is the remainder. Deriving
    //   tax by subtraction rather than by a second rounded multiplication is
    //   what guarantees subtotal + tax === total exactly, with no stray minor
    //   unit — the payment ceiling in reservations.ts relies on that identity.
    let subtotalMinor: number;
    let taxMinor: number;
    if (taxInclusive) {
      const denominator = 10000n + bp;
      const gross = BigInt(lineTotalMinor);
      subtotalMinor = Number((gross * 10000n + denominator / 2n) / denominator);
      taxMinor = lineTotalMinor - subtotalMinor;
    } else {
      subtotalMinor = lineTotalMinor;
      taxMinor = Number((BigInt(lineTotalMinor) * bp + 5000n) / 10000n);
    }
    const currency = settings.config.bookingCurrency;
    const quote: Quote = {
      lines,
      subtotalMinor,
      taxMinor,
      totalMinor: subtotalMinor + taxMinor,
      taxInclusive,
      currency,
      exchangeRate: {
        from: currency,
        to: currency,
        numerator: 1,
        denominator: 1,
        source: "same_currency",
      },
      configVersion: settings.version,
      productVersion: product.version,
      minimumPaidPercent: settings.config.minimumPaidPercent,
      allowUnresolvedPickup: settings.config.allowUnresolvedPickup,
    };
    if (
      !Number.isSafeInteger(quote.totalMinor) ||
      quote.totalMinor > 1_000_000_000_000
    )
      throw new BadRequestException("Booking amount exceeds supported range");
    return { quote, seats, adultSeats, childSeats };
  }
  ordinaryFits(
    free: {
      available: number;
      available_adults: number;
      available_children: number | null;
    },
    seats: number,
    adultSeats: number,
    childSeats: number,
  ) {
    if (seats > free.available) return false;
    if (adultSeats > free.available_adults) return false;
    if (free.available_children != null && childSeats > free.available_children)
      return false;
    return true;
  }
  async adjustPools(
    tx: Tx,
    actor: Actor,
    departureId: string,
    pool: "committed" | "overbooked",
    seats: number,
    adultSeats: number,
    childSeats: number,
    options?: { ordinaryCheck?: boolean; startGuard?: string },
  ) {
    const startGuard = options?.startGuard ?? "";
    if (pool === "overbooked") {
      const { rowCount } = await tx.query(
        `UPDATE departures
            SET overbooked=overbooked+$3,
                overbooked_adults=overbooked_adults+$4,
                overbooked_children=overbooked_children+$5
          WHERE tenant_id=$1 AND id=$2${startGuard}`,
        [actor.tenantId, departureId, seats, adultSeats, childSeats],
      );
      return rowCount;
    }
    const check = options?.ordinaryCheck
      ? ` AND committed+$3<=capacity AND committed_adults+$4<=capacity_adult AND (capacity_child IS NULL OR committed_children+$5<=capacity_child)`
      : "";
    const { rowCount } = await tx.query(
      `UPDATE departures
          SET committed=committed+$3,
              committed_adults=committed_adults+$4,
              committed_children=committed_children+$5
        WHERE tenant_id=$1 AND id=$2${check}${startGuard}`,
      [actor.tenantId, departureId, seats, adultSeats, childSeats],
    );
    return rowCount;
  }
  create(
    actor: Actor,
    key: string,
    input: unknown,
    options?: { allowAfterSchedule?: boolean },
  ) {
    const data = parse(holdSchema, input);
    return this.db.command(actor, "hold.create", key, data, async (tx) => {
      const settings = await tenant(tx, actor);
      const dep = await this.requireFixedDeparture(
        tx,
        actor,
        data.departureId,
        true,
      );
      const {
        rows: [future],
      } = await tx.query("SELECT $1::timestamptz>clock_timestamp() AS future", [
        dep.starts_at,
      ]);
      if (options?.allowAfterSchedule) {
        const {
          rows: [run],
        } = await tx.query(
          "SELECT state FROM trip_runs WHERE tenant_id=$1 AND departure_id=$2",
          [actor.tenantId, data.departureId],
        );
        if (["departed", "completed", "cancelled"].includes(run?.state ?? ""))
          throw new ConflictException(
            "Walk-in is closed because this trip has already left",
          );
      } else if (!future.future)
        throw new ConflictException("Departure has already started");
      if (dep.operational_status !== "open")
        throw new ConflictException("Departure is not available for sale");
      const { quote, seats, adultSeats, childSeats } = await this.price(
        tx,
        actor,
        data.departureId,
        data.party,
      );
      const free = await this.availability(tx, actor, data.departureId, {
        allowAfterSchedule: options?.allowAfterSchedule,
      });
      if (!this.ordinaryFits(free, seats, adultSeats, childSeats))
        throw new ConflictException("Insufficient seats");
      const holdId = randomUUID();
      const {
        rows: [hold],
      } = await tx.query(
        `INSERT INTO holds(tenant_id,id,departure_id,actor_id,party,seats,adult_seats,child_seats,quote,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+$10*interval '1 second') RETURNING expires_at`,
        [
          actor.tenantId,
          holdId,
          data.departureId,
          actor.actorId,
          data.party,
          seats,
          adultSeats,
          childSeats,
          quote,
          settings.config.holdSeconds,
        ],
      );
      await record(tx, actor, "booking.held", holdId, null, {
        departureId: data.departureId,
        party: data.party,
        seats,
        quote,
        expiresAt: hold.expires_at,
      });
      return {
        holdId,
        departureId: data.departureId,
        seats,
        quote,
        expiresAt: hold.expires_at.toISOString(),
      };
    });
  }
  createOverbook(actor: Actor, key: string, input: unknown) {
    const data = parse(overbookHoldSchema, input);
    return this.db.command(actor, "hold.overbook", key, data, async (tx) => {
      const settings = await tenant(tx, actor);
      const dep = await this.requireFixedDeparture(
        tx,
        actor,
        data.departureId,
        true,
      );
      const {
        rows: [future],
      } = await tx.query("SELECT $1::timestamptz>clock_timestamp() AS future", [
        dep.starts_at,
      ]);
      if (!future.future)
        throw new ConflictException("Departure has already started");
      if (dep.operational_status !== "open")
        throw new ConflictException("Departure is not available for sale");
      const { quote, seats, adultSeats, childSeats } = await this.price(
        tx,
        actor,
        data.departureId,
        data.party,
      );
      if ((settings.config.overbookPolicy ?? "authorized") === "off")
        throw new ConflictException("Overbooking is turned off for this tenant");
      const free = await this.availability(tx, actor, data.departureId);
      if (this.ordinaryFits(free, seats, adultSeats, childSeats))
        throw new BadRequestException(
          "Ordinary capacity is available; create a standard hold",
        );
      const holdId = randomUUID();
      const {
        rows: [hold],
      } = await tx.query(
        `INSERT INTO holds(tenant_id,id,departure_id,actor_id,party,seats,adult_seats,child_seats,quote,expires_at,overbook_authorized_by,overbook_reason)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+$10*interval '1 second',$4,$11) RETURNING expires_at`,
        [
          actor.tenantId,
          holdId,
          data.departureId,
          actor.actorId,
          data.party,
          seats,
          adultSeats,
          childSeats,
          quote,
          settings.config.holdSeconds,
          data.reason,
        ],
      );
      await record(
        tx,
        actor,
        "inventory.overbook_authorized",
        holdId,
        null,
        {
          departureId: data.departureId,
          seats,
          ordinaryAvailable: free.available,
          projectedCommitted: dep.committed + seats,
        },
        data.reason,
      );
      await record(
        tx,
        actor,
        "booking.held",
        holdId,
        null,
        {
          departureId: data.departureId,
          party: data.party,
          seats,
          quote,
          expiresAt: hold.expires_at,
          overbookAuthorized: true,
        },
        data.reason,
      );
      return {
        holdId,
        departureId: data.departureId,
        seats,
        quote,
        expiresAt: hold.expires_at.toISOString(),
        overbookAuthorized: true,
      };
    });
  }
  async consume(
    tx: Tx,
    actor: Actor,
    holdId: string,
    options?: { allowAfterSchedule?: boolean },
  ) {
    const initial = await this.hold(tx, actor, holdId);
    const departure = await this.departure(
      tx,
      actor,
      initial.departure_id,
      true,
    );
    if (departure.operational_status !== "open")
      throw new ConflictException("Departure is not available for sale");
    const hold = await this.hold(tx, actor, holdId);
    if (!hold.live || hold.consumed)
      throw new ConflictException("Hold expired or already consumed");
    if (options?.allowAfterSchedule) {
      const {
        rows: [run],
      } = await tx.query(
        "SELECT state FROM trip_runs WHERE tenant_id=$1 AND departure_id=$2",
        [actor.tenantId, hold.departure_id],
      );
      if (["departed", "completed", "cancelled"].includes(run?.state ?? ""))
        throw new ConflictException(
          "Walk-in is closed because this trip has already left",
        );
    }
    const authorized = Boolean(hold.overbook_authorized_by);
    const startGuard = options?.allowAfterSchedule
      ? ""
      : " AND starts_at>clock_timestamp()";
    const rowCount = await this.adjustPools(
      tx,
      actor,
      hold.departure_id,
      authorized ? "overbooked" : "committed",
      hold.seats,
      Number(hold.adult_seats ?? 0),
      Number(hold.child_seats ?? 0),
      { ordinaryCheck: !authorized, startGuard },
    );
    if (!rowCount) throw new ConflictException("Departure unavailable");
    await tx.query(
      "UPDATE holds SET consumed=true WHERE tenant_id=$1 AND id=$2",
      [actor.tenantId, holdId],
    );
    await record(
      tx,
      actor,
      "inventory.hold_consumed",
      holdId,
      { consumed: false },
      { consumed: true },
    );
    await record(
      tx,
      actor,
      "departure.capacity_changed",
      hold.departure_id,
      null,
      authorized
        ? { overbookedDelta: hold.seats }
        : { committedDelta: hold.seats },
      hold.overbook_reason ?? undefined,
    );
    return hold;
  }
}
@Controller("staff/v1")
export class InventoryController {
  constructor(
    private readonly service: InventoryService,
    private readonly db: Database,
  ) {}
  @Get("departures/:id/availability")
  @Access("catalog.read")
  availability(@CurrentActor() a: Actor, @Param("id") dep: string) {
    return this.db.transaction(a, (tx) =>
      this.service.availability(tx, a, parse(id, dep)),
    );
  }
  @Post("holds")
  @Access("bookings.write")
  hold(
    @CurrentActor() a: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.create(a, parse(keySchema, key), body);
  }
  @Post("overbook-holds")
  @Access("inventory.overbook")
  overbook(
    @CurrentActor() a: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.createOverbook(a, parse(keySchema, key), body);
  }
}
