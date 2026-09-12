import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";

const partnerSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    email: z.string().email().max(254).optional(),
    phone: z.string().trim().max(40).optional(),
    notes: z.string().trim().max(2000).default(""),
  })
  .strict();
const claimSchema = z
  .object({
    bookingId: z.string().uuid(),
    partnerId: z.string().uuid(),
    amountMinor: z.number().int().min(1).max(1_000_000_000_000),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    reference: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(2000).default(""),
  })
  .strict();
const decisionSchema = z
  .object({
    decision: z.enum(["accepted", "rejected"]),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

function integer(value: string, message: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new ConflictException(message);
  return parsed;
}
@Injectable()
export class PartnerService {
  constructor(private readonly db: Database) {}
  list(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            "SELECT id,name,email,phone,status,notes,created_at FROM partner_organizations WHERE tenant_id=$1 ORDER BY status,name,id",
            [actor.tenantId],
          )
        ).rows,
    );
  }
  available(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            "SELECT id,name FROM partner_organizations WHERE tenant_id=$1 AND status='active' ORDER BY name,id",
            [actor.tenantId],
          )
        ).rows,
    );
  }
  create(actor: Actor, key: string, raw: unknown) {
    const input = parse(partnerSchema, raw);
    return this.db.command(actor, "partner.create", key, input, async (tx) => {
      const result = { id: randomUUID(), ...input, status: "active" };
      await tx.query(
        "INSERT INTO partner_organizations(tenant_id,id,name,email,phone,notes) VALUES($1,$2,$3,$4,$5,$6)",
        [
          actor.tenantId,
          result.id,
          result.name,
          result.email ?? null,
          result.phone ?? null,
          result.notes,
        ],
      );
      await record(tx, actor, "partner.created", result.id, null, result);
      return result;
    });
  }
  setStatus(actor: Actor, partnerId: string, key: string, raw: unknown) {
    const input = parse(
      z.object({ status: z.enum(["active", "inactive"]) }).strict(),
      raw,
    );
    return this.db.command(
      actor,
      `partner.status:${partnerId}`,
      key,
      input,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT id,name,email,phone,status,notes,created_at FROM partner_organizations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [actor.tenantId, partnerId],
        );
        if (!before) throw new NotFoundException("Partner not found");
        const {
          rows: [after],
        } = await tx.query(
          `UPDATE partner_organizations SET status=$3
           WHERE tenant_id=$1 AND id=$2
           RETURNING id,name,email,phone,status,notes,created_at`,
          [actor.tenantId, partnerId, input.status],
        );
        await record(tx, actor, "partner.status_changed", partnerId, before, after);
        return after;
      },
    );
  }
  claim(actor: Actor, key: string, raw: unknown) {
    const input = parse(claimSchema, raw);
    return this.db.command(actor, "partner.claim.create", key, input, async (tx) => {
      const { rows: snapshots } = await tx.query(
        `SELECT booking_id,partner_id,collection_mode,total_minor::text,currency
         FROM booking_partner_snapshots
         WHERE tenant_id=$1 AND booking_id=$2
         ORDER BY booking_version DESC LIMIT 1`,
        [actor.tenantId, input.bookingId],
      );
      const snapshot = snapshots[0];
      if (!snapshot) throw new ConflictException("Booking has no confirmed partner terms");
      if (snapshot.partner_id !== input.partnerId)
        throw new NotFoundException("Partner is not assigned to this booking");
      if (snapshot.collection_mode !== "partner_collects_for_tenant")
        throw new ConflictException("This booking does not permit partner collection claims");
      if (snapshot.currency !== input.currency)
        throw new ConflictException("Cross-currency partner claims are not enabled");
      const { rows: totals } = await tx.query(
        `SELECT
           COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.tenant_id=$1 AND p.booking_id=$2 AND p.status='settled' AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)::text AS guest_paid,
           COALESCE((SELECT SUM(c.amount_minor)
             FROM partner_collection_claims c
             JOIN partner_claim_decisions d ON d.tenant_id=c.tenant_id AND d.claim_id=c.id AND d.decision='accepted'
             WHERE c.tenant_id=$1 AND c.booking_id=$2),0)::text AS accepted_credit`,
        [actor.tenantId, input.bookingId],
      );
      const total = integer(snapshot.total_minor, "Booking total outside supported range");
      const guestPaid = integer(totals[0].guest_paid, "Guest payment total outside supported range");
      const acceptedCredit = integer(totals[0].accepted_credit, "Partner credit total outside supported range");
      if (input.amountMinor > total - guestPaid - acceptedCredit)
        throw new ConflictException("Partner claim exceeds remaining guest balance");
      const result = { id: randomUUID(), ...input, state: "unverified" as const };
      await tx.query(
        `INSERT INTO partner_collection_claims(tenant_id,id,booking_id,partner_id,amount_minor,currency,reference,notes,recorded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [actor.tenantId, result.id, input.bookingId, input.partnerId, input.amountMinor, input.currency, input.reference, input.notes, actor.actorId],
      );
      await record(tx, actor, "partner.claim.recorded", result.id, null, result);
      return result;
    });
  }
  decide(actor: Actor, claimId: string, key: string, raw: unknown) {
    const input = parse(decisionSchema, raw);
    return this.db.command(actor, `partner.claim.decision:${claimId}`, key, input, async (tx) => {
      const { rows: claims } = await tx.query(
        `SELECT c.id,c.booking_id,c.partner_id,c.amount_minor::text,c.currency,s.collection_mode,s.total_minor::text,s.currency AS snapshot_currency
         FROM partner_collection_claims c
         JOIN booking_partner_snapshots s ON s.tenant_id=c.tenant_id AND s.booking_id=c.booking_id AND s.partner_id=c.partner_id
         WHERE c.tenant_id=$1 AND c.id=$2
         ORDER BY s.booking_version DESC LIMIT 1 FOR UPDATE OF c`,
        [actor.tenantId, claimId],
      );
      const claim = claims[0];
      if (!claim) throw new NotFoundException("Partner claim not found");
      const prior = await tx.query(
        "SELECT id FROM partner_claim_decisions WHERE tenant_id=$1 AND claim_id=$2",
        [actor.tenantId, claimId],
      );
      if (prior.rowCount) throw new ConflictException("Partner claim has already been decided");
      if (input.decision === "accepted") {
        if (claim.collection_mode !== "partner_collects_for_tenant")
          throw new ConflictException("This claim cannot be accepted for the booking collection mode");
        if (claim.currency !== claim.snapshot_currency)
          throw new ConflictException("Cross-currency partner claims are not enabled");
        const { rows: totals } = await tx.query(
          `SELECT
             COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.tenant_id=$1 AND p.booking_id=$2 AND p.status='settled' AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)::text AS guest_paid,
             COALESCE((SELECT SUM(c.amount_minor)
               FROM partner_collection_claims c
               JOIN partner_claim_decisions d ON d.tenant_id=c.tenant_id AND d.claim_id=c.id AND d.decision='accepted'
               WHERE c.tenant_id=$1 AND c.booking_id=$2),0)::text AS accepted_credit`,
          [actor.tenantId, claim.booking_id],
        );
        const remaining = integer(claim.total_minor, "Booking total outside supported range") -
          integer(totals[0].guest_paid, "Guest payment total outside supported range") -
          integer(totals[0].accepted_credit, "Partner credit total outside supported range");
        if (integer(claim.amount_minor, "Claim amount outside supported range") > remaining)
          throw new ConflictException("Partner claim exceeds remaining guest balance");
      }
      const result = { id: randomUUID(), claimId, ...input };
      await tx.query(
        "INSERT INTO partner_claim_decisions(tenant_id,id,claim_id,decision,reason,decided_by) VALUES($1,$2,$3,$4,$5,$6)",
        [actor.tenantId, result.id, claimId, input.decision, input.reason, actor.actorId],
      );
      if (input.decision === "accepted") {
        const obligationId = randomUUID();
        await tx.query(
          "INSERT INTO partner_obligations(tenant_id,id,booking_id,partner_id,claim_id,amount_minor,currency,kind) VALUES($1,$2,$3,$4,$5,$6,$7,'partner_collection')",
          [actor.tenantId, obligationId, claim.booking_id, claim.partner_id, claimId, claim.amount_minor, claim.currency],
        );
        Object.assign(result, { obligationId });
        await record(tx, actor, "partner.obligation.created", obligationId, null, { ...result, bookingId: claim.booking_id });
      }
      await record(tx, actor, "partner.claim.decided", claimId, { state: "unverified" }, result, input.reason);
      return result;
    });
  }
  summary(actor: Actor, bookingId: string) {
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.booking_id,s.total_minor::text,s.currency,s.partner_id,s.collection_mode,
          COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.tenant_id=$1 AND p.booking_id=s.booking_id AND p.status='settled' AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)::text AS guest_paid,
          COALESCE((SELECT SUM(c.amount_minor) FROM partner_collection_claims c JOIN partner_claim_decisions d ON d.tenant_id=c.tenant_id AND d.claim_id=c.id AND d.decision='accepted' WHERE c.tenant_id=$1 AND c.booking_id=s.booking_id),0)::text AS partner_credit,
          COALESCE((SELECT SUM(amount_minor) FROM partner_obligations WHERE tenant_id=$1 AND booking_id=s.booking_id),0)::text AS partner_obligation
         FROM booking_partner_snapshots s
         WHERE s.tenant_id=$1 AND s.booking_id=$2 ORDER BY s.booking_version DESC LIMIT 1`,
        [actor.tenantId, bookingId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException("Booking has no confirmed partner terms");
      const totalMinor = integer(row.total_minor, "Booking total outside supported range");
      const guestPaidMinor = integer(row.guest_paid, "Guest payment total outside supported range");
      const partnerCreditMinor = integer(row.partner_credit, "Partner credit total outside supported range");
      return { bookingId, partnerId: row.partner_id, collectionMode: row.collection_mode, currency: row.currency, totalMinor, guestPaidMinor, partnerCreditMinor, guestBalanceMinor: Math.max(0, totalMinor - guestPaidMinor - partnerCreditMinor), partnerObligationMinor: integer(row.partner_obligation, "Partner obligation total outside supported range") };
    });
  }
  statements(actor: Actor, partnerId?: string) {
    return this.db.transaction(actor, async (tx) => (
      await tx.query(
        `SELECT o.id,o.booking_id,o.partner_id,p.name AS partner_name,o.amount_minor::text,o.currency,o.kind,o.created_at
         FROM partner_obligations o JOIN partner_organizations p ON p.tenant_id=o.tenant_id AND p.id=o.partner_id
         WHERE o.tenant_id=$1 AND ($2::uuid IS NULL OR o.partner_id=$2)
         ORDER BY o.created_at DESC,o.id DESC`,
        [actor.tenantId, partnerId ?? null],
      )
    ).rows);
  }
  claims(actor: Actor) {
    return this.db.transaction(actor, async (tx) => (
      await tx.query(
        `SELECT c.id,c.booking_id,c.partner_id,p.name AS partner_name,c.amount_minor::text,c.currency,c.reference,c.notes,c.recorded_at,
          d.decision,d.reason AS decision_reason,d.decided_at
         FROM partner_collection_claims c
         JOIN partner_organizations p ON p.tenant_id=c.tenant_id AND p.id=c.partner_id
         LEFT JOIN partner_claim_decisions d ON d.tenant_id=c.tenant_id AND d.claim_id=c.id
         WHERE c.tenant_id=$1 ORDER BY (d.id IS NULL) DESC,c.recorded_at DESC,c.id DESC`,
        [actor.tenantId],
      )
    ).rows);
  }
}
@Controller("finance/v1")
export class PartnerController {
  constructor(private readonly service: PartnerService) {}
  @Get("partners") @Access("partner.manage") list(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.list(actor);
  }
  @Get("partners/available") @Access("bookings.write") available(
    @CurrentActor() actor: Actor,
  ) { return this.service.available(actor); }
  @Post("partners") @Access("partner.manage") create(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.create(actor, parse(keySchema, key), body);
  }
  @Post("partners/:id/status") @Access("partner.manage") setStatus(
    @CurrentActor() actor: Actor,
    @Param("id") partnerId: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.setStatus(
      actor,
      parse(z.string().uuid(), partnerId),
      parse(keySchema, key),
      body,
    );
  }
  @Post("partner-claims") @Access("partner.collection.record") claim(
    @CurrentActor() actor: Actor, @Headers("idempotency-key") key: string, @Body() body: unknown,
  ) { return this.service.claim(actor, parse(keySchema, key), body); }
  @Get("partner-claims") @Access("partner.collection.verify") claims(
    @CurrentActor() actor: Actor,
  ) { return this.service.claims(actor); }
  @Post("partner-claims/:id/decision") @Access("partner.collection.verify") decide(
    @CurrentActor() actor: Actor, @Param("id") claimId: string, @Headers("idempotency-key") key: string, @Body() body: unknown,
  ) { return this.service.decide(actor, parse(z.string().uuid(), claimId), parse(keySchema, key), body); }
  @Get("bookings/:id/finance-summary") @Access("bookings.read") summary(
    @CurrentActor() actor: Actor, @Param("id") bookingId: string,
  ) { return this.service.summary(actor, parse(z.string().uuid(), bookingId)); }
  @Get("partner-statements") @Access("partner.statement.read") statements(
    @CurrentActor() actor: Actor, @Query("partnerId") partnerId?: string,
  ) { return this.service.statements(actor, partnerId ? parse(z.string().uuid(), partnerId) : undefined); }
}
