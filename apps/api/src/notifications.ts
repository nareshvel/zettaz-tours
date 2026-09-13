import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import {
  renderCustomerBookingEmail,
  type CustomerNotificationKind,
} from "./customer-booking-email.js";
import { Database, record } from "./database";
import { sendCustomerMessage, smtpConfigured } from "./email";
import { Access, CurrentActor, keySchema, parse } from "./http";

const requestSchema = z
  .object({
    kind: z.enum([
      "booking_confirmation",
      "payment_request",
      "waiver_request",
      "cancellation",
    ]),
  })
  .strict();

type NotificationRow = {
  id: string;
  booking_id: string;
  kind: string;
  channel: string;
  recipient: string;
  locale: string;
  subject: string;
  body: string;
  status: string;
  provider_message_id: string | null;
  failure_detail: string | null;
  requested_at: string;
  sent_at: string | null;
};

@Injectable()
export class NotificationService {
  constructor(private readonly db: Database) {}

  list(actor: Actor, bookingId: string) {
    return this.db.transaction(actor, async (tx) => {
      const booking = await tx.query(
        "SELECT 1 FROM bookings WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, bookingId],
      );
      if (!booking.rowCount) throw new NotFoundException("Booking not found");
      return (
        await tx.query(
          `SELECT id,booking_id,kind,channel,recipient,locale,subject,status,provider_message_id,failure_detail,requested_at,sent_at
           FROM notification_messages WHERE tenant_id=$1 AND booking_id=$2 ORDER BY requested_at DESC,id DESC`,
          [actor.tenantId, bookingId],
        )
      ).rows;
    });
  }

