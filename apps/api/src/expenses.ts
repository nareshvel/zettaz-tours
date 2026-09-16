import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Patch,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database, record } from "./database";
import { Access, CurrentActor, parse } from "./http";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const categorySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    code: z.string().trim().max(20).optional().nullable(),
    sort_order: z.number().int().min(0).default(0),
  })
  .strict();

const vendorSchema = z
  .object({ name: z.string().trim().min(1).max(200) })
  .strict();

const expenseSchema = z
  .object({
    expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    category_id: z.string().uuid(),
    amount_minor: z.number().int().min(1),
    currency: z.string().length(3).optional().nullable(),
    fx_rate: z.number().positive().max(1_000_000).optional().nullable(),
    vendor: z.string().trim().max(200).optional().nullable(),
    description: z.string().trim().max(2000).optional().nullable(),
    reference: z.string().trim().max(200).optional().nullable(),
  })
  .strict();

const batchExpenseSchema = z
  .object({
    expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    vendor: z.string().trim().max(200).optional().nullable(),
    reference: z.string().trim().max(200).optional().nullable(),
    currency: z.string().length(3).optional().nullable(), // ISO 4217; defaults to tenant expense_currency
    fx_rate: z.number().positive().max(1_000_000).optional().nullable(), // bank rate to reporting currency
    lines: z
      .array(
        z.object({
          category_id: z.string().uuid(),
          description: z.string().trim().max(2000).optional().nullable(),
          amount_minor: z.number().int().min(1),
        }),
      )
      .min(1)
      .max(50),
  })
  .strict();

