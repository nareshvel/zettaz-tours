"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@/lib/types";
import { dateOnly, money, useMutation, useResource } from "@/lib/client";
import { downloadCsv } from "@/lib/reports-csv";
import { Empty, Loading, Notice } from "./common";
import { ReportShell, csvHeader, useReportPeriod } from "./reports-shell";

const major = (minor: number) => (minor / 100).toFixed(2);

// ─── Partner statement ───────────────────────────────────────────────────────

type Statement = {
  range: { from: string; to: string };
  tenant: { currency: string; timezone: string };
  partner: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    direction: string | null;
    currency: string;
  };
  openingMinor: number;
  closingMinor: number;
  lines: {
    kind:
      | "booking"
      | "settlement"
      | "settlement_reversal"
      | "settlement_info"
      | "claim";
    date: string;
    description: string;
    reference: string;
    status: string | null;
    currency: string;
    grossMinor: number | null;
    commissionMinor: number | null;
    amountMinor: number;
    balanceMinor: number;
  }[];
};

function balanceLabel(minor: number) {
  if (minor > 0) return "Partner owes us";
  if (minor < 0) return "We owe partner";
  return "Settled";
}

export function PartnerStatementReport({ session }: { session: Session }) {
  const period = useReportPeriod(session, { defaultRange: "last_month" });
  const partners = useResource<{ id: string; name: string; status: string }[]>(
    "finance/v1/partners",
  );
  const [partnerId, setPartnerId] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("partner") ?? ""),
  );
  useEffect(() => {
    if (!partnerId && partners.data?.length) setPartnerId(partners.data[0].id);
  }, [partners.data, partnerId]);
  useEffect(() => {
    if (!partnerId) return;
    const params = new URLSearchParams(window.location.search);
    params.set("partner", partnerId);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${params.toString()}`,
    );
  }, [partnerId, period.query]);

  const statement = useResource<Statement>(
    partnerId
      ? `reports/v1/partner-statement?${new URLSearchParams({ partnerId, from: period.from, to: period.to })}`
      : null,
  );
  const data = statement.data;
  const { locale, dateFormat } = period;
  const cur = (minor: number, c?: string) =>
    money(Math.abs(minor), c ?? data?.partner.currency ?? "USD", locale);

  function exportCsv() {
    if (!data) return;
    downloadCsv(
      `partner-statement-${data.partner.name}-${period.from}-${period.to}.csv`,
      [
        ...csvHeader(
          session,
          `Partner statement — ${data.partner.name}`,
          { ...period, basisLabel: "Entry date" },
          data.partner.currency,
        ),
        ["Opening balance", major(data.openingMinor)],
        [],
        [
          "Date",
          "Type",
          "Description",
          "Reference",
          "Status",
          "Gross",
          "Commission",
          "Amount",
          "Balance",
        ],
        ...data.lines.map((l) => [
          l.date,
          l.kind,
          l.description,
          l.reference,
          l.status ?? "",
          l.grossMinor === null ? "" : major(l.grossMinor),
          l.commissionMinor === null ? "" : major(l.commissionMinor),
          major(l.amountMinor),
          major(l.balanceMinor),
        ]),
        [],
        ["Closing balance", major(data.closingMinor)],
      ],
    );
  }

  const picker = (
    <>
      <select
        className="report-select"
        aria-label="Partner"
        value={partnerId}
        onChange={(e) => setPartnerId(e.target.value)}
      >
        {(partners.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.status === "inactive" ? " (inactive)" : ""}
          </option>
        ))}
      </select>
      {period.filters}
    </>
  );

  return (
    <ReportShell
      title="Partner statement"
      basis="Printable statement · use Print → Save as PDF to send"
      filters={picker}
      onExport={exportCsv}
      exportDisabled={!data}
    >
      {partners.error ? (
        <Notice error>{partners.error}</Notice>
      ) : partners.data && !partners.data.length ? (
        <Empty title="No partners yet">
          <p>
            Add partners in{" "}
            <Link href="/finance/partners">Finance → Partners</Link>.
          </p>
        </Empty>
      ) : statement.error ? (
        <Notice error>{statement.error}</Notice>
      ) : !data ? (
        <Loading />
      ) : (
        <article className="statement-sheet">
          <header className="statement-head">
            <div>
              <p className="eyebrow">STATEMENT OF ACCOUNT</p>
              <h2>{data.partner.name}</h2>
              <p className="muted">
                {[data.partner.email, data.partner.phone]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="statement-meta">
              <strong>{session.tenant.name}</strong>
              <span>
                {dateOnly(period.from, dateFormat, locale)} –{" "}
                {dateOnly(period.to, dateFormat, locale)}
              </span>
              <span className="muted">{data.partner.currency}</span>
            </div>
          </header>
          <section className="statement-summary">
            <div>
              <span>Opening balance</span>
              <strong>{cur(data.openingMinor)}</strong>
              <small>{balanceLabel(data.openingMinor)}</small>
            </div>
            <div>
              <span>Activity</span>
              <strong>{data.lines.length} entries</strong>
              <small>
                {data.lines.filter((l) => l.kind === "booking").length} bookings
              </small>
            </div>
            <div className={data.closingMinor !== 0 ? "attention" : ""}>
              <span>Closing balance</span>
              <strong>{cur(data.closingMinor)}</strong>
              <small>{balanceLabel(data.closingMinor)}</small>
            </div>
          </section>
          <div className="table-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Reference</th>
                  <th className="num">Gross</th>
                  <th className="num">Commission</th>
                  <th className="num">Amount</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="muted">
                  <td>{dateOnly(period.from, dateFormat, locale)}</td>
                  <td colSpan={5}>Opening balance</td>
                  <td className="num">{cur(data.openingMinor)}</td>
                </tr>
                {data.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{dateOnly(l.date, dateFormat, locale)}</td>
                    <td>
                      {l.description}
                      {l.kind === "settlement" && l.status !== "paid" && (
                        <small className="muted">
                          {" "}
                          · {l.status} (not yet paid)
                        </small>
                      )}
                    </td>
                    <td>{l.reference}</td>
                    <td className="num">
                      {l.grossMinor === null
                        ? ""
                        : cur(l.grossMinor, l.currency)}
                    </td>
                    <td className="num">
                      {l.commissionMinor === null
                        ? ""
                        : cur(l.commissionMinor, l.currency)}
                    </td>
                    <td className="num">
                      {l.amountMinor === 0
                        ? "—"
                        : `${l.amountMinor < 0 ? "−" : ""}${cur(l.amountMinor, l.currency)}`}
                    </td>
                    <td className="num">
                      {l.balanceMinor < 0 ? "−" : ""}
                      {cur(l.balanceMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={6}>
                    Closing balance · {balanceLabel(data.closingMinor)}
                  </th>
                  <th className="num">{cur(data.closingMinor)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted statement-foot">
            Positive balance: partner owes {session.tenant.name}. Commission is
            fixed on each booking when it is linked. Only paid settlements
            change the balance.
          </p>
        </article>
      )}
    </ReportShell>
  );
}

// ─── Profit & loss ───────────────────────────────────────────────────────────

type Pnl = {
  range: { from: string; to: string };
  currency: string;
  revenueMinor: number;
  taxCollectedMinor: number;
  confirmedBookings: number;
  commissionMinor: number;
  grossProfitMinor: number;
  expenses: { category: string; amountMinor: number }[];
  expenseTotalMinor: number;
  netMinor: number;
  excluded: { bookings: number; commissions: number; expenses: number };
};

export function ProfitAndLossReport({ session }: { session: Session }) {
  const period = useReportPeriod(session, { defaultRange: "month" });
  const report = useResource<Pnl>(
    `reports/v1/profit-and-loss?${new URLSearchParams({ from: period.from, to: period.to })}`,
  );
  const data = report.data;
  const m = (minor: number) =>
    money(minor, data?.currency ?? "USD", period.locale);
  const excludedTotal = data
    ? data.excluded.bookings +
      data.excluded.commissions +
      data.excluded.expenses
    : 0;

  function exportCsv() {
    if (!data) return;
    downloadCsv(`profit-and-loss-${period.from}-${period.to}.csv`, [
      ...csvHeader(
        session,
        "Management P&L",
        {
          ...period,
          basisLabel: "Departure date (revenue), expense date (costs)",
        },
        data.currency,
      ),
      ["Line", "Amount"],
      ["Tour revenue (net of tax)", major(data.revenueMinor)],
      ["Partner commission", major(-data.commissionMinor)],
      ["Gross profit", major(data.grossProfitMinor)],
      ...data.expenses.map((e) => [
        `Expense: ${e.category}`,
        major(-e.amountMinor),
      ]),
      ["Total operating expenses", major(-data.expenseTotalMinor)],
      ["Net operating result", major(data.netMinor)],
      [],
      ["Memo: tax collected", major(data.taxCollectedMinor)],
    ]);
  }

  return (
    <ReportShell
      title="Profit & loss"
      basis="Management view · revenue on departure date · not a tax filing"
      filters={period.filters}
      onExport={exportCsv}
      exportDisabled={!data}
    >
      {report.error ? (
        <Notice error>{report.error}</Notice>
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <p className="muted report-range-note">
            Showing <strong>{period.rangeHint}</strong> · {data.currency}
          </p>
          <section className="metric-grid report-metrics compact">
            <div className="metric-card">
              <span>Revenue</span>
              <strong>{m(data.revenueMinor)}</strong>
              <small>{data.confirmedBookings} confirmed bookings</small>
            </div>
            <div className="metric-card">
              <span>Costs</span>
              <strong>
                {m(data.commissionMinor + data.expenseTotalMinor)}
              </strong>
              <small>commission + expenses</small>
            </div>
            <div
              className={
                "metric-card" + (data.netMinor < 0 ? " attention" : "")
              }
            >
              <span>Net operating result</span>
              <strong>{m(data.netMinor)}</strong>
              <small>
                {data.revenueMinor
                  ? `${Math.round((data.netMinor / data.revenueMinor) * 100)}% margin`
                  : "no revenue"}
              </small>
            </div>
          </section>
          <section className="panel">
            <table className="report-table pnl-table">
              <tbody>
                <tr>
                  <td>Tour revenue (net of tax)</td>
                  <td className="num">{m(data.revenueMinor)}</td>
                </tr>
                <tr>
                  <td>Less partner commission</td>
                  <td className="num">−{m(data.commissionMinor)}</td>
                </tr>
                <tr className="pnl-subtotal">
                  <th>Gross profit</th>
                  <th className="num">{m(data.grossProfitMinor)}</th>
                </tr>
                {data.expenses.map((e) => (
                  <tr key={e.category}>
                    <td className="pnl-indent">{e.category}</td>
                    <td className="num">−{m(e.amountMinor)}</td>
                  </tr>
                ))}
                <tr>
                  <td>Total operating expenses</td>
                  <td className="num">−{m(data.expenseTotalMinor)}</td>
                </tr>
                <tr className="pnl-total">
                  <th>Net operating result</th>
                  <th className="num">{m(data.netMinor)}</th>
                </tr>
                <tr className="muted">
                  <td>Memo: tax collected (liability, not revenue)</td>
                  <td className="num">{m(data.taxCollectedMinor)}</td>
                </tr>
              </tbody>
            </table>
          </section>
          {excludedTotal > 0 && (
            <Notice>
              {excludedTotal} item{excludedTotal === 1 ? " is" : "s are"} in
              another currency without a recorded rate and excluded (
              {data.excluded.bookings} bookings, {data.excluded.commissions}{" "}
              commissions, {data.excluded.expenses} expenses).
            </Notice>
          )}
          <Notice>
            Management view for the owner and accountant. Revenue is recognised
            when the tour departs, from each booking&apos;s frozen price.
            Expenses use the reporting amount recorded on each bill. For tax
            returns, use the accounting export.
          </Notice>
        </>
      )}
    </ReportShell>
  );
}

// ─── Accounting export ───────────────────────────────────────────────────────

type Accounts = {
  incomeAccount: string;
  guestReceiptsAccount: string;
  cashAccount: string;
  bankAccount: string;
  accountsPayable: string;
  commissionExpense: string;
  defaultExpenseAccount: string;
};

type JournalResponse = {
  range: { from: string; to: string };
  currency: string;
  accounts: Accounts;
  journals: {
    number: number;
    date: string;
    source: string;
    reference: string;
    description: string;
    name: string;
    lines: { account: string; debit: number; credit: number }[];
  }[];
  totals: { debit: number; credit: number };
  excludedOtherCurrency: number;
};

const ACCOUNT_LABELS: [keyof Accounts, string, string][] = [
  [
    "incomeAccount",
    "Tour income",
    "Credited for guest payments and partner remittances",
  ],
  [
    "guestReceiptsAccount",
    "Guest card / transfer receipts",
    "Debited for non-cash guest payments",
  ],
  [
    "cashAccount",
    "Cash",
    "Debited for cash guest payments; credited for cash expense payments",
  ],
  ["bankAccount", "Bank", "Expense payments and partner settlements"],
  ["accountsPayable", "Accounts payable", "Expense bills and their payments"],
  ["commissionExpense", "Commission expense", "Partner commission"],
  [
    "defaultExpenseAccount",
    "Default expense account",
    "Used when an expense category has no code",
  ],
];

export function AccountingExportReport({ session }: { session: Session }) {
  const period = useReportPeriod(session, { defaultRange: "last_month" });
  const report = useResource<JournalResponse>(
    `reports/v1/accounting-journal?${new URLSearchParams({ from: period.from, to: period.to })}`,
  );
  const data = report.data;
  const canEdit = session.permissions.includes("config.write");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Accounts | null>(null);
  const mutation = useMutation();
  useEffect(() => {
    if (data && !draft) setDraft(data.accounts);
  }, [data, draft]);

  const m = (minor: number) =>
    minor ? money(minor, data?.currency ?? "USD", period.locale) : "";

  function exportCsv() {
    if (!data) return;
    // QuickBooks Online → Import Data → Journal Entries column set.
    downloadCsv(`journal-${period.from}-${period.to}.csv`, [
      [
        "JournalNo",
        "JournalDate",
        "AccountName",
        "Debits",
        "Credits",
        "Description",
        "Name",
        "Currency",
        "Memo",
      ],
      ...data.journals.flatMap((j) =>
        j.lines.map((l) => [
          `ZT-${j.number}`,
          j.date,
          l.account,
          l.debit ? major(l.debit) : "",
          l.credit ? major(l.credit) : "",
          j.description,
          j.name,
          data.currency,
          `${j.source}${j.reference ? ` · ${j.reference}` : ""}`,
        ]),
      ),
    ]);
  }

  async function saveAccounts(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const config = (session.tenant.config ?? {}) as Record<string, unknown>;
    const ok = await mutation.run(
      "admin/v1/tenant/config",
      {
        version: session.tenant.version,
        config: { ...config, accounting: draft },
      },
      "PATCH",
    );
    if (ok) {
      setEditing(false);
      window.location.reload();
    }
  }

  const balanced = data ? data.totals.debit === data.totals.credit : true;

  return (
    <ReportShell
      title="Accounting export"
      basis="Cash-basis journal · QuickBooks Online journal import CSV"
      filters={period.filters}
      onExport={exportCsv}
      exportDisabled={!data || !data.journals.length}
    >
      {report.error ? (
        <Notice error>{report.error}</Notice>
      ) : !data || !draft ? (
        <Loading />
      ) : (
        <>
          <p className="muted report-range-note">
            Showing <strong>{period.rangeHint}</strong> · {data.journals.length}{" "}
            journals · {data.currency} ·{" "}
            {balanced ? "balanced" : "NOT balanced"}
          </p>

          <section className="panel accounting-map no-print">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">CHART OF ACCOUNTS</p>
                <h2>Account mapping</h2>
              </div>
              {canEdit && !editing && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setEditing(true)}
                >
                  Edit mapping
                </button>
              )}
            </div>
            {editing ? (
              <form className="accounting-map-form" onSubmit={saveAccounts}>
                {ACCOUNT_LABELS.map(([key, label, hint]) => (
                  <label key={key} className="field">
                    <span>{label}</span>
                    <input
                      value={draft[key]}
                      maxLength={80}
                      required
                      onChange={(e) =>
                        setDraft({ ...draft, [key]: e.target.value })
                      }
                    />
                    <small className="muted">{hint}</small>
                  </label>
                ))}
                {mutation.error && <Notice error>{mutation.error}</Notice>}
                <div className="accounting-map-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setDraft(data.accounts);
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="button"
                    disabled={mutation.busy}
                  >
                    {mutation.busy ? "Saving…" : "Save mapping"}
                  </button>
                </div>
              </form>
            ) : (
              <dl className="accounting-map-list">
                {ACCOUNT_LABELS.map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{data.accounts[key]}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="muted accounting-map-note">
              Expense bills post to the expense category&apos;s{" "}
              <strong>code</strong> (or its name). Use the exact account names
              from your accountant&apos;s chart.
            </p>
          </section>

          {!data.journals.length ? (
            <Empty title="Nothing to export for this period">
              <p>
                Guest payments, expense bills, expense payments, and paid
                partner settlements appear here.
              </p>
            </Empty>
          ) : (
            <section className="panel">
              <div className="table-scroll">
                <table className="report-table journal-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Date</th>
                      <th>Source</th>
                      <th>Account</th>
                      <th className="num">Debit</th>
                      <th className="num">Credit</th>
                      <th>Name / memo</th>
                    </tr>
                  </thead>
                  {data.journals.map((j) => (
                    <tbody key={j.number} className="journal-group">
                      {j.lines.map((l, i) => (
                        <tr key={i}>
                          <td>{i === 0 ? `ZT-${j.number}` : ""}</td>
                          <td>
                            {i === 0
                              ? dateOnly(
                                  j.date,
                                  period.dateFormat,
                                  period.locale,
                                )
                              : ""}
                          </td>
                          <td>{i === 0 ? j.source : ""}</td>
                          <td className={l.credit ? "journal-credit" : ""}>
                            {l.account}
                          </td>
                          <td className="num">{m(l.debit)}</td>
                          <td className="num">{m(l.credit)}</td>
                          <td className="muted">
                            {i === 0
                              ? [j.name, j.description]
                                  .filter(Boolean)
                                  .join(" · ")
                              : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                  <tfoot>
                    <tr>
                      <th colSpan={4}>Totals</th>
                      <th className="num">{m(data.totals.debit)}</th>
                      <th className="num">{m(data.totals.credit)}</th>
                      <th />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}
          {data.excludedOtherCurrency > 0 && (
            <Notice>
              {data.excludedOtherCurrency} fact
              {data.excludedOtherCurrency === 1 ? " is" : "s are"} in another
              currency and not exported until an FX policy is approved.
            </Notice>
          )}
          <Notice>
            Cash basis: only money that moved (guest payments, expense bills and
            payments, paid partner settlements). Open guest balances are never
            posted. Voided bills are left out; payment voids post a reversing
            journal on the void date.
          </Notice>
        </>
      )}
    </ReportShell>
  );
}
