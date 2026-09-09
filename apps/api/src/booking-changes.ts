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
  amendmentSchema,
  acceptAmendmentSchema,
  cancellationSchema,
  id,
  Quote,
} from "../../../packages/shared/src/contracts";
import { Database, record, Tx } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";
import { ReservationService } from "./reservations";
import { InventoryService } from "./inventory";
import { FinanceService } from "./finance";
import { tenant } from "./tenant";

@Injectable()
export class BookingChangeService {
  constructor(
    private readonly db: Database,
    private readonly reservations: ReservationService,
    private readonly inventory: InventoryService,
    private readonly finance: FinanceService,
  ) {}
  async editable(tx: Tx, actor: Actor, booking: any) {
    if (!["held", "confirmed"].includes(booking.state))
      throw new ConflictException("Booking is not editable");
    const hold = await this.inventory.hold(tx, actor, booking.hold_id);
    if (booking.state === "held" && !hold.live)
      throw new ConflictException("Hold expired");
    const dep = await this.inventory.departure(tx, actor, booking.departure_id);
    const {
      rows: [r],
    } = await tx.query("SELECT $1::timestamptz>clock_timestamp() AS future", [
      dep.starts_at,
    ]);
    if (!r.future) throw new ConflictException("Departure has already started");
    return hold;
  }
  quote(actor: Actor, bookingId: string, key: string, input: unknown) {
    const data = parse(amendmentSchema, input);
    return this.db.command(
      actor,
      `booking.change_quote:${bookingId}`,
      key,
      data,
      async (tx) => {
        const booking = await this.reservations.booking(tx, actor, bookingId);
        if (booking.version !== data.version)
          throw new ConflictException("Stale booking version");
        const hold = await this.editable(tx, actor, booking);
        const sameParty = Object.keys({ ...hold.party, ...data.party }).every(
          (k) => (hold.party[k] ?? 0) === (data.party[k] ?? 0),
        );
        const commercialChange =
          booking.departure_id !== data.departureId || !sameParty;
        if (commercialChange && booking.state !== "confirmed")
          throw new ConflictException(
            "Held bookings support guest and pickup corrections only; create a new reservation for departure or party changes",
          );
        const target = await this.inventory.departure(
          tx,
          actor,
          data.departureId,
        );
        const {
          rows: [future],
        } = await tx.query(
          "SELECT $1::timestamptz>clock_timestamp() AS future",
          [target.starts_at],
        );
        if (!future.future)
          throw new ConflictException("Target departure has already started");
        const priced = commercialChange
          ? await this.inventory.price(tx, actor, data.departureId, data.party)
          : { quote: hold.quote as Quote, seats: hold.seats as number };
        if (priced.quote.currency !== hold.quote.currency)
          throw new ConflictException(
            "Cross-currency amendment is not supported",
          );
        if (
          booking.state === "confirmed" &&
          data.pickup.kind === "unresolved" &&
          !priced.quote.allowUnresolvedPickup
        )
          throw new ConflictException("Pickup must be resolved");
        const settings = await tenant(tx, actor),
          quoteId = randomUUID();
        const {
          rows: [q],
        } = await tx.query(
          `INSERT INTO booking_change_quotes(tenant_id,id,booking_id,actor_id,base_version,input,quote,seats,allow_balance,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,LEAST(clock_timestamp()+$10*interval '1 second',$11::timestamptz)) RETURNING expires_at`,
          [
            actor.tenantId,
            quoteId,
            bookingId,
            actor.actorId,
            booking.version,
            data,
            priced.quote,
            priced.seats,
            settings.config.allowAmendmentBalance === true,
            settings.config.holdSeconds,
            booking.state === "held" ? hold.expires_at : target.starts_at,
          ],
        );
        const paidMinor = await this.finance.paid(tx, actor, bookingId);
        const result = {
          quoteId,
          version: booking.version,
          quote: priced.quote,
          previousTotalMinor: hold.quote.totalMinor,
          differenceMinor: priced.quote.totalMinor - hold.quote.totalMinor,
          paidMinor,
          balanceMinor: priced.quote.totalMinor - paidMinor,
          expiresAt: q.expires_at,
          allowAmendmentBalance: settings.config.allowAmendmentBalance === true,
          seatsReserved: false,
        };
        await record(
          tx,
          actor,
          "booking.change_quoted",
          bookingId,
          null,
          result,
          data.reason,
        );
        return result;
      },
    );
  }
  accept(actor: Actor, bookingId: string, key: string, input: unknown) {
    const data = parse(acceptAmendmentSchema, input);
    return this.db.command(
      actor,
      `booking.change_accept:${bookingId}`,
      key,
      data,
      async (tx) => {
        const {
          rows: [q],
        } = await tx.query(
          "SELECT * FROM booking_change_quotes WHERE tenant_id=$1 AND id=$2 AND booking_id=$3",
          [actor.tenantId, data.quoteId, bookingId],
        );
        if (!q) throw new NotFoundException();
        const initial = await this.reservations.booking(tx, actor, bookingId);
        // All inventory mutations take departure locks before the booking lock.
        for (const departureId of [
          ...new Set<string>([initial.departure_id, q.input.departureId]),
        ].sort())
          await this.inventory.departure(tx, actor, departureId, true);
        const booking = await this.reservations.booking(
          tx,
          actor,
          bookingId,
          true,
        );
        if (
          booking.version !== data.version ||
          booking.version !== q.base_version ||
          booking.departure_id !== initial.departure_id
        )
          throw new ConflictException(
            "Stale booking version; request a fresh quote",
          );
        const old = await this.editable(tx, actor, booking);
        const {
          rows: [live],
        } = await tx.query("SELECT $1::timestamptz>clock_timestamp() AS live", [
          q.expires_at,
        ]);
        if (!live.live) throw new ConflictException("Change quote expired");
        const free = await this.inventory.availability(
          tx,
          actor,
          q.input.departureId,
        );
        const {
          rows: [future],
        } = await tx.query(
          "SELECT $1::timestamptz>clock_timestamp() AS future",
          [free.starts_at],
        );
        if (!future.future)
          throw new ConflictException("Target departure has already started");
        const paid = await this.finance.paid(tx, actor, bookingId);
        if (
          booking.state === "confirmed" &&
          !q.allow_balance &&
          BigInt(paid) * 100n <
            BigInt(q.quote.totalMinor) * BigInt(q.quote.minimumPaidPercent)
        )
          throw new ConflictException(
            "Tenant amendment policy requires the minimum payment first",
          );
        let holdId = booking.hold_id;
        const before = { ...booking, party: old.party, quote: old.quote };
        if (booking.state === "confirmed") {
          const available =
            free.available +
            (booking.departure_id === q.input.departureId ? old.seats : 0);
          if (q.seats > available)
            throw new ConflictException(
              "Insufficient seats; original booking is unchanged",
            );
          await tx.query(
            "UPDATE departures SET committed=committed-$3 WHERE tenant_id=$1 AND id=$2",
            [actor.tenantId, booking.departure_id, old.seats],
          );
          await tx.query(
            "UPDATE departures SET committed=committed+$3 WHERE tenant_id=$1 AND id=$2",
            [actor.tenantId, q.input.departureId, q.seats],
          );
          holdId = randomUUID();
          await tx.query(
            `INSERT INTO holds(tenant_id,id,departure_id,actor_id,party,seats,quote,expires_at,consumed) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),true)`,
            [
              actor.tenantId,
              holdId,
              q.input.departureId,
              actor.actorId,
              q.input.party,
              q.seats,
              q.quote,
            ],
          );
          await tx.query("INSERT INTO price_snapshots VALUES($1,$2,$3,$4)", [
            actor.tenantId,
            bookingId,
            booking.version + 1,
            q.quote,
          ]);
          await record(
            tx,
            actor,
            "price_snapshot.created",
            bookingId,
            null,
            q.quote,
            q.input.reason,
          );
          await record(
            tx,
            actor,
            "departure.capacity_changed",
            booking.departure_id,
            null,
            { committedDelta: -old.seats },
            q.input.reason,
          );
          await record(
            tx,
            actor,
            "departure.capacity_changed",
            q.input.departureId,
            null,
            { committedDelta: q.seats },
            q.input.reason,
          );
        }
        if (
          booking.departure_id !== q.input.departureId ||
          q.input.pickup.kind !== "selected"
        )
          await tx.query(
            "DELETE FROM pickup_stops WHERE tenant_id=$1 AND booking_id=$2",
            [actor.tenantId, bookingId],
          );
        await tx.query(
          `UPDATE bookings SET hold_id=$3,departure_id=$4,lead_name=$5,lead_email=$6,pickup=$7,version=version+1 WHERE tenant_id=$1 AND id=$2`,
          [
            actor.tenantId,
            bookingId,
            holdId,
            q.input.departureId,
            q.input.leadName,
            q.input.leadEmail,
            q.input.pickup,
          ],
        );
        const after = {
          ...booking,
          hold_id: holdId,
          departure_id: q.input.departureId,
          lead_name: q.input.leadName,
          lead_email: q.input.leadEmail,
          pickup: q.input.pickup,
          party: q.input.party,
          quote: q.quote,
          version: booking.version + 1,
          financeReviewRequired: paid > q.quote.totalMinor,
        };
        await this.history(
          tx,
          actor,
          bookingId,
          "amendment",
          before,
          after,
          q.input.reason,
          q.id,
        );
        return { bookingId, version: after.version, state: booking.state };
      },
    );
  }
  cancel(actor: Actor, bookingId: string, key: string, input: unknown) {
    const data = parse(cancellationSchema, input);
    return this.db.command(
      actor,
      `booking.cancel:${bookingId}`,
      key,
      data,
      async (tx) => {
        const initial = await this.reservations.booking(tx, actor, bookingId);
        await this.inventory.departure(tx, actor, initial.departure_id, true);
        const booking = await this.reservations.booking(
          tx,
          actor,
          bookingId,
          true,
        );
        if (
          booking.version !== data.version ||
          booking.departure_id !== initial.departure_id
        )
          throw new ConflictException("Stale booking version");
        const hold = await this.editable(tx, actor, booking);
        if (booking.state === "confirmed") {
          await tx.query(
            "UPDATE departures SET committed=committed-$3 WHERE tenant_id=$1 AND id=$2",
            [actor.tenantId, booking.departure_id, hold.seats],
          );
          await record(
            tx,
            actor,
            "departure.capacity_changed",
            booking.departure_id,
            null,
            { committedDelta: -hold.seats },
            data.reason,
          );
        } else {
          await tx.query(
            "UPDATE holds SET expires_at=LEAST(expires_at,clock_timestamp()) WHERE tenant_id=$1 AND id=$2",
            [actor.tenantId, booking.hold_id],
          );
          await record(
            tx,
            actor,
            "inventory.hold_released",
            booking.hold_id,
            null,
            { cancelled: true },
            data.reason,
          );
        }
        await tx.query(
          "DELETE FROM pickup_stops WHERE tenant_id=$1 AND booking_id=$2",
          [actor.tenantId, bookingId],
        );
        const paidMinor = await this.finance.paid(tx, actor, bookingId);
        const {
          rows: [payments],
        } = await tx.query(
          "SELECT COUNT(*)::int AS count FROM payments WHERE tenant_id=$1 AND booking_id=$2",
          [actor.tenantId, bookingId],
        );
        await tx.query(
          "UPDATE bookings SET state='cancelled',version=version+1 WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, bookingId],
        );
        const after = {
          ...booking,
          state: "cancelled",
          version: booking.version + 1,
          financeReviewRequired: payments.count > 0,
          paidMinor,
          currency: hold.quote.currency,
        };
        await this.history(
          tx,
          actor,
          bookingId,
          "cancellation",
          { ...booking, quote: hold.quote, party: hold.party },
          after,
          data.reason,
        );
        return {
          bookingId,
          state: "cancelled",
          version: after.version,
          financeReviewRequired: after.financeReviewRequired,
        };
      },
    );
  }
  async history(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    kind: string,
    before: any,
    after: any,
    reason: string,
    quoteId: string | null = null,
  ) {
    await tx.query(
      "INSERT INTO booking_changes(tenant_id,id,booking_id,version,kind,quote_id,before_data,after_data,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        actor.tenantId,
        randomUUID(),
        bookingId,
        after.version,
        kind,
        quoteId,
        before,
        after,
        reason,
        actor.actorId,
      ],
    );
    await record(
      tx,
      actor,
      kind === "cancellation" ? "booking.cancelled" : "booking.amended",
      bookingId,
      before,
      after,
      reason,
    );
  }
  historyRead(actor: Actor, bookingId: string) {
    return this.db.transaction(actor, async (tx) => {
      await this.reservations.booking(tx, actor, bookingId);
      return (
        await tx.query(
          "SELECT id,version,kind,before_data,after_data,reason,actor_id,occurred_at FROM booking_changes WHERE tenant_id=$1 AND booking_id=$2 ORDER BY version DESC",
          [actor.tenantId, bookingId],
        )
      ).rows;
    });
  }
}
@Controller("staff/v1/bookings")
export class BookingChangeController {
  constructor(private readonly service: BookingChangeService) {}
  @Post(":id/change-quotes") @Access("bookings.write") quote(
    @CurrentActor() a: Actor,
    @Param("id") b: string,
    @Headers("idempotency-key") k: string,
    @Body() input: unknown,
  ) {
    return this.service.quote(a, parse(id, b), parse(keySchema, k), input);
  }
  @Post(":id/changes") @Access("bookings.write") accept(
    @CurrentActor() a: Actor,
    @Param("id") b: string,
    @Headers("idempotency-key") k: string,
    @Body() input: unknown,
  ) {
    return this.service.accept(a, parse(id, b), parse(keySchema, k), input);
  }
  @Post(":id/cancel") @Access("bookings.write") cancel(
    @CurrentActor() a: Actor,
    @Param("id") b: string,
    @Headers("idempotency-key") k: string,
    @Body() input: unknown,
  ) {
    return this.service.cancel(a, parse(id, b), parse(keySchema, k), input);
  }
  @Get(":id/changes") @Access("bookings.read") history(
    @CurrentActor() a: Actor,
    @Param("id") b: string,
  ) {
    return this.service.historyRead(a, parse(id, b));
  }
}
