import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database, type Tx } from "./database";
import { PARTNER_LEDGER_ENTRIES } from "./partner-ledger";
import { Access, CurrentActor, parse } from "./http";

/** Every report accepts a closed date range (max ~13 months) and a date basis. */
const reportQuery = z
  .object({
    from: z.string().date(),
    to: z.string().date(),
    basis: z.enum(["departure", "booked"]).default("departure"),
  })
  .strict()
  .refine((v) => v.from <= v.to, "From date must not follow to date")
  .refine(
    (v) => Date.parse(v.to) - Date.parse(v.from) <= 400 * 86_400_000,
    "Choose a range of 400 days or less",
  );
type ReportInput = z.infer<typeof reportQuery>;

const statementQuery = z
  .object({
    partnerId: z.string().uuid(),
    from: z.string().date(),
    to: z.string().date(),
  })
  .strict()
  .refine((v) => v.from <= v.to, "From date must not follow to date");

/**
 * Date filter for a booking row `b` joined to departure `d`.
 * departure = departure local date; booked = booking created_at in tenant timezone.
 */
function dateFilter(basis: ReportInput["basis"]) {
  return basis === "booked"
    ? `(b.created_at AT TIME ZONE t.timezone)::date BETWEEN $2 AND $3`
    : `d.local_date BETWEEN $2 AND $3`;
}

/** Latest immutable price snapshot per booking, with its currency. */
const SNAPSHOT = `LEFT JOIN LATERAL (
    SELECT (s.quote->>'totalMinor')::bigint AS total_minor,
           COALESCE(s.quote->>'currency', t.reporting_currency) AS currency
    FROM price_snapshots s WHERE s.tenant_id=b.tenant_id AND s.booking_id=b.id
    ORDER BY s.version DESC LIMIT 1) snap ON true`;

/** Settled payments that were not voided or reversed (adjustments are whole-payment). */
const PAID = `COALESCE((SELECT SUM(p.amount_minor) FROM payments p
    WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='settled'
    AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)`;

function shiftRange(from: string, to: string) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    from: iso(Date.parse(from) - days * 86_400_000),
    to: iso(Date.parse(from) - 86_400_000),
  };
}

@Injectable()
export class ReportService {
  constructor(private readonly db: Database) {}

  private async tenant(tx: Tx, actor: Actor) {
    const {
      rows: [row],
    } = await tx.query(
      `SELECT COALESCE(reporting_currency, base_currency, 'XCD') AS currency, timezone
       FROM tenants WHERE id=$1`,
      [actor.tenantId],
    );
    return row as { currency: string; timezone: string };
  }

  private async commercial(tx: Tx, actor: Actor, input: ReportInput) {
    const {
      rows: [c],
    } = await tx.query(
      `WITH t AS (SELECT id, COALESCE(reporting_currency, base_currency, 'XCD') AS reporting_currency, timezone FROM tenants WHERE id=$1),
       scoped AS (
         SELECT b.id, b.state, COALESCE(snap.total_minor,0) AS total_minor,
           snap.currency = t.reporting_currency OR snap.currency IS NULL AS same_ccy,
           ${PAID} AS paid_minor,
           COALESCE((SELECT SUM(c.amount_minor) FROM partner_collection_claims c
             JOIN partner_claim_decisions x ON x.tenant_id=c.tenant_id AND x.claim_id=c.id AND x.decision='accepted'
             WHERE c.tenant_id=b.tenant_id AND c.booking_id=b.id),0) AS partner_credit_minor,
           COALESCE((SELECT SUM(o.amount_minor) FROM partner_obligations o
             WHERE o.tenant_id=b.tenant_id AND o.booking_id=b.id),0) AS partner_due_minor
         FROM bookings b
         JOIN t ON t.id=b.tenant_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         ${SNAPSHOT}
         WHERE b.tenant_id=$1 AND ${dateFilter(input.basis)}
       )
       SELECT COUNT(*)::int AS bookings,
         COUNT(*) FILTER(WHERE state='confirmed')::int AS confirmed,
         COUNT(*) FILTER(WHERE state='held')::int AS held,
         COUNT(*) FILTER(WHERE state='cancelled')::int AS cancelled,
         COUNT(*) FILTER(WHERE NOT same_ccy)::int AS other_currency,
         COALESCE(SUM(total_minor) FILTER(WHERE state='confirmed' AND same_ccy),0)::text AS booked_minor,
         COALESCE(SUM(paid_minor) FILTER(WHERE state='confirmed' AND same_ccy),0)::text AS received_minor,
         COALESCE(SUM(paid_minor) FILTER(WHERE state<>'confirmed' AND same_ccy),0)::text AS received_unconfirmed_minor,
         COALESCE(SUM(partner_credit_minor) FILTER(WHERE state='confirmed' AND same_ccy),0)::text AS partner_credit_minor,
         COALESCE(SUM(GREATEST(total_minor-paid_minor-partner_credit_minor,0)) FILTER(WHERE state='confirmed' AND same_ccy),0)::text AS guest_balance_minor,
         COALESCE(SUM(partner_due_minor) FILTER(WHERE same_ccy),0)::text AS partner_due_minor
       FROM scoped`,
      [actor.tenantId, input.from, input.to],
    );
    return {
      bookings: c.bookings as number,
      confirmed: c.confirmed as number,
      held: c.held as number,
      cancelled: c.cancelled as number,
      otherCurrency: c.other_currency as number,
      bookedMinor: Number(c.booked_minor),
      receivedMinor: Number(c.received_minor),
      receivedUnconfirmedMinor: Number(c.received_unconfirmed_minor),
      partnerCreditMinor: Number(c.partner_credit_minor),
      guestBalanceMinor: Number(c.guest_balance_minor),
      partnerDueMinor: Number(c.partner_due_minor),
    };
  }

