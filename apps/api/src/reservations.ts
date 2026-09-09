import {
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
  bookingSchema,
  confirmSchema,
  id,
  paymentSchema,
  Quote,
} from "../../../packages/shared/src/contracts";
import { Database, record, Tx } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";
import { InventoryService } from "./inventory";
import { FinanceService } from "./finance";
import { tenant } from "./tenant";

@Injectable()
export class ReservationService {
  constructor(
    private readonly db: Database,
    private readonly inventory: InventoryService,
    private readonly finance: FinanceService,
  ) {}
  async booking(tx: Tx, actor: Actor, bookingId: string, lock = false) {
    const {
      rows: [row],
    } = await tx.query(
      `SELECT * FROM bookings WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [actor.tenantId, bookingId],
    );
    if (!row) throw new NotFoundException();
    return row;
  }
  create(actor: Actor, key: string, input: unknown) {
    const data = parse(bookingSchema, input);
    return this.db.command(actor, "booking.create", key, data, async (tx) => {
      const settings = await tenant(tx, actor);
      if (!settings.config.bookingSources.includes(data.source))
        throw new ConflictException("Booking source is not configured");
      const hold = await this.inventory.hold(tx, actor, data.holdId);
      await this.inventory.departure(tx, actor, hold.departure_id, true);
      const current = await this.inventory.hold(tx, actor, data.holdId);
      if (current.actor_id !== actor.actorId) throw new NotFoundException();
      if (!current.live || current.consumed)
        throw new ConflictException("Hold expired or consumed");
      const bookingId = randomUUID();
      await tx.query(
        `INSERT INTO bookings(tenant_id,id,hold_id,departure_id,lead_name,lead_email,source,pickup,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'held')`,
        [
          actor.tenantId,
          bookingId,
          data.holdId,
          hold.departure_id,
          data.leadName,
          data.leadEmail,
          data.source,
          data.pickup,
        ],
      );
      await record(tx, actor, "booking.created", bookingId, null, data);
      return { bookingId, state: "held", version: 1, quote: hold.quote };
    });
  }
  payment(actor: Actor, bookingId: string, key: string, input: unknown) {
    const data = parse(paymentSchema, input);
    return this.db.command(
      actor,
      `booking.payment:${bookingId}`,
      key,
      data,
      async (tx) => {
        const booking = await this.booking(tx, actor, bookingId, true);
        if (!["held", "confirmed"].includes(booking.state))
          throw new ConflictException(
            "Cannot collect on a cancelled reservation",
          );
        const hold = await this.inventory.hold(tx, actor, booking.hold_id);
        if (booking.state !== "confirmed" && !hold.live)
          throw new ConflictException(
            "Cannot collect on an expired reservation",
          );
        const result = await this.finance.record(
          tx,
          actor,
          bookingId,
          hold.quote,
          data,
        );
        return result;
      },
    );
  }
  confirm(actor: Actor, bookingId: string, key: string, input: unknown) {
    const data = parse(confirmSchema, input);
    return this.db.command(
      actor,
      `booking.confirm:${bookingId}`,
      key,
      data,
      async (tx) => {
        const initial = await this.booking(tx, actor, bookingId);
        await this.inventory.departure(tx, actor, initial.departure_id, true);
        const booking = await this.booking(tx, actor, bookingId, true);
        if (booking.state === "confirmed")
          return { bookingId, state: "confirmed", version: booking.version };
        if (booking.state !== "held")
          throw new ConflictException("Booking cannot be confirmed");
        if (booking.version !== data.version)
          throw new ConflictException("Stale booking version");
        const hold = await this.inventory.hold(tx, actor, booking.hold_id),
          quote = hold.quote as Quote;
        if (!hold.live) throw new ConflictException("Hold expired");
        if (
          booking.pickup.kind === "unresolved" &&
          !quote.allowUnresolvedPickup
        )
          throw new ConflictException(
            "Pickup must be resolved before confirmation",
          );
        const paid = await this.finance.paid(tx, actor, bookingId);
        if (
          BigInt(paid) * 100n <
          BigInt(quote.totalMinor) * BigInt(quote.minimumPaidPercent)
        )
          throw new ConflictException("Required payment has not settled");
        await this.inventory.consume(tx, actor, booking.hold_id);
        await tx.query(
          `UPDATE bookings SET state='confirmed',version=version+1 WHERE tenant_id=$1 AND id=$2`,
          [actor.tenantId, bookingId],
        );
        await tx.query(`INSERT INTO price_snapshots VALUES($1,$2,$3,$4)`, [
          actor.tenantId,
          bookingId,
          booking.version + 1,
          quote,
        ]);
        await record(
          tx,
          actor,
          "price_snapshot.created",
          bookingId,
          null,
          quote,
        );
        await record(
          tx,
          actor,
          "booking.confirmed",
          bookingId,
          { state: booking.state, version: booking.version },
          { state: "confirmed", version: booking.version + 1 },
        );
        return { bookingId, state: "confirmed", version: booking.version + 1 };
      },
    );
  }
  read(actor: Actor, bookingId: string) {
    return this.db.transaction(actor, async (tx) => {
      const booking = await this.booking(tx, actor, bookingId);
      const hold = await this.inventory.hold(tx, actor, booking.hold_id);
      const paidMinor = await this.finance.paid(tx, actor, bookingId);
      // Expiry is derived from database time so the worker is not a correctness dependency.
      return {
        ...booking,
        state:
          booking.state === "held" && !hold.live ? "expired" : booking.state,
        party: hold.party,
        expiresAt: hold.expires_at,
        quote: hold.quote,
        paidMinor,
        balanceMinor:
          booking.state === "cancelled" ? 0 : hold.quote.totalMinor - paidMinor,
        historicalBalanceMinor: hold.quote.totalMinor - paidMinor,
        financeReviewRequired:
          (booking.state === "cancelled" &&
            (
              await tx.query(
                "SELECT 1 FROM payments WHERE tenant_id=$1 AND booking_id=$2 LIMIT 1",
                [actor.tenantId, bookingId],
              )
            ).rowCount! > 0) ||
          paidMinor > hold.quote.totalMinor,
        departure: await this.inventory.departure(
          tx,
          actor,
          booking.departure_id,
        ),
      };
    });
  }
}
@Controller("staff/v1/bookings")
export class ReservationController {
  constructor(private readonly service: ReservationService) {}
  @Post()
  @Access("bookings.write")
  create(
    @CurrentActor() a: Actor,
    @Headers("idempotency-key") k: string,
    @Body() b: unknown,
  ) {
    return this.service.create(a, parse(keySchema, k), b);
  }
  @Get(":id")
  @Access("bookings.read")
  read(@CurrentActor() a: Actor, @Param("id") b: string) {
    return this.service.read(a, parse(id, b));
  }
  @Post(":id/payments")
  @Access("payment.write")
  payment(
    @CurrentActor() a: Actor,
    @Param("id") idValue: string,
    @Headers("idempotency-key") k: string,
    @Body() b: unknown,
  ) {
    return this.service.payment(a, parse(id, idValue), parse(keySchema, k), b);
  }
  @Post(":id/confirm")
  @Access("bookings.write")
  confirm(
    @CurrentActor() a: Actor,
    @Param("id") idValue: string,
    @Headers("idempotency-key") k: string,
    @Body() b: unknown,
  ) {
    return this.service.confirm(a, parse(id, idValue), parse(keySchema, k), b);
  }
}