const voidSchema = z
  .object({
    void_reason: z.string().trim().min(1).max(500),
  })
  .strict();

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ExpenseService {
  constructor(private readonly db: Database) {}

  // ── Vendors ─────────────────────────────────────────────────────────────

  listVendors(actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, name, is_active, created_at
         FROM vendors
         WHERE tenant_id=$1
         ORDER BY name`,
        [actor.tenantId],
      );
      return { vendors: rows };
    });
  }

  createVendor(actor: Actor, raw: unknown) {
    const input = parse(vendorSchema, raw);
    return this.db.transaction(actor, async (tx) => {
      const { rows: [vendor] } = await tx.query(
        `INSERT INTO vendors(tenant_id, name)
         VALUES($1,$2)
         ON CONFLICT (tenant_id, lower(name))
         DO UPDATE SET is_active=true, name=EXCLUDED.name
         RETURNING id, name, is_active, created_at`,
        [actor.tenantId, input.name],
      );
      return vendor;
    });
  }

  archiveVendor(actor: Actor, vendorId: string) {
    return this.db.transaction(actor, async (tx) => {
      const { rows: [vendor] } = await tx.query(
        `UPDATE vendors SET is_active=false
         WHERE tenant_id=$1 AND id=$2
         RETURNING id, name, is_active`,
        [actor.tenantId, vendorId],
      );
      if (!vendor) throw new NotFoundException("Vendor not found");
      return vendor;
    });
  }

  renameVendor(actor: Actor, vendorId: string, raw: unknown) {
    const input = parse(vendorSchema, raw);
    return this.db.transaction(actor, async (tx) => {
      const { rows: [vendor] } = await tx.query(
        `UPDATE vendors SET name=$3
         WHERE tenant_id=$1 AND id=$2 AND is_active=true
         RETURNING id, name, is_active`,
        [actor.tenantId, vendorId, input.name],
      );
      if (!vendor) throw new NotFoundException("Vendor not found");
      return vendor;
    });
  }

  // ── Expense categories ──────────────────────────────────────────────────

  listCategories(actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, name, code, sort_order, is_active, created_at
         FROM expense_categories
         WHERE tenant_id=$1
         ORDER BY sort_order, name`,
        [actor.tenantId],
      );
      return { categories: rows };
    });
  }

  createCategory(actor: Actor, raw: unknown) {
    const input = parse(categorySchema, raw);
    return this.db.transaction(actor, async (tx) => {
      const { rows: [cat] } = await tx.query(
        `INSERT INTO expense_categories(tenant_id, name, code, sort_order)
         VALUES($1,$2,$3,$4)
         RETURNING id, name, code, sort_order, is_active, created_at`,
        [actor.tenantId, input.name, input.code ?? null, input.sort_order],
      );
      return cat;
    });
  }

  updateCategory(actor: Actor, categoryId: string, raw: unknown) {
    const input = parse(categorySchema.partial(), raw);
    return this.db.transaction(actor, async (tx) => {
      const { rows: [existing] } = await tx.query(
        "SELECT id FROM expense_categories WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, categoryId],
      );
      if (!existing) throw new NotFoundException("Category not found");
      const { rows: [cat] } = await tx.query(
        `UPDATE expense_categories
         SET name=COALESCE($3,name), code=COALESCE($4,code), sort_order=COALESCE($5,sort_order)
         WHERE tenant_id=$1 AND id=$2
         RETURNING id, name, code, sort_order, is_active, created_at`,
        [actor.tenantId, categoryId, input.name ?? null, input.code ?? null, input.sort_order ?? null],
      );
      return cat;
    });
  }

  archiveCategory(actor: Actor, categoryId: string) {
    return this.db.transaction(actor, async (tx) => {
      const { rows: [cat] } = await tx.query(
        `UPDATE expense_categories SET is_active=false
         WHERE tenant_id=$1 AND id=$2
         RETURNING id, name, is_active`,
        [actor.tenantId, categoryId],
      );
      if (!cat) throw new NotFoundException("Category not found");
      return cat;
    });
  }

  // ── Expenses ────────────────────────────────────────────────────────────

  listExpenses(
    actor: Actor,
    opts: { categoryId?: string; dateFrom?: string; dateTo?: string; page?: number },
  ) {
    return this.db.transaction(actor, async (tx) => {
      const page = Math.max(1, opts.page ?? 1);
      const limit = 50;
      const offset = (page - 1) * limit;

      const { rows: expenses } = await tx.query(
        `SELECT e.id, e.category_id, ec.name AS category_name,
                e.amount_minor::bigint, e.currency, e.expense_date,
                e.fx_rate, e.amount_reporting_minor::bigint,
                e.vendor, e.description, e.reference,
                e.voided_at, e.created_at,
                COALESCE(su.name, su.email, 'Unknown') AS recorded_by_name
         FROM expenses e
         JOIN expense_categories ec ON ec.id=e.category_id
         LEFT JOIN staff_users su ON su.id=e.recorded_by
         WHERE e.tenant_id=$1
           AND ($2::uuid IS NULL OR e.category_id=$2)
           AND ($3::date IS NULL OR e.expense_date >= $3::date)
           AND ($4::date IS NULL OR e.expense_date <= $4::date)
         ORDER BY e.expense_date DESC, e.created_at DESC
         LIMIT $5 OFFSET $6`,
        [actor.tenantId, opts.categoryId ?? null, opts.dateFrom ?? null, opts.dateTo ?? null, limit, offset],
      );

      const { rows: totals } = await tx.query(
        `SELECT ec.name AS category_name,
                e.currency,
                SUM(e.amount_minor)::bigint AS total_minor,
                SUM(e.amount_reporting_minor)::bigint AS total_reporting_minor
         FROM expenses e
         JOIN expense_categories ec ON ec.id=e.category_id
         WHERE e.tenant_id=$1 AND e.voided_at IS NULL
           AND ($2::date IS NULL OR e.expense_date >= $2::date)
           AND ($3::date IS NULL OR e.expense_date <= $3::date)
         GROUP BY ec.name, e.currency
         ORDER BY category_name, total_minor DESC`,
        [actor.tenantId, opts.dateFrom ?? null, opts.dateTo ?? null],
      );

      const currency = (
        await tx.query("SELECT base_currency FROM tenants WHERE id=$1", [actor.tenantId])
      ).rows[0]?.base_currency ?? "XCD";

      return {
        expenses: expenses.map((e: any) => ({ ...e, amount_minor: Number(e.amount_minor) })),
        category_totals: totals.map((t: any) => ({
          category_name: t.category_name,
          total_minor: Number(t.total_minor),
          total_reporting_minor: t.total_reporting_minor != null ? Number(t.total_reporting_minor) : null,
          currency: t.currency ?? currency,
        })),
        currency,
        page,
        has_more: expenses.length === limit,
      };
    });
  }

  createExpense(actor: Actor, raw: unknown) {
    const input = parse(expenseSchema, raw);
    return this.db.transaction(actor, async (tx) => {
      const { rows: [cat] } = await tx.query(
        "SELECT id FROM expense_categories WHERE tenant_id=$1 AND id=$2 AND is_active=true",
        [actor.tenantId, input.category_id],
      );
      if (!cat) throw new NotFoundException("Expense category not found or inactive");

      const currency = (
        await tx.query("SELECT base_currency FROM tenants WHERE id=$1", [actor.tenantId])
      ).rows[0]?.base_currency ?? "XCD";

      const { rows: [expense] } = await tx.query(
        `INSERT INTO expenses(tenant_id, category_id, amount_minor, currency,
          expense_date, vendor, description, reference, recorded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, category_id, amount_minor::bigint, currency,
                   expense_date, vendor, description, reference, created_at`,
        [actor.tenantId, input.category_id, input.amount_minor, currency,
         input.expense_date, input.vendor ?? null, input.description ?? null,
         input.reference ?? null, actor.actorId],
      );
      await record(tx, actor, "expense.created", expense.id, null, expense);
      return { ...expense, amount_minor: Number(expense.amount_minor) };
    });
  }

  createBatchExpense(actor: Actor, raw: unknown) {
    const input = parse(batchExpenseSchema, raw);
    return this.db.transaction(actor, async (tx) => {
      // Use the per-bill currency if supplied; otherwise fall back to the tenant's
      // expense_currency column (collectionCurrency), then base_currency.
      const tenantRow = (
        await tx.query(
          "SELECT expense_currency, reporting_currency, base_currency FROM tenants WHERE id=$1",
          [actor.tenantId],
        )
      ).rows[0];
      const currency =
        (input.currency?.trim().toUpperCase() || null) ??
        tenantRow?.expense_currency ??
        tenantRow?.base_currency ??
        "XCD";
      const reportingCurrency =
        tenantRow?.reporting_currency ?? tenantRow?.base_currency ?? currency;
      // fx_rate is the bank rate that was actually applied at transaction time.
      // Only used when the expense currency differs from the reporting currency.
      const fxRate =
        currency !== reportingCurrency
          ? (input.fx_rate ?? null)
          : null;

      const created: any[] = [];
      for (const line of input.lines) {
        const { rows: [cat] } = await tx.query(
          "SELECT id FROM expense_categories WHERE tenant_id=$1 AND id=$2 AND is_active=true",
          [actor.tenantId, line.category_id],
        );
        if (!cat) throw new NotFoundException(`Category ${line.category_id} not found or inactive`);

        // Same-currency: reporting minor = original minor (1:1, no conversion).
        // Foreign currency: apply the stored fx_rate (reporting units per 1 expense unit).
        const reportingMinor = currency === reportingCurrency
          ? line.amount_minor
          : fxRate ? Math.round(line.amount_minor * fxRate) : null;
        const { rows: [expense] } = await tx.query(
          `INSERT INTO expenses(tenant_id, category_id, amount_minor, currency,
            expense_date, vendor, description, reference, recorded_by,
            fx_rate, amount_reporting_minor)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id, category_id, amount_minor::bigint, currency,
                     expense_date, vendor, description, reference, created_at,
                     fx_rate, amount_reporting_minor::bigint`,
          [actor.tenantId, line.category_id, line.amount_minor, currency,
           input.expense_date, input.vendor ?? null, line.description ?? null,
           input.reference ?? null, actor.actorId,
           fxRate, reportingMinor],
        );
        await record(tx, actor, "expense.created", expense.id, null, expense);
        created.push({ ...expense, amount_minor: Number(expense.amount_minor) });
      }
      return { expenses: created, count: created.length };
    });
  }

  getExpense(actor: Actor, expenseId: string) {
    return this.db.transaction(actor, async (tx) => {
      const { rows: [expense] } = await tx.query(
        `SELECT e.id, e.category_id, ec.name AS category_name,
                e.amount_minor::bigint, e.currency, e.expense_date,
                e.vendor, e.description, e.reference, e.voided_at, e.void_reason, e.created_at
         FROM expenses e
         JOIN expense_categories ec ON ec.id=e.category_id
         WHERE e.tenant_id=$1 AND e.id=$2`,
        [actor.tenantId, expenseId],
      );
      if (!expense) throw new NotFoundException("Expense not found");
      return { ...expense, amount_minor: Number(expense.amount_minor) };
    });
  }

  updateExpense(actor: Actor, expenseId: string, raw: unknown) {
    const input = parse(expenseSchema.partial(), raw);
    return this.db.transaction(actor, async (tx) => {
      const { rows: [before] } = await tx.query(
        "SELECT * FROM expenses WHERE tenant_id=$1 AND id=$2 AND voided_at IS NULL FOR UPDATE",
        [actor.tenantId, expenseId],
      );
      if (!before) throw new NotFoundException("Expense not found or already voided");
      // Resolve currency and reporting amount on update
      const tenantRow2 = (await tx.query(
        "SELECT expense_currency, reporting_currency, base_currency FROM tenants WHERE id=$1",
        [actor.tenantId],
      )).rows[0];
      const newCurrency = input.currency?.trim().toUpperCase() ?? null;
      const reportingCurrency2 = tenantRow2?.reporting_currency ?? tenantRow2?.base_currency ?? null;
      const newFxRate = newCurrency && reportingCurrency2 && newCurrency !== reportingCurrency2
        ? (input.fx_rate ?? null) : null;
      const newAmtMinor = input.amount_minor ?? null;
      // Same-currency: reporting minor equals original minor (1:1).
      // Foreign currency: apply fx_rate. If fx_rate missing, null (flagged in UI).
      const newReportingMinor = newAmtMinor != null
        ? (newCurrency === reportingCurrency2
            ? newAmtMinor
            : newFxRate ? Math.round(newAmtMinor * newFxRate) : null)
        : null;

      const { rows: [expense] } = await tx.query(
        `UPDATE expenses
         SET expense_date=COALESCE($3, expense_date),
             category_id=COALESCE($4, category_id),
             amount_minor=COALESCE($5, amount_minor),
             currency=COALESCE($6, currency),
             fx_rate=$7,
             amount_reporting_minor=$8,
             vendor=COALESCE($9, vendor),
             description=COALESCE($10, description),
             reference=COALESCE($11, reference)
         WHERE tenant_id=$1 AND id=$2
         RETURNING id, category_id, amount_minor::bigint, currency, fx_rate,
                   expense_date, vendor, description, reference, created_at`,
        [actor.tenantId, expenseId,
         input.expense_date ?? null, input.category_id ?? null,
         newAmtMinor, newCurrency,
         newFxRate, newReportingMinor,
         input.vendor ?? null, input.description ?? null,
         input.reference ?? null],
      );
      await record(tx, actor, "expense.updated", expenseId, before, expense);
      return { ...expense, amount_minor: Number(expense.amount_minor) };
    });
  }

  voidExpense(actor: Actor, expenseId: string, raw: unknown) {
    const input = parse(voidSchema, raw);
    return this.db.transaction(actor, async (tx) => {
      const { rows: [before] } = await tx.query(
        "SELECT * FROM expenses WHERE tenant_id=$1 AND id=$2 AND voided_at IS NULL FOR UPDATE",
        [actor.tenantId, expenseId],
      );
      if (!before) throw new NotFoundException("Expense not found or already voided");
      const { rows: [expense] } = await tx.query(
        `UPDATE expenses SET voided_at=now(), void_reason=$3
         WHERE tenant_id=$1 AND id=$2
         RETURNING id, voided_at, void_reason`,
        [actor.tenantId, expenseId, input.void_reason],
      );
      await record(tx, actor, "expense.voided", expenseId, before, expense);
      return expense;
    });
  }
}