  overview(actor: Actor, raw: unknown) {
    const input = parse(reportQuery, raw);
    return this.db.transaction(actor, async (tx: Tx) => {
      const tenant = await this.tenant(tx, actor);
      const commercial = await this.commercial(tx, actor, input);
      const previous = await this.commercial(tx, actor, {
        ...input,
        ...shiftRange(input.from, input.to),
      });
      const {
        rows: [operations],
      } = await tx.query(
        `SELECT COUNT(*)::int AS departures,
          COUNT(*) FILTER(WHERE d.operational_status='weather_hold')::int AS weather_holds,
          COUNT(*) FILTER(WHERE d.operational_status='closed')::int AS closed,
          COUNT(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM departure_assignments a
            WHERE a.tenant_id=d.tenant_id AND a.departure_id=d.id AND a.status='active'))::int AS unassigned,
          COALESCE(SUM((SELECT COUNT(*) FROM bookings b WHERE b.tenant_id=d.tenant_id
            AND b.departure_id=d.id AND b.state='confirmed' AND b.pickup->>'kind'='unresolved')),0)::int AS unresolved_pickups
         FROM departures d WHERE d.tenant_id=$1 AND d.local_date BETWEEN $2 AND $3`,
        [actor.tenantId, input.from, input.to],
      );
      // Full calendar series so zero-activity days are visible, not silently skipped.
      const { rows: days } = await tx.query(
        `SELECT g.day::date::text AS date,
           COUNT(DISTINCT d.id)::int AS departures,
           COUNT(b.id) FILTER(WHERE b.state='confirmed')::int AS confirmed_bookings,
           COALESCE(SUM(h.seats) FILTER(WHERE b.state='confirmed'),0)::int AS guests
         FROM generate_series($2::date, $3::date, interval '1 day') g(day)
         LEFT JOIN departures d ON d.tenant_id=$1 AND d.local_date=g.day::date
         LEFT JOIN bookings b ON b.tenant_id=d.tenant_id AND b.departure_id=d.id
         LEFT JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         GROUP BY g.day ORDER BY g.day`,
        [actor.tenantId, input.from, input.to],
      );
      return {
        range: { from: input.from, to: input.to },
        basis: input.basis,
        currency: tenant.currency,
        commercial,
        previous: {
          range: shiftRange(input.from, input.to),
          confirmed: previous.confirmed,
          bookedMinor: previous.bookedMinor,
          receivedMinor: previous.receivedMinor,
        },
        operations: {
          departures: operations.departures,
          weatherHolds: operations.weather_holds,
          closed: operations.closed,
          unassigned: operations.unassigned,
          unresolvedPickups: operations.unresolved_pickups,
        },
        days,
      };
    });
  }

