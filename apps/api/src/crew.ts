import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import {
  isFieldCrewRole,
  partySchema,
  paymentSchema,
  type Actor,
} from "../../../packages/shared/src/contracts";
import { Database, record, Tx } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";
import { DispatchService } from "./dispatch";
import { FinanceService } from "./finance";
import { InventoryService } from "./inventory";
import { PassengerService } from "./passengers";
import { PrintService } from "./printing";
import { ReservationService } from "./reservations";

const todayQuery = z.object({ date: z.string().date().optional() }).strict();
const tripEvent = z
  .object({
    state: z.enum([
      "preparing",
      "en_route_pickup",
      "boarding",
      "departed",
      "at_stop",
      "delayed",
      "completed",
      "cancelled",
      "emergency",
    ]),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();
const departureId = z.string().uuid();

const walkUpCreate = z
  .object({
    departureId: z.string().uuid(),
    party: partySchema,
    leadName: z.string().trim().min(1).max(120),
    leadEmail: z.string().email().max(254),
    leadPhone: z.string().trim().max(40).default(""),
    payment: paymentSchema.optional(),
  })
  .strict();
const walkUpComplete = z
  .object({
    bookingId: z.string().uuid(),
    payment: paymentSchema,
  })
  .strict();
const crewPrintSchema = z
  .object({
    documentType: z.enum(["pickup_list", "receipt"]),
    sourceId: z.string().uuid(),
  })
  .strict();

function pendingRoster(party: Record<string, number>, leadName: string) {
  const passengers: {
    name: string;
    category: string;
    isMinor: boolean;
    identityPending: boolean;
  }[] = [];
  for (const [category, count] of Object.entries(party)) {
    for (let i = 0; i < count; i++) {
      const first = passengers.length === 0;
      passengers.push({
        name: first
          ? leadName
          : `Guest ${passengers.length + 1} · name required`,
        category,
        isMinor: /(child|infant|minor|kid)/i.test(category),
        identityPending: !first,
      });
    }
  }
  return passengers;
}

function fieldRole(role: string) {
  return isFieldCrewRole(role);
}

function boardingClearance(
  collectionMode: string | null,
  guestBalanceMinor: number,
) {
  if (
    collectionMode === "partner_invoice" ||
    collectionMode === "partner_collects_for_tenant"
  )
    return "partner" as const;
  return guestBalanceMinor > 0 ? ("due" as const) : ("settled" as const);
}

@Injectable()
export class CrewService {
  constructor(
    private readonly db: Database,
    private readonly finance: FinanceService,
    private readonly inventory: InventoryService,
    private readonly dispatch: DispatchService,
    private readonly reservations: ReservationService,
    private readonly passengers: PassengerService,
    private readonly printing: PrintService,
  ) {}
  today(actor: Actor, raw: unknown) {
    const input = parse(todayQuery, raw);
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [tenant],
      } = await tx.query("SELECT timezone, config FROM tenants WHERE id=$1", [
        actor.tenantId,
      ]);
      const date =
        input.date ?? DateTime.now().setZone(tenant.timezone).toISODate();
      const { rows: trips } = await tx.query(
        `SELECT d.id,d.starts_at,d.local_date,d.operational_status,p.name AS product_name,
          p.cover_path,
          r.state AS trip_run_state,
          array_agg(a.assignment_role ORDER BY a.assignment_role) AS assignment_roles
         FROM departure_assignments a
         JOIN departures d ON d.tenant_id=a.tenant_id AND d.id=a.departure_id
         JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         JOIN crew_profiles c ON c.tenant_id=a.tenant_id AND c.membership_actor_id=a.crew_actor_id AND c.active
         LEFT JOIN trip_runs r ON r.tenant_id=d.tenant_id AND r.departure_id=d.id
         WHERE a.tenant_id=$1 AND a.crew_actor_id=$2 AND a.status='active' AND d.local_date=$3
         GROUP BY d.id,d.starts_at,d.local_date,d.operational_status,p.name,p.cover_path,r.state
         ORDER BY d.starts_at,d.id`,
        [actor.tenantId, actor.actorId, date],
      );
      const departureIds = trips.map((trip) => trip.id);
      const { rows: guests } = departureIds.length
        ? await tx.query(
            `SELECT b.departure_id,b.id AS booking_id,b.lead_name,h.party,
              (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size,
              COALESCE(c.state,'not_arrived') AS checkin_state,
              c.version AS checkin_version,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'is_minor',p.is_minor,'identity_pending',p.identity_pending,'checkin_state',latest.state,'waiver_signed',EXISTS(SELECT 1 FROM waiver_signatures w WHERE w.tenant_id=p.tenant_id AND w.passenger_id=p.id)) ORDER BY p.created_at,p.id)
                FROM booking_passengers p LEFT JOIN LATERAL (SELECT state FROM passenger_checkins x WHERE x.tenant_id=p.tenant_id AND x.passenger_id=p.id ORDER BY x.occurred_at DESC,x.id DESC LIMIT 1) latest ON true
                WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.superseded_at IS NULL),'[]'::jsonb) AS passengers,
              b.pickup,b.stay,
              (h.quote->>'totalMinor')::bigint AS total_minor,
              h.quote->>'currency' AS currency,
              COALESCE((SELECT SUM(p.amount_minor) FROM payments p
                WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='settled'
                AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)::bigint AS paid_minor,
              COALESCE((SELECT SUM(cl.amount_minor) FROM partner_collection_claims cl
                JOIN partner_claim_decisions d ON d.tenant_id=cl.tenant_id AND d.claim_id=cl.id AND d.decision='accepted'
                WHERE cl.tenant_id=b.tenant_id AND cl.booking_id=b.id),0)::bigint AS partner_credit_minor,
              (SELECT s.collection_mode FROM booking_partner_snapshots s
                WHERE s.tenant_id=b.tenant_id AND s.booking_id=b.id
                ORDER BY s.booking_version DESC,s.partner_id DESC LIMIT 1) AS collection_mode
             FROM bookings b
             JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
             LEFT JOIN booking_checkins c ON c.tenant_id=b.tenant_id AND c.booking_id=b.id
             WHERE b.tenant_id=$1 AND b.departure_id=ANY($2::uuid[]) AND b.state='confirmed'
             ORDER BY b.departure_id,b.id`,
            [actor.tenantId, departureIds],
          )
        : { rows: [] };
      const { rows: pickupStops } = departureIds.length
        ? await tx.query(
            `SELECT s.departure_id,s.booking_id,s.sequence,s.pickup_at,s.notes,l.name AS location_name,b.lead_name,
              (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
             FROM pickup_stops s
             JOIN pickup_locations l ON l.tenant_id=s.tenant_id AND l.id=s.location_id
             JOIN bookings b ON b.tenant_id=s.tenant_id AND b.id=s.booking_id
             JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
             WHERE s.tenant_id=$1 AND s.departure_id=ANY($2::uuid[])
             ORDER BY s.departure_id,s.sequence`,
            [actor.tenantId, departureIds],
          )
        : { rows: [] };
      const { rows: pickupExceptions } = departureIds.length
        ? await tx.query(
            `SELECT b.departure_id,b.id AS booking_id,b.lead_name,b.pickup->>'kind' AS pickup_kind,
              (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
             FROM bookings b
             JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
             WHERE b.tenant_id=$1 AND b.departure_id=ANY($2::uuid[]) AND b.state='confirmed' AND (
               b.pickup->>'kind'='unresolved' OR (
                 b.pickup->>'kind'='selected' AND NOT EXISTS (
                   SELECT 1 FROM pickup_stops s
                   WHERE s.tenant_id=b.tenant_id AND s.departure_id=b.departure_id AND s.booking_id=b.id
                 )
               )
             )
             ORDER BY b.departure_id,b.pickup->>'kind',b.lead_name,b.id`,
            [actor.tenantId, departureIds],
          )
        : { rows: [] };
      const roster = guests.map((guest) => {
        const totalMinor = Number(guest.total_minor);
        const paidMinor = Number(guest.paid_minor);
        const partnerCreditMinor = Number(guest.partner_credit_minor);
        const partnerClears =
          guest.collection_mode === "partner_invoice" ||
          guest.collection_mode === "partner_collects_for_tenant";
        const guestBalanceMinor = partnerClears
          ? 0
          : Math.max(0, totalMinor - paidMinor - partnerCreditMinor);
        return {
          departure_id: guest.departure_id,
          booking_id: guest.booking_id,
          lead_name: guest.lead_name,
          party_size: guest.party_size,
          checkin_state: guest.checkin_state,
          checkin_version: guest.checkin_version,
          passengers: guest.passengers,
          pickup: guest.pickup,
          stay: guest.stay,
          currency: guest.currency,
          boarding_clearance: boardingClearance(
            guest.collection_mode,
            guestBalanceMinor,
          ),
          guest_balance_minor: guestBalanceMinor,
        };
      });
      return {
        date,
        paymentMethods: (
          (tenant.config?.manualPaymentMethods as string[] | undefined) ?? []
        ).filter((method) => method !== "reseller_payment"),
        bookingCurrency: tenant.config?.bookingCurrency ?? null,
        collectionCurrency: tenant.config?.collectionCurrency ?? null,
        waiverTemplate:
          (
            await tx.query(
              "SELECT id,version,title,body FROM waiver_templates WHERE tenant_id=$1 AND active ORDER BY version DESC LIMIT 1",
              [actor.tenantId],
            )
          ).rows[0] ?? null,
        trips: trips.map((trip) => {
          const tripGuests = roster.filter(
            (guest) => guest.departure_id === trip.id,
          );
          const passengers = tripGuests.flatMap(
            (guest) => guest.passengers ?? [],
          );
          const boarded = passengers.filter(
            (person: { checkin_state?: string | null }) =>
              person.checkin_state === "boarded",
          ).length;
          const noShow = passengers.filter(
            (person: { checkin_state?: string | null }) =>
              person.checkin_state === "no_show",
          ).length;
          return {
            id: trip.id,
            starts_at: trip.starts_at,
            local_date: trip.local_date,
            product_name: trip.product_name,
            cover_path: trip.cover_path,
            assignment_roles: trip.assignment_roles,
            operational_status: trip.operational_status,
            trip_run_state: trip.trip_run_state,
            boarded_guests: boarded,
            no_show_guests: noShow,
            boarding_pending: Math.max(0, passengers.length - boarded - noShow),
            pickup_stops: pickupStops.filter(
              (stop) => stop.departure_id === trip.id,
            ),
            pickup_exceptions: pickupExceptions.filter(
              (item) => item.departure_id === trip.id,
            ),
            guests: tripGuests.map(
              ({ departure_id: _departureId, ...guest }) => guest,
            ),
          };
        }),
      };
    });
  }
  event(actor: Actor, departure: string, key: string, raw: unknown) {
    const input = parse(tripEvent, raw);
    return this.db.command(
      actor,
      `trip.run:${departure}`,
      key,
      input,
      async (tx) => {
        const assigned = await tx.query(
          "SELECT 1 FROM departure_assignments WHERE tenant_id=$1 AND crew_actor_id=$2 AND departure_id=$3 AND status='active'",
          [actor.tenantId, actor.actorId, departure],
        );
        if (!assigned.rowCount)
          throw new BadRequestException(
            "Crew can update only an assigned departure",
          );
        const prior = (
          await tx.query(
            "SELECT state,version FROM trip_runs WHERE tenant_id=$1 AND departure_id=$2 FOR UPDATE",
            [actor.tenantId, departure],
          )
        ).rows[0] as { state: string; version: number } | undefined;
        if (["completed", "cancelled"].includes(prior?.state ?? ""))
          throw new BadRequestException(
            "Completed or cancelled trip runs cannot be changed",
          );
        const version = (prior?.version ?? 0) + 1;
        await tx.query(
          "INSERT INTO trip_runs(tenant_id,departure_id,state,version,recorded_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,departure_id) DO UPDATE SET state=EXCLUDED.state,version=EXCLUDED.version,recorded_by=EXCLUDED.recorded_by,updated_at=clock_timestamp()",
          [actor.tenantId, departure, input.state, version, actor.actorId],
        );
        const result = {
          id: randomUUID(),
          departureId: departure,
          state: input.state,
          version,
          reason: input.reason ?? null,
        };
        await tx.query(
          "INSERT INTO trip_run_events(tenant_id,id,departure_id,state,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)",
          [
            actor.tenantId,
            result.id,
            departure,
            input.state,
            result.reason,
            actor.actorId,
          ],
        );
        await record(
          tx,
          actor,
          "trip_run.event_recorded",
          departure,
          prior ?? null,
          result,
          input.reason,
        );
        return result;
      },
    );
  }
  payment(actor: Actor, bookingId: string, key: string, raw: unknown) {
    const data = parse(paymentSchema, raw);
    return this.db.command(
      actor,
      `crew.booking.payment:${bookingId}`,
      key,
      data,
      async (tx) => {
        if (data.status !== "settled")
          throw new BadRequestException(
            "Crew boarding payments must be recorded as settled",
          );
        if (data.method === "reseller_payment")
          throw new BadRequestException(
            "Reseller collection is not recorded on the crew app",
          );
        const {
          rows: [booking],
        } = await tx.query(
          `SELECT b.id,b.state,b.hold_id,b.departure_id FROM bookings b
           WHERE b.tenant_id=$1 AND b.id=$2 FOR UPDATE`,
          [actor.tenantId, bookingId],
        );
        if (!booking) throw new NotFoundException();
        if (booking.state !== "confirmed")
          throw new ConflictException(
            "Cannot collect on a cancelled reservation",
          );
        if (fieldRole(actor.role)) {
          const assigned = await tx.query(
            "SELECT 1 FROM departure_assignments WHERE tenant_id=$1 AND crew_actor_id=$2 AND departure_id=$3 AND status='active'",
            [actor.tenantId, actor.actorId, booking.departure_id],
          );
          if (!assigned.rowCount)
            throw new BadRequestException(
              "Crew can collect only on an assigned departure",
            );
        }
        const {
          rows: [snap],
        } = await tx.query(
          `SELECT collection_mode FROM booking_partner_snapshots
           WHERE tenant_id=$1 AND booking_id=$2
           ORDER BY booking_version DESC, partner_id DESC LIMIT 1`,
          [actor.tenantId, bookingId],
        );
        if (
          snap?.collection_mode === "partner_invoice" ||
          snap?.collection_mode === "partner_collects_for_tenant"
        )
          throw new BadRequestException(
            "Partner settlement already clears this booking — skip Pay",
          );
        const hold = await this.inventory.hold(tx, actor, booking.hold_id);
        return this.finance.record(tx, actor, bookingId, hold.quote, data);
      },
    );
  }
  async board(actor: Actor, raw: unknown) {
    const input = parse(todayQuery, raw);
    const meta = await this.db.transaction(actor, async (tx) => {
      const {
        rows: [tenant],
      } = await tx.query("SELECT timezone, config FROM tenants WHERE id=$1", [
        actor.tenantId,
      ]);
      return {
        date:
          input.date ?? DateTime.now().setZone(tenant.timezone).toISODate()!,
        paymentMethods: (
          (tenant.config?.manualPaymentMethods as string[] | undefined) ?? []
        ).filter((method) => method !== "reseller_payment"),
        collectionCurrency: tenant.config?.collectionCurrency ?? null,
        waiverTemplate:
          (
            await tx.query(
              "SELECT id,version,title,body FROM waiver_templates WHERE tenant_id=$1 AND active ORDER BY version DESC LIMIT 1",
              [actor.tenantId],
            )
          ).rows[0] ?? null,
      };
    });
    const board = await this.dispatch.board(actor, { date: meta.date });
    const ids = board.items.map((item: { id: string }) => item.id);
    const crew = await this.db.transaction(actor, async (tx) =>
      ids.length
        ? (
            await tx.query(
              `SELECT a.departure_id,a.assignment_role,s.name
               FROM departure_assignments a
               JOIN staff_users s ON s.id=a.crew_actor_id
               WHERE a.tenant_id=$1 AND a.departure_id=ANY($2::uuid[]) AND a.status='active'
               ORDER BY a.departure_id,a.assignment_role,s.name,a.crew_actor_id`,
              [actor.tenantId, ids],
            )
          ).rows
        : [],
    );
    return {
      date: board.date,
      paymentMethods: meta.paymentMethods,
      collectionCurrency: meta.collectionCurrency,
      waiverTemplate: meta.waiverTemplate,
      capabilities: {
        walkUp: actor.permissions.includes("bookings.write"),
        weather: actor.permissions.includes("operations.write"),
        print:
          actor.permissions.includes("print.jobs.create") &&
          actor.permissions.includes("print.jobs.read"),
        checkin: actor.permissions.includes("checkin.write"),
      },
      items: board.items.map((item: { id: string }) => ({
        ...item,
        crew: crew
          .filter((row) => row.departure_id === item.id)
          .map((row) => ({
            assignment_role: row.assignment_role,
            name: row.name,
          })),
      })),
    };
  }
  trip(actor: Actor, departure: string) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [trip],
      } = await tx.query(
        `SELECT d.id,d.starts_at,d.local_date,d.operational_status,p.name AS product_name,
          p.cover_path,
          r.state AS trip_run_state
         FROM departures d
         JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         LEFT JOIN trip_runs r ON r.tenant_id=d.tenant_id AND r.departure_id=d.id
         WHERE d.tenant_id=$1 AND d.id=$2`,
        [actor.tenantId, departure],
      );
      if (!trip) throw new NotFoundException();
      const facts = await rosterFacts(tx, actor, [departure]);
      const { rows: crew } = await tx.query(
        `SELECT a.assignment_role,s.name
         FROM departure_assignments a
         JOIN staff_users s ON s.id=a.crew_actor_id
         WHERE a.tenant_id=$1 AND a.departure_id=$2 AND a.status='active'
         ORDER BY a.assignment_role,s.name,a.crew_actor_id`,
        [actor.tenantId, departure],
      );
      return {
        ...shapeTrip(trip, facts, crew),
      };
    });
  }
  async walkUp(actor: Actor, key: string, raw: unknown) {
    const complete = walkUpComplete.safeParse(raw);
    if (complete.success) {
      const input = complete.data;
      const booking = await this.db.transaction(actor, (tx) =>
        this.reservations.booking(tx, actor, input.bookingId, true),
      );
      if (booking.source !== "walk_in")
        throw new BadRequestException(
          "Only walk-up reservations can be completed here",
        );
      if (booking.state === "confirmed")
        return {
          bookingId: input.bookingId,
          state: "confirmed",
          version: booking.version,
          needsPayment: false,
        };
      await this.reservations.payment(
        actor,
        input.bookingId,
        `${key}:pay`,
        input.payment,
      );
      return {
        ...(await this.reservations.confirm(
          actor,
          input.bookingId,
          `${key}:confirm`,
          { version: booking.version },
        )),
        needsPayment: false,
      };
    }
    const input = parse(walkUpCreate, raw);
    const hold = await this.inventory.create(actor, `${key}:hold`, {
      departureId: input.departureId,
      party: input.party,
    });
    const booking = await this.reservations.create(actor, `${key}:booking`, {
      holdId: hold.holdId,
      leadName: input.leadName,
      leadEmail: input.leadEmail,
      leadPhone: input.leadPhone,
      source: "walk_in",
      pickup: { kind: "none" },
      stay: { kind: "none" },
    });
    await this.passengers.replace(actor, booking.bookingId, `${key}:roster`, {
      passengers: pendingRoster(input.party, input.leadName),
    });
    if (input.payment) {
      await this.reservations.payment(
        actor,
        booking.bookingId,
        `${key}:pay`,
        input.payment,
      );
    }
    try {
      return {
        ...(await this.reservations.confirm(
          actor,
          booking.bookingId,
          `${key}:confirm`,
          { version: booking.version },
        )),
        quote: hold.quote,
        needsPayment: false,
      };
    } catch (reason) {
      if (
        reason instanceof HttpException &&
        reason.getStatus() === 409 &&
        /required payment/i.test(reason.message)
      )
        return {
          bookingId: booking.bookingId,
          state: "held",
          version: booking.version,
          quote: hold.quote,
          needsPayment: true,
        };
      throw reason;
    }
  }
  operationalStatus(
    actor: Actor,
    departure: string,
    key: string,
    raw: unknown,
  ) {
    return this.dispatch.setOperationalStatus(actor, departure, key, raw);
  }
  pickupList(actor: Actor, departure: string) {
    return this.dispatch.printableList(actor, departure);
  }
  printJob(actor: Actor, key: string, raw: unknown) {
    const input = parse(crewPrintSchema, raw);
    return this.printing.requestBrowserJob(actor, key, {
      documentType: input.documentType,
      sourceType: input.documentType === "receipt" ? "booking" : "departure",
      sourceId: input.sourceId,
    });
  }
  async pdf(actor: Actor, jobId: string) {
    const allowed = await this.db.transaction(actor, async (tx) => {
      const {
        rows: [job],
      } = await tx.query(
        "SELECT document_type FROM print_jobs WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, jobId],
      );
      return (
        job?.document_type === "pickup_list" || job?.document_type === "receipt"
      );
    });
    if (!allowed) throw new NotFoundException("Printable job not found");
    return this.printing.pdf(actor, jobId);
  }
}

