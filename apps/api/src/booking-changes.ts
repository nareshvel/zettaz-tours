import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpException,
  Injectable,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
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

const rebookingPreviewSchema = z.object({
  targetDepartureId: id,
  reason: z.string().trim().min(1).max(500),
}).strict();
const rebookingApplySchema = z.object({
  targetDepartureId: id,
  items: z.array(z.object({
    bookingId: id,
    version: z.number().int().positive(),
    quoteId: id,
  }).strict()).min(1).max(200),
}).strict().refine(
  (value) => new Set(value.items.map((item) => item.bookingId)).size === value.items.length,
  "A booking can appear only once",
);

function childKey(key: string, bookingId: string, action: string) {
  const hex = createHash("sha256").update(`${key}:${bookingId}:${action}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function failureMessage(error: unknown) {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === "string") return response;
    if (response && typeof response === "object" && "message" in response) {
      const message = (response as { message: unknown }).message;
      return Array.isArray(message) ? message.join("; ") : String(message);
    }
  }
  return error instanceof Error ? error.message : "Rebooking failed";
}

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
        const existingPurchaser =
          (booking.purchaser as {
            name?: string;
            email?: string;
            phone?: string;
          }) ?? {};
        const purchaser = data.purchaser ?? {
          name: data.leadName,
          email: data.leadEmail,
          phone: data.leadPhone || existingPurchaser.phone || "",
        };
        if (data.leadPhone && !data.purchaser)
          purchaser.phone = data.leadPhone;
        const stayInput =
          data.stay ??
          (booking.stay as {
            kind: string;
            vesselId?: string;
            accommodationId?: string;
          });
        const resolved = await this.reservations.resolveStay(
          tx,
          actor,
          stayInput,
        );
        const emergencyContact =
          data.emergencyContact ??
          (booking.emergency_contact as Record<string, unknown>) ??
          {};
        const normalizedInput = {
          ...data,
          leadPhone: data.leadPhone || purchaser.phone || "",
          purchaser,
          emergencyContact:
            emergencyContact && Object.keys(emergencyContact).length
              ? emergencyContact
              : undefined,
          stay: resolved.stay,
          vesselId: resolved.vesselId,
          accommodationId: resolved.accommodationId,
        };
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
            normalizedInput,
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
          const sourcePool = old.overbook_authorized_by ? "overbooked" : "committed";
          const retainOverbook = booking.departure_id === q.input.departureId && Boolean(old.overbook_authorized_by);
          const targetPool = retainOverbook ? "overbooked" : "committed";
          await tx.query(
            `UPDATE departures SET ${sourcePool}=${sourcePool}-$3 WHERE tenant_id=$1 AND id=$2`,
            [actor.tenantId, booking.departure_id, old.seats],
          );
          await tx.query(
            `UPDATE departures SET ${targetPool}=${targetPool}+$3 WHERE tenant_id=$1 AND id=$2`,
            [actor.tenantId, q.input.departureId, q.seats],
          );
          holdId = randomUUID();
          await tx.query(
            `INSERT INTO holds(tenant_id,id,departure_id,actor_id,party,seats,quote,expires_at,consumed,overbook_authorized_by,overbook_reason)
             VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),true,$8,$9)`,
            [
              actor.tenantId,
              holdId,
              q.input.departureId,
              actor.actorId,
              q.input.party,
              q.seats,
              q.quote,
              retainOverbook ? old.overbook_authorized_by : null,
              retainOverbook ? old.overbook_reason : null,
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
            old.overbook_authorized_by ? { overbookedDelta: -old.seats } : { committedDelta: -old.seats },
            q.input.reason,
          );
          await record(
            tx,
            actor,
            "departure.capacity_changed",
            q.input.departureId,
            null,
            retainOverbook ? { overbookedDelta: q.seats } : { committedDelta: q.seats },
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
        let customerId = booking.customer_id;
        const leadPhone =
          typeof q.input.leadPhone === "string" ? q.input.leadPhone : "";
        const purchaser = (q.input.purchaser as {
          name: string;
          email: string;
          phone: string;
        }) ?? {
          name: q.input.leadName,
          email: q.input.leadEmail,
          phone: leadPhone,
        };
        const emergencyContact =
          (q.input.emergencyContact as Record<string, unknown>) ?? {};
        const stay =
          (q.input.stay as Record<string, unknown>) ?? booking.stay ?? { kind: "none" };
        const vesselId =
          (q.input.vesselId as string | null | undefined) ??
          (stay.kind === "cruise" ? (stay.vesselId as string) ?? null : null);
        const accommodationId =
          (q.input.accommodationId as string | null | undefined) ??
          (stay.kind === "hotel"
            ? (stay.accommodationId as string) ?? null
            : null);
        if (booking.lead_email.toLowerCase().trim() !== q.input.leadEmail.toLowerCase().trim()) {
          const { rows: [customer] } = await tx.query(
            `INSERT INTO customers(tenant_id,id,name,email,normalized_email,phone)
             VALUES($1,$2,$3,$4,lower(trim($4)),$5)
             ON CONFLICT(tenant_id,normalized_email) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,
               phone=CASE WHEN EXCLUDED.phone<>'' THEN EXCLUDED.phone ELSE customers.phone END,
               updated_at=clock_timestamp()
             RETURNING id`,
            [
              actor.tenantId,
              randomUUID(),
              q.input.leadName,
              q.input.leadEmail,
              leadPhone || purchaser.phone || "",
            ],
          );
          customerId = customer.id;
        } else if (leadPhone || purchaser.phone) {
          await tx.query(
            `UPDATE customers SET
               phone=CASE WHEN $3<>'' THEN $3 ELSE phone END,
               name=$4,updated_at=clock_timestamp()
             WHERE tenant_id=$1 AND id=$2`,
            [
              actor.tenantId,
              customerId,
              leadPhone || purchaser.phone || "",
              q.input.leadName,
            ],
          );
        }
        await tx.query(
          `UPDATE bookings SET hold_id=$3,departure_id=$4,lead_name=$5,lead_email=$6,pickup=$7,
            stay=$8,vessel_id=$9,accommodation_property_id=$10,purchaser=$11,emergency_contact=$12,
            customer_id=$13,version=version+1 WHERE tenant_id=$1 AND id=$2`,
          [
            actor.tenantId,
            bookingId,
            holdId,
            q.input.departureId,
            q.input.leadName,
            q.input.leadEmail,
            q.input.pickup,
            stay,
            vesselId,
            accommodationId,
            purchaser,
            emergencyContact,
            customerId,
          ],
        );
        const after = {
          ...booking,
          hold_id: holdId,
          departure_id: q.input.departureId,
          lead_name: q.input.leadName,
          lead_email: q.input.leadEmail,
          pickup: q.input.pickup,
          stay,
          vessel_id: vesselId,
          accommodation_property_id: accommodationId,
          purchaser,
          emergency_contact: emergencyContact,
          customer_id: customerId,
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
          const pool = hold.overbook_authorized_by ? "overbooked" : "committed";
          await tx.query(
            `UPDATE departures SET ${pool}=${pool}-$3 WHERE tenant_id=$1 AND id=$2`,
            [actor.tenantId, booking.departure_id, hold.seats],
          );
          await record(
            tx,
            actor,
            "departure.capacity_changed",
            booking.departure_id,
            null,
            hold.overbook_authorized_by ? { overbookedDelta: -hold.seats } : { committedDelta: -hold.seats },
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
        const {
          rows: [partnerFacts],
        } = await tx.query(
          `SELECT EXISTS(SELECT 1 FROM booking_partner_snapshots WHERE tenant_id=$1 AND booking_id=$2)
            OR EXISTS(SELECT 1 FROM partner_collection_claims WHERE tenant_id=$1 AND booking_id=$2)
            OR EXISTS(SELECT 1 FROM partner_obligations WHERE tenant_id=$1 AND booking_id=$2) AS present`,
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
          financeReviewRequired: payments.count > 0 || partnerFacts.present,
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
      const { rows } = await tx.query(
        "SELECT id,version,kind,before_data,after_data,reason,actor_id,occurred_at FROM booking_changes WHERE tenant_id=$1 AND booking_id=$2 ORDER BY version DESC",
        [actor.tenantId, bookingId],
      );
      const departureIds = new Set<string>();
      for (const row of rows) {
        const beforeId = row.before_data?.departure_id;
        const afterId = row.after_data?.departure_id;
        if (typeof beforeId === "string") departureIds.add(beforeId);
        if (typeof afterId === "string") departureIds.add(afterId);
      }
      const labels = new Map<
        string,
        { id: string; starts_at: string; product_name: string }
      >();
      if (departureIds.size) {
        const { rows: deps } = await tx.query(
          `SELECT d.id,d.starts_at,p.name AS product_name
           FROM departures d
           JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
           WHERE d.tenant_id=$1 AND d.id = ANY($2::uuid[])`,
          [actor.tenantId, [...departureIds]],
        );
        for (const dep of deps) {
          labels.set(dep.id, dep);
        }
      }
      return rows.map((row) => ({
        ...row,
        before_data: {
          ...row.before_data,
          departure: row.before_data?.departure_id
            ? labels.get(row.before_data.departure_id) ?? null
            : null,
        },
        after_data: {
          ...row.after_data,
          departure: row.after_data?.departure_id
            ? labels.get(row.after_data.departure_id) ?? null
            : null,
        },
      }));
    });
  }

  rebookingOptions(actor: Actor, sourceDepartureId: string) {
    return this.db.transaction(actor, async (tx) => {
      const source = await this.inventory.departure(tx, actor, sourceDepartureId);
      const { rows } = await tx.query(
        `SELECT d.id,d.starts_at,d.capacity,(d.committed+d.overbooked)::int AS committed,d.overbooked,GREATEST(0,d.capacity-d.committed-d.overbooked)::int AS available,p.name AS product_name
         FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         WHERE d.tenant_id=$1 AND d.product_id=$2 AND d.id<>$3
           AND d.starts_at>clock_timestamp() AND d.operational_status='open'
         ORDER BY d.starts_at,d.id LIMIT 100`,
        [actor.tenantId, source.product_id, sourceDepartureId],
      );
      return { source: { id: source.id, startsAt: source.starts_at, status: source.operational_status }, options: rows };
    });
  }

  async previewRebooking(actor: Actor, sourceDepartureId: string, key: string, raw: unknown) {
    const input = parse(rebookingPreviewSchema, raw);
    const candidates = await this.db.transaction(actor, async (tx) => {
      const source = await this.inventory.departure(tx, actor, sourceDepartureId);
      if (source.operational_status === "open")
        throw new ConflictException("Put the source departure on weather hold or close it before preparing recovery");
      const target = await this.inventory.departure(tx, actor, input.targetDepartureId);
      if (target.operational_status !== "open")
        throw new ConflictException("Target departure is not open");
      if (target.product_id !== source.product_id)
        throw new ConflictException("Target departure must use the same tour product");
      const { rows } = await tx.query(
        `SELECT b.id,b.version,b.lead_name,b.lead_email,b.pickup,h.party
         FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         WHERE b.tenant_id=$1 AND b.departure_id=$2 AND b.state='confirmed'
         ORDER BY b.id LIMIT 200`,
        [actor.tenantId, sourceDepartureId],
      );
      return rows;
    });
    const items: any[] = [];
    for (const booking of candidates) {
      try {
        const quote = await this.quote(actor, booking.id, childKey(key, booking.id, "preview"), {
          version: booking.version,
          departureId: input.targetDepartureId,
          party: booking.party,
          leadName: booking.lead_name,
          leadEmail: booking.lead_email,
          pickup: booking.pickup,
          reason: input.reason,
        });
        items.push({ bookingId: booking.id, leadName: booking.lead_name, eligible: true, ...quote });
      } catch (error) {
        items.push({ bookingId: booking.id, leadName: booking.lead_name, eligible: false, reason: failureMessage(error) });
      }
    }
    return {
      sourceDepartureId,
      targetDepartureId: input.targetDepartureId,
      affected: candidates.length,
      eligible: items.filter((item) => item.eligible).length,
      excluded: items.filter((item) => !item.eligible).length,
      messagesQueued: 0,
      items,
    };
  }

  async applyRebooking(actor: Actor, sourceDepartureId: string, key: string, raw: unknown) {
    const input = parse(rebookingApplySchema, raw);
    const results: any[] = [];
    for (const item of input.items) {
      try {
        await this.db.transaction(actor, async (tx) => {
          const { rows: [valid] } = await tx.query(
            `SELECT 1 FROM booking_change_quotes q JOIN bookings b ON b.tenant_id=q.tenant_id AND b.id=q.booking_id
             WHERE q.tenant_id=$1 AND q.id=$2 AND q.booking_id=$3
               AND b.departure_id=$4 AND q.input->>'departureId'=$5`,
            [actor.tenantId, item.quoteId, item.bookingId, sourceDepartureId, input.targetDepartureId],
          );
          if (!valid) throw new ConflictException("Quote does not belong to this recovery plan");
        });
        const result = await this.accept(actor, item.bookingId, childKey(key, item.bookingId, "apply"), {
          version: item.version,
          quoteId: item.quoteId,
        });
        results.push({ bookingId: item.bookingId, success: true, version: result.version });
      } catch (error) {
        results.push({ bookingId: item.bookingId, success: false, reason: failureMessage(error) });
      }
    }
    return {
      sourceDepartureId,
      targetDepartureId: input.targetDepartureId,
      succeeded: results.filter((item) => item.success).length,
      failed: results.filter((item) => !item.success).length,
      messagesQueued: 0,
      results,
    };
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

@Controller("ops/v1/departures")
export class RebookingController {
  constructor(private readonly service: BookingChangeService) {}
  @Get(":id/rebooking-options") @Access("operations.write") options(
    @CurrentActor() actor: Actor,
    @Param("id") departureId: string,
  ) {
    return this.service.rebookingOptions(actor, parse(id, departureId));
  }
  @Post(":id/rebooking-preview") @Access("operations.write") preview(
    @CurrentActor() actor: Actor,
    @Param("id") departureId: string,
    @Headers("idempotency-key") key: string,
    @Body() input: unknown,
  ) {
    return this.service.previewRebooking(actor, parse(id, departureId), parse(keySchema, key), input);
  }
  @Post(":id/rebook") @Access("operations.write") apply(
    @CurrentActor() actor: Actor,
    @Param("id") departureId: string,
    @Headers("idempotency-key") key: string,
    @Body() input: unknown,
  ) {
    return this.service.applyRebooking(actor, parse(id, departureId), parse(keySchema, key), input);
  }
}