  salesByProduct(actor: Actor, raw: unknown) {
    const input = parse(reportQuery, raw);
    return this.db.transaction(actor, async (tx: Tx) => {
      const tenant = await this.tenant(tx, actor);
      const { rows } = await tx.query(
        `WITH t AS (SELECT id, COALESCE(reporting_currency, base_currency, 'XCD') AS reporting_currency, timezone FROM tenants WHERE id=$1),
         scoped AS (
           SELECT d.product_id, b.state, h.seats, COALESCE(snap.total_minor,0) AS total_minor,
             snap.currency = t.reporting_currency OR snap.currency IS NULL AS same_ccy,
             ${PAID} AS paid_minor
           FROM bookings b
           JOIN t ON t.id=b.tenant_id
           JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
           JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
           ${SNAPSHOT}
           WHERE b.tenant_id=$1 AND ${dateFilter(input.basis)}
         ),
         cap AS (
           SELECT d.product_id, COUNT(*)::int AS departures, SUM(d.capacity)::int AS capacity
           FROM departures d WHERE d.tenant_id=$1 AND d.local_date BETWEEN $2 AND $3
             AND d.operational_status<>'closed'
           GROUP BY d.product_id
         )
         SELECT p.id AS product_id, p.name,
           COALESCE(cap.departures,0) AS departures, COALESCE(cap.capacity,0) AS capacity,
           COUNT(s.*) FILTER(WHERE s.state='confirmed')::int AS confirmed,
           COUNT(s.*) FILTER(WHERE s.state='cancelled')::int AS cancelled,
           COALESCE(SUM(s.seats) FILTER(WHERE s.state='confirmed'),0)::int AS guests,
           COALESCE(SUM(s.total_minor) FILTER(WHERE s.state='confirmed' AND s.same_ccy),0)::text AS booked_minor,
           COALESCE(SUM(s.paid_minor) FILTER(WHERE s.state='confirmed' AND s.same_ccy),0)::text AS received_minor,
           COUNT(s.*) FILTER(WHERE NOT s.same_ccy)::int AS other_currency
         FROM products p
         LEFT JOIN scoped s ON s.product_id=p.id
         LEFT JOIN cap ON cap.product_id=p.id
         WHERE p.tenant_id=$1
         GROUP BY p.id, p.name, cap.departures, cap.capacity
         HAVING COUNT(s.*)>0 OR COALESCE(cap.departures,0)>0
         ORDER BY SUM(s.total_minor) FILTER(WHERE s.state='confirmed') DESC NULLS LAST, p.name`,
        [actor.tenantId, input.from, input.to],
      );
      return {
        range: { from: input.from, to: input.to },
        basis: input.basis,
        currency: tenant.currency,
        rows: rows.map((r) => ({
          productId: r.product_id,
          name: r.name,
          departures: r.departures,
          capacity: r.capacity,
          confirmed: r.confirmed,
          cancelled: r.cancelled,
          guests: r.guests,
          bookedMinor: Number(r.booked_minor),
          receivedMinor: Number(r.received_minor),
          otherCurrency: r.other_currency,
        })),
      };
    });
  }

  bookingSources(actor: Actor, raw: unknown) {
    const input = parse(reportQuery, raw);
    return this.db.transaction(actor, async (tx: Tx) => {
      const tenant = await this.tenant(tx, actor);
      const { rows } = await tx.query(
        `WITH t AS (SELECT id, COALESCE(reporting_currency, base_currency, 'XCD') AS reporting_currency, timezone FROM tenants WHERE id=$1)
         SELECT COALESCE(NULLIF(trim(b.source),''),'unknown') AS source,
           COUNT(*)::int AS bookings,
           COUNT(*) FILTER(WHERE b.state='confirmed')::int AS confirmed,
           COUNT(*) FILTER(WHERE b.state='cancelled')::int AS cancelled,
           COALESCE(SUM(h.seats) FILTER(WHERE b.state='confirmed'),0)::int AS guests,
           COALESCE(SUM(snap.total_minor) FILTER(WHERE b.state='confirmed'
             AND (snap.currency=t.reporting_currency OR snap.currency IS NULL)),0)::text AS booked_minor
         FROM bookings b
         JOIN t ON t.id=b.tenant_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         ${SNAPSHOT}
         WHERE b.tenant_id=$1 AND ${dateFilter(input.basis)}
         GROUP BY 1 ORDER BY 2 DESC`,
        [actor.tenantId, input.from, input.to],
      );
      return {
        range: { from: input.from, to: input.to },
        basis: input.basis,
        currency: tenant.currency,
        rows: rows.map((r) => ({
          source: r.source as string,
          bookings: r.bookings as number,
          confirmed: r.confirmed as number,
          cancelled: r.cancelled as number,
          guests: r.guests as number,
          bookedMinor: Number(r.booked_minor),
        })),
      };
    });
  }

