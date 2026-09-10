import { BadRequestException, Body, ConflictException, Controller, Get, Headers, Injectable, NotFoundException, Param, Post } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database, digest, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";

const id = z.string().uuid();
const passengerSchema = z.object({ name: z.string().trim().min(1).max(120), category: z.string().trim().min(1).max(80), isMinor: z.boolean().default(false) }).strict();
const rosterSchema = z.object({ passengers: z.array(passengerSchema).min(1).max(100) }).strict();
const correctionSchema = rosterSchema.extend({ reason: z.string().trim().min(3).max(500) }).strict();
const checkinSchema = z.object({ state: z.enum(["arrived", "cleared_to_board", "boarded", "no_show"]) }).strict();
const tokenSchema = z.object({ token: z.string().min(20).max(200) }).strict();
type Roster = z.infer<typeof rosterSchema>;

@Injectable()
export class PassengerService {
  constructor(private readonly db: Database) {}

  list(actor: Actor, bookingId: string) {
    return this.db.transaction(actor, async (tx) => {
      const booking = await tx.query("SELECT id FROM bookings WHERE tenant_id=$1 AND id=$2", [actor.tenantId, bookingId]);
      if (!booking.rowCount) throw new NotFoundException();
      return (await tx.query(`SELECT p.id,p.name,p.category,p.is_minor,p.guardian_passenger_id,p.roster_version,
        latest.state AS checkin_state,latest.occurred_at AS checked_in_at
        FROM booking_passengers p LEFT JOIN LATERAL (
          SELECT state,occurred_at FROM passenger_checkins c WHERE c.tenant_id=p.tenant_id AND c.passenger_id=p.id ORDER BY occurred_at DESC,id DESC LIMIT 1
        ) latest ON true WHERE p.tenant_id=$1 AND p.booking_id=$2 AND p.superseded_at IS NULL ORDER BY p.created_at,p.id`, [actor.tenantId, bookingId])).rows;
    });
  }

  private async validateParty(tx: Parameters<Database["transaction"]>[1] extends (tx: infer T) => unknown ? T : never, actor: Actor, bookingId: string, roster: Roster) {
    const booking = (await tx.query("SELECT b.state,h.party FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id WHERE b.tenant_id=$1 AND b.id=$2 FOR UPDATE", [actor.tenantId, bookingId])).rows[0] as { state: string; party: Record<string, number> } | undefined;
    if (!booking) throw new NotFoundException();
    if (booking.state !== "held") throw new ConflictException("Passenger roster is frozen after confirmation");
    const expected = Object.entries(booking.party).filter(([, count]) => count > 0).sort(([left], [right]) => left.localeCompare(right));
    const actual = Object.entries(roster.passengers.reduce<Record<string, number>>((counts, passenger) => { counts[passenger.category] = (counts[passenger.category] ?? 0) + 1; return counts; }, {})).sort(([left], [right]) => left.localeCompare(right));
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new ConflictException("Passenger categories and counts must match the reserved party");
  }

  replace(actor: Actor, bookingId: string, key: string, raw: unknown) {
    const input = parse(rosterSchema, raw);
    return this.db.command(actor, `booking.passengers:${bookingId}`, key, input, async (tx) => {
      await this.validateParty(tx, actor, bookingId, input);
      const existing = await tx.query("SELECT id FROM booking_passengers WHERE tenant_id=$1 AND booking_id=$2", [actor.tenantId, bookingId]);
      if (existing.rowCount) throw new ConflictException("Passenger roster already recorded; use a reasoned correction");
      const result = input.passengers.map((passenger) => ({ id: randomUUID(), ...passenger, rosterVersion: 1 }));
      for (const passenger of result) await tx.query("INSERT INTO booking_passengers(tenant_id,id,booking_id,name,category,is_minor,roster_version) VALUES($1,$2,$3,$4,$5,$6,$7)", [actor.tenantId, passenger.id, bookingId, passenger.name, passenger.category, passenger.isMinor, passenger.rosterVersion]);
      await record(tx, actor, "booking.passengers_recorded", bookingId, null, { count: result.length, rosterVersion: 1 });
      return result;
    });
  }

