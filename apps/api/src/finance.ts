import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Actor,
  paymentAdjustmentSchema,
  paymentSchema,
  Quote,
} from "../../../packages/shared/src/contracts";
import { record, Tx } from "./database";
import { parse } from "./http";
import { tenant } from "./tenant";

@Injectable()
export class FinanceService {
  async paid(tx: Tx, actor: Actor, bookingId: string) {
    const {
      rows: [r],
    } = await tx.query(
      `SELECT COALESCE(SUM(p.amount_minor),0)::text AS paid FROM payments p
       WHERE p.tenant_id=$1 AND p.booking_id=$2 AND p.status='settled'
       AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)`,
      [actor.tenantId, bookingId],
    );
    const paid = Number(r.paid);
    if (!Number.isSafeInteger(paid))
      throw new ConflictException("Payment total outside supported range");
    return paid;
  }
  async adjust(tx:Tx,actor:Actor,bookingId:string,paymentId:string,input:unknown){
    const data=parse(paymentAdjustmentSchema,input);
    if(new Date(data.occurredAt).getTime()>Date.now()+60_000)
      throw new BadRequestException("Adjustment occurredAt is in the future");
    const {rows:[payment]}=await tx.query(
      "SELECT * FROM payments WHERE tenant_id=$1 AND id=$2 AND booking_id=$3",
      [actor.tenantId,paymentId,bookingId],
    );
    if(!payment) throw new BadRequestException("Payment is unavailable for this booking");
    if((payment.status==="pending"&&data.kind!=="void")||(payment.status==="settled"&&data.kind!=="reversal"))
      throw new BadRequestException(payment.status==="pending"?"Pending payments must be voided":"Settled payments must be reversed");
    if(new Date(data.occurredAt).getTime()<new Date(payment.occurred_at).getTime())
      throw new BadRequestException("Adjustment cannot predate the payment");
    const adjustmentId=randomUUID();
    await tx.query(
      `INSERT INTO payment_adjustments(tenant_id,id,payment_id,kind,reference,reason,occurred_at,actor_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [actor.tenantId,adjustmentId,paymentId,data.kind,data.reference,data.reason,data.occurredAt,actor.actorId],
    );
    await record(tx,actor,`payment.${data.kind}`,paymentId,{status:payment.status,amountMinor:Number(payment.amount_minor)},{adjustmentId,...data},data.reason);
    return {adjustmentId,paymentId,bookingId,...data};
  }
  async partnerCredit(tx: Tx, actor: Actor, bookingId: string) {
    const {
      rows: [r],
    } = await tx.query(
      `SELECT COALESCE(SUM(c.amount_minor),0)::text AS credit
       FROM partner_collection_claims c
       JOIN partner_claim_decisions d ON d.tenant_id=c.tenant_id AND d.claim_id=c.id AND d.decision='accepted'
       WHERE c.tenant_id=$1 AND c.booking_id=$2`,
      [actor.tenantId, bookingId],
    );
    const credit = Number(r.credit);
    if (!Number.isSafeInteger(credit))
      throw new ConflictException("Partner credit total outside supported range");
    return credit;
  }
  /** Guest boarding clearance: partner invoice/collect modes clear by policy; else paid + accepted credit. */
  async boardingBalanceSettled(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    totalMinor: number,
    paidMinor: number,
  ) {
    const {
      rows: [snap],
    } = await tx.query(
      `SELECT collection_mode
       FROM booking_partner_snapshots
       WHERE tenant_id=$1 AND booking_id=$2
       ORDER BY booking_version DESC, partner_id DESC
       LIMIT 1`,
      [actor.tenantId, bookingId],
    );
    if (
      snap?.collection_mode === "partner_invoice" ||
      snap?.collection_mode === "partner_collects_for_tenant"
    )
      return true;
    const credit = await this.partnerCredit(tx, actor, bookingId);
    return BigInt(paidMinor) + BigInt(credit) >= BigInt(totalMinor);
  }
  async record(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    quote: Quote,
    input: unknown,
  ) {
    const data = parse(paymentSchema, input);
    const settings = await tenant(tx, actor);
    if (!settings.config.manualPaymentMethods.includes(data.method))
      throw new BadRequestException("Payment method is not enabled");
    if (data.currency !== quote.currency)
      throw new BadRequestException("Cross-currency payment is not enabled");
    if (new Date(data.occurredAt).getTime() > Date.now() + 60_000)
      throw new BadRequestException("Payment occurredAt is in the future");
    const paid = await this.paid(tx, actor, bookingId);
    const partnerCredit = await this.partnerCredit(tx, actor, bookingId);
    if (
      data.status === "settled" &&
      paid + partnerCredit + data.amountMinor > quote.totalMinor
    )
      throw new ConflictException("Payment exceeds remaining balance");
    const paymentId = randomUUID();
    await tx.query(
      `INSERT INTO payments VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        actor.tenantId,
        paymentId,
        bookingId,
        data.amountMinor,
        data.currency,
        data.method,
        data.status,
        data.reference,
        data.reason,
        data.occurredAt,
        actor.actorId,
      ],
    );
    await record(
      tx,
      actor,
      "payment.manual_recorded",
      paymentId,
      null,
      { bookingId, ...data },
      data.reason,
    );
    return {
      paymentId,
      ...data,
      paidMinor: paid + (data.status === "settled" ? data.amountMinor : 0),
      partnerCreditMinor: partnerCredit,
    };
  }
}