  /**
   * Partner statement for a period. Positive balance = partner owes the tenant.
   * Booking links add gross (partner collected for us) or subtract commission
   * (we owe the partner); paid settlements clear by their net amount.
   * Draft/invoiced/sent/overdue settlements are listed for information only.
   */
  partnerStatement(actor: Actor, raw: unknown) {
    const input = parse(statementQuery, raw);
    return this.db.transaction(actor, async (tx: Tx) => {
      const tenant = await this.tenant(tx, actor);
      const {
        rows: [partner],
      } = await tx.query(
        `SELECT id, name, email, phone, commission_direction,
           CASE WHEN commission_type IS NULL THEN NULL ELSE commission_currency END AS currency
         FROM partner_organizations WHERE tenant_id=$1 AND id=$2`,
        [actor.tenantId, input.partnerId],
      );
      if (!partner) throw new NotFoundException("Partner not found");
      const {
        rows: [opening],
      } = await tx.query(
        `WITH t AS (SELECT id, timezone FROM tenants WHERE id=$1), e AS (${PARTNER_LEDGER_ENTRIES})
         SELECT COALESCE(SUM(amount_minor),0)::text AS balance FROM e, t
         WHERE (e.event_at AT TIME ZONE t.timezone)::date < $3`,
        [actor.tenantId, input.partnerId, input.from],
      );
      const { rows } = await tx.query(
        `WITH t AS (SELECT id, timezone FROM tenants WHERE id=$1), e AS (${PARTNER_LEDGER_ENTRIES})
         SELECT kind, (e.event_at AT TIME ZONE t.timezone)::date::text AS date, description, reference,
           amount_minor::text, gross_minor::text AS gross_amount_minor,
           commission_minor::text AS commission_amount_minor, currency, status
         FROM e, t WHERE (e.event_at AT TIME ZONE t.timezone)::date BETWEEN $3 AND $4
         ORDER BY e.event_at, e.kind, e.id`,
        [actor.tenantId, input.partnerId, input.from, input.to],
      );
      let running = Number(opening.balance);
      const lines = rows.map((r) => {
        const amount = Number(r.amount_minor);
        running += amount;
        return {
          kind: r.kind as
            | "booking"
            | "settlement"
            | "settlement_reversal"
            | "settlement_info"
            | "claim",
          date: r.date as string,
          description: r.description as string,
          reference: r.reference as string,
          status: r.status as string | null,
          currency: r.currency as string,
          grossMinor:
            r.gross_amount_minor === null ? null : Number(r.gross_amount_minor),
          commissionMinor:
            r.commission_amount_minor === null
              ? null
              : Number(r.commission_amount_minor),
          amountMinor: amount,
          balanceMinor: running,
        };
      });
      return {
        range: { from: input.from, to: input.to },
        tenant: { currency: tenant.currency, timezone: tenant.timezone },
        partner: {
          id: partner.id,
          name: partner.name,
          email: partner.email,
          phone: partner.phone,
          direction: partner.commission_direction,
          currency: String(partner.currency ?? tenant.currency).trim(),
        },
        openingMinor: Number(opening.balance),
        closingMinor: running,
        lines,
      };
    });
  }