async function rosterFacts(tx: Tx, actor: Actor, departureIds: string[]) {
  const { rows: guests } = departureIds.length
    ? await tx.query(
        `SELECT b.departure_id,b.id AS booking_id,b.lead_name,h.party,
          (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size,
          COALESCE(c.state,'not_arrived') AS checkin_state,
          c.version AS checkin_version,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'is_minor',p.is_minor,'identity_pending',p.identity_pending,'checkin_state',latest.state,'waiver_signed',EXISTS(SELECT 1 FROM waiver_signatures w WHERE w.tenant_id=p.tenant_id AND w.passenger_id=p.id)) ORDER BY p.created_at,p.id)
            FROM booking_passengers p LEFT JOIN LATERAL (SELECT state FROM passenger_checkins x WHERE x.tenant_id=p.tenant_id AND x.passenger_id=p.id ORDER BY x.occurred_at DESC,x.id DESC LIMIT 1) latest ON true
            WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.superseded_at IS NULL),'[]'::jsonb) AS passengers,
          b.pickup,b.stay,
          (h.quote->>'totalMinor')::bigint AS total_minor,
          h.quote->>'currency' AS currency,
          COALESCE((SELECT SUM(p.amount_minor) FROM payments p
            WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='settled'
            AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)::bigint AS paid_minor,
          COALESCE((SELECT SUM(cl.amount_minor) FROM partner_collection_claims cl
            JOIN partner_claim_decisions d ON d.tenant_id=cl.tenant_id AND d.claim_id=cl.id AND d.decision='accepted'
            WHERE cl.tenant_id=b.tenant_id AND cl.booking_id=b.id),0)::bigint AS partner_credit_minor,
          (SELECT s.collection_mode FROM booking_partner_snapshots s
            WHERE s.tenant_id=b.tenant_id AND s.booking_id=b.id
            ORDER BY s.booking_version DESC,s.partner_id DESC LIMIT 1) AS collection_mode
         FROM bookings b
         JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         LEFT JOIN booking_checkins c ON c.tenant_id=b.tenant_id AND c.booking_id=b.id
         WHERE b.tenant_id=$1 AND b.departure_id=ANY($2::uuid[]) AND b.state='confirmed'
         ORDER BY b.departure_id,b.id`,
        [actor.tenantId, departureIds],
      )
    : { rows: [] };
  const { rows: pickupStops } = departureIds.length
    ? await tx.query(
        `SELECT s.departure_id,s.booking_id,s.sequence,s.pickup_at,s.notes,l.name AS location_name,b.lead_name,
          (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
         FROM pickup_stops s
         JOIN pickup_locations l ON l.tenant_id=s.tenant_id AND l.id=s.location_id
         JOIN bookings b ON b.tenant_id=s.tenant_id AND b.id=s.booking_id
         JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         WHERE s.tenant_id=$1 AND s.departure_id=ANY($2::uuid[])
         ORDER BY s.departure_id,s.sequence`,
        [actor.tenantId, departureIds],
      )
    : { rows: [] };
  const { rows: pickupExceptions } = departureIds.length
    ? await tx.query(
        `SELECT b.departure_id,b.id AS booking_id,b.lead_name,b.pickup->>'kind' AS pickup_kind,
          (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
         FROM bookings b
         JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         WHERE b.tenant_id=$1 AND b.departure_id=ANY($2::uuid[]) AND b.state='confirmed' AND (
           b.pickup->>'kind'='unresolved' OR (
             b.pickup->>'kind'='selected' AND NOT EXISTS (
               SELECT 1 FROM pickup_stops s
               WHERE s.tenant_id=b.tenant_id AND s.departure_id=b.departure_id AND s.booking_id=b.id
             )
           )
         )
         ORDER BY b.departure_id,b.pickup->>'kind',b.lead_name,b.id`,
        [actor.tenantId, departureIds],
      )
    : { rows: [] };
  const roster = guests.map((guest) => {
    const totalMinor = Number(guest.total_minor);
    const paidMinor = Number(guest.paid_minor);
    const partnerCreditMinor = Number(guest.partner_credit_minor);
    const guestBalanceMinor =
      guest.collection_mode === "partner_invoice" ||
      guest.collection_mode === "partner_collects_for_tenant"
        ? 0
        : Math.max(0, totalMinor - paidMinor - partnerCreditMinor);
    return {
      departure_id: guest.departure_id,
      booking_id: guest.booking_id,
      lead_name: guest.lead_name,
      party_size: guest.party_size,
      checkin_state: guest.checkin_state,
      checkin_version: guest.checkin_version,
      passengers: guest.passengers,
      pickup: guest.pickup,
      stay: guest.stay,
      currency: guest.currency,
      boarding_clearance: boardingClearance(
        guest.collection_mode,
        guestBalanceMinor,
      ),
      guest_balance_minor: guestBalanceMinor,
    };
  });
  return { roster, pickupStops, pickupExceptions };
}

