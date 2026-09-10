import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  Param,
  Post,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Actor, id } from "../../../packages/shared/src/contracts";
import { Database, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";
const template = z
  .object({
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(20000),
  })
  .strict();
const signature = z
  .object({
    templateId: id,
    signerName: z.string().trim().min(1).max(160),
    signerCapacity: z.enum(["self", "guardian", "staff_attestation"]),
    passengerId: id.optional(),
    guardianPassengerId: id.optional(),
  })
  .strict();
const checkin = z
  .object({
    state: z.enum(["arrived", "cleared_to_board", "boarded", "no_show"]),
    version: z.number().int().positive().optional(),
  })
  .strict();
@Injectable()
export class WaiverService {
  constructor(private readonly db: Database) {}
  templates(a: Actor) {
    return this.db.transaction(
      a,
      async (tx) =>
        (
          await tx.query(
            "SELECT id,version,title,body,active,created_at FROM waiver_templates WHERE tenant_id=$1 AND active ORDER BY version DESC",
            [a.tenantId],
          )
        ).rows,
    );
  }
  create(a: Actor, k: string, raw: unknown) {
    const v = parse(template, raw);
    return this.db.command(a, "waiver.template.create", k, v, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        a.tenantId,
      ]);
      const { rows: prior } = await tx.query(
        "SELECT id,version,title,body,active,created_at FROM waiver_templates WHERE tenant_id=$1 AND active FOR UPDATE",
        [a.tenantId],
      );
      await tx.query(
        "UPDATE waiver_templates SET active=false WHERE tenant_id=$1 AND active",
        [a.tenantId],
      );
      const {
        rows: [n],
      } = await tx.query(
        "SELECT COALESCE(MAX(version),0)+1 AS version FROM waiver_templates WHERE tenant_id=$1",
        [a.tenantId],
      );
      const x = { id: randomUUID(), version: n.version, ...v, active: true };
      await tx.query(
        "INSERT INTO waiver_templates(tenant_id,id,version,title,body) VALUES($1,$2,$3,$4,$5)",
        [a.tenantId, x.id, x.version, x.title, x.body],
      );
      for (const old of prior)
        await record(tx, a, "waiver_template.superseded", old.id, old, {
          ...old,
          active: false,
        });
      await record(tx, a, "waiver_template.created", x.id, null, x);
      return x;
    });
  }
  sign(a: Actor, b: string, k: string, raw: unknown) {
    const v = parse(signature, raw);
    return this.db.command(a, `waiver.signature:${b}`, k, v, async (tx) => {
      const {
        rows: [t],
      } = await tx.query(
        "SELECT version FROM waiver_templates WHERE tenant_id=$1 AND id=$2 AND active",
        [a.tenantId, v.templateId],
      );
      if (!t) throw new BadRequestException("Active waiver template not found");
      const {
        rows: [booking],
      } = await tx.query(
        "SELECT state FROM bookings WHERE tenant_id=$1 AND id=$2",
        [a.tenantId, b],
      );
      if (!booking || booking.state !== "confirmed")
        throw new BadRequestException(
          "Waiver evidence can only be recorded for a confirmed booking",
        );
      if (v.signerCapacity === "guardian" && (!v.passengerId || !v.guardianPassengerId))
        throw new BadRequestException("Guardian signatures require both the minor and guardian passenger");
      if (v.signerCapacity === "self" && v.guardianPassengerId)
        throw new BadRequestException("Self signatures cannot name a guardian passenger");
      if (v.passengerId) {
        const { rows: people } = await tx.query(
          "SELECT id,is_minor FROM booking_passengers WHERE tenant_id=$1 AND booking_id=$2 AND superseded_at IS NULL AND id=ANY($3::uuid[])",
          [a.tenantId, b, [v.passengerId, ...(v.guardianPassengerId ? [v.guardianPassengerId] : [])]],
        );
        const passenger = people.find((person) => person.id === v.passengerId);
        const guardian = people.find((person) => person.id === v.guardianPassengerId);
        if (!passenger) throw new BadRequestException("Passenger is not in the current booking roster");
        if (v.signerCapacity === "guardian" && (!passenger.is_minor || !guardian || guardian.is_minor || guardian.id === passenger.id))
          throw new BadRequestException("Guardian must be an adult in the same booking and sign for a minor");
        if (v.signerCapacity === "self" && passenger.is_minor)
          throw new BadRequestException("A minor requires guardian waiver evidence");
      } else if (v.signerCapacity === "self") {
        const roster = await tx.query("SELECT 1 FROM booking_passengers WHERE tenant_id=$1 AND booking_id=$2 AND superseded_at IS NULL LIMIT 1", [a.tenantId, b]);
        if (roster.rowCount) throw new BadRequestException("Passenger waiver evidence requires a passenger");
      } else if (v.signerCapacity !== "staff_attestation") {
        throw new BadRequestException("Passenger waiver evidence requires a passenger");
      }
      const x = {
        id: randomUUID(),
        bookingId: b,
        templateId: v.templateId,
        templateVersion: t.version,
        signerName: v.signerName,
        signerCapacity: v.signerCapacity,
        passengerId: v.passengerId ?? null,
        guardianPassengerId: v.guardianPassengerId ?? null,
      };
      await tx.query(
        "INSERT INTO waiver_signatures(tenant_id,id,booking_id,template_id,template_version,signer_name,signer_capacity,passenger_id,guardian_passenger_id,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          a.tenantId,
          x.id,
          b,
          x.templateId,
          x.templateVersion,
          x.signerName,
          x.signerCapacity,
          x.passengerId,
          x.guardianPassengerId,
          a.actorId,
        ],
      );
      await record(tx, a, "waiver.signature_recorded", x.id, null, x);
      return x;
    });
  }
  signatures(a: Actor, bookingId: string) {
    return this.db.transaction(a, async (tx) => {
      const booking = await tx.query("SELECT id FROM bookings WHERE tenant_id=$1 AND id=$2", [a.tenantId, bookingId]);
      if (!booking.rowCount) throw new BadRequestException("Booking not found");
      return (await tx.query(`SELECT w.id,w.template_id,w.template_version,w.signer_name,w.signer_capacity,w.passenger_id,w.guardian_passenger_id,w.occurred_at,
        p.name AS passenger_name,g.name AS guardian_passenger_name
        FROM waiver_signatures w LEFT JOIN booking_passengers p ON p.tenant_id=w.tenant_id AND p.id=w.passenger_id
        LEFT JOIN booking_passengers g ON g.tenant_id=w.tenant_id AND g.id=w.guardian_passenger_id
        WHERE w.tenant_id=$1 AND w.booking_id=$2 ORDER BY w.occurred_at DESC,w.id DESC`, [a.tenantId, bookingId])).rows;
    });
  }
  checkIn(a: Actor, bookingId: string, key: string, raw: unknown) {
    const input = parse(checkin, raw);
    return this.db.command(
      a,
      `booking.checkin:${bookingId}`,
      key,
      input,
      async (tx) => {
        const {
          rows: [booking],
        } = await tx.query(
          `SELECT b.state,(h.quote->>'totalMinor')::bigint AS total_minor,
        COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='settled' AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)::bigint AS paid_minor,
        EXISTS(SELECT 1 FROM waiver_signatures w WHERE w.tenant_id=b.tenant_id AND w.booking_id=b.id) AS waiver_signed
        FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id WHERE b.tenant_id=$1 AND b.id=$2`,
          [a.tenantId, bookingId],
        );
        if (!booking || booking.state !== "confirmed")
          throw new BadRequestException(
            "Only confirmed bookings can be checked in",
          );
        if (["guide", "driver"].includes(a.role)) {
          const { rows: assigned } = await tx.query(
            `SELECT 1
             FROM departure_assignments x
             WHERE x.tenant_id=$1 AND x.crew_actor_id=$2 AND x.departure_id=(
               SELECT departure_id FROM bookings WHERE tenant_id=$1 AND id=$3
             ) AND x.status='active'`,
            [a.tenantId, a.actorId, bookingId],
          );
          if (!assigned[0])
            throw new BadRequestException(
              "Crew can check in only guests on their assigned departure",
            );
        }
        const balanceSettled = booking.paid_minor >= booking.total_minor;
        const gateState = !balanceSettled
          ? "balance_pending"
          : !booking.waiver_signed
            ? "waiver_pending"
            : null;
        if (["cleared_to_board", "boarded"].includes(input.state) && gateState)
          throw new BadRequestException(
            gateState === "balance_pending"
              ? "Outstanding balance blocks clearance"
              : "Required waiver blocks clearance",
          );
        const {
          rows: [prior],
        } = await tx.query(
          "SELECT state,version FROM booking_checkins WHERE tenant_id=$1 AND booking_id=$2 FOR UPDATE",
          [a.tenantId, bookingId],
        );
        if (prior && input.version !== prior.version)
          throw new BadRequestException("Stale check-in version");
        if (!prior && input.version !== undefined)
          throw new BadRequestException("Check-in record does not exist yet");
        const state =
          input.state === "arrived" && gateState ? gateState : input.state;
        const version = (prior?.version ?? 0) + 1;
        await tx.query(
          `INSERT INTO booking_checkins(tenant_id,booking_id,state,version,recorded_by)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(tenant_id,booking_id) DO UPDATE SET state=EXCLUDED.state,version=EXCLUDED.version,recorded_by=EXCLUDED.recorded_by,updated_at=clock_timestamp()`,
          [a.tenantId, bookingId, state, version, a.actorId],
        );
        const result = {
          bookingId,
          state,
          version,
          balanceSettled,
          waiverSigned: booking.waiver_signed,
        };
        await record(
          tx,
          a,
          "booking.checkin_recorded",
          bookingId,
          prior ?? null,
          result,
        );
        return result;
      },
    );
  }
}
@Controller("ops/v1")
export class WaiverController {
  constructor(private readonly s: WaiverService) {}
  @Get("waiver-templates") @Access("manifest.read") list(
    @CurrentActor() a: Actor,
  ) {
    return this.s.templates(a);
  }
  @Post("waiver-templates") @Access("waiver.template.publish") create(
    @CurrentActor() a: Actor,
    @Headers("idempotency-key") k: string,
    @Body() b: unknown,
  ) {
    return this.s.create(a, parse(keySchema, k), b);
  }
  @Post("bookings/:id/waivers") @Access("operations.write") sign(
    @CurrentActor() a: Actor,
    @Param("id") b: string,
    @Headers("idempotency-key") k: string,
    @Body() v: unknown,
  ) {
    return this.s.sign(a, parse(id, b), parse(keySchema, k), v);
  }
  @Get("bookings/:id/waivers") @Access("manifest.read") signatures(
    @CurrentActor() a: Actor,
    @Param("id") b: string,
  ) {
    return this.s.signatures(a, parse(id, b));
  }
  @Post("bookings/:id/checkin") @Access("checkin.write") checkIn(
    @CurrentActor() a: Actor,
    @Param("id") b: string,
    @Headers("idempotency-key") k: string,
    @Body() v: unknown,
  ) {
    return this.s.checkIn(a, parse(id, b), parse(keySchema, k), v);
  }
}
