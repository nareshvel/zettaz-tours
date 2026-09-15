/**
 * Partner Commission & Settlement Extension
 * ==========================================
 * Merge this into apps/api/src/partners.ts
 *
 * Instructions for merge:
 *   1. Add the new Zod schemas below the existing partnerSchema
 *   2. Add the new service methods to PartnersService (after the existing statements() method)
 *   3. Add the new controller handlers to FinanceController (after existing routes)
 *   4. Add new permissions to the Access decorator imports where shown
 *
 * New permissions needed in your permissions seed:
 *   partner.commission.write   — configure commission on a partner
 *   partner.booking.link       — attribute a booking to a partner
 *   partner.settlement.write   — generate / advance settlement status
 *   partner.settlement.read    — read settlement list and detail
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMAS  (add after existing partnerSchema)
// ─────────────────────────────────────────────────────────────────────────────

const commissionConfigSchema = z.object({
  partner_type: z.enum(["ota", "reseller", "affiliate", "wholesale"]).optional(),
  commission_type: z.enum(["percentage", "flat_per_booking", "flat_per_pax", "net_rate"]),
  commission_rate: z.number().min(0).max(1).optional().nullable(),  // 0.20 = 20%
  commission_amount_minor: z.number().int().min(0).optional().nullable(),
  commission_direction: z.enum(["partner_owes_tenant", "tenant_owes_partner"]),
  commission_currency: z.string().length(3).default("XCD"),
  settlement_schedule: z.enum(["monthly", "biweekly", "per_booking", "custom", "manual"]).default("manual"),
  settlement_day: z.number().int().min(1).max(28).optional().nullable(),
  payment_terms_days: z.number().int().min(0).max(365).default(30),
  requires_formal_invoice: z.boolean().default(false),
  contract_ref: z.string().trim().max(200).optional().nullable(),
}).strict().refine(
  (d) => {
    if (d.commission_type === "percentage") return d.commission_rate != null;
    if (d.commission_type === "flat_per_booking" || d.commission_type === "flat_per_pax")
      return d.commission_amount_minor != null;
    return true; // net_rate: no rate/amount required
  },
  { message: "commission_rate required for percentage; commission_amount_minor required for flat types" }
);

const bookingLinkSchema = z.object({
  booking_id: z.string().uuid(),
  gross_amount_minor: z.number().int().min(0),
  pax_count: z.number().int().min(1).default(1),
  source: z.enum(["manual", "import", "ota_webhook"]).default("manual"),
  external_ref: z.string().trim().max(200).optional().nullable(),
}).strict();

const settlementGenerateSchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict().refine(d => d.period_start <= d.period_end, {
  message: "period_start must be ≤ period_end",
});

const settlementAdvanceSchema = z.object({
  status: z.enum(["invoiced", "sent", "paid", "overdue", "void"]),
  payment_ref: z.string().trim().max(400).optional().nullable(),
  invoice_number: z.string().trim().max(100).optional().nullable(),
  invoice_pdf_path: z.string().trim().max(1000).optional().nullable(),
  void_reason: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).strict();

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE METHODS  (add to PartnersService)
// ─────────────────────────────────────────────────────────────────────────────

/*
  async configureCommission(actor: Actor, partnerId: string, idempotencyKey: string, input: unknown) {
    const data = commissionConfigSchema.parse(input);
    return this.db.command(actor, idempotencyKey, data, async (tx) => {
      const before = await tx.queryRow<Record<string, unknown>>(
        `SELECT id, partner_type, commission_type, commission_rate, commission_amount_minor,
                commission_direction, commission_currency, settlement_schedule, settlement_day,
                payment_terms_days, requires_formal_invoice, contract_ref
         FROM partner_organizations WHERE id = $1 AND tenant_id = $2`,
        [partnerId, actor.tenantId]
      );
      if (!before) throw new NotFoundException("partner_not_found");

      const after = await tx.queryRow<Record<string, unknown>>(
        `UPDATE partner_organizations SET
           partner_type            = $3,
           commission_type         = $4,
           commission_rate         = $5,
           commission_amount_minor = $6,
           commission_direction    = $7,
           commission_currency     = $8,
           settlement_schedule     = $9,
           settlement_day          = $10,
           payment_terms_days      = $11,
           requires_formal_invoice = $12,
           contract_ref            = $13
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, name, partner_type, commission_type, commission_rate,
                   commission_amount_minor, commission_direction, commission_currency,
                   settlement_schedule, settlement_day, payment_terms_days,
                   requires_formal_invoice, contract_ref`,
        [
          partnerId,
          actor.tenantId,
          data.partner_type ?? null,
          data.commission_type,
          data.commission_rate ?? null,
          data.commission_amount_minor ?? null,
          data.commission_direction,
          data.commission_currency,
          data.settlement_schedule,
          data.settlement_day ?? null,
          data.payment_terms_days,
          data.requires_formal_invoice,
          data.contract_ref ?? null,
        ]
      );

      await record(tx, actor, "partner.commission.configured", partnerId, before, after);
      return after;
    });
  }

  async linkBooking(actor: Actor, partnerId: string, idempotencyKey: string, input: unknown) {
    const data = bookingLinkSchema.parse(input);
    return this.db.command(actor, idempotencyKey, { partnerId, ...data }, async (tx) => {
      const result = await tx.queryRow(
        `SELECT link_booking_to_partner($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          actor.tenantId,
          partnerId,
          data.booking_id,
          data.gross_amount_minor,
          data.pax_count,
          data.source,
          data.external_ref ?? null,
          actor.userId,
        ]
      );
      await record(tx, actor, "partner.booking.linked", partnerId, null, result);
      return result;
    });
  }

  async unlinkBooking(actor: Actor, partnerId: string, linkId: string, idempotencyKey: string, reason?: string) {
    return this.db.command(actor, idempotencyKey, { partnerId, linkId, reason }, async (tx) => {
      const before = await tx.queryRow(
        `SELECT * FROM partner_booking_links WHERE id = $1 AND partner_id = $2 AND tenant_id = $3 AND unlinked_at IS NULL`,
        [linkId, partnerId, actor.tenantId]
      );
      if (!before) throw new NotFoundException("link_not_found_or_already_unlinked");

      const after = await tx.queryRow(
        `UPDATE partner_booking_links
         SET unlinked_at = clock_timestamp(), unlinked_by = $4, unlink_reason = $5
         WHERE id = $1 AND partner_id = $2 AND tenant_id = $3
         RETURNING *`,
        [linkId, partnerId, actor.tenantId, actor.userId, reason ?? null]
      );
      await record(tx, actor, "partner.booking.unlinked", partnerId, before, after, reason);
      return after;
    });
  }

  async listUnsettledBookings(actor: Actor, partnerId: string) {
    return this.db.transaction(actor, async (tx) => {
      return tx.queryRows(
        `SELECT
           pbl.id, pbl.booking_id, pbl.gross_amount_minor, pbl.pax_count,
           pbl.commission_type, pbl.commission_rate, pbl.commission_amount_minor,
           pbl.commission_direction, pbl.currency, pbl.source, pbl.external_ref,
           pbl.created_at,
           b.reference, b.starts_at, b.status AS booking_status,
           COALESCE(c.full_name, c.email) AS customer_name
         FROM partner_booking_links pbl
         JOIN bookings b ON b.id = pbl.booking_id
         LEFT JOIN customers c ON c.id = b.customer_id
         WHERE pbl.tenant_id  = $1
           AND pbl.partner_id = $2
           AND pbl.settlement_id IS NULL
           AND pbl.unlinked_at  IS NULL
         ORDER BY b.starts_at DESC`,
        [actor.tenantId, partnerId]
      );
    });
  }

  async generateSettlement(actor: Actor, partnerId: string, idempotencyKey: string, input: unknown) {
    const data = settlementGenerateSchema.parse(input);
    return this.db.command(actor, idempotencyKey, { partnerId, ...data }, async (tx) => {
      const result = await tx.queryRow(
        `SELECT generate_partner_settlement($1, $2, $3, $4, $5)`,
        [actor.tenantId, partnerId, data.period_start, data.period_end, actor.userId]
      );
      await record(tx, actor, "partner.settlement.generated", partnerId, null, result);
      return result;
    });
  }

  async listSettlements(actor: Actor, partnerId: string) {
    return this.db.transaction(actor, async (tx) => {
      return tx.queryRows(
        `SELECT
           ps.*,
           po.name AS partner_name,
           po.partner_type
         FROM partner_settlements ps
         JOIN partner_organizations po ON po.id = ps.partner_id
         WHERE ps.tenant_id  = $1
           AND ps.partner_id = $2
         ORDER BY ps.created_at DESC`,
        [actor.tenantId, partnerId]
      );
    });
  }

  async getSettlement(actor: Actor, partnerId: string, settlementId: string) {
    return this.db.transaction(actor, async (tx) => {
      const settlement = await tx.queryRow(
        `SELECT ps.*, po.name AS partner_name, po.partner_type, po.requires_formal_invoice
         FROM partner_settlements ps
         JOIN partner_organizations po ON po.id = ps.partner_id
         WHERE ps.id = $1 AND ps.partner_id = $2 AND ps.tenant_id = $3`,
        [settlementId, partnerId, actor.tenantId]
      );
      if (!settlement) throw new NotFoundException("settlement_not_found");

      const links = await tx.queryRows(
        `SELECT
           pbl.id, pbl.booking_id, pbl.gross_amount_minor, pbl.pax_count,
           pbl.commission_type, pbl.commission_amount_minor, pbl.currency,
           b.reference, b.starts_at,
           COALESCE(c.full_name, c.email) AS customer_name
         FROM partner_booking_links pbl
         JOIN bookings b ON b.id = pbl.booking_id
         LEFT JOIN customers c ON c.id = b.customer_id
         WHERE pbl.settlement_id = $1
         ORDER BY b.starts_at`,
        [settlementId]
      );

      return { ...settlement, bookings: links };
    });
  }

  async advanceSettlement(actor: Actor, partnerId: string, settlementId: string, idempotencyKey: string, input: unknown) {
    const data = settlementAdvanceSchema.parse(input);
    return this.db.command(actor, idempotencyKey, { settlementId, ...data }, async (tx) => {
      const before = await tx.queryRow(
        `SELECT * FROM partner_settlements WHERE id = $1 AND partner_id = $2 AND tenant_id = $3`,
        [settlementId, partnerId, actor.tenantId]
      );
      if (!before) throw new NotFoundException("settlement_not_found");

      const result = await tx.queryRow(
        `SELECT advance_settlement_status($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          actor.tenantId,
          settlementId,
          data.status,
          data.payment_ref ?? null,
          data.invoice_number ?? null,
          data.invoice_pdf_path ?? null,
          data.void_reason ?? null,
          data.notes ?? null,
        ]
      );
      await record(tx, actor, `partner.settlement.${data.status}`, settlementId, before, result);
      return result;
    });
  }

  async partnerFinanceSummary(actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      // Receivable: partner_owes_tenant → unsettled booking commissions
      const receivable = await tx.queryRow<{ total_minor: bigint; count: number }>(
        `SELECT
           COALESCE(SUM(pbl.commission_amount_minor), 0) AS total_minor,
           COUNT(*) AS count
         FROM partner_booking_links pbl
         JOIN partner_organizations po ON po.id = pbl.partner_id
         WHERE pbl.tenant_id = $1
           AND pbl.settlement_id IS NULL
           AND pbl.unlinked_at  IS NULL
           AND po.commission_direction = 'partner_owes_tenant'`,
        [actor.tenantId]
      );

      // Payable: tenant_owes_partner → unsettled booking commissions
      const payable = await tx.queryRow<{ total_minor: bigint; count: number }>(
        `SELECT
           COALESCE(SUM(pbl.commission_amount_minor), 0) AS total_minor,
           COUNT(*) AS count
         FROM partner_booking_links pbl
         JOIN partner_organizations po ON po.id = pbl.partner_id
         WHERE pbl.tenant_id = $1
           AND pbl.settlement_id IS NULL
           AND pbl.unlinked_at  IS NULL
           AND po.commission_direction = 'tenant_owes_partner'`,
        [actor.tenantId]
      );

      // Overdue: settlements past due_date and not paid/voided
      const overdue = await tx.queryRow<{ count: number; total_minor: bigint }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(net_amount_minor), 0) AS total_minor
         FROM partner_settlements
         WHERE tenant_id = $1
           AND status NOT IN ('paid', 'void')
           AND due_date < CURRENT_DATE`,
        [actor.tenantId]
      );

      // Per-partner unsettled summary
      const byPartner = await tx.queryRows(
        `SELECT
           po.id, po.name, po.partner_type, po.commission_direction,
           po.commission_currency AS currency,
           COUNT(pbl.id)                              AS unsettled_count,
           COALESCE(SUM(pbl.gross_amount_minor), 0)   AS gross_minor,
           COALESCE(SUM(pbl.commission_amount_minor), 0) AS commission_minor
         FROM partner_organizations po
         LEFT JOIN partner_booking_links pbl
           ON pbl.partner_id = po.id
           AND pbl.settlement_id IS NULL
           AND pbl.unlinked_at IS NULL
         WHERE po.tenant_id = $1
           AND po.commission_direction IS NOT NULL
         GROUP BY po.id, po.name, po.partner_type, po.commission_direction, po.commission_currency
         ORDER BY commission_minor DESC NULLS LAST`,
        [actor.tenantId]
      );

      return {
        receivable_minor:  Number(receivable?.total_minor ?? 0),
        receivable_count:  Number(receivable?.count ?? 0),
        payable_minor:     Number(payable?.total_minor ?? 0),
        payable_count:     Number(payable?.count ?? 0),
        overdue_count:     Number(overdue?.count ?? 0),
        overdue_minor:     Number(overdue?.total_minor ?? 0),
        by_partner:        byPartner,
      };
    });
  }
*/

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER HANDLERS  (add to FinanceController inside the class)
// ─────────────────────────────────────────────────────────────────────────────

