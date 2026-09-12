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
import { FinanceService } from "./finance";
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
const crewSignature = z
  .object({
    passengerName: z.string().trim().min(1).max(120).optional(),
    signerName: z.string().trim().min(1).max(160),
    guardianPassengerId: id.optional(),
    consentAccepted: z.literal(true),
    signatureStrokes: z
      .array(
        z
          .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
          .strict(),
      )
      .min(8)
      .max(5000),
    capturedAt: z.string().datetime({ offset: true }),
    deviceCommandId: z.string().trim().min(8).max(128),
    stay: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z
        .object({
          kind: z.literal("cruise"),
          vesselName: z.string().trim().min(1).max(160),
          cabinNumber: z.string().trim().max(40).default(""),
        })
        .strict(),
      z
        .object({
          kind: z.literal("hotel"),
          hotelName: z.string().trim().min(1).max(160),
          roomNumber: z.string().trim().max(40).default(""),
        })
        .strict(),
      z
        .object({
          kind: z.literal("private_accommodation"),
          propertyName: z.string().trim().min(1).max(160),
          address: z.string().trim().min(1).max(300),
        })
        .strict(),
      z
        .object({
          kind: z.literal("local"),
          address: z.string().trim().max(300).default(""),
        })
        .strict(),
    ]),
  })
  .strict();