  async request(actor: Actor, bookingId: string, key: string, raw: unknown) {
    const input = parse(requestSchema, raw);
    const created = await this.db.command(
      actor,
      `notification.request:${bookingId}`,
      key,
      input,
      async (tx) => {
        const { rows: bookings } = await tx.query(
          `SELECT b.id,b.lead_name,b.lead_email,b.state,b.pickup,b.stay,
                  t.name AS tenant_name,t.config,
                  p.name AS product_name,d.starts_at,
                  h.party,h.quote->>'currency' AS currency,
                  COALESCE((h.quote->>'totalMinor')::bigint,0)::bigint AS total_minor,
                  COALESCE((
                    SELECT SUM(pay.amount_minor) FROM payments pay
                    WHERE pay.tenant_id=b.tenant_id AND pay.booking_id=b.id AND pay.status='settled'
                      AND NOT EXISTS(
                        SELECT 1 FROM payment_adjustments a
                        WHERE a.tenant_id=pay.tenant_id AND a.payment_id=pay.id
                      )
                  ),0)::bigint AS paid_minor
           FROM bookings b
           JOIN tenants t ON t.id=b.tenant_id
           JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
           JOIN products p ON p.tenant_id=b.tenant_id AND p.id=d.product_id
           JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
           WHERE b.tenant_id=$1 AND b.id=$2`,
          [actor.tenantId, bookingId],
        );
        const booking = bookings[0];
        if (!booking) throw new NotFoundException("Booking not found");
        if (!booking.lead_email)
          throw new BadRequestException(
            "Booking has no guest email address for delivery.",
          );
        const locale = booking.config.locale ?? "en";
        const timezone = booking.config.timezone ?? "UTC";
        const email = await renderCustomerBookingEmail({
          kind: input.kind as CustomerNotificationKind,
          tenantName: booking.tenant_name as string,
          timezone,
          locale,
          bookingId: booking.id as string,
          state: booking.state as string,
          leadName: booking.lead_name as string,
          productName: booking.product_name as string,
          startsAt: booking.starts_at as string | Date,
          party: (booking.party ?? {}) as Record<string, number>,
          currency: (booking.currency as string) || "USD",
          totalMinor: Number(booking.total_minor ?? 0),
          paidMinor: Number(booking.paid_minor ?? 0),
          pickup: (booking.pickup ?? { kind: "none" }) as {
            kind: string;
            location?: string;
            note?: string;
            instructions?: string;
          },
          stay: (booking.stay ?? { kind: "none" }) as {
            kind: string;
            vesselName?: string;
            cabinNumber?: string;
            hotelName?: string;
            roomNumber?: string;
            propertyName?: string;
            address?: string;
          },
        });
        const configured = smtpConfigured();
        const status = configured ? "queued" : "held_provider";
        const failureDetail = configured
          ? null
          : "SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS, then retry.";
        const result = {
          id: randomUUID(),
          bookingId,
          kind: input.kind,
          channel: "email",
          recipient: booking.lead_email,
          locale,
          subject: email.subject,
          body: email.body,
          status,
          failure_detail: failureDetail,
          tenant_name: booking.tenant_name as string,
        };
        await tx.query(
          `INSERT INTO notification_messages(tenant_id,id,booking_id,kind,channel,recipient,locale,subject,body,status,failure_detail,requested_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            actor.tenantId,
            result.id,
            bookingId,
            result.kind,
            result.channel,
            result.recipient,
            result.locale,
            result.subject,
            result.body,
            result.status,
            result.failure_detail,
            actor.actorId,
          ],
        );
        await record(tx, actor, "notification.requested", result.id, null, {
          ...result,
          body: "[stored communication snapshot]",
        });
        return result;
      },
    );

    if (created.status === "queued") {
      return this.deliver(actor, bookingId, created.id);
    }
    return {
      id: created.id,
      booking_id: bookingId,
      kind: created.kind,
      channel: created.channel,
      recipient: created.recipient,
      locale: created.locale,
      subject: created.subject,
      status: created.status,
      provider_message_id: null,
      failure_detail: created.failure_detail,
      requested_at: new Date().toISOString(),
      sent_at: null,
    };
  }

  async retry(actor: Actor, bookingId: string, messageId: string, key: string) {
    return this.db.command(
      actor,
      `notification.retry:${messageId}`,
      key,
      { bookingId, messageId },
      async (tx) => {
        const { rows } = await tx.query(
          `SELECT * FROM notification_messages
           WHERE tenant_id=$1 AND booking_id=$2 AND id=$3`,
          [actor.tenantId, bookingId, messageId],
        );
        const row = rows[0] as NotificationRow | undefined;
        if (!row) throw new NotFoundException("Communication not found");
        if (row.status === "sent")
          throw new BadRequestException("This communication was already sent.");
        if (row.status === "cancelled")
          throw new BadRequestException(
            "Cancelled communications cannot be retried.",
          );
        if (!smtpConfigured()) {
          await tx.query(
            `UPDATE notification_messages
             SET status='held_provider',
                 failure_detail=$4,
                 provider_message_id=NULL,
                 sent_at=NULL
             WHERE tenant_id=$1 AND booking_id=$2 AND id=$3`,
            [
              actor.tenantId,
              bookingId,
              messageId,
              "SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS, then retry.",
            ],
          );
          await record(tx, actor, "notification.retry_held", messageId, null, {
            status: "held_provider",
          });
          return { id: messageId, status: "held_provider", deferred: true };
        }
        await tx.query(
          `UPDATE notification_messages
           SET status='queued', failure_detail=NULL
           WHERE tenant_id=$1 AND booking_id=$2 AND id=$3`,
          [actor.tenantId, bookingId, messageId],
        );
        await record(tx, actor, "notification.retry_queued", messageId, null, {
          status: "queued",
        });
        return { id: messageId, status: "queued", deferred: false };
      },
    ).then(async (result) => {
      if (result.deferred) {
        const listed = await this.list(actor, bookingId);
        return listed.find((row: { id: string }) => row.id === messageId);
      }
      return this.deliver(actor, bookingId, messageId);
    });
  }

  private async deliver(actor: Actor, bookingId: string, messageId: string) {
    const payload = await this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT n.*, t.name AS tenant_name
         FROM notification_messages n
         JOIN tenants t ON t.id = n.tenant_id
         WHERE n.tenant_id=$1 AND n.booking_id=$2 AND n.id=$3`,
        [actor.tenantId, bookingId, messageId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException("Communication not found");
      return row as NotificationRow & { tenant_name: string };
    });

    try {
      const sent = await sendCustomerMessage({
        to: payload.recipient,
        subject: payload.subject,
        body: payload.body,
        tenantName: payload.tenant_name,
      });
      return this.db.transaction(actor, async (tx) => {
        await tx.query(
          `UPDATE notification_messages
           SET status='sent',
               provider_message_id=$4,
               failure_detail=NULL,
               sent_at=clock_timestamp()
           WHERE tenant_id=$1 AND booking_id=$2 AND id=$3`,
          [actor.tenantId, bookingId, messageId, sent.messageId || null],
        );
        await record(tx, actor, "notification.sent", messageId, null, {
          provider_message_id: sent.messageId || null,
        });
        const { rows } = await tx.query(
          `SELECT id,booking_id,kind,channel,recipient,locale,subject,status,provider_message_id,failure_detail,requested_at,sent_at
           FROM notification_messages WHERE tenant_id=$1 AND booking_id=$2 AND id=$3`,
          [actor.tenantId, bookingId, messageId],
        );
        return rows[0];
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message.slice(0, 500) : "Send failed";
      return this.db.transaction(actor, async (tx) => {
        await tx.query(
          `UPDATE notification_messages
           SET status='failed',
               failure_detail=$4,
               provider_message_id=NULL,
               sent_at=NULL
           WHERE tenant_id=$1 AND booking_id=$2 AND id=$3`,
          [actor.tenantId, bookingId, messageId, detail],
        );
        await record(tx, actor, "notification.failed", messageId, null, {
          failure_detail: detail,
        });
        const { rows } = await tx.query(
          `SELECT id,booking_id,kind,channel,recipient,locale,subject,status,provider_message_id,failure_detail,requested_at,sent_at
           FROM notification_messages WHERE tenant_id=$1 AND booking_id=$2 AND id=$3`,
          [actor.tenantId, bookingId, messageId],
        );
        return rows[0];
      });
    }
  }
}

@Controller("staff/v1/bookings/:bookingId/notifications")
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  @Access("notifications.read")
  list(
    @CurrentActor() actor: Actor,
    @Param("bookingId") bookingId: string,
  ) {
    return this.service.list(actor, parse(z.string().uuid(), bookingId));
  }

  @Post()
  @Access("notifications.request")
  request(
    @CurrentActor() actor: Actor,
    @Param("bookingId") bookingId: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.request(
      actor,
      parse(z.string().uuid(), bookingId),
      parse(keySchema, key),
      body,
    );
  }

  @Post(":messageId/retry")
  @Access("notifications.request")
  retry(
    @CurrentActor() actor: Actor,
    @Param("bookingId") bookingId: string,
    @Param("messageId") messageId: string,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.retry(
      actor,
      parse(z.string().uuid(), bookingId),
      parse(z.string().uuid(), messageId),
      parse(keySchema, key),
    );
  }
}