/*
  // PATCH /finance/v1/partners/:id/commission
  @Patch("partners/:id/commission")
  @Access("partner.commission.write")
  configureCommission(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown
  ) {
    return this.partners.configureCommission(actor, id, key, body);
  }

  // GET /finance/v1/partners/:id/bookings/unsettled
  @Get("partners/:id/bookings/unsettled")
  @Access("partner.statement.read")
  listUnsettledBookings(
    @CurrentActor() actor: Actor,
    @Param("id") id: string
  ) {
    return this.partners.listUnsettledBookings(actor, id);
  }

  // POST /finance/v1/partners/:id/bookings
  @Post("partners/:id/bookings")
  @Access("partner.booking.link")
  linkBooking(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown
  ) {
    return this.partners.linkBooking(actor, id, key, body);
  }

  // DELETE /finance/v1/partners/:id/bookings/:linkId
  @Delete("partners/:id/bookings/:linkId")
  @Access("partner.booking.link")
  unlinkBooking(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Param("linkId") linkId: string,
    @Headers("idempotency-key") key: string,
    @Body("reason") reason: string
  ) {
    return this.partners.unlinkBooking(actor, id, linkId, key, reason);
  }

  // GET /finance/v1/partners/:id/settlements
  @Get("partners/:id/settlements")
  @Access("partner.settlement.read")
  listSettlements(
    @CurrentActor() actor: Actor,
    @Param("id") id: string
  ) {
    return this.partners.listSettlements(actor, id);
  }

  // POST /finance/v1/partners/:id/settlements
  @Post("partners/:id/settlements")
  @Access("partner.settlement.write")
  generateSettlement(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown
  ) {
    return this.partners.generateSettlement(actor, id, key, body);
  }

  // GET /finance/v1/partners/:id/settlements/:sid
  @Get("partners/:id/settlements/:sid")
  @Access("partner.settlement.read")
  getSettlement(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Param("sid") sid: string
  ) {
    return this.partners.getSettlement(actor, id, sid);
  }

  // PATCH /finance/v1/partners/:id/settlements/:sid
  @Patch("partners/:id/settlements/:sid")
  @Access("partner.settlement.write")
  advanceSettlement(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Param("sid") sid: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown
  ) {
    return this.partners.advanceSettlement(actor, id, sid, key, body);
  }

  // GET /finance/v1/partner-finance-summary
  @Get("partner-finance-summary")
  @Access("partner.statement.read")
  partnerFinanceSummary(@CurrentActor() actor: Actor) {
    return this.partners.partnerFinanceSummary(actor);
  }
*/

export {}; // keeps TypeScript happy as a module