  correct(actor: Actor, bookingId: string, key: string, raw: unknown) {
    const input = parse(correctionSchema, raw);
    return this.db.command(actor, `booking.passengers.correct:${bookingId}`, key, input, async (tx) => {
      await this.validateParty(tx, actor, bookingId, input);
      const prior = (await tx.query("SELECT id,roster_version,name,category,is_minor FROM booking_passengers WHERE tenant_id=$1 AND booking_id=$2 AND superseded_at IS NULL FOR UPDATE", [actor.tenantId, bookingId])).rows;
      if (!prior.length) throw new ConflictException("Passenger roster must be recorded before it can be corrected");
      const rosterVersion = Math.max(...prior.map((row) => row.roster_version)) + 1;
      const result = input.passengers.map((passenger) => ({ id: randomUUID(), ...passenger, rosterVersion }));
      const supersededBy = result[0]?.id;
      if (!supersededBy) throw new ConflictException("Passenger roster cannot be empty");
      for (const passenger of result) await tx.query("INSERT INTO booking_passengers(tenant_id,id,booking_id,name,category,is_minor,roster_version) VALUES($1,$2,$3,$4,$5,$6,$7)", [actor.tenantId, passenger.id, bookingId, passenger.name, passenger.category, passenger.isMinor, passenger.rosterVersion]);
      for (const passenger of prior) await tx.query("UPDATE booking_passengers SET superseded_at=clock_timestamp(),superseded_by=$3 WHERE tenant_id=$1 AND id=$2", [actor.tenantId, passenger.id, supersededBy]);
      await record(tx, actor, "booking.passengers_corrected", bookingId, prior, result, input.reason);
      return result;
    });
  }

  checkIn(actor: Actor, passengerId: string, key: string, raw: unknown) {
    const input = parse(checkinSchema, raw);
    return this.db.command(actor, `passenger.checkin:${passengerId}`, key, input, async (tx) => {
      const passenger = (await tx.query(`SELECT p.id,p.booking_id,b.departure_id,b.state,(h.quote->>'totalMinor')::bigint AS total_minor,
        COALESCE((SELECT SUM(x.amount_minor) FROM payments x WHERE x.tenant_id=b.tenant_id AND x.booking_id=b.id AND x.status='settled' AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=x.tenant_id AND a.payment_id=x.id)),0)::bigint AS paid_minor,
        EXISTS(SELECT 1 FROM waiver_signatures w WHERE w.tenant_id=p.tenant_id AND w.booking_id=p.booking_id AND w.passenger_id=p.id) AS waiver_signed
        FROM booking_passengers p JOIN bookings b ON b.tenant_id=p.tenant_id AND b.id=p.booking_id
        JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
        WHERE p.tenant_id=$1 AND p.id=$2 AND p.superseded_at IS NULL FOR UPDATE`, [actor.tenantId, passengerId])).rows[0] as { id: string; booking_id: string; departure_id: string; state: string; total_minor: number; paid_minor: number; waiver_signed: boolean } | undefined;
      if (!passenger || passenger.state !== "confirmed") throw new NotFoundException();
      if (["guide", "driver"].includes(actor.role)) {
        const assignment = await tx.query("SELECT 1 FROM departure_assignments WHERE tenant_id=$1 AND crew_actor_id=$2 AND departure_id=$3 AND status='active'", [actor.tenantId, actor.actorId, passenger.departure_id]);
        if (!assignment.rowCount) throw new BadRequestException("Crew can check in only passengers on their assigned departure");
      }
      const prior = (await tx.query("SELECT state FROM passenger_checkins WHERE tenant_id=$1 AND passenger_id=$2 ORDER BY occurred_at DESC,id DESC LIMIT 1", [actor.tenantId, passengerId])).rows[0] as { state: string } | undefined;
      if (["boarded", "no_show"].includes(prior?.state ?? "")) throw new ConflictException("Final passenger check-in state cannot be changed");
      const balanceSettled = passenger.paid_minor >= passenger.total_minor;
      const gateState = !balanceSettled ? "balance_pending" : !passenger.waiver_signed ? "waiver_pending" : null;
      if (["cleared_to_board", "boarded"].includes(input.state) && gateState) throw new BadRequestException(gateState === "balance_pending" ? "Outstanding balance blocks clearance" : "Required passenger waiver blocks clearance");
      const state = input.state === "arrived" && gateState ? gateState : input.state;
      const result = { id: randomUUID(), passengerId, bookingId: passenger.booking_id, state, balanceSettled, waiverSigned: passenger.waiver_signed };
      await tx.query("INSERT INTO passenger_checkins(tenant_id,id,passenger_id,state,actor_id) VALUES($1,$2,$3,$4,$5)", [actor.tenantId, result.id, passengerId, state, actor.actorId]);
      await record(tx, actor, "passenger.checkin_recorded", passengerId, prior ?? null, result);
      return result;
    });
  }
  issueToken(actor: Actor, passengerId: string, key: string) {
    return this.db.command(actor, `passenger.token:${passengerId}`, key, {}, async (tx) => {
      const passenger = await tx.query("SELECT id FROM booking_passengers WHERE tenant_id=$1 AND id=$2 AND superseded_at IS NULL", [actor.tenantId, passengerId]);
      if (!passenger.rowCount) throw new NotFoundException();
      const token = `ztc_${randomBytes(24).toString("base64url")}`;
      const result = { id: randomUUID(), passengerId, token, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() };
      await tx.query("UPDATE passenger_checkin_tokens SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND passenger_id=$2 AND revoked_at IS NULL", [actor.tenantId, passengerId]);
      await tx.query("INSERT INTO passenger_checkin_tokens(tenant_id,id,passenger_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6)", [actor.tenantId,result.id,passengerId,digest(token),result.expiresAt,actor.actorId]);
      await record(tx,actor,"passenger.checkin_token_issued",result.id,null,{passengerId,expiresAt:result.expiresAt});
      return result;
    });
  }
  resolveToken(actor: Actor, raw: unknown) {
    const input = parse(tokenSchema, raw);
    return this.db.transaction(actor, async (tx) => {
      const row = (await tx.query(`SELECT p.id,p.name,p.category,p.is_minor,p.booking_id,b.departure_id FROM passenger_checkin_tokens t JOIN booking_passengers p ON p.tenant_id=t.tenant_id AND p.id=t.passenger_id JOIN bookings b ON b.tenant_id=p.tenant_id AND b.id=p.booking_id WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>clock_timestamp() AND p.tenant_id=$2 AND p.superseded_at IS NULL`, [digest(input.token),actor.tenantId])).rows[0];
      if (!row) throw new NotFoundException("Check-in token is invalid or expired");
      const assigned = await tx.query("SELECT 1 FROM departure_assignments WHERE tenant_id=$1 AND crew_actor_id=$2 AND departure_id=$3 AND status='active'", [actor.tenantId,actor.actorId,row.departure_id]);
      if (!assigned.rowCount) throw new BadRequestException("Crew can resolve only passengers on an assigned departure");
      return { passengerId: row.id, name: row.name, category: row.category, isMinor: row.is_minor, bookingId: row.booking_id, departureId: row.departure_id };
    });
  }
}