function shapeTrip(
  trip: {
    id: string;
    starts_at: string;
    local_date: string;
    product_name: string;
    cover_path?: string | null;
    operational_status: string;
    trip_run_state: string | null;
  },
  facts: Awaited<ReturnType<typeof rosterFacts>>,
  crew: { assignment_role: string; name: string }[],
) {
  const tripGuests = facts.roster.filter(
    (guest) => guest.departure_id === trip.id,
  );
  const passengers = tripGuests.flatMap((guest) => guest.passengers ?? []);
  const boarded = passengers.filter(
    (person: { checkin_state?: string | null }) =>
      person.checkin_state === "boarded",
  ).length;
  const noShow = passengers.filter(
    (person: { checkin_state?: string | null }) =>
      person.checkin_state === "no_show",
  ).length;
  return {
    id: trip.id,
    starts_at: trip.starts_at,
    local_date: trip.local_date,
    product_name: trip.product_name,
    cover_path: trip.cover_path ?? null,
    assignment_roles: crew.map((row) => row.assignment_role),
    operational_status: trip.operational_status,
    trip_run_state: trip.trip_run_state,
    boarded_guests: boarded,
    no_show_guests: noShow,
    boarding_pending: Math.max(0, passengers.length - boarded - noShow),
    pickup_stops: facts.pickupStops.filter(
      (stop) => stop.departure_id === trip.id,
    ),
    pickup_exceptions: facts.pickupExceptions.filter(
      (item) => item.departure_id === trip.id,
    ),
    guests: tripGuests.map(({ departure_id: _departureId, ...guest }) => guest),
    crew,
  };
}

