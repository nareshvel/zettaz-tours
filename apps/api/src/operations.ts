import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
} from "@nestjs/common";
import { Actor, id } from "../../../packages/shared/src/contracts";
import { Database } from "./database";
import { Access, CurrentActor, parse } from "./http";

@Injectable()
export class OutboxService {
  constructor(private readonly db: Database) {}
  drain(actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id FROM outbox_events WHERE tenant_id=$1 AND delivered_at IS NULL ORDER BY occurred_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`,
        [actor.tenantId],
      );
      for (const row of rows) {
        // Local durable consumer only. External consumers need their own retry/deduplication port.
        await tx.query(
          `INSERT INTO event_receipts VALUES($1,$2,'local-observer-v1') ON CONFLICT DO NOTHING`,
          [actor.tenantId, row.id],
        );
        await tx.query(
          "UPDATE outbox_events SET delivered_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, row.id],
        );
      }
      return { delivered: rows.length };
    });
  }
}
@Controller("ops/v1")
export class OperationsController {
  constructor(private readonly db: Database) {}
  @Get("departures/:id/manifest")
  @Access("manifest.read")
  manifest(@CurrentActor() actor: Actor, @Param("id") value: string) {
    const departureId = parse(id, value);
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [departure],
      } = await tx.query(
        "SELECT id,starts_at,capacity FROM departures WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, departureId],
      );
      if (!departure) throw new NotFoundException();
      const { rows: bookings } = await tx.query(
        `SELECT b.id AS booking_id,b.lead_name,b.pickup,h.party,
        (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
        FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
        WHERE b.tenant_id=$1 AND b.departure_id=$2 AND b.state='confirmed' ORDER BY b.id`,
        [actor.tenantId, departureId],
      );
      return { departure, bookings };
    });
  }
  @Get("audit")
  @Access("audit.read")
  audit(@CurrentActor() actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            `SELECT id,actor_id,action,aggregate_id,reason,occurred_at FROM audit_events WHERE tenant_id=$1 ORDER BY occurred_at DESC,id LIMIT 100`,
            [actor.tenantId],
          )
        ).rows,
    );
  }
}
