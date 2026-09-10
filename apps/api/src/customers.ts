import { Controller, Get, Injectable, NotFoundException, Param, Query } from "@nestjs/common";
import { z } from "zod";
import { Actor, id } from "../../../packages/shared/src/contracts";
import { Database } from "./database";
import { Access, CurrentActor, parse } from "./http";

const listSchema = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().trim().max(100).default(""),
}).strict();

@Injectable()
export class CustomerService {
  constructor(private readonly db: Database) {}
  list(actor: Actor, raw: unknown) {
    const input = parse(listSchema, raw);
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT c.id,c.name,c.email,c.phone,c.created_at,c.updated_at,
           COUNT(b.id)::int AS booking_count,
           MAX(d.starts_at) AS latest_trip_at
         FROM customers c
         LEFT JOIN bookings b ON b.tenant_id=c.tenant_id AND b.customer_id=c.id
         LEFT JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         WHERE c.tenant_id=$1 AND ($2::uuid IS NULL OR c.id>$2)
           AND (c.name ILIKE $3 OR c.email ILIKE $3 OR c.phone ILIKE $3)
         GROUP BY c.tenant_id,c.id
         ORDER BY c.id LIMIT $4`,
        [actor.tenantId, input.cursor ?? null, `%${input.search}%`, input.limit + 1],
      );
      return {
        items: rows.slice(0, input.limit),
        nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.id : null,
      };
    });
  }
  detail(actor: Actor, customerId: string) {
    return this.db.transaction(actor, async (tx) => {
      const { rows: [customer] } = await tx.query(
        "SELECT id,name,email,phone,created_at,updated_at FROM customers WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, customerId],
      );
      if (!customer) throw new NotFoundException();
      const { rows: bookings } = await tx.query(
        `SELECT b.id,b.lead_name,b.lead_email,b.purchaser,b.emergency_contact,b.state,b.source,b.pickup,b.stay,b.version,d.starts_at,p.name AS product_name,h.party,h.quote->>'currency' AS currency,(h.quote->>'totalMinor')::bigint AS total_minor
         FROM bookings b JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         WHERE b.tenant_id=$1 AND b.customer_id=$2 ORDER BY d.starts_at DESC,b.id`,
        [actor.tenantId, customerId],
      );
      const bookingIds = bookings.map((booking) => booking.id);
      if (!bookingIds.length) return { customer, bookings, timeline: [] };
      const payments = await tx.query("SELECT booking_id AS booking_id,'payment' AS kind,occurred_at,amount_minor,currency,status,method FROM payments WHERE tenant_id=$1 AND booking_id=ANY($2::uuid[])", [actor.tenantId, bookingIds]);
      const waivers = await tx.query("SELECT booking_id,'waiver' AS kind,occurred_at,signer_name,signer_capacity FROM waiver_signatures WHERE tenant_id=$1 AND booking_id=ANY($2::uuid[])", [actor.tenantId, bookingIds]);
      const messages = await tx.query("SELECT booking_id,'message' AS kind,requested_at AS occurred_at,subject,status,channel FROM notification_messages WHERE tenant_id=$1 AND booking_id=ANY($2::uuid[])", [actor.tenantId, bookingIds]);
      const changes = await tx.query("SELECT booking_id,kind,occurred_at,reason FROM booking_changes WHERE tenant_id=$1 AND booking_id=ANY($2::uuid[])", [actor.tenantId, bookingIds]);
      const bookingEvents = bookings.map((booking) => ({
        booking_id: booking.id,
        kind: "booking",
        occurred_at: booking.starts_at,
        state: booking.state,
        product_name: booking.product_name,
      }));
      const timeline = [...bookingEvents, ...payments.rows, ...waivers.rows, ...messages.rows, ...changes.rows]
        .sort((left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime());
      return { customer, bookings, timeline };
    });
  }
}

@Controller("staff/v1/customers")
export class CustomerController {
  constructor(private readonly service: CustomerService) {}
  @Get() @Access("bookings.read") list(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.service.list(actor, query);
  }
  @Get(":id") @Access("bookings.read") detail(@CurrentActor() actor: Actor, @Param("id") customerId: string) {
    return this.service.detail(actor, parse(id, customerId));
  }
}