@Controller("crew/v1")
export class CrewController {
  constructor(private readonly service: CrewService) {}
  @Get("today") @Access("crew.trip.read") today(
    @CurrentActor() actor: Actor,
    @Query() query: unknown,
  ) {
    return this.service.today(actor, query);
  }
  @Get("board") @Access("manifest.read") board(
    @CurrentActor() actor: Actor,
    @Query() query: unknown,
  ) {
    return this.service.board(actor, query);
  }
  @Get("board/:id") @Access("manifest.read") trip(
    @CurrentActor() actor: Actor,
    @Param("id") value: string,
  ) {
    return this.service.trip(actor, parse(departureId, value));
  }
  @Post("walk-ups") @Access("bookings.write") walkUp(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.walkUp(actor, parse(keySchema, key), body);
  }
  @Post("departures/:id/operational-status")
  @Access("operations.write")
  operationalStatus(
    @CurrentActor() actor: Actor,
    @Param("id") value: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.operationalStatus(
      actor,
      parse(departureId, value),
      parse(keySchema, key),
      body,
    );
  }
  @Get("departures/:id/pickup-list") @Access("manifest.read") pickupList(
    @CurrentActor() actor: Actor,
    @Param("id") value: string,
  ) {
    return this.service.pickupList(actor, parse(departureId, value));
  }
  @Post("print-jobs") @Access("print.jobs.create") printJob(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.printJob(actor, parse(keySchema, key), body);
  }
  @Get("print-jobs/:id/pdf") @Access("print.jobs.read") async pdf(
    @CurrentActor() actor: Actor,
    @Param("id") value: string,
    @Res() response: Response,
  ) {
    const result = await this.service.pdf(actor, parse(departureId, value));
    response
      .status(200)
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
      })
      .send(result.bytes);
  }
  @Post("departures/:id/events") @Access("crew.trip.read") event(
    @CurrentActor() actor: Actor,
    @Param("id") value: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.event(
      actor,
      parse(departureId, value),
      parse(keySchema, key),
      body,
    );
  }
  @Post("bookings/:id/payments") @Access("authenticated") payment(
    @CurrentActor() actor: Actor,
    @Param("id") value: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    if (
      !actor.permissions.includes("checkin.write") &&
      !actor.permissions.includes("payment.write")
    )
      throw new ForbiddenException();
    return this.service.payment(
      actor,
      parse(departureId, value),
      parse(keySchema, key),
      body,
    );
  }
}