  /**
   * Cash-basis journal for the accountant (QuickBooks Online "Journal Entries" import).
   * Only facts already recorded in Zettaz, in the reporting currency; open guest
   * balances are never posted. Every journal balances (debits = credits).
   */
  accountingJournal(actor: Actor, raw: unknown) {
    const input = parse(reportQuery, raw);
    return this.db.transaction(actor, async (tx: Tx) => {
      const tenant = await this.tenant(tx, actor);
      const {
        rows: [cfg],
      } = await tx.query("SELECT config FROM tenants WHERE id=$1", [
        actor.tenantId,
      ]);
      const a = {
        incomeAccount: "Tour income",
        guestReceiptsAccount: "Undeposited Funds",
        cashAccount: "Cash on hand",
        bankAccount: "Bank",
        accountsPayable: "Accounts Payable",
        commissionExpense: "Commission expense",
        defaultExpenseAccount: "Operating expenses",
        ...((cfg?.config?.accounting ?? {}) as Record<string, string>),
      };
      const range = [actor.tenantId, input.from, input.to, tenant.currency];
      const tz = `(SELECT timezone FROM tenants WHERE id=$1)`;
      type Line = { account: string; debit: number; credit: number };
      type Journal = {
        date: string;
        source: string;
        reference: string;
        description: string;
        name: string;
        lines: Line[];
      };
      const journals: Journal[] = [];
      let excluded = 0;
      const receiptAccount = (method: string) =>
        method === "cash" ? a.cashAccount : a.guestReceiptsAccount;
      const payAccount = (method: string) =>
        method === "cash" ? a.cashAccount : a.bankAccount;

      const inRange = (day: string | null) =>
        !!day && day >= input.from && day <= input.to;

      // 1. Guest payments settled in the period, and reversals/voids recorded in the period.
      const { rows: pays } = await tx.query(
        `SELECT p.id, (p.occurred_at AT TIME ZONE ${tz})::date::text AS day, p.amount_minor::text,
           p.currency, p.method, p.reference, b.lead_name, LEFT(b.id::text,8) AS booking_ref,
           a.kind AS adj_kind, (a.occurred_at AT TIME ZONE ${tz})::date::text AS adj_day
         FROM payments p
         JOIN bookings b ON b.tenant_id=p.tenant_id AND b.id=p.booking_id
         LEFT JOIN payment_adjustments a ON a.tenant_id=p.tenant_id AND a.payment_id=p.id
         WHERE p.tenant_id=$1 AND p.status='settled'
           AND (((p.occurred_at AT TIME ZONE ${tz})::date BETWEEN $2 AND $3)
             OR ((a.occurred_at AT TIME ZONE ${tz})::date BETWEEN $2 AND $3))`,
        range.slice(0, 3),
      );
      for (const r of pays) {
        if (r.currency !== tenant.currency) {
          excluded += 1;
          continue;
        }
        const amount = Number(r.amount_minor);
        if (inRange(r.day))
          journals.push({
            date: r.day,
            source: "Guest payment",
            reference: r.reference || r.booking_ref,
            description: `Booking ${r.booking_ref} · ${r.method}`,
            name: r.lead_name,
            lines: [
              { account: receiptAccount(r.method), debit: amount, credit: 0 },
              { account: a.incomeAccount, debit: 0, credit: amount },
            ],
          });
        if (inRange(r.adj_day))
          journals.push({
            date: r.adj_day,
            source: `Guest payment ${r.adj_kind}`,
            reference: r.reference || r.booking_ref,
            description: `Booking ${r.booking_ref} · ${r.adj_kind}`,
            name: r.lead_name,
            lines: [
              { account: a.incomeAccount, debit: amount, credit: 0 },
              { account: receiptAccount(r.method), debit: 0, credit: amount },
            ],
          });
      }

      // 2. Expense bills: posted on the bill date; a void posts the reversal on the
      //    void date, so a bill already exported to the accountant is corrected, never erased.
      const { rows: bills } = await tx.query(
        `SELECT e.expense_date::text AS day, e.amount_minor::text, trim(e.currency) AS currency,
           e.vendor, e.description, e.reference, COALESCE(NULLIF(trim(c.code),''), c.name) AS account,
           (e.voided_at AT TIME ZONE ${tz})::date::text AS void_day, e.void_reason
         FROM expenses e JOIN expense_categories c ON c.id=e.category_id
         WHERE e.tenant_id=$1 AND (e.expense_date BETWEEN $2 AND $3
           OR (e.voided_at AT TIME ZONE ${tz})::date BETWEEN $2 AND $3)`,
        range.slice(0, 3),
      );
      for (const r of bills) {
        if (r.currency !== tenant.currency) {
          excluded += 1;
          continue;
        }
        const amount = Number(r.amount_minor);
        const expenseAccount = r.account || a.defaultExpenseAccount;
        // A bill voided before (or on) its own date never existed for the books.
        const voidedBeforeBill = r.void_day && r.void_day <= r.day;
        if (inRange(r.day) && !voidedBeforeBill)
          journals.push({
            date: r.day,
            source: "Expense bill",
            reference: r.reference ?? "",
            description: r.description ?? "Expense",
            name: r.vendor ?? "",
            lines: [
              { account: expenseAccount, debit: amount, credit: 0 },
              { account: a.accountsPayable, debit: 0, credit: amount },
            ],
          });
        if (inRange(r.void_day) && !voidedBeforeBill)
          journals.push({
            date: r.void_day,
            source: "Expense bill void",
            reference: r.reference ?? "",
            description: `Void: ${r.description ?? "expense"}${r.void_reason ? ` (${r.void_reason})` : ""}`,
            name: r.vendor ?? "",
            lines: [
              { account: a.accountsPayable, debit: amount, credit: 0 },
              { account: expenseAccount, debit: 0, credit: amount },
            ],
          });
      }

      // 3. Expense payments: posted on the paid date; a void posts the reversal on its void date.
      const { rows: expPays } = await tx.query(
        `SELECT p.paid_on::text AS day, p.amount_minor::text, trim(p.currency) AS currency, p.method,
           p.reference, e.vendor, e.description,
           (p.voided_at AT TIME ZONE ${tz})::date::text AS void_day
         FROM expense_payments p JOIN expenses e ON e.id=p.expense_id
         WHERE p.tenant_id=$1 AND (p.paid_on BETWEEN $2 AND $3
           OR (p.voided_at AT TIME ZONE ${tz})::date BETWEEN $2 AND $3)`,
        range.slice(0, 3),
      );
      for (const r of expPays) {
        if (r.currency !== tenant.currency) {
          excluded += 1;
          continue;
        }
        const amount = Number(r.amount_minor);
        const voidedBeforePaid = r.void_day && r.void_day < r.day;
        if (inRange(r.day) && !voidedBeforePaid)
          journals.push({
            date: r.day,
            source: "Expense payment",
            reference: r.reference ?? "",
            description: `Paid: ${r.description ?? "expense"}`,
            name: r.vendor ?? "",
            lines: [
              { account: a.accountsPayable, debit: amount, credit: 0 },
              { account: payAccount(r.method), debit: 0, credit: amount },
            ],
          });
        if (inRange(r.void_day) && !voidedBeforePaid)
          journals.push({
            date: r.void_day,
            source: "Expense payment void",
            reference: r.reference ?? "",
            description: `Void payment: ${r.description ?? "expense"}`,
            name: r.vendor ?? "",
            lines: [
              { account: payAccount(r.method), debit: amount, credit: 0 },
              { account: a.accountsPayable, debit: 0, credit: amount },
            ],
          });
      }

      // 4. Partner settlements: posted when PAID (on the recorded payment date); a paid
      //    settlement that is later voided posts the reversal on its void date.
      const { rows: settlements } = await tx.query(
        `SELECT (s.paid_at AT TIME ZONE ${tz})::date::text AS day,
           CASE WHEN s.status='void' THEN (s.voided_at AT TIME ZONE ${tz})::date::text END AS void_day,
           trim(s.currency) AS currency,
           s.gross_amount_minor::text, s.commission_amount_minor::text, s.net_amount_minor::text,
           s.commission_direction, COALESCE(s.payment_ref, s.invoice_number, LEFT(s.id::text,8)) AS reference,
           po.name
         FROM partner_settlements s
         JOIN partner_organizations po ON po.tenant_id=s.tenant_id AND po.id=s.partner_id
         WHERE s.tenant_id=$1 AND s.paid_at IS NOT NULL AND s.status IN ('paid','void')
           AND ((s.paid_at AT TIME ZONE ${tz})::date BETWEEN $2 AND $3
             OR (s.status='void' AND (s.voided_at AT TIME ZONE ${tz})::date BETWEEN $2 AND $3))`,
        range.slice(0, 3),
      );
      for (const r of settlements) {
        if (r.currency !== tenant.currency) {
          excluded += 1;
          continue;
        }
        const net = Math.abs(Number(r.net_amount_minor));
        const commission = Math.abs(Number(r.commission_amount_minor));
        const lines: Line[] =
          r.commission_direction === "partner_owes_tenant"
            ? // Partner collected from guests and remits gross less its commission.
              [
                { account: a.bankAccount, debit: net, credit: 0 },
                ...(commission
                  ? [
                      {
                        account: a.commissionExpense,
                        debit: commission,
                        credit: 0,
                      },
                    ]
                  : []),
                {
                  account: a.incomeAccount,
                  debit: 0,
                  credit: net + commission,
                },
              ]
            : // We collected from guests and pay the partner its commission.
              [
                { account: a.commissionExpense, debit: net, credit: 0 },
                { account: a.bankAccount, debit: 0, credit: net },
              ];
        const description =
          r.commission_direction === "partner_owes_tenant"
            ? "Partner remittance"
            : "Commission paid to partner";
        if (inRange(r.day))
          journals.push({
            date: r.day,
            source: "Partner settlement",
            reference: r.reference,
            description,
            name: r.name,
            lines,
          });
        if (inRange(r.void_day))
          journals.push({
            date: r.void_day,
            source: "Partner settlement void",
            reference: r.reference,
            description: `Void: ${description}`,
            name: r.name,
            lines: lines.map((l) => ({
              account: l.account,
              debit: l.credit,
              credit: l.debit,
            })),
          });
      }

      journals.sort(
        (x, y) =>
          x.date.localeCompare(y.date) || x.source.localeCompare(y.source),
      );
      const numbered = journals.map((j, i) => ({ number: i + 1, ...j }));
      const totals = numbered.reduce(
        (t, j) => {
          for (const l of j.lines) {
            t.debit += l.debit;
            t.credit += l.credit;
          }
          return t;
        },
        { debit: 0, credit: 0 },
      );
      return {
        range: { from: input.from, to: input.to },
        currency: tenant.currency,
        accounts: a,
        journals: numbered,
        totals,
        excludedOtherCurrency: excluded,
      };
    });
  }

