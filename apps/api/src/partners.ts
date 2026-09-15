import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";

// ─── Schemas ────────────────────────────────────────────────────────────────

const partnerSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    email: z.string().email().max(254).optional(),
    phone: z.string().trim().max(40).optional(),
    notes: z.string().trim().max(2000).default(""),
  })
  .strict();

const partnerUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    email: z.string().email().max(254).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be supplied",
  });

const claimSchema = z
  .object({
    bookingId: z.string().uuid(),
    partnerId: z.string().uuid(),
    amountMinor: z.number().int().min(1).max(1_000_000_000_000),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/),
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

// Commission config — extends partner_organizations with type/rate/direction
const commissionSchema = z
  .object({
    partner_type: z
      .enum(["ota", "reseller", "affiliate", "wholesale"])
      .optional(),
    commission_type: z.enum([
      "percentage",
      "flat_per_booking",
      "flat_per_pax",
      "net_rate",
    ]),
    commission_rate: z.number().min(0).max(1).optional().nullable(), // 0.20 = 20%
    commission_amount_minor: z.number().int().min(0).optional().nullable(), // in minor units
    commission_direction: z.enum([
      "partner_owes_tenant",
      "tenant_owes_partner",
    ]),
    commission_currency: z.string().length(3).default("XCD"),
    settlement_schedule: z
      .enum([
        "weekly",
        "biweekly",
        "monthly",
        "per_booking",
        "custom",
        "manual",
      ])
      .default("manual"),
    // Unit depends on the schedule: day of month (1-31) for monthly,
    // ISO day of week (1=Mon..7=Sun) for weekly/biweekly, NULL otherwise.
    settlement_day: z.number().int().min(1).max(31).optional().nullable(),
    payment_terms_days: z.number().int().min(0).max(365).default(30),
    requires_formal_invoice: z.boolean().default(false),
    contract_ref: z.string().trim().max(200).optional().nullable(),
  })
  .strict()
  .refine(
    (d) => {
      if (d.commission_type === "percentage") return d.commission_rate != null;
      if (
        d.commission_type === "flat_per_booking" ||
        d.commission_type === "flat_per_pax"
      )
        return d.commission_amount_minor != null;
      return true; // net_rate: neither required
    },
    {
      message:
        "commission_rate required for percentage; commission_amount_minor required for flat types",
    },
  )
  .refine(
    (d) => {
      if (d.settlement_day == null) return true;
      if (d.settlement_schedule === "monthly") return d.settlement_day <= 31;
      if (
        d.settlement_schedule === "weekly" ||
        d.settlement_schedule === "biweekly"
      )
        return d.settlement_day <= 7;
      return false;
    },
    {
      message:
        "settlement_day must be 1-31 for monthly, 1-7 for weekly/biweekly, and unset otherwise",
    },
  );

const bookingLinkSchema = z
  .object({
    booking_id: z.string().uuid(),
    gross_amount_minor: z.number().int().min(0),
    pax_count: z.number().int().min(1).default(1),
    source: z.enum(["manual", "import", "ota_webhook"]).default("manual"),
    external_ref: z.string().trim().max(200).optional().nullable(),
  })
  .strict();

const settlementGenerateSchema = z
  .object({
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()
  .refine((d) => d.period_start <= d.period_end, {
    message: "period_start must be <= period_end",
  });

const settlementAdvanceSchema = z
  .object({
    status: z.enum(["invoiced", "sent", "paid", "overdue", "void"]),
    payment_ref: z.string().trim().max(400).optional().nullable(),
    invoice_number: z.string().trim().max(100).optional().nullable(),
    invoice_pdf_path: z.string().trim().max(1000).optional().nullable(),
    void_reason: z.string().trim().max(1000).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .strict();

// ─── Helper ──────────────────────────────────────────────────────────────────

function integer(value: string, message: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new ConflictException(message);
  return parsed;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PartnerService {
  constructor(private readonly db: Database) {}

  // ── Existing methods (unchanged) ─────────────────────────────────────────

  list(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            `SELECT id, name, email, phone, status, notes,
                    partner_type, commission_type, commission_rate,
                    commission_amount_minor::text, commission_direction,
                    commission_currency, settlement_schedule, settlement_day,
                    payment_terms_days, requires_formal_invoice, contract_ref,
                    created_at
             FROM partner_organizations
             WHERE tenant_id=$1
             ORDER BY status, name, id`,
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

  update(actor: Actor, partnerId: string, key: string, raw: unknown) {
    const input = parse(partnerUpdateSchema, raw);
    return this.db.command(
      actor,
      `partner.update:${partnerId}`,
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
          `UPDATE partner_organizations SET
           name  = COALESCE($3, name),
           email = CASE WHEN $4::boolean THEN $5 ELSE email END,
           phone = CASE WHEN $6::boolean THEN $7 ELSE phone END,
           notes = COALESCE($8, notes)
         WHERE tenant_id=$1 AND id=$2
         RETURNING id,name,email,phone,status,notes,created_at`,
          [
            actor.tenantId,
            partnerId,
            input.name ?? null,
            "email" in input,
            input.email ?? null,
            "phone" in input,
            input.phone ?? null,
            input.notes ?? null,
          ],
        );
        await record(tx, actor, "partner.updated", partnerId, before, after);
        return after;
      },
    );
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
        await record(
          tx,
          actor,
          "partner.status_changed",
          partnerId,
          before,
          after,
        );
        return after;
      },
    );
  }

  claim(actor: Actor, key: string, raw: unknown) {
    const input = parse(claimSchema, raw);
    return this.db.command(
      actor,
      "partner.claim.create",
      key,
      input,
      async (tx) => {
        const { rows: snapshots } = await tx.query(
          `SELECT booking_id,partner_id,collection_mode,total_minor::text,currency
         FROM booking_partner_snapshots
         WHERE tenant_id=$1 AND booking_id=$2
         ORDER BY booking_version DESC LIMIT 1`,
          [actor.tenantId, input.bookingId],
        );
        const snapshot = snapshots[0];
        if (!snapshot)
          throw new ConflictException("Booking has no confirmed partner terms");
        if (snapshot.partner_id !== input.partnerId)
          throw new NotFoundException(
            "Partner is not assigned to this booking",
          );
        if (snapshot.collection_mode !== "partner_collects_for_tenant")
          throw new ConflictException(
            "This booking does not permit partner collection claims",
          );
        if (snapshot.currency !== input.currency)
          throw new ConflictException(
            "Cross-currency partner claims are not enabled",
          );
        const { rows: totals } = await tx.query(
          `SELECT
           COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.tenant_id=$1 AND p.booking_id=$2 AND p.status='settled' AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)::text AS guest_paid,
           COALESCE((SELECT SUM(c.amount_minor)
             FROM partner_collection_claims c
             JOIN partner_claim_decisions d ON d.tenant_id=c.tenant_id AND d.claim_id=c.id AND d.decision='accepted'
             WHERE c.tenant_id=$1 AND c.booking_id=$2),0)::text AS accepted_credit`,
          [actor.tenantId, input.bookingId],
        );
        const total = integer(
          snapshot.total_minor,
          "Booking total outside supported range",
        );
        const guestPaid = integer(
          totals[0].guest_paid,
          "Guest payment total outside supported range",
        );
        const acceptedCredit = integer(
          totals[0].accepted_credit,
          "Partner credit total outside supported range",
        );
        if (input.amountMinor > total - guestPaid - acceptedCredit)
          throw new ConflictException(
            "Partner claim exceeds remaining guest balance",
          );
        const result = {
          id: randomUUID(),
          ...input,
          state: "unverified" as const,
        };
        await tx.query(
          `INSERT INTO partner_collection_claims(tenant_id,id,booking_id,partner_id,amount_minor,currency,reference,notes,recorded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            actor.tenantId,
            result.id,
            input.bookingId,
            input.partnerId,
            input.amountMinor,
            input.currency,
            input.reference,
            input.notes,
            actor.actorId,
          ],
        );
        await record(
          tx,
          actor,
          "partner.claim.recorded",
          result.id,
          null,
          result,
        );
        return result;
      },
    );
  }

  decide(actor: Actor, claimId: string, key: string, raw: unknown) {
    const input = parse(decisionSchema, raw);
    return this.db.command(
      actor,
      `partner.claim.decision:${claimId}`,
      key,
      input,
      async (tx) => {
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
        if (prior.rowCount)
          throw new ConflictException("Partner claim has already been decided");
        if (input.decision === "accepted") {
          if (claim.collection_mode !== "partner_collects_for_tenant")
            throw new ConflictException(
              "This claim cannot be accepted for the booking collection mode",
            );
          if (claim.currency !== claim.snapshot_currency)
            throw new ConflictException(
              "Cross-currency partner claims are not enabled",
            );
          const { rows: totals } = await tx.query(
            `SELECT
             COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.tenant_id=$1 AND p.booking_id=$2 AND p.status='settled' AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)::text AS guest_paid,
             COALESCE((SELECT SUM(c.amount_minor)
               FROM partner_collection_claims c
               JOIN partner_claim_decisions d ON d.tenant_id=c.tenant_id AND d.claim_id=c.id AND d.decision='accepted'
               WHERE c.tenant_id=$1 AND c.booking_id=$2),0)::text AS accepted_credit`,
            [actor.tenantId, claim.booking_id],
          );
          const remaining =
            integer(
              claim.total_minor,
              "Booking total outside supported range",
            ) -
            integer(
              totals[0].guest_paid,
              "Guest payment total outside supported range",
            ) -
            integer(
              totals[0].accepted_credit,
              "Partner credit total outside supported range",
            );
          if (
            integer(
              claim.amount_minor,
              "Claim amount outside supported range",
            ) > remaining
          )
            throw new ConflictException(
              "Partner claim exceeds remaining guest balance",
            );
        }
        const result = { id: randomUUID(), claimId, ...input };
        await tx.query(
          "INSERT INTO partner_claim_decisions(tenant_id,id,claim_id,decision,reason,decided_by) VALUES($1,$2,$3,$4,$5,$6)",
          [
            actor.tenantId,
            result.id,
            claimId,
            input.decision,
            input.reason,
            actor.actorId,
          ],
        );
        if (input.decision === "accepted") {
          const obligationId = randomUUID();
          await tx.query(
            "INSERT INTO partner_obligations(tenant_id,id,booking_id,partner_id,claim_id,amount_minor,currency,kind) VALUES($1,$2,$3,$4,$5,$6,$7,'partner_collection')",
            [
              actor.tenantId,
              obligationId,
              claim.booking_id,
              claim.partner_id,
              claimId,
              claim.amount_minor,
              claim.currency,
            ],
          );
          Object.assign(result, { obligationId });
          await record(
            tx,
            actor,
            "partner.obligation.created",
            obligationId,
            null,
            { ...result, bookingId: claim.booking_id },
          );
        }
        await record(
          tx,
          actor,
          "partner.claim.decided",
          claimId,
          { state: "unverified" },
          result,
          input.reason,
        );
        return result;
      },
    );
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
      if (!row)
        throw new NotFoundException("Booking has no confirmed partner terms");
      const totalMinor = integer(
        row.total_minor,
        "Booking total outside supported range",
      );
      const guestPaidMinor = integer(
        row.guest_paid,
        "Guest payment total outside supported range",
      );
      const partnerCreditMinor = integer(
        row.partner_credit,
        "Partner credit total outside supported range",
      );
      return {
        bookingId,
        partnerId: row.partner_id,
        collectionMode: row.collection_mode,
        currency: row.currency,
        totalMinor,
        guestPaidMinor,
        partnerCreditMinor,
        guestBalanceMinor: Math.max(
          0,
          totalMinor - guestPaidMinor - partnerCreditMinor,
        ),
        partnerObligationMinor: integer(
          row.partner_obligation,
          "Partner obligation total outside supported range",
        ),
      };
    });
  }

  statements(actor: Actor, partnerId?: string) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            `SELECT o.id,o.booking_id,o.partner_id,p.name AS partner_name,o.amount_minor::text,o.currency,o.kind,o.created_at
             FROM partner_obligations o JOIN partner_organizations p ON p.tenant_id=o.tenant_id AND p.id=o.partner_id
             WHERE o.tenant_id=$1 AND ($2::uuid IS NULL OR o.partner_id=$2)
             ORDER BY o.created_at DESC,o.id DESC`,
            [actor.tenantId, partnerId ?? null],
          )
        ).rows,
    );
  }

  claims(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            `SELECT c.id,c.booking_id,c.partner_id,p.name AS partner_name,c.amount_minor::text,c.currency,c.reference,c.notes,c.recorded_at,
              d.decision,d.reason AS decision_reason,d.decided_at
             FROM partner_collection_claims c
             JOIN partner_organizations p ON p.tenant_id=c.tenant_id AND p.id=c.partner_id
             LEFT JOIN partner_claim_decisions d ON d.tenant_id=c.tenant_id AND d.claim_id=c.id
             WHERE c.tenant_id=$1 ORDER BY (d.id IS NULL) DESC,c.recorded_at DESC,c.id DESC`,
            [actor.tenantId],
          )
        ).rows,
    );
  }

  // ── Commission & Settlement methods (new) ────────────────────────────────

  configureCommission(
    actor: Actor,
    partnerId: string,
    key: string,
    raw: unknown,
  ) {
    const input = parse(commissionSchema, raw);
    return this.db.command(
      actor,
      `partner.commission:${partnerId}`,
      key,
      input,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          `SELECT partner_type,commission_type,commission_rate,commission_amount_minor::text,
                commission_direction,commission_currency,settlement_schedule,settlement_day,
                payment_terms_days,requires_formal_invoice,contract_ref
         FROM partner_organizations WHERE tenant_id=$1 AND id=$2`,
          [actor.tenantId, partnerId],
        );
        if (!before) throw new NotFoundException("Partner not found");
        const {
          rows: [after],
        } = await tx.query(
          `UPDATE partner_organizations SET
           partner_type=$3, commission_type=$4, commission_rate=$5,
           commission_amount_minor=$6, commission_direction=$7, commission_currency=$8,
           settlement_schedule=$9, settlement_day=$10, payment_terms_days=$11,
           requires_formal_invoice=$12, contract_ref=$13
         WHERE tenant_id=$1 AND id=$2
         RETURNING id, name, partner_type, commission_type, commission_rate,
                   commission_amount_minor::text, commission_direction, commission_currency,
                   settlement_schedule, settlement_day, payment_terms_days,
                   requires_formal_invoice, contract_ref`,
          [
            actor.tenantId,
            partnerId,
            input.partner_type ?? null,
            input.commission_type,
            input.commission_rate ?? null,
            input.commission_amount_minor ?? null,
            input.commission_direction,
            input.commission_currency,
            input.settlement_schedule,
            input.settlement_day ?? null,
            input.payment_terms_days,
            input.requires_formal_invoice,
            input.contract_ref ?? null,
          ],
        );
        await record(
          tx,
          actor,
          "partner.commission.configured",
          partnerId,
          before,
          after,
        );
        return after;
      },
    );
  }

  linkBooking(actor: Actor, partnerId: string, key: string, raw: unknown) {
    const input = parse(bookingLinkSchema, raw);
    return this.db.command(
      actor,
      `partner.booking.link:${partnerId}:${input.booking_id}`,
      key,
      input,
      async (tx) => {
        const {
          rows: [partner],
        } = await tx.query(
          "SELECT commission_direction FROM partner_organizations WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, partnerId],
        );
        if (!partner) throw new NotFoundException("Partner not found");
        if (!partner.commission_direction)
          throw new ConflictException("Partner commission not configured");
        const {
          rows: [link],
        } = await tx.query(
          `SELECT * FROM link_booking_to_partner($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            actor.tenantId,
            partnerId,
            input.booking_id,
            input.gross_amount_minor,
            input.pax_count,
            input.source,
            input.external_ref ?? null,
            actor.actorId,
          ],
        );
        await record(
          tx,
          actor,
          "partner.booking.linked",
          partnerId,
          null,
          link,
        );
        return link;
      },
    );
  }

  unlinkBooking(
    actor: Actor,
    partnerId: string,
    linkId: string,
    key: string,
    reason?: string,
  ) {
    return this.db.command(
      actor,
      `partner.booking.unlink:${linkId}`,
      key,
      { linkId, reason },
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT * FROM partner_booking_links WHERE id=$1 AND partner_id=$2 AND tenant_id=$3 AND unlinked_at IS NULL FOR UPDATE",
          [linkId, partnerId, actor.tenantId],
        );
        if (!before)
          throw new NotFoundException("Link not found or already unlinked");
        if (before.settlement_id)
          throw new ConflictException(
            "Cannot unlink a booking already included in a settlement",
          );
        const {
          rows: [after],
        } = await tx.query(
          `UPDATE partner_booking_links
         SET unlinked_at=clock_timestamp(), unlinked_by=$4, unlink_reason=$5
         WHERE id=$1 AND partner_id=$2 AND tenant_id=$3
         RETURNING *`,
          [linkId, partnerId, actor.tenantId, actor.actorId, reason ?? null],
        );
        await record(
          tx,
          actor,
          "partner.booking.unlinked",
          partnerId,
          before,
          after,
          reason,
        );
        return after;
      },
    );
  }

  listUnsettledBookings(actor: Actor, partnerId: string) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [exists],
      } = await tx.query(
        "SELECT id FROM partner_organizations WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, partnerId],
      );
      if (!exists) throw new NotFoundException("Partner not found");
      return (
        await tx.query(
          `SELECT pbl.id, pbl.booking_id, pbl.gross_amount_minor::text, pbl.pax_count,
                  pbl.commission_type, pbl.commission_rate, pbl.commission_amount_minor::text,
                  pbl.commission_direction, pbl.currency, pbl.source, pbl.external_ref, pbl.created_at,
                  b.id AS reference, d.starts_at, b.state AS booking_status,
                  COALESCE(c.name, b.lead_name) AS customer_name
           FROM partner_booking_links pbl
           JOIN bookings b ON b.tenant_id = pbl.tenant_id AND b.id = pbl.booking_id
           JOIN departures d ON d.tenant_id = b.tenant_id AND d.id = b.departure_id
           LEFT JOIN customers c ON c.tenant_id = b.tenant_id AND c.id = b.customer_id
           WHERE pbl.tenant_id=$1 AND pbl.partner_id=$2
             AND pbl.settlement_id IS NULL AND pbl.unlinked_at IS NULL
           ORDER BY d.starts_at DESC`,
          [actor.tenantId, partnerId],
        )
      ).rows;
    });
  }

  generateSettlement(
    actor: Actor,
    partnerId: string,
    key: string,
    raw: unknown,
  ) {
    const input = parse(settlementGenerateSchema, raw);
    return this.db.command(
      actor,
      `partner.settlement.generate:${partnerId}:${input.period_start}:${input.period_end}`,
      key,
      input,
      async (tx) => {
        const {
          rows: [settlement],
        } = await tx.query(
          `SELECT * FROM generate_partner_settlement($1,$2,$3,$4,$5)`,
          [
            actor.tenantId,
            partnerId,
            input.period_start,
            input.period_end,
            actor.actorId,
          ],
        );
        if (!settlement)
          throw new ConflictException(
            "No unsettled bookings in the selected period",
          );
        await record(
          tx,
          actor,
          "partner.settlement.generated",
          partnerId,
          null,
          settlement,
        );
        return settlement;
      },
    );
  }

  listSettlements(actor: Actor, partnerId: string) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [exists],
      } = await tx.query(
        "SELECT id FROM partner_organizations WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, partnerId],
      );
      if (!exists) throw new NotFoundException("Partner not found");
      return (
        await tx.query(
          `SELECT ps.id, ps.period_start, ps.period_end, ps.booking_count,
                  ps.gross_amount_minor::text, ps.commission_amount_minor::text,
                  ps.net_amount_minor::text, ps.commission_direction, ps.currency,
                  ps.status, ps.due_date, ps.invoice_number, ps.payment_ref,
                  ps.paid_at, ps.voided_at, ps.notes, ps.created_at,
                  po.name AS partner_name, po.partner_type
           FROM partner_settlements ps
           JOIN partner_organizations po
             ON po.tenant_id = ps.tenant_id AND po.id = ps.partner_id
           WHERE ps.tenant_id=$1 AND ps.partner_id=$2
           ORDER BY ps.created_at DESC`,
          [actor.tenantId, partnerId],
        )
      ).rows;
    });
  }

  getSettlement(actor: Actor, partnerId: string, settlementId: string) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [settlement],
      } = await tx.query(
        `SELECT ps.*, po.name AS partner_name, po.partner_type, po.requires_formal_invoice
         FROM partner_settlements ps
         JOIN partner_organizations po
           ON po.tenant_id = ps.tenant_id AND po.id = ps.partner_id
         WHERE ps.id=$1 AND ps.partner_id=$2 AND ps.tenant_id=$3`,
        [settlementId, partnerId, actor.tenantId],
      );
      if (!settlement) throw new NotFoundException("Settlement not found");
      const { rows: bookings } = await tx.query(
        `SELECT pbl.id, pbl.booking_id, pbl.gross_amount_minor::text, pbl.pax_count,
                pbl.commission_type, pbl.commission_amount_minor::text, pbl.currency,
                b.id AS reference, d.starts_at,
                COALESCE(c.name, b.lead_name) AS customer_name
         FROM partner_booking_links pbl
         JOIN bookings b ON b.tenant_id = pbl.tenant_id AND b.id = pbl.booking_id
         JOIN departures d ON d.tenant_id = b.tenant_id AND d.id = b.departure_id
         LEFT JOIN customers c ON c.tenant_id = b.tenant_id AND c.id = b.customer_id
         WHERE pbl.settlement_id=$1 AND pbl.tenant_id=$2
         ORDER BY d.starts_at`,
        [settlementId, actor.tenantId],
      );
      return { ...settlement, bookings };
    });
  }

  advanceSettlement(
    actor: Actor,
    partnerId: string,
    settlementId: string,
    key: string,
    raw: unknown,
  ) {
    const input = parse(settlementAdvanceSchema, raw);
    return this.db.command(
      actor,
      `partner.settlement.advance:${settlementId}:${input.status}`,
      key,
      input,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT * FROM partner_settlements WHERE id=$1 AND partner_id=$2 AND tenant_id=$3 FOR UPDATE",
          [settlementId, partnerId, actor.tenantId],
        );
        if (!before) throw new NotFoundException("Settlement not found");
        const {
          rows: [result],
        } = await tx.query(
          `SELECT * FROM advance_settlement_status($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            actor.tenantId,
            settlementId,
            input.status,
            input.payment_ref ?? null,
            input.invoice_number ?? null,
            input.invoice_pdf_path ?? null,
            input.void_reason ?? null,
            input.notes ?? null,
          ],
        );
        await record(
          tx,
          actor,
          `partner.settlement.${input.status}`,
          settlementId,
          before,
          result,
        );
        return result;
      },
    );
  }

  partnerFinanceSummary(actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [receivable],
      } = await tx.query(
        `SELECT COALESCE(SUM(pbl.commission_amount_minor),0)::text AS total_minor, COUNT(*)::text AS cnt
         FROM partner_booking_links pbl
         JOIN partner_organizations po
           ON po.tenant_id = pbl.tenant_id AND po.id = pbl.partner_id
         WHERE pbl.tenant_id=$1 AND pbl.settlement_id IS NULL AND pbl.unlinked_at IS NULL
           AND po.commission_direction='partner_owes_tenant'`,
        [actor.tenantId],
      );
      const {
        rows: [payable],
      } = await tx.query(
        `SELECT COALESCE(SUM(pbl.commission_amount_minor),0)::text AS total_minor, COUNT(*)::text AS cnt
         FROM partner_booking_links pbl
         JOIN partner_organizations po
           ON po.tenant_id = pbl.tenant_id AND po.id = pbl.partner_id
         WHERE pbl.tenant_id=$1 AND pbl.settlement_id IS NULL AND pbl.unlinked_at IS NULL
           AND po.commission_direction='tenant_owes_partner'`,
        [actor.tenantId],
      );
      const {
        rows: [overdue],
      } = await tx.query(
        `SELECT COUNT(*)::text AS cnt, COALESCE(SUM(net_amount_minor),0)::text AS total_minor
         FROM partner_settlements
         WHERE tenant_id=$1 AND status NOT IN ('paid','void') AND due_date < CURRENT_DATE`,
        [actor.tenantId],
      );
      const { rows: byPartner } = await tx.query(
        `SELECT po.id, po.name, po.partner_type, po.commission_direction,
                po.commission_currency AS currency,
                COUNT(pbl.id)::text AS unsettled_count,
                COALESCE(SUM(pbl.gross_amount_minor),0)::text AS gross_minor,
                COALESCE(SUM(pbl.commission_amount_minor),0)::text AS commission_minor
         FROM partner_organizations po
         LEFT JOIN partner_booking_links pbl
           ON pbl.tenant_id=po.tenant_id AND pbl.partner_id=po.id
          AND pbl.settlement_id IS NULL AND pbl.unlinked_at IS NULL
         WHERE po.tenant_id=$1 AND po.commission_direction IS NOT NULL
         GROUP BY po.tenant_id,po.id,po.name,po.partner_type,po.commission_direction,po.commission_currency
         ORDER BY SUM(pbl.commission_amount_minor) DESC NULLS LAST`,
        [actor.tenantId],
      );
      return {
        receivable_minor: integer(
          receivable.total_minor,
          "receivable total overflow",
        ),
        receivable_count: integer(receivable.cnt, "receivable count overflow"),
        payable_minor: integer(payable.total_minor, "payable total overflow"),
        payable_count: integer(payable.cnt, "payable count overflow"),
        overdue_count: integer(overdue.cnt, "overdue count overflow"),
        overdue_minor: integer(overdue.total_minor, "overdue total overflow"),
        by_partner: byPartner,
      };
    });
  }
}

// ─── Controller ──────────────────────────────────────────────────────────────

@Controller("finance/v1")
export class PartnerController {
  constructor(private readonly service: PartnerService) {}

  // ── Partner management ───────────────────────────────────────────────────

  @Get("partners")
  @Access("partner.manage")
  list(@CurrentActor() actor: Actor) {
    return this.service.list(actor);
  }

  @Get("partners/available")
  @Access("bookings.write")
  available(@CurrentActor() actor: Actor) {
    return this.service.available(actor);
  }

  @Post("partners")
  @Access("partner.manage")
  create(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.create(actor, parse(keySchema, key), body);
  }

  @Patch("partners/:id")
  @Access("partner.manage")
  update(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.update(
      actor,
      parse(z.string().uuid(), id),
      parse(keySchema, key),
      body,
    );
  }

  @Post("partners/:id/status")
  @Access("partner.manage")
  setStatus(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.setStatus(
      actor,
      parse(z.string().uuid(), id),
      parse(keySchema, key),
      body,
    );
  }

  // ── Commission config ────────────────────────────────────────────────────

  @Patch("partners/:id/commission")
  @Access("partner.manage")
  configureCommission(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.configureCommission(
      actor,
      parse(z.string().uuid(), id),
      parse(keySchema, key),
      body,
    );
  }

  // ── Booking attribution ──────────────────────────────────────────────────

  @Get("partners/:id/bookings/unsettled")
  @Access("partner.statement.read")
  listUnsettledBookings(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.service.listUnsettledBookings(
      actor,
      parse(z.string().uuid(), id),
    );
  }

  @Post("partners/:id/bookings")
  @Access("partner.manage")
  linkBooking(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.linkBooking(
      actor,
      parse(z.string().uuid(), id),
      parse(keySchema, key),
      body,
    );
  }

  @Delete("partners/:id/bookings/:linkId")
  @Access("partner.manage")
  unlinkBooking(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Param("linkId") linkId: string,
    @Headers("idempotency-key") key: string,
    @Body("reason") reason?: string,
  ) {
    return this.service.unlinkBooking(
      actor,
      parse(z.string().uuid(), id),
      parse(z.string().uuid(), linkId),
      parse(keySchema, key),
      reason,
    );
  }

  // ── Settlements ──────────────────────────────────────────────────────────

  @Get("partners/:id/settlements")
  @Access("partner.statement.read")
  listSettlements(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.service.listSettlements(actor, parse(z.string().uuid(), id));
  }

  @Post("partners/:id/settlements")
  @Access("partner.manage")
  generateSettlement(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.generateSettlement(
      actor,
      parse(z.string().uuid(), id),
      parse(keySchema, key),
      body,
    );
  }

  @Get("partners/:id/settlements/:sid")
  @Access("partner.statement.read")
  getSettlement(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Param("sid") sid: string,
  ) {
    return this.service.getSettlement(
      actor,
      parse(z.string().uuid(), id),
      parse(z.string().uuid(), sid),
    );
  }

  @Patch("partners/:id/settlements/:sid")
  @Access("partner.manage")
  advanceSettlement(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Param("sid") sid: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.advanceSettlement(
      actor,
      parse(z.string().uuid(), id),
      parse(z.string().uuid(), sid),
      parse(keySchema, key),
      body,
    );
  }

  // ── Finance summary ──────────────────────────────────────────────────────

  @Get("partner-finance-summary")
  @Access("partner.statement.read")
  partnerFinanceSummary(@CurrentActor() actor: Actor) {
    return this.service.partnerFinanceSummary(actor);
  }

  // ── Existing claim routes ────────────────────────────────────────────────

  @Post("partner-claims")
  @Access("partner.collection.record")
  claim(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.claim(actor, parse(keySchema, key), body);
  }

  @Get("partner-claims")
  @Access("partner.collection.verify")
  claims(@CurrentActor() actor: Actor) {
    return this.service.claims(actor);
  }

  @Post("partner-claims/:id/decision")
  @Access("partner.collection.verify")
  decide(
    @CurrentActor() actor: Actor,
    @Param("id") claimId: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.decide(
      actor,
      parse(z.string().uuid(), claimId),
      parse(keySchema, key),
      body,
    );
  }

  @Get("bookings/:id/finance-summary")
  @Access("bookings.read")
  summary(@CurrentActor() actor: Actor, @Param("id") bookingId: string) {
    return this.service.summary(actor, parse(z.string().uuid(), bookingId));
  }

  @Get("partner-statements")
  @Access("partner.statement.read")
  statements(
    @CurrentActor() actor: Actor,
    @Query("partnerId") partnerId?: string,
  ) {
    return this.service.statements(
      actor,
      partnerId ? parse(z.string().uuid(), partnerId) : undefined,
    );
  }
}