// ─── Controller ───────────────────────────────────────────────────────────────

@Controller("finance/v1")
export class ExpenseController {
  constructor(private readonly service: ExpenseService) {}

  // ── Vendors ─────────────────────────────────────────────────────────────

  @Get("vendors")
  @Access("partner.statement.read")
  listVendors(@CurrentActor() actor: Actor) {
    return this.service.listVendors(actor);
  }

  @Post("vendors")
  @Access("partner.statement.read")
  createVendor(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.createVendor(actor, body);
  }

  @Delete("vendors/:id")
  @Access("partner.statement.read")
  archiveVendor(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.service.archiveVendor(actor, parse(z.string().uuid(), id));
  }

  @Patch("vendors/:id")
  @Access("partner.statement.read")
  renameVendor(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    return this.service.renameVendor(actor, parse(z.string().uuid(), id), body);
  }

  // ── Expense categories ──────────────────────────────────────────────────

  @Get("expense-categories")
  @Access("partner.statement.read")
  listCategories(@CurrentActor() actor: Actor) {
    return this.service.listCategories(actor);
  }

  @Post("expense-categories")
  @Access("config.write")
  createCategory(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.createCategory(actor, body);
  }

  @Patch("expense-categories/:id")
  @Access("config.write")
  updateCategory(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateCategory(actor, parse(z.string().uuid(), id), body);
  }