  /**
   * Management P&L (not a tax filing). Revenue is recognised on the departure date
   * from each confirmed booking's price snapshot, net of tax. Commission comes from
   * partner link snapshots; expenses use the reporting amount recorded on each bill.
   */
  profitAndLoss(actor: Actor, raw: unknown) {
    const input = parse(reportQuery, raw);
    return this.db.transaction(actor, async (tx: Tx) => {
      const tenant = await this.tenant(tx, actor);
      const {
        rows: [rev],
      } = await tx.query(
        `WITH t AS (SELECT id, COALESCE(reporting_currency, base_currency, 'XCD') AS reporting_currency, timezone FROM tenants WHERE id=$1)
         SELECT
           COALESCE(SUM((s.quote->>'totalMinor')::bigint - COALESCE((s.quote->>'taxMinor')::bigint,0))
             FILTER(WHERE COALESCE(s.quote->>'currency', t.reporting_currency)=t.reporting_currency),0)::text AS revenue_minor,
           COALESCE(SUM(COALESCE((s.quote->>'taxMinor')::bigint,0))
             FILTER(WHERE COALESCE(s.quote->>'currency', t.reporting_currency)=t.reporting_currency),0)::text AS tax_minor,
           COUNT(*) FILTER(WHERE COALESCE(s.quote->>'currency', t.reporting_currency)<>t.reporting_currency)::int AS excluded,
           COUNT(*)::int AS bookings
         FROM bookings b
         JOIN t ON t.id=b.tenant_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         JOIN LATERAL (SELECT quote FROM price_snapshots ps WHERE ps.tenant_id=b.tenant_id AND ps.booking_id=b.id
           ORDER BY version DESC LIMIT 1) s ON true
         WHERE b.tenant_id=$1 AND b.state='confirmed' AND d.local_date BETWEEN $2 AND $3`,
        [actor.tenantId, input.from, input.to],
      );
      const {
        rows: [com],
      } = await tx.query(
        `SELECT COALESCE(SUM(l.commission_amount_minor) FILTER(WHERE trim(l.currency)=$4),0)::text AS commission_minor,
           COUNT(*) FILTER(WHERE trim(l.currency)<>$4)::int AS excluded
         FROM partner_booking_links l
         JOIN bookings b ON b.tenant_id=l.tenant_id AND b.id=l.booking_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         WHERE l.tenant_id=$1 AND l.unlinked_at IS NULL AND b.state='confirmed'
           AND d.local_date BETWEEN $2 AND $3`,
        [actor.tenantId, input.from, input.to, tenant.currency],
      );
      const { rows: expenses } = await tx.query(
        `SELECT c.name AS category,
           COALESCE(SUM(COALESCE(e.amount_reporting_minor,
             CASE WHEN trim(e.currency)=$4 THEN e.amount_minor END)),0)::text AS amount_minor,
           COUNT(*) FILTER(WHERE e.amount_reporting_minor IS NULL AND trim(e.currency)<>$4)::int AS excluded
         FROM expenses e JOIN expense_categories c ON c.id=e.category_id
         WHERE e.tenant_id=$1 AND e.voided_at IS NULL AND e.expense_date BETWEEN $2 AND $3
         GROUP BY c.name ORDER BY 2 DESC`,
        [actor.tenantId, input.from, input.to, tenant.currency],
      );
      const revenue = Number(rev.revenue_minor);
      const commission = Number(com.commission_minor);
      const expenseRows = expenses.map((r) => ({
        category: r.category as string,
        amountMinor: Number(r.amount_minor),
      }));
      const expenseTotal = expenseRows.reduce((t, r) => t + r.amountMinor, 0);
      return {
        range: { from: input.from, to: input.to },
        currency: tenant.currency,
        revenueMinor: revenue,
        taxCollectedMinor: Number(rev.tax_minor),
        confirmedBookings: rev.bookings as number,
        commissionMinor: commission,
        grossProfitMinor: revenue - commission,
        expenses: expenseRows,
        expenseTotalMinor: expenseTotal,
        netMinor: revenue - commission - expenseTotal,
        excluded: {
          bookings: rev.excluded as number,
          commissions: com.excluded as number,
          expenses: expenses.reduce((t, r) => t + Number(r.excluded), 0),
        },
      };
    });
  }