@Injectable()
export class WaiverService {
  constructor(
    private readonly db: Database,
    private readonly finance: FinanceService,
  ) {}
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
      if (
        v.signerCapacity === "guardian" &&
        (!v.passengerId || !v.guardianPassengerId)
      )
        throw new BadRequestException(
          "Guardian signatures require both the minor and guardian passenger",
        );
      if (v.signerCapacity === "self" && v.guardianPassengerId)
        throw new BadRequestException(
          "Self signatures cannot name a guardian passenger",
        );
      if (v.passengerId) {
        const { rows: people } = await tx.query(
          "SELECT id,is_minor,identity_pending FROM booking_passengers WHERE tenant_id=$1 AND booking_id=$2 AND superseded_at IS NULL AND id=ANY($3::uuid[])",
          [
            a.tenantId,
            b,
            [
              v.passengerId,
              ...(v.guardianPassengerId ? [v.guardianPassengerId] : []),
            ],
          ],
        );
        const passenger = people.find((person) => person.id === v.passengerId);
        const guardian = people.find(
          (person) => person.id === v.guardianPassengerId,
        );
        if (!passenger)
          throw new BadRequestException(
            "Passenger is not in the current booking roster",
          );
        if (passenger.identity_pending)
          throw new BadRequestException(
            "Complete the passenger name before recording a waiver",
          );
        if (
          v.signerCapacity === "guardian" &&
          (!passenger.is_minor ||
            !guardian ||
            guardian.is_minor ||
            guardian.id === passenger.id)
        )
          throw new BadRequestException(
            "Guardian must be an adult in the same booking and sign for a minor",
          );
        if (v.signerCapacity === "self" && passenger.is_minor)
          throw new BadRequestException(
            "A minor requires guardian waiver evidence",
          );
      } else if (v.signerCapacity === "self") {
        const roster = await tx.query(
          "SELECT 1 FROM booking_passengers WHERE tenant_id=$1 AND booking_id=$2 AND superseded_at IS NULL LIMIT 1",
          [a.tenantId, b],
        );
        if (roster.rowCount)
          throw new BadRequestException(
            "Passenger waiver evidence requires a passenger",
          );
      } else if (v.signerCapacity !== "staff_attestation") {
        throw new BadRequestException(
          "Passenger waiver evidence requires a passenger",
        );
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
      const booking = await tx.query(
        "SELECT id FROM bookings WHERE tenant_id=$1 AND id=$2",
        [a.tenantId, bookingId],
      );
      if (!booking.rowCount) throw new BadRequestException("Booking not found");
      return (
        await tx.query(
          `SELECT w.id,w.template_id,w.template_version,w.signer_name,w.signer_capacity,w.passenger_id,w.guardian_passenger_id,w.occurred_at,
        w.consent_text,w.signature_strokes,w.stay_snapshot,w.captured_at,
        t.title AS template_title,t.body AS template_body,
        p.name AS passenger_name,g.name AS guardian_passenger_name
        FROM waiver_signatures w
        LEFT JOIN waiver_templates t ON t.tenant_id=w.tenant_id AND t.id=w.template_id
        LEFT JOIN booking_passengers p ON p.tenant_id=w.tenant_id AND p.id=w.passenger_id
        LEFT JOIN booking_passengers g ON g.tenant_id=w.tenant_id AND g.id=w.guardian_passenger_id
        WHERE w.tenant_id=$1 AND w.booking_id=$2 ORDER BY w.occurred_at DESC,w.id DESC`,
          [a.tenantId, bookingId],
        )
      ).rows;
    });
  }
  passengerWaiver(a: Actor, passengerId: string) {
    return this.db.transaction(a, async (tx) => {
      const {
        rows: [passenger],
      } = await tx.query(
        `SELECT p.id,p.name,p.category,p.is_minor,p.identity_pending,p.booking_id,b.stay
         FROM booking_passengers p
         JOIN bookings b ON b.tenant_id=p.tenant_id AND b.id=p.booking_id
         WHERE p.tenant_id=$1 AND p.id=$2 AND p.superseded_at IS NULL`,
        [a.tenantId, passengerId],
      );
      if (!passenger) throw new BadRequestException("Passenger not found");
      const {
        rows: [signature],
      } = await tx.query(
        `SELECT w.id,w.template_id,w.template_version,w.signer_name,w.signer_capacity,
          w.consent_text,w.signature_strokes,w.stay_snapshot,w.captured_at,w.occurred_at,
          t.title AS template_title,t.body AS template_body,
          g.name AS guardian_passenger_name
         FROM waiver_signatures w
         LEFT JOIN waiver_templates t ON t.tenant_id=w.tenant_id AND t.id=w.template_id
         LEFT JOIN booking_passengers g ON g.tenant_id=w.tenant_id AND g.id=w.guardian_passenger_id
         WHERE w.tenant_id=$1 AND w.passenger_id=$2
         ORDER BY w.occurred_at DESC,w.id DESC LIMIT 1`,
        [a.tenantId, passengerId],
      );
      return {
        passenger: {
          id: passenger.id,
          name: passenger.name,
          category: passenger.category,
          is_minor: passenger.is_minor,
          identity_pending: passenger.identity_pending,
          booking_id: passenger.booking_id,
          stay: passenger.stay,
        },
        signature: signature
          ? {
              id: signature.id,
              templateId: signature.template_id,
              templateVersion: signature.template_version,
              templateTitle: signature.template_title,
              templateBody: signature.template_body,
              signerName: signature.signer_name,
              signerCapacity: signature.signer_capacity,
              consentText: signature.consent_text,
              signatureStrokes: signature.signature_strokes ?? [],
              staySnapshot: signature.stay_snapshot,
              guardianPassengerName: signature.guardian_passenger_name,
              capturedAt: signature.captured_at ?? signature.occurred_at,
            }
          : null,
      };
    });
  }
  crewSign(a: Actor, passengerId: string, k: string, raw: unknown) {
    const v = parse(crewSignature, raw);
    return this.db.command(
      a,
      `crew.waiver:${passengerId}`,
      k,
      v,
      async (tx) => {
        const { rows: people } = await tx.query(
          `SELECT p.id,p.name,p.is_minor,p.identity_pending,p.booking_id,b.departure_id,b.state,
         (h.quote->>'totalMinor')::bigint AS total_minor,
         COALESCE((SELECT SUM(x.amount_minor) FROM payments x WHERE x.tenant_id=b.tenant_id AND x.booking_id=b.id AND x.status='settled' AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=x.tenant_id AND a.payment_id=x.id)),0)::bigint AS paid_minor
         FROM booking_passengers p JOIN bookings b ON b.tenant_id=p.tenant_id AND b.id=p.booking_id
         JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[]) AND p.superseded_at IS NULL`,
          [
            a.tenantId,
            [
              passengerId,
              ...(v.guardianPassengerId ? [v.guardianPassengerId] : []),
            ],
          ],
        );
        const passenger = people.find((person) => person.id === passengerId);
        if (!passenger || passenger.state !== "confirmed")
          throw new BadRequestException("Confirmed passenger not found");
        if (passenger.identity_pending && !v.passengerName)
          throw new BadRequestException(
            "Passenger name is required before signing the waiver",
          );
        if (passenger.identity_pending) {
          await tx.query(
            "UPDATE booking_passengers SET name=$3,identity_pending=false WHERE tenant_id=$1 AND id=$2",
            [a.tenantId, passengerId, v.passengerName],
          );
          await record(
            tx,
            a,
            "passenger.identity_completed",
            passengerId,
            { name: passenger.name, identityPending: true },
            { name: v.passengerName, identityPending: false },
          );
          passenger.name = v.passengerName;
          passenger.identity_pending = false;
        }
        if (["guide", "driver"].includes(a.role)) {
          const assigned = await tx.query(
            "SELECT 1 FROM departure_assignments WHERE tenant_id=$1 AND crew_actor_id=$2 AND departure_id=$3 AND status='active'",
            [a.tenantId, a.actorId, passenger.departure_id],
          );
          if (!assigned.rowCount)
            throw new BadRequestException(
              "Crew can collect waivers only for an assigned departure",
            );
        }
        const guardian = v.guardianPassengerId
          ? people.find((person) => person.id === v.guardianPassengerId)
          : undefined;
        if (
          passenger.is_minor &&
          (!guardian ||
            guardian.is_minor ||
            guardian.booking_id !== passenger.booking_id)
        )
          throw new BadRequestException(
            "A minor requires an adult guardian from the same booking",
          );
        if (!passenger.is_minor && v.guardianPassengerId)
          throw new BadRequestException(
            "An adult passenger signs for themselves",
          );
        const { rows: templates } = await tx.query(
          "SELECT id,version,title,body FROM waiver_templates WHERE tenant_id=$1 AND active ORDER BY version DESC LIMIT 1",
          [a.tenantId],
        );
        const template = templates[0];
        if (!template)
          throw new BadRequestException("Active waiver template not found");
        await tx.query(
          "UPDATE bookings SET stay=$3::jsonb,cruise_call_id=NULL,accommodation_property_id=NULL WHERE tenant_id=$1 AND id=$2",
          [a.tenantId, passenger.booking_id, JSON.stringify(v.stay)],
        );
        const result = {
          id: randomUUID(),
          bookingId: passenger.booking_id,
          passengerId,
          guardianPassengerId: v.guardianPassengerId ?? null,
          templateId: template.id,
          templateVersion: template.version,
          signerName: v.signerName,
          signerCapacity: passenger.is_minor ? "guardian" : "self",
          stay: v.stay,
          capturedAt: v.capturedAt,
          deviceCommandId: v.deviceCommandId,
        };
        await tx.query(
          `INSERT INTO waiver_signatures(tenant_id,id,booking_id,template_id,template_version,signer_name,signer_capacity,passenger_id,guardian_passenger_id,recorded_by,consent_text,signature_strokes,stay_snapshot,captured_at,device_command_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15)`,
          [
            a.tenantId,
            result.id,
            result.bookingId,
            result.templateId,
            result.templateVersion,
            result.signerName,
            result.signerCapacity,
            result.passengerId,
            result.guardianPassengerId,
            a.actorId,
            "I have read and agree to the active waiver.",
            JSON.stringify(v.signatureStrokes),
            JSON.stringify(v.stay),
            v.capturedAt,
            v.deviceCommandId,
          ],
        );
        await record(
          tx,
          a,
          "waiver.signature_recorded",
          result.id,
          null,
          result,
        );
        const priorCheckin = (
          await tx.query(
            "SELECT state FROM passenger_checkins WHERE tenant_id=$1 AND passenger_id=$2 ORDER BY occurred_at DESC,id DESC LIMIT 1",
            [a.tenantId, passengerId],
          )
        ).rows[0] as { state: string } | undefined;
        if (
          priorCheckin &&
          ["arrived", "waiver_pending", "balance_pending"].includes(
            priorCheckin.state,
          )
        ) {
          const balanceSettled = await this.finance.boardingBalanceSettled(
            tx,
            a,
            passenger.booking_id,
            Number(passenger.total_minor),
            Number(passenger.paid_minor),
          );
          const nextState = balanceSettled
            ? "cleared_to_board"
            : "balance_pending";
          if (nextState !== priorCheckin.state) {
            const checkinId = randomUUID();
            await tx.query(
              "INSERT INTO passenger_checkins(tenant_id,id,passenger_id,state,actor_id) VALUES($1,$2,$3,$4,$5)",
              [a.tenantId, checkinId, passengerId, nextState, a.actorId],
            );
            await record(
              tx,
              a,
              "passenger.checkin_recorded",
              passengerId,
              priorCheckin,
              {
                id: checkinId,
                passengerId,
                bookingId: passenger.booking_id,
                state: nextState,
                balanceSettled,
                waiverSigned: true,
                reason: "advanced_after_waiver",
              },
            );
          }
        }
        return result;
      },
    );
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
        const balanceSettled = await this.finance.boardingBalanceSettled(
          tx,
          a,
          bookingId,
          Number(booking.total_minor),
          Number(booking.paid_minor),
        );
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
  @Get("passengers/:id/waiver") @Access("manifest.read") passengerWaiver(
    @CurrentActor() a: Actor,
    @Param("id") passengerId: string,
  ) {
    return this.s.passengerWaiver(a, parse(id, passengerId));
  }
  @Post("bookings/:id/checkin") @Access("checkin.write") checkIn(
    @CurrentActor() a: Actor,
    @Param("id") b: string,
    @Headers("idempotency-key") k: string,
    @Body() v: unknown,
  ) {
    return this.s.checkIn(a, parse(id, b), parse(keySchema, k), v);
  }
  @Post("passengers/:id/waiver") @Access("checkin.write") crewSign(
    @CurrentActor() a: Actor,
    @Param("id") passengerId: string,
    @Headers("idempotency-key") k: string,
    @Body() body: unknown,
  ) {
    return this.s.crewSign(
      a,
      parse(id, passengerId),
      parse(keySchema, k),
      body,
    );
  }
}