  @Delete("expense-categories/:id")
  @Access("config.write")
  archiveCategory(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.service.archiveCategory(actor, parse(z.string().uuid(), id));
  }

  // ── Expenses ────────────────────────────────────────────────────────────

  @Get("expenses")
  @Access("partner.statement.read")
  listExpenses(
    @CurrentActor() actor: Actor,
    @Query("categoryId") categoryId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("page") page?: string,
  ) {
    return this.service.listExpenses(actor, {
      categoryId: categoryId ? parse(z.string().uuid(), categoryId) : undefined,
      dateFrom,
      dateTo,
      page: page ? parseInt(page, 10) : undefined,
    });
  }

  @Post("expenses")
  @Access("partner.statement.read")
  createExpense(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.createExpense(actor, body);
  }

  @Post("expenses/batch")
  @Access("partner.statement.read")
  createBatchExpense(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.service.createBatchExpense(actor, body);
  }

  @Get("expenses/:id")
  @Access("partner.statement.read")
  getExpense(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.service.getExpense(actor, parse(z.string().uuid(), id));
  }

  @Patch("expenses/:id")
  @Access("partner.statement.read")
  updateExpense(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateExpense(actor, parse(z.string().uuid(), id), body);
  }

  @Delete("expenses/:id")
  @Access("payment.correct")
  voidExpense(
    @CurrentActor() actor: Actor,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.voidExpense(actor, parse(z.string().uuid(), id), body);
  }
}
