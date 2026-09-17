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

const settlementAdvanceSchema = z.object({
  status: z.enum(["invoiced", "sent", "paid", "overdue", "void"]),
  payment_ref: z.string().trim().max(400).optional().nullable(),
  payment_date: z.string().trim().optional().nullable(),
  confirmed_amount_minor: z.number().int().optional().nullable(),
  invoice_number: z.string().trim().max(100).optional().nullable(),
  invoice_pdf_path: z.string().trim().max(1000).optional().nullable(),
  void_reason: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

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

  unsettledSummary(actor: Actor, partnerId: string, from: string, to: string) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [exists],
      } = await tx.query(
        "SELECT id FROM partner_organizations WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, partnerId],
      );
      if (!exists) throw new NotFoundException("Partner not found");
      const {
        rows: [row],
      } = await tx.query(
        `SELECT COUNT(*)::int AS count,
                COALESCE(SUM(pbl.gross_amount_minor), 0)::bigint AS gross_minor,
                COALESCE(SUM(pbl.commission_amount_minor), 0)::bigint AS commission_minor,
                po.commission_direction,
                pbl.currency
         FROM partner_booking_links pbl
         JOIN partner_organizations po ON po.tenant_id=pbl.tenant_id AND po.id=pbl.partner_id
         JOIN bookings b ON b.tenant_id=pbl.tenant_id AND b.id=pbl.booking_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         WHERE pbl.tenant_id=$1 AND pbl.partner_id=$2
           AND pbl.settlement_id IS NULL AND pbl.unlinked_at IS NULL
           AND d.starts_at >= $3::date AND d.starts_at <= $4::date
         GROUP BY po.commission_direction, pbl.currency
         LIMIT 1`,
        [actor.tenantId, partnerId, from, to],
      );
      if (!row) return { count: 0, total_minor: 0, currency: "USD" };
      const total =
        row.commission_direction === "partner_owes_tenant"
          ? Number(row.gross_minor)
          : Number(row.commission_minor);
      return { count: row.count, total_minor: total, currency: row.currency };
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
        // Alias DB column names to match the frontend Settlement type
        return {
          ...settlement,
          gross_minor: Number(settlement.gross_amount_minor),
          commission_minor: Number(settlement.commission_amount_minor),
          net_minor: Number(settlement.net_amount_minor),
        };
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
                  ps.gross_amount_minor::bigint AS gross_minor, ps.commission_amount_minor::bigint AS commission_minor, ps.net_amount_minor::bigint AS net_minor, ps.commission_direction, ps.currency,
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

  deleteSettlement(
    actor: Actor,
    partnerId: string,
    settlementId: string,
    key: string,
  ) {
    return this.db.command(
      actor,
      `partner.settlement.delete:${settlementId}`,
      key,
      {},
      async (tx) => {
        const {
          rows: [settlement],
        } = await tx.query(
          `SELECT * FROM partner_settlements WHERE id=$1 AND partner_id=$2 AND tenant_id=$3 FOR UPDATE`,
          [settlementId, partnerId, actor.tenantId],
        );
        if (!settlement) throw new NotFoundException("Settlement not found");
        if (settlement.status !== "draft")
          throw new ConflictException("Only draft settlements can be deleted");
        // Unlink bookings back to unsettled
        await tx.query(
          `UPDATE partner_booking_links SET settlement_id = NULL WHERE settlement_id=$1 AND tenant_id=$2`,
          [settlementId, actor.tenantId],
        );
        await tx.query(
          `DELETE FROM partner_settlements WHERE id=$1 AND tenant_id=$2`,
          [settlementId, actor.tenantId],
        );
        await record(
          tx,
          actor,
          "partner.settlement.deleted",
          partnerId,
          settlement,
          null,
        );
        return { deleted: true };
      },
    );
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

  // ─── Finance Overview ────────────────────────────────────────────────────

  financeOverview(actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const currency =
        (
          await tx.query("SELECT base_currency FROM tenants WHERE id=$1", [
            actor.tenantId,
          ])
        ).rows[0]?.base_currency ?? "XCD";

      // Net position (reuse existing logic)
      const {
        rows: [receivable],
      } = await tx.query(
        `SELECT COALESCE(SUM(pbl.commission_amount_minor),0)::bigint AS total_minor,
                COUNT(DISTINCT pbl.partner_id)::int AS cnt
         FROM partner_booking_links pbl
         JOIN partner_organizations po ON po.tenant_id=pbl.tenant_id AND po.id=pbl.partner_id
         WHERE pbl.tenant_id=$1 AND pbl.settlement_id IS NULL AND pbl.unlinked_at IS NULL
           AND po.commission_direction='partner_owes_tenant'`,
        [actor.tenantId],
      );
      const {
        rows: [payable],
      } = await tx.query(
        `SELECT COALESCE(SUM(pbl.commission_amount_minor),0)::bigint AS total_minor,
                COUNT(DISTINCT pbl.partner_id)::int AS cnt
         FROM partner_booking_links pbl
         JOIN partner_organizations po ON po.tenant_id=pbl.tenant_id AND po.id=pbl.partner_id
         WHERE pbl.tenant_id=$1 AND pbl.settlement_id IS NULL AND pbl.unlinked_at IS NULL
           AND po.commission_direction='tenant_owes_partner'`,
        [actor.tenantId],
      );
      const {
        rows: [overdue],
      } = await tx.query(
        `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(net_amount_minor),0)::bigint AS total_minor
         FROM partner_settlements
         WHERE tenant_id=$1 AND status NOT IN ('paid','void') AND due_date < CURRENT_DATE`,
        [actor.tenantId],
      );

      // Work queue: overdue settlements
      const { rows: overdueItems } = await tx.query(
        `SELECT ps.id, po.id AS partner_id, po.name AS partner_name,
                (CURRENT_DATE - ps.due_date) AS days_outstanding,
                ps.net_amount_minor::bigint AS amount_minor, ps.currency,
                ps.status
         FROM partner_settlements ps
         JOIN partner_organizations po ON po.tenant_id=ps.tenant_id AND po.id=ps.partner_id
         WHERE ps.tenant_id=$1 AND ps.status NOT IN ('paid','void') AND ps.due_date < CURRENT_DATE
         ORDER BY ps.due_date ASC`,
        [actor.tenantId],
      );

      // Work queue: settlements due soon (within 7 days)
      const { rows: dueSoonItems } = await tx.query(
        `SELECT ps.id, po.id AS partner_id, po.name AS partner_name,
                (ps.due_date - CURRENT_DATE) AS due_in_days,
                ps.net_amount_minor::bigint AS amount_minor, ps.currency,
                ps.status
         FROM partner_settlements ps
         JOIN partner_organizations po ON po.tenant_id=ps.tenant_id AND po.id=ps.partner_id
         WHERE ps.tenant_id=$1 AND ps.status NOT IN ('paid','void')
           AND ps.due_date >= CURRENT_DATE AND ps.due_date <= CURRENT_DATE + 7
         ORDER BY ps.due_date ASC`,
        [actor.tenantId],
      );

      // Work queue: unverified claims
      const { rows: claimItems } = await tx.query(
        `SELECT po.id AS partner_id, po.name AS partner_name,
                COUNT(c.id)::int AS claim_count,
                COALESCE(SUM(c.amount_minor),0)::bigint AS amount_minor
         FROM partner_collection_claims c
         JOIN partner_organizations po ON po.tenant_id=c.tenant_id AND po.id=c.partner_id
         WHERE c.tenant_id=$1
           AND NOT EXISTS(SELECT 1 FROM partner_claim_decisions d WHERE d.tenant_id=c.tenant_id AND d.claim_id=c.id)
         GROUP BY po.id, po.name`,
        [actor.tenantId],
      );

      // Work queue: partners with bookings ready to settle (>= 3 unsettled)
      const { rows: readyItems } = await tx.query(
        `SELECT po.id AS partner_id, po.name AS partner_name,
                COUNT(pbl.id)::int AS booking_count,
                COALESCE(SUM(pbl.commission_amount_minor),0)::bigint AS amount_minor
         FROM partner_booking_links pbl
         JOIN partner_organizations po ON po.tenant_id=pbl.tenant_id AND po.id=pbl.partner_id
         WHERE pbl.tenant_id=$1 AND pbl.settlement_id IS NULL AND pbl.unlinked_at IS NULL
         GROUP BY po.id, po.name
         HAVING COUNT(pbl.id) >= 3`,
        [actor.tenantId],
      );

      // Recent activity (last 10 settlement state changes + claim decisions)
      // audit_events columns: action (not kind), aggregate_id (not subject_id)
      const { rows: activity } = await tx.query(
        `SELECT ae.id, ae.occurred_at AS event_at,
                po.name AS partner_name,
                ae.action AS description,
                COALESCE(ps.net_amount_minor, pc.amount_minor, 0)::bigint AS amount_minor,
                COALESCE(ps.currency, pc.currency, $2) AS currency,
                CASE
                  WHEN ae.action LIKE '%paid%' THEN 'in'
                  WHEN ae.action LIKE '%void%' THEN 'neutral'
                  ELSE 'neutral'
                END AS direction
         FROM audit_events ae
         LEFT JOIN partner_settlements ps ON ps.id=ae.aggregate_id AND ps.tenant_id=ae.tenant_id
         LEFT JOIN partner_collection_claims pc ON pc.id=ae.aggregate_id AND pc.tenant_id=ae.tenant_id
         LEFT JOIN partner_organizations po ON po.tenant_id=ae.tenant_id
           AND (po.id=ps.partner_id OR po.id=pc.partner_id)
         WHERE ae.tenant_id=$1
           AND ae.action IN ('partner.settlement.paid','partner.settlement.invoiced',
                             'partner.settlement.sent','partner.settlement.void',
                             'partner.collection.accepted','partner.collection.rejected')
         ORDER BY ae.occurred_at DESC
         LIMIT 10`,
        [actor.tenantId, currency],
      );

      // Build work queue
      const workQueue: object[] = [];
      for (const item of overdueItems) {
        workQueue.push({
          id: `overdue-${item.id}`,
          partner_id: item.partner_id,
          partner_name: item.partner_name,
          priority: "overdue",
          action: `Settlement overdue — ${item.status}`,
          amount_minor: Number(item.amount_minor),
          currency: item.currency ?? currency,
          days_outstanding: Number(item.days_outstanding),
          link: `/finance/partners/${item.partner_id}`,
        });
      }
      for (const item of dueSoonItems) {
        workQueue.push({
          id: `due-soon-${item.id}`,
          partner_id: item.partner_id,
          partner_name: item.partner_name,
          priority: "due_soon",
          action: `Invoice ${item.status} — awaiting payment`,
          amount_minor: Number(item.amount_minor),
          currency: item.currency ?? currency,
          due_in_days: Number(item.due_in_days),
          link: `/finance/partners/${item.partner_id}`,
        });
      }
      for (const item of claimItems) {
        workQueue.push({
          id: `claims-${item.partner_id}`,
          partner_id: item.partner_id,
          partner_name: item.partner_name,
          priority: "pending",
          action: `${item.claim_count} collection claim${item.claim_count !== 1 ? "s" : ""} awaiting review`,
          amount_minor: Number(item.amount_minor),
          currency,
          link: `/finance/partners/${item.partner_id}`,
        });
      }
      for (const item of readyItems) {
        // Only show if no overdue/due-soon already listed for this partner
        if (!workQueue.find((w: any) => w.partner_id === item.partner_id)) {
          workQueue.push({
            id: `ready-${item.partner_id}`,
            partner_id: item.partner_id,
            partner_name: item.partner_name,
            priority: "pending",
            action: `${item.booking_count} bookings ready to settle`,
            amount_minor: Number(item.amount_minor),
            currency,
            link: `/finance/partners/${item.partner_id}`,
          });
        }
      }

      return {
        work_queue: workQueue,
        net_position: {
          receivable_minor: Number(receivable.total_minor),
          payable_minor: Number(payable.total_minor),
          overdue_minor: Number(overdue.total_minor),
          receivable_count: receivable.cnt,
          payable_count: payable.cnt,
          overdue_count: overdue.cnt,
          currency,
        },
        recent_activity: activity.map((a: any) => ({
          id: a.id,
          event_at: a.event_at,
          partner_name: a.partner_name ?? "Unknown",
          description: a.description
            .replace("partner.", "")
            .replace(/\./g, " "),
          amount_minor: Number(a.amount_minor),
          currency: a.currency,
          direction: a.direction,
        })),
      };
    });
  }

  // ─── Partner Aging Report ────────────────────────────────────────────────

  financeAging(
    actor: Actor,
    opts: { asOf?: string; direction?: string; partnerId?: string } = {},
  ) {
    return this.db.transaction(actor, async (tx) => {
      // Resolve reporting currency from tenant config
      const {
        rows: [tenant],
      } = await tx.query(
        `SELECT COALESCE(config->>'reportingCurrency', base_currency, 'XCD') AS reporting_currency
         FROM tenants WHERE id=$1`,
        [actor.tenantId],
      );
      const reportingCurrency: string = tenant?.reporting_currency ?? "XCD";

      // Reference date — default today; must be YYYY-MM-DD
      const asOf =
        opts.asOf && /^\d{4}-\d{2}-\d{2}$/.test(opts.asOf)
          ? opts.asOf
          : new Date().toISOString().slice(0, 10);

      // Direction filter: 'payable' | 'receivable' | 'both'
      const direction =
        opts.direction === "payable" || opts.direction === "receivable"
          ? opts.direction
          : "both";

      // Build dynamic WHERE clauses
      const params: any[] = [actor.tenantId, asOf];
      const extraWhere: string[] = [];

      if (direction === "payable") {
        extraWhere.push("AND ps.commission_direction = 'tenant_owes_partner'");
      } else if (direction === "receivable") {
        extraWhere.push("AND ps.commission_direction = 'partner_owes_tenant'");
      }

      if (opts.partnerId) {
        params.push(opts.partnerId);
        extraWhere.push(`AND po.id = $${params.length}`);
      }

      // Per-partner, per-currency aging buckets using as-of date
      const { rows } = await tx.query(
        `SELECT po.id          AS partner_id,
                po.name        AS partner_name,
                ps.currency    AS currency,
                ps.commission_direction,
                COALESCE(SUM(CASE WHEN ($2::date - ps.due_date) <= 0 THEN ps.net_amount_minor ELSE 0 END),0)::bigint AS current_minor,
                COALESCE(SUM(CASE WHEN ($2::date - ps.due_date) BETWEEN 1  AND 30 THEN ps.net_amount_minor ELSE 0 END),0)::bigint AS days_1_30_minor,
                COALESCE(SUM(CASE WHEN ($2::date - ps.due_date) BETWEEN 31 AND 60 THEN ps.net_amount_minor ELSE 0 END),0)::bigint AS days_31_60_minor,
                COALESCE(SUM(CASE WHEN ($2::date - ps.due_date) BETWEEN 61 AND 90 THEN ps.net_amount_minor ELSE 0 END),0)::bigint AS days_61_90_minor,
                COALESCE(SUM(CASE WHEN ($2::date - ps.due_date) > 90              THEN ps.net_amount_minor ELSE 0 END),0)::bigint AS days_90_plus_minor,
                COALESCE(SUM(ps.net_amount_minor),0)::bigint AS total_minor
         FROM partner_settlements ps
         JOIN partner_organizations po ON po.tenant_id = ps.tenant_id AND po.id = ps.partner_id
         WHERE ps.tenant_id = $1
           AND ps.status NOT IN ('paid','void')
           AND ps.due_date IS NOT NULL
           ${extraWhere.join("\n           ")}
         GROUP BY po.id, po.name, ps.currency, ps.commission_direction
         ORDER BY po.name, ps.currency`,
        params,
      );

      // Merge into per-partner rows (each partner may have multiple currency buckets)
      const partnerMap = new Map<string, any>();
      for (const r of rows) {
        const pid = r.partner_id as string;
        if (!partnerMap.has(pid)) {
          partnerMap.set(pid, {
            partner_id: pid,
            partner_name: r.partner_name as string,
            direction:
              (r.commission_direction as string) === "tenant_owes_partner"
                ? "payable"
                : "receivable",
            buckets: [],
          });
        }
        partnerMap.get(pid)!.buckets.push({
          currency: r.currency as string,
          current_minor: Number(r.current_minor),
          days_1_30_minor: Number(r.days_1_30_minor),
          days_31_60_minor: Number(r.days_31_60_minor),
          days_61_90_minor: Number(r.days_61_90_minor),
          days_90_plus_minor: Number(r.days_90_plus_minor),
          total_minor: Number(r.total_minor),
        });
      }

      // Footer totals grouped by currency — never add across currencies
      const footerMap = new Map<
        string,
        {
          current_minor: number;
          days_1_30_minor: number;
          days_31_60_minor: number;
          days_61_90_minor: number;
          days_90_plus_minor: number;
          total_minor: number;
        }
      >();
      for (const r of rows) {
        const cur = r.currency as string;
        if (!footerMap.has(cur)) {
          footerMap.set(cur, {
            current_minor: 0,
            days_1_30_minor: 0,
            days_31_60_minor: 0,
            days_61_90_minor: 0,
            days_90_plus_minor: 0,
            total_minor: 0,
          });
        }
        const ft = footerMap.get(cur)!;
        ft.current_minor += Number(r.current_minor);
        ft.days_1_30_minor += Number(r.days_1_30_minor);
        ft.days_31_60_minor += Number(r.days_31_60_minor);
        ft.days_61_90_minor += Number(r.days_61_90_minor);
        ft.days_90_plus_minor += Number(r.days_90_plus_minor);
        ft.total_minor += Number(r.total_minor);
      }

      // Partner list for filter dropdown (active only)
      const { rows: partnerList } = await tx.query(
        `SELECT id, name FROM partner_organizations
         WHERE tenant_id=$1 AND status='active' ORDER BY name`,
        [actor.tenantId],
      );

      return {
        reporting_currency: reportingCurrency,
        as_of: asOf,
        direction,
        rows: Array.from(partnerMap.values()),
        totals_by_currency: Array.from(footerMap.entries()).map(
          ([currency, t]) => ({
            currency,
            ...t,
          }),
        ),
        partner_list: partnerList.map((p: any) => ({
          id: p.id as string,
          name: p.name as string,
        })),
      };
    });
  }

  // ─── Partner Ledger (transaction register) ───────────────────────────────

  partnerLedger(
    actor: Actor,
    partnerId: string,
    opts: {
      page?: number;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ) {
    return this.db.transaction(actor, async (tx) => {
      // Verify partner belongs to tenant
      const {
        rows: [partner],
      } = await tx.query(
        `SELECT id, name, partner_type, commission_type, commission_rate,
                commission_amount_minor::bigint AS commission_amount_minor,
                commission_direction, commission_currency AS currency,
                settlement_schedule, payment_terms_days, requires_formal_invoice,
                contract_ref, status
         FROM partner_organizations WHERE tenant_id=$1 AND id=$2`,
        [actor.tenantId, partnerId],
      );
      if (!partner) throw new NotFoundException("Partner not found");

      // Compute true account balance independently of pagination
      // Balance = sum of unsettled booking commissions (net of settled amounts)
      const {
        rows: [balRow],
      } = await tx.query(
        `SELECT
           -- Balance = all booking DRs minus cleared settlement CRs.
           -- This mirrors the running balance in the transaction register.
           -- For partner_owes_tenant: DR = gross, CR cleared settlement = net (remitted)
           -- For tenant_owes_partner: DR = commission, CR cleared settlement = net (paid out)
           COALESCE(SUM(CASE WHEN pbl.unlinked_at IS NULL
                              AND po.commission_direction = 'partner_owes_tenant'
                         THEN pbl.gross_amount_minor ELSE 0 END), 0)
           -
           COALESCE(SUM(CASE WHEN pbl.unlinked_at IS NULL
                              AND po.commission_direction = 'tenant_owes_partner'
                         THEN pbl.commission_amount_minor ELSE 0 END), 0)
           -- Subtract cleared (paid/voided) settlement net amounts (they reset the ledger)
           - COALESCE((
               SELECT SUM(CASE WHEN ps.commission_direction = 'partner_owes_tenant'
                               THEN ps.net_amount_minor ELSE -ps.net_amount_minor END)
               FROM partner_settlements ps
               WHERE ps.tenant_id=$1 AND ps.partner_id=$2
                 AND ps.status IN ('paid','voided','void')
             ), 0)
           AS balance_minor
         FROM partner_booking_links pbl
         JOIN partner_organizations po ON po.tenant_id=pbl.tenant_id AND po.id=pbl.partner_id
         WHERE pbl.tenant_id=$1 AND pbl.partner_id=$2`,
        [actor.tenantId, partnerId],
      );
      const balance_minor = Number(balRow?.balance_minor ?? 0);

      // Unsettled booking count
      const {
        rows: [cntRow],
      } = await tx.query(
        `SELECT COUNT(*)::int AS cnt FROM partner_booking_links
         WHERE tenant_id=$1 AND partner_id=$2 AND settlement_id IS NULL AND unlinked_at IS NULL`,
        [actor.tenantId, partnerId],
      );
      const unsettled_count = Number(cntRow?.cnt ?? 0);

      const page = opts.page ?? 1;
      const limit = 50;
      const offset = (page - 1) * limit;

      // Date range params
      const dateFrom =
        opts.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(opts.dateFrom)
          ? opts.dateFrom
          : null;
      const dateTo =
        opts.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(opts.dateTo)
          ? opts.dateTo
          : null;
      const statusFilter =
        opts.status === "unsettled" || opts.status === "settled"
          ? opts.status
          : null;

      // Booking entries
      const bookingDateWhere = [
        dateFrom ? "pbl.created_at >= $5::date" : null,
        dateTo ? "pbl.created_at <  ($6::date + interval '1 day')" : null,
      ]
        .filter(Boolean)
        .join(" AND ");
      const bookingStatusWhere =
        statusFilter === "settled"
          ? "AND pbl.settlement_id IS NOT NULL"
          : statusFilter === "unsettled"
            ? "AND pbl.settlement_id IS NULL"
            : "";

      const bookingParams: any[] = [actor.tenantId, partnerId, limit, offset];
      if (dateFrom) bookingParams.push(dateFrom);
      if (dateTo) bookingParams.push(dateTo);

      const { rows: bookingRows } = await tx.query(
        `SELECT 'booking' AS entry_type,
                pbl.id,
                pbl.created_at AS event_at,
                p.name || ' — ' || TO_CHAR(d.starts_at, 'DD Mon YYYY') || ' (' || LEFT(b.id::text, 8) || ')' AS description,
                pbl.gross_amount_minor::bigint AS gross_amount_minor,
                pbl.commission_amount_minor::bigint AS commission_amount_minor,
                -- DR = gross for partner_owes_tenant (they collected it); commission for tenant_owes_partner (we owe it)
                CASE po.commission_direction
                  WHEN 'partner_owes_tenant' THEN pbl.gross_amount_minor::bigint
                  ELSE pbl.commission_amount_minor::bigint
                END AS amount_minor,
                pbl.currency,
                po.commission_direction,
                pbl.booking_id,
                pbl.settlement_id
         FROM partner_booking_links pbl
         JOIN bookings b ON b.tenant_id=pbl.tenant_id AND b.id=pbl.booking_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         JOIN partner_organizations po ON po.tenant_id=pbl.tenant_id AND po.id=pbl.partner_id
         WHERE pbl.tenant_id=$1 AND pbl.partner_id=$2 AND pbl.unlinked_at IS NULL
           ${bookingStatusWhere}
           ${bookingDateWhere ? `AND ${bookingDateWhere}` : ""}
         ORDER BY pbl.created_at DESC, pbl.id DESC
         LIMIT $3 OFFSET $4`,
        bookingParams,
      );

      // Settlement entries (not filtered by booking status — always show)
      const settlementParams: any[] = [
        actor.tenantId,
        partnerId,
        limit,
        offset,
      ];
      const settlementDateWhere = [
        dateFrom
          ? `ps.created_at >= $${settlementParams.push(dateFrom)}::date`
          : null,
        dateTo
          ? `ps.created_at <  ($${settlementParams.push(dateTo)}::date + interval '1 day')`
          : null,
      ].filter(Boolean);

      const { rows: settlementRows } =
        statusFilter === "unsettled"
          ? { rows: [] }
          : await tx.query(
              `SELECT 'settlement' AS entry_type,
                ps.id,
                ps.created_at AS event_at,
                'Settlement ' || TO_CHAR(ps.period_start,'Mon DD') || '–' || TO_CHAR(ps.period_end,'Mon DD, YYYY')
                  || CASE WHEN ps.invoice_number IS NOT NULL THEN ' (' || ps.invoice_number || ')' ELSE '' END
                  AS description,
                ps.net_amount_minor::bigint AS amount_minor,
                ps.currency,
                ps.commission_direction,
                ps.status,
                ps.due_date,
                ps.invoice_number,
                ps.payment_ref,
                ps.paid_at,
                ps.voided_at
         FROM partner_settlements ps
         WHERE ps.tenant_id=$1 AND ps.partner_id=$2
           ${settlementDateWhere.length ? `AND ${settlementDateWhere.join(" AND ")}` : ""}
         ORDER BY ps.created_at DESC, ps.id DESC
         LIMIT $3 OFFSET $4`,
              settlementParams,
            );

      const { rows: claimRows } = await tx.query(
        `SELECT 'claim' AS entry_type,
                c.id,
                c.recorded_at AS event_at,
                'Collection claim — ' || c.reference AS description,
                c.amount_minor::bigint AS amount_minor,
                c.currency,
                'partner_owes_tenant' AS commission_direction,
                d.decision,
                d.reason AS decision_reason
         FROM partner_collection_claims c
         LEFT JOIN partner_claim_decisions d ON d.tenant_id=c.tenant_id AND d.claim_id=c.id
         WHERE c.tenant_id=$1 AND c.partner_id=$2
         ORDER BY c.recorded_at DESC, c.id DESC
         LIMIT $3 OFFSET $4`,
        [actor.tenantId, partnerId, limit, offset],
      );

      // Merge, sort, paginate
      const allEntries = [...bookingRows, ...settlementRows, ...claimRows]
        .sort(
          (a: any, b: any) =>
            new Date(b.event_at).getTime() - new Date(a.event_at).getTime(),
        )
        .slice(0, limit);

      // Running balance: booking/claim entries build the debt; settlements clear it.
      // Pending settlements (draft/issued/sent) are informational only — bookings already counted.
      let runBalance = 0;
      const entriesWithBalance = allEntries.reverse().map((entry: any) => {
        const amount = Number(entry.amount_minor);
        const isSettlement = entry.entry_type === "settlement";
        const isClearedSettlement =
          isSettlement &&
          ["paid", "void", "voided"].includes(entry.status ?? "");
        const isPendingSettlement = isSettlement && !isClearedSettlement;

        if (isClearedSettlement) {
          runBalance = 0;
        } else if (!isPendingSettlement) {
          if (entry.commission_direction === "partner_owes_tenant") {
            runBalance += amount;
          } else if (entry.commission_direction === "tenant_owes_partner") {
            runBalance -= amount;
          }
        }
        // Settlement rows show on the CR side (they clear the receivable/payable).
        // Booking/claim rows show on DR or CR per commission direction.
        let dr_minor: number;
        let cr_minor: number;
        if (isSettlement) {
          if (entry.commission_direction === "partner_owes_tenant") {
            dr_minor = 0;
            cr_minor = amount;
          } else {
            dr_minor = amount;
            cr_minor = 0;
          }
        } else {
          dr_minor =
            entry.commission_direction === "partner_owes_tenant" ? amount : 0;
          cr_minor =
            entry.commission_direction === "tenant_owes_partner" ? amount : 0;
        }
        const status: string =
          entry.status ?? (entry.settlement_id ? "settled" : "unsettled");
        return {
          id: entry.id,
          kind: entry.entry_type as string,
          event_at: entry.event_at as string,
          description: entry.description as string,
          dr_minor,
          cr_minor,
          balance_minor: runBalance,
          currency: entry.currency as string,
          status,
          ref: (entry.invoice_number ??
            entry.payment_ref ??
            (entry.booking_id
              ? String(entry.booking_id).slice(0, 8)
              : null)) as string | null,
        };
      });

      return {
        partner: { ...partner, balance_minor, unsettled_count },
        entries: entriesWithBalance.reverse(),
        page,
        has_more: allEntries.length === limit,
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

  @Get("partners/:id/bookings/unsettled-summary")
  @Access("partner.statement.read")
  unsettledSummary(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    return this.service.unsettledSummary(
      actor,
      parse(z.string().uuid(), id),
      from ?? "",
      to ?? "",
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

  @Delete("partners/:id/settlements/:sid")
  @Access("partner.manage")
  deleteSettlement(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Param("sid") sid: string,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.deleteSettlement(
      actor,
      parse(z.string().uuid(), id),
      parse(z.string().uuid(), sid),
      parse(keySchema, key),
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

  // ── Overview & Aging ────────────────────────────────────────────────────

  @Get("finance-overview")
  @Access("partner.statement.read")
  financeOverview(@CurrentActor() actor: Actor) {
    return this.service.financeOverview(actor);
  }

  @Get("finance-aging")
  @Access("partner.statement.read")
  financeAging(
    @CurrentActor() actor: Actor,
    @Query("asOf") asOf?: string,
    @Query("direction") direction?: string,
    @Query("partnerId") partnerId?: string,
  ) {
    return this.service.financeAging(actor, { asOf, direction, partnerId });
  }

  @Get("partners/:id/ledger")
  @Access("partner.statement.read")
  partnerLedger(
    @CurrentActor() actor: Actor,
    @Param("id") partnerId: string,
    @Query("page") page?: string,
    @Query("status") status?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
  ) {
    return this.service.partnerLedger(
      actor,
      parse(z.string().uuid(), partnerId),
      {
        page: page ? Math.max(1, parseInt(page, 10)) : 1,
        status,
        dateFrom,
        dateTo,
      },
    );
  }
}
