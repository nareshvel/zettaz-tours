import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Actor,
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
      `SELECT COALESCE(SUM(amount_minor),0)::text AS paid FROM payments WHERE tenant_id=$1 AND booking_id=$2 AND status='settled'`,
      [actor.tenantId, bookingId],
    );
    const paid = Number(r.paid);
    if (!Number.isSafeInteger(paid))
      throw new ConflictException("Payment total outside supported range");
    return paid;
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
    if (data.status === "settled" && paid + data.amountMinor > quote.totalMinor)
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
    };
  }
}