  commissionSummary(actor: Actor, raw: unknown) {
    const input = parse(reportQuery, raw);
    return this.db.transaction(actor, async (tx: Tx) => {
      const tenant = await this.tenant(tx, actor);
      // Commission comes from the snapshot stored on partner_booking_links at link time —
      // never recalculated from current partner terms.
      const { rows } = await tx.query(
        `WITH t AS (SELECT id, timezone FROM tenants WHERE id=$1)
         SELECT po.id AS partner_id, po.name, l.commission_direction AS direction, l.currency,
           COUNT(*)::int AS bookings,
           SUM(l.pax_count)::int AS guests,
           SUM(l.gross_amount_minor)::text AS gross_minor,
           SUM(l.commission_amount_minor)::text AS commission_minor,
           COALESCE(SUM(l.commission_amount_minor) FILTER(WHERE ps.status='paid'),0)::text AS settled_minor
         FROM partner_booking_links l
         JOIN t ON t.id=l.tenant_id
         JOIN partner_organizations po ON po.tenant_id=l.tenant_id AND po.id=l.partner_id
         JOIN bookings b ON b.tenant_id=l.tenant_id AND b.id=l.booking_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         LEFT JOIN partner_settlements ps ON ps.tenant_id=l.tenant_id AND ps.id=l.settlement_id
         WHERE l.tenant_id=$1 AND l.unlinked_at IS NULL
           AND (b.state<>'cancelled' OR l.settlement_id IS NOT NULL)
           AND ${dateFilter(input.basis)}
         GROUP BY po.id, po.name, l.commission_direction, l.currency
         ORDER BY po.name, l.commission_direction`,
        [actor.tenantId, input.from, input.to],
      );
      return {
        range: { from: input.from, to: input.to },
        basis: input.basis,
        currency: tenant.currency,
        rows: rows.map((r) => {
          const commission = Number(r.commission_minor);
          const settled = Number(r.settled_minor);
          return {
            partnerId: r.partner_id,
            name: r.name,
            direction: r.direction as
              "partner_owes_tenant" | "tenant_owes_partner",
            currency: String(r.currency).trim(),
            bookings: r.bookings,
            guests: r.guests,
            grossMinor: Number(r.gross_minor),
            commissionMinor: commission,
            settledMinor: settled,
            outstandingMinor: commission - settled,
          };
        }),
      };
    });
  }
}

@Controller("reports/v1")
export class ReportController {
  constructor(private readonly service: ReportService) {}
  @Get("overview")
  @Access("bookings.read")
  overview(
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.overview(actor, query);
  }
  @Get("sales-by-product")
  @Access("bookings.read")
  salesByProduct(
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.salesByProduct(actor, query);
  }
  @Get("booking-sources")
  @Access("bookings.read")
  bookingSources(
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.bookingSources(actor, query);
  }
  @Get("partner-statement")
  @Access("partner.statement.read")
  partnerStatement(
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.partnerStatement(actor, query);
  }
  @Get("accounting-journal")
  @Access("partner.statement.read")
  accountingJournal(
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.accountingJournal(actor, query);
  }
  @Get("profit-and-loss")
  @Access("partner.statement.read")
  profitAndLoss(
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.profitAndLoss(actor, query);
  }
  @Get("commission-summary")
  @Access("partner.statement.read")
  commissionSummary(
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.commissionSummary(actor, query);
  }
}
