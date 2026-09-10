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
  paymentAdjustmentSchema,
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
      let stay = data.stay;
      let cruiseCallId: string | null = null;
      let accommodationId: string | null = null;
      if (data.stay.kind === "cruise" && data.stay.cruiseCallId) {
        const { rows } = await tx.query("SELECT id,vessel_name FROM cruise_calls WHERE tenant_id=$1 AND id=$2 AND active", [actor.tenantId,data.stay.cruiseCallId]);
        if (!rows[0]) throw new NotFoundException("Cruise call not found");
        cruiseCallId = rows[0].id;
        stay = { ...data.stay, vesselName: rows[0].vessel_name };
      }
      if (data.stay.kind === "hotel" && data.stay.accommodationId) {
        const { rows } = await tx.query("SELECT id,name FROM accommodation_properties WHERE tenant_id=$1 AND id=$2 AND active", [actor.tenantId,data.stay.accommodationId]);
        if (!rows[0]) throw new NotFoundException("Accommodation not found");
        accommodationId = rows[0].id;
        stay = { ...data.stay, hotelName: rows[0].name };
      }
      const purchaser = data.purchaser ?? {
        name: data.leadName,
        email: data.leadEmail,
        phone: data.leadPhone,
      };
      const { rows: [customer] } = await tx.query(
        `INSERT INTO customers(tenant_id,id,name,email,normalized_email,phone)
         VALUES($1,$2,$3,$4,lower(trim($4)),$5)
         ON CONFLICT(tenant_id,normalized_email) DO UPDATE SET
           name=EXCLUDED.name,email=EXCLUDED.email,
           phone=CASE WHEN EXCLUDED.phone<>'' THEN EXCLUDED.phone ELSE customers.phone END,
           updated_at=clock_timestamp()
         RETURNING id`,
        [actor.tenantId, randomUUID(), data.leadName, data.leadEmail, data.leadPhone],
      );
      const bookingId = randomUUID();
      await tx.query(
        `INSERT INTO bookings(tenant_id,id,hold_id,departure_id,lead_name,lead_email,source,pickup,stay,cruise_call_id,accommodation_property_id,customer_id,purchaser,emergency_contact,state)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'held')`,
        [
          actor.tenantId,
          bookingId,
          data.holdId,
          hold.departure_id,
          data.leadName,
          data.leadEmail,
          data.source,
          data.pickup,
          stay,
          cruiseCallId,
          accommodationId,
          customer.id,
          purchaser,
          data.emergencyContact ?? {},
        ],
      );
      if (data.partner) {
        const { rows: partners } = await tx.query(
          "SELECT id FROM partner_organizations WHERE tenant_id=$1 AND id=$2 AND status='active'",
          [actor.tenantId, data.partner.partnerId],
        );
        if (!partners[0]) throw new NotFoundException("Partner not found");
        await tx.query(
          `INSERT INTO booking_partner_attributions(tenant_id,booking_id,partner_id,external_reference,collection_mode,invoice_required,updated_by)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            actor.tenantId,
            bookingId,
            data.partner.partnerId,
            data.partner.externalReference,
            data.partner.collectionMode,
            data.partner.invoiceRequired,
            actor.actorId,
          ],
        );
      }
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
  paymentAdjustment(actor:Actor,bookingId:string,paymentId:string,key:string,input:unknown){
    const data=parse(paymentAdjustmentSchema,input);
    return this.db.command(actor,`booking.payment.adjust:${paymentId}`,key,data,async tx=>{
      await this.booking(tx,actor,bookingId,true);
      return this.finance.adjust(tx,actor,bookingId,paymentId,data);
    });
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
        const { rows: attribution } = await tx.query(
          "SELECT partner_id,external_reference,collection_mode,invoice_required FROM booking_partner_attributions WHERE tenant_id=$1 AND booking_id=$2",
          [actor.tenantId, bookingId],
        );
        if (attribution[0]) {
          const partner = attribution[0];
          await tx.query(
            `INSERT INTO booking_partner_snapshots(tenant_id,booking_id,booking_version,partner_id,external_reference,collection_mode,invoice_required,total_minor,currency)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              actor.tenantId,
              bookingId,
              booking.version + 1,
              partner.partner_id,
              partner.external_reference,
              partner.collection_mode,
              partner.invoice_required,
              quote.totalMinor,
              quote.currency,
            ],
          );
          if (partner.collection_mode === "partner_invoice")
          {
            const obligationId = randomUUID();
            await tx.query(
              "INSERT INTO partner_obligations(tenant_id,id,booking_id,partner_id,amount_minor,currency,kind) VALUES($1,$2,$3,$4,$5,$6,'partner_invoice')",
              [
                actor.tenantId,
                obligationId,
                bookingId,
                partner.partner_id,
                quote.totalMinor,
                quote.currency,
              ],
            );
            await record(tx, actor, "partner.obligation.created", obligationId, null, {
              bookingId,
              partnerId: partner.partner_id,
              amountMinor: quote.totalMinor,
              currency: quote.currency,
              kind: "partner_invoice",
            });
          }
          await record(tx, actor, "partner.terms.snapshotted", bookingId, null, {
            partnerId: partner.partner_id,
            externalReference: partner.external_reference,
            collectionMode: partner.collection_mode,
            invoiceRequired: partner.invoice_required,
            totalMinor: quote.totalMinor,
            currency: quote.currency,
          });
        }
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
      const partnerCreditMinor = await this.finance.partnerCredit(
        tx,
        actor,
        bookingId,
      );
      const {rows:payments}=await tx.query(
        `SELECT p.id,p.amount_minor::float8,p.currency,p.method,p.status,p.reference,p.reason,p.occurred_at,
          a.id AS adjustment_id,a.kind AS adjustment_kind,a.reference AS adjustment_reference,
          a.reason AS adjustment_reason,a.occurred_at AS adjustment_occurred_at
         FROM payments p LEFT JOIN payment_adjustments a ON a.tenant_id=p.tenant_id AND a.payment_id=p.id
         WHERE p.tenant_id=$1 AND p.booking_id=$2 ORDER BY p.occurred_at,p.id`,
        [actor.tenantId,bookingId],
      );
      // Expiry is derived from database time so the worker is not a correctness dependency.
      const { rows: partnerFacts } = await tx.query(
        `SELECT EXISTS(SELECT 1 FROM booking_partner_snapshots WHERE tenant_id=$1 AND booking_id=$2)
          OR EXISTS(SELECT 1 FROM partner_collection_claims WHERE tenant_id=$1 AND booking_id=$2)
          OR EXISTS(SELECT 1 FROM partner_obligations WHERE tenant_id=$1 AND booking_id=$2) AS has_partner_facts`,
        [actor.tenantId, bookingId],
      );
      return {
        ...booking,
        state:
          booking.state === "held" && !hold.live ? "expired" : booking.state,
        party: hold.party,
        expiresAt: hold.expires_at,
        quote: hold.quote,
        paidMinor,
        partnerCreditMinor,
        payments,
        balanceMinor:
          booking.state === "cancelled"
            ? 0
            : hold.quote.totalMinor - paidMinor - partnerCreditMinor,
        historicalBalanceMinor:
          hold.quote.totalMinor - paidMinor - partnerCreditMinor,
        financeReviewRequired:
          (booking.state === "cancelled" &&
            (
              await tx.query(
                "SELECT 1 FROM payments WHERE tenant_id=$1 AND booking_id=$2 LIMIT 1",
                [actor.tenantId, bookingId],
              )
            ).rowCount! > 0) ||
          (booking.state === "cancelled" && partnerFacts[0].has_partner_facts) ||
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
  @Post(":id/payments/:paymentId/adjustments")
  @Access("payment.correct")
  paymentAdjustment(@CurrentActor() a:Actor,@Param("id") bookingId:string,@Param("paymentId") paymentId:string,@Headers("idempotency-key") k:string,@Body() b:unknown){
    return this.service.paymentAdjustment(a,parse(id,bookingId),parse(id,paymentId),parse(keySchema,k),b);
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
