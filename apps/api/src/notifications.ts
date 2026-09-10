import { Body, Controller, Get, Headers, Injectable, NotFoundException, Param, Post } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";

const requestSchema = z.object({
  kind: z.enum(["booking_confirmation", "payment_request", "waiver_request", "cancellation"]),
}).strict();

@Injectable()
export class NotificationService {
  constructor(private readonly db: Database) {}

  list(actor: Actor, bookingId: string) {
    return this.db.transaction(actor, async (tx) => {
      const booking = await tx.query("SELECT 1 FROM bookings WHERE tenant_id=$1 AND id=$2", [actor.tenantId, bookingId]);
      if (!booking.rowCount) throw new NotFoundException("Booking not found");
      return (await tx.query(
        `SELECT id,booking_id,kind,channel,recipient,locale,subject,status,provider_message_id,failure_detail,requested_at,sent_at
         FROM notification_messages WHERE tenant_id=$1 AND booking_id=$2 ORDER BY requested_at DESC,id DESC`,
        [actor.tenantId, bookingId],
      )).rows;
    });
  }

  request(actor: Actor, bookingId: string, key: string, raw: unknown) {
    const input = parse(requestSchema, raw);
    return this.db.command(actor, `notification.request:${bookingId}`, key, input, async (tx) => {
      const { rows: bookings } = await tx.query(
        `SELECT b.id,b.lead_name,b.lead_email,b.state,t.name AS tenant_name,t.config
         FROM bookings b JOIN tenants t ON t.id=b.tenant_id WHERE b.tenant_id=$1 AND b.id=$2`,
        [actor.tenantId, bookingId],
      );
      const booking = bookings[0];
      if (!booking) throw new NotFoundException("Booking not found");
      const locale = booking.config.locale ?? "en";
      const copy = {
        booking_confirmation: { subject: `Booking confirmation from ${booking.tenant_name}`, body: `Hello ${booking.lead_name}, your booking reference ${booking.id} is confirmed.` },
        payment_request: { subject: `Payment request from ${booking.tenant_name}`, body: `Hello ${booking.lead_name}, payment is requested for booking ${booking.id}. Please contact ${booking.tenant_name} for approved payment instructions.` },
        waiver_request: { subject: `Waiver request from ${booking.tenant_name}`, body: `Hello ${booking.lead_name}, please contact ${booking.tenant_name} to complete the waiver for booking ${booking.id}.` },
        cancellation: { subject: `Booking cancellation from ${booking.tenant_name}`, body: `Hello ${booking.lead_name}, booking ${booking.id} has been cancelled. Please contact ${booking.tenant_name} with questions.` },
      }[input.kind];
      const result = { id: randomUUID(), bookingId, kind: input.kind, channel: "email", recipient: booking.lead_email, locale, ...copy, status: "held_provider" };
      await tx.query(
        `INSERT INTO notification_messages(tenant_id,id,booking_id,kind,channel,recipient,locale,subject,body,status,requested_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [actor.tenantId,result.id,bookingId,result.kind,result.channel,result.recipient,result.locale,result.subject,result.body,result.status,actor.actorId],
      );
      await record(tx, actor, "notification.requested", result.id, null, { ...result, body: "[stored communication snapshot]" });
      return result;
    });
  }
}

@Controller("staff/v1/bookings/:bookingId/notifications")
export class NotificationController {
  constructor(private readonly service: NotificationService) {}
  @Get() @Access("notifications.read") list(@CurrentActor() actor: Actor, @Param("bookingId") bookingId: string) {
    return this.service.list(actor, parse(z.string().uuid(), bookingId));
  }
  @Post() @Access("notifications.request") request(@CurrentActor() actor: Actor, @Param("bookingId") bookingId: string, @Headers("idempotency-key") key: string, @Body() body: unknown) {
    return this.service.request(actor, parse(z.string().uuid(), bookingId), parse(keySchema, key), body);
  }
}
