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
import { Database, record, Tx } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";
import { tenant } from "./tenant";
import { CatalogService } from "./catalog";
import { z } from "zod";

const overbookHoldSchema = holdSchema.extend({
  reason: z.string().trim().min(8).max(500),
}).strict();

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
  async availability(tx: Tx, actor: Actor, departureId: string) {
    // One SQL snapshot prevents a concurrent confirm being counted both as hold and commitment.
    const {
      rows: [r],
    } = await tx.query(
      `SELECT d.capacity,d.committed,d.overbooked,d.starts_at,d.operational_status,
      GREATEST(0,d.capacity-d.committed-d.overbooked-COALESCE((SELECT SUM(h.seats) FROM holds h WHERE h.tenant_id=d.tenant_id AND h.departure_id=d.id AND NOT h.consumed AND h.expires_at>clock_timestamp()),0))::int AS available
      FROM departures d WHERE d.tenant_id=$1 AND d.id=$2`,
      [actor.tenantId, departureId],
    );
    if (!r) throw new NotFoundException();
    return {
      ...r,
      available:
        new Date(r.starts_at).getTime() <= Date.now() ||
        r.operational_status !== "open"
          ? 0
          : r.available,
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
      seats += definition.countsTowardCapacity ? quantity : 0;
      lines.push({
        category,
        quantity,
        unitAmountMinor: rate.amountMinor,
        amountMinor: rate.amountMinor * quantity,
      });
    }
    const subtotalMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
    // Integer rational arithmetic; round tax half-up once on the subtotal.
    const taxMinor = Number(
      (BigInt(subtotalMinor) * BigInt(settings.config.taxBasisPoints) + 5000n) /
        10000n,
    );
    const currency = settings.config.bookingCurrency;
    const quote: Quote = {
      lines,
      subtotalMinor,
      taxMinor,
      totalMinor: subtotalMinor + taxMinor,
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
    return { quote, seats };
  }
  create(actor: Actor, key: string, input: unknown) {
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
      if (!future.future)
        throw new ConflictException("Departure has already started");
      if (dep.operational_status !== "open")
        throw new ConflictException("Departure is not available for sale");
      const { quote, seats } = await this.price(
        tx,
        actor,
        data.departureId,
        data.party,
      );
      const free = await this.availability(tx, actor, data.departureId);
      if (seats > free.available)
        throw new ConflictException("Insufficient seats");
      const holdId = randomUUID();
      const {
        rows: [hold],
      } = await tx.query(
        `INSERT INTO holds(tenant_id,id,departure_id,actor_id,party,seats,quote,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+$8*interval '1 second') RETURNING expires_at`,
        [
          actor.tenantId,
          holdId,
          data.departureId,
          actor.actorId,
          data.party,
          seats,
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
      const dep = await this.requireFixedDeparture(tx, actor, data.departureId, true);
      const { rows: [future] } = await tx.query(
        "SELECT $1::timestamptz>clock_timestamp() AS future",
        [dep.starts_at],
      );
      if (!future.future) throw new ConflictException("Departure has already started");
      if (dep.operational_status !== "open")
        throw new ConflictException("Departure is not available for sale");
      const { quote, seats } = await this.price(tx, actor, data.departureId, data.party);
      const free = await this.availability(tx, actor, data.departureId);
      if (seats <= free.available)
        throw new BadRequestException("Ordinary capacity is available; create a standard hold");
      const holdId = randomUUID();
      const { rows: [hold] } = await tx.query(
        `INSERT INTO holds(tenant_id,id,departure_id,actor_id,party,seats,quote,expires_at,overbook_authorized_by,overbook_reason)
         VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+$8*interval '1 second',$4,$9) RETURNING expires_at`,
        [actor.tenantId, holdId, data.departureId, actor.actorId, data.party, seats, quote, settings.config.holdSeconds, data.reason],
      );
      await record(tx, actor, "inventory.overbook_authorized", holdId, null, {
        departureId: data.departureId,
        seats,
        ordinaryAvailable: free.available,
        projectedCommitted: dep.committed + seats,
      }, data.reason);
      await record(tx, actor, "booking.held", holdId, null, {
        departureId: data.departureId,
        party: data.party,
        seats,
        quote,
        expiresAt: hold.expires_at,
        overbookAuthorized: true,
      }, data.reason);
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
  async consume(tx: Tx, actor: Actor, holdId: string) {
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
    const authorized = Boolean(hold.overbook_authorized_by);
    const { rowCount } = authorized
      ? await tx.query(
          "UPDATE departures SET overbooked=overbooked+$3 WHERE tenant_id=$1 AND id=$2 AND starts_at>clock_timestamp()",
          [actor.tenantId, hold.departure_id, hold.seats],
        )
      : await tx.query(
          "UPDATE departures SET committed=committed+$3 WHERE tenant_id=$1 AND id=$2 AND committed+$3<=capacity AND starts_at>clock_timestamp()",
          [actor.tenantId, hold.departure_id, hold.seats],
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
      authorized ? { overbookedDelta: hold.seats } : { committedDelta: hold.seats },
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