@Controller("staff/v1")
export class PassengerController {
  constructor(private readonly service: PassengerService) {}
  @Get("bookings/:id/passengers") @Access("bookings.read") list(@CurrentActor() actor: Actor, @Param("id") value: string) { return this.service.list(actor, parse(id, value)); }
  @Post("bookings/:id/passengers") @Access("bookings.write") replace(@CurrentActor() actor: Actor, @Param("id") value: string, @Headers("idempotency-key") key: string, @Body() body: unknown) { return this.service.replace(actor, parse(id, value), parse(keySchema, key), body); }
  @Post("bookings/:id/passengers/corrections") @Access("bookings.write") correct(@CurrentActor() actor: Actor, @Param("id") value: string, @Headers("idempotency-key") key: string, @Body() body: unknown) { return this.service.correct(actor, parse(id, value), parse(keySchema, key), body); }
  @Post("passengers/:id/checkin") @Access("checkin.write") checkIn(@CurrentActor() actor: Actor, @Param("id") value: string, @Headers("idempotency-key") key: string, @Body() body: unknown) { return this.service.checkIn(actor, parse(id, value), parse(keySchema, key), body); }
  @Post("passengers/:id/checkin-token") @Access("bookings.write") issueToken(@CurrentActor() actor: Actor, @Param("id") value: string, @Headers("idempotency-key") key: string) { return this.service.issueToken(actor, parse(id, value), parse(keySchema, key)); }
  @Post("crew/checkin-token/resolve") @Access("crew.trip.read") resolveToken(@CurrentActor() actor: Actor, @Body() body: unknown) { return this.service.resolveToken(actor, body); }
}
