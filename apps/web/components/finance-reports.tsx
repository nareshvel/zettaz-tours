"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Session } from "@/lib/types";
import { money, formatMediumDate, useResource } from "@/lib/client";
import { downloadCsv } from "@/lib/reports-csv";
import { Empty, Loading, Notice, TenantDateInput } from "./common";
import { PERIOD_LABELS, periodDates, type PeriodKey } from "./finance";
import { ReportFilterBar, ReportShell } from "./reports-shell";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExpenseSummaryResponse = {
  category_totals: {
    category_name: string;
    total_minor: number;
    total_reporting_minor: number | null;
    currency: string;
  }[];
  period?: {
    recorded_reporting_minor: number;
    outstanding_reporting_minor: number;
    paid_reporting_minor: number;
  };
  currency: string;
};

function tenantDay(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function ExpenseSummary({ session }: { session: Session }) {
  const timezone = session.tenant.timezone;
  const today = tenantDay(timezone);
  const [period, setPeriod] = useState<PeriodKey>("this_year");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [periodOpen, setPeriodOpen] = useState(false);
  const periodRef = useRef<HTMLDivElement>(null);
  const { from, to } = useMemo(
    () => periodDates(period, customFrom, customTo, timezone),
    [period, customFrom, customTo, timezone],
  );
  const { data, error } = useResource<ExpenseSummaryResponse>(
    `finance/v1/expenses?dateFrom=${from}&dateTo=${to}`,
  );
  const reporting =
    session.tenant.config.reportingCurrency ?? data?.currency ?? "USD";
  const totals = data?.category_totals ?? [];
  const grand = useMemo(
    () => totals.reduce((sum, row) => sum + (row.total_reporting_minor ?? 0), 0),
    [totals],
  );

  function exportCsv() {
    downloadCsv(`expense-summary-${from}-${to}.csv`, [
      ["From", from],
      ["To", to],
      ["Reporting currency", reporting],
      [],
      ["Recorded reporting minor", data?.period?.recorded_reporting_minor ?? ""],
      ["Paid reporting minor", data?.period?.paid_reporting_minor ?? ""],
      ["Outstanding reporting minor", data?.period?.outstanding_reporting_minor ?? ""],
      [],
      ["Category", "Currency", "Recorded minor", "Reporting minor"],
      ...totals.map((row) => [
        row.category_name,
        row.currency,
        row.total_minor,
        row.total_reporting_minor ?? "",
      ]),
    ]);
  }

  const presets: { value: PeriodKey; caption: string }[] = [
    { value: "this_week", caption: "This week" },
    { value: "this_month", caption: "This month" },
    { value: "last_month", caption: "Last month" },
    { value: "this_year", caption: "This year" },
    { value: "last_year", caption: "Last year" },
    { value: "custom", caption: "Custom" },
  ];

  function selectPeriod(next: PeriodKey) {
    setPeriod(next);
    if (next === "custom") {
      setCustomFrom(from);
      setCustomTo(to);
      return;
    }
    setPeriodOpen(false);
  }

  useEffect(() => {
    if (!periodOpen) return;
    const close = (event: MouseEvent) => {
      if (
        periodRef.current?.contains(event.target as Node) ||
        document.getElementById("tdp-popup")?.contains(event.target as Node)
      ) {
        return;
      }
      setPeriodOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [periodOpen]);

  const dateFormat = session.tenant.config.dateFormat as
    | "DD/MM/YYYY"
    | "MM/DD/YYYY"
    | "YYYY-MM-DD";
  const locale = session.tenant.config.locale;

  return (
    <ReportShell
      title="Expense summary"
      filters={
        <>
          <div className="filter-menu report-filter-menu" ref={periodRef}>
            <button
              type="button"
              className={
                "button secondary catalog-add-btn" +
                (periodOpen ? " active-filter" : "")
              }
              aria-label="Report date range"
              aria-expanded={periodOpen}
              aria-haspopup="listbox"
              onClick={() => setPeriodOpen((open) => !open)}
            >
              <span className="button-label">{PERIOD_LABELS[period]}</span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            {periodOpen && (
              <div
                className="filter-popover"
                role="listbox"
                aria-label="Report date range"
              >
                {presets.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="option"
                    aria-selected={period === item.value}
                    className={
                      "filter-range-option" +
                      (period === item.value ? " selected" : "")
                    }
                    onClick={() => selectPeriod(item.value)}
                  >
                    {item.caption}
                  </button>
                ))}
                {period === "custom" && (
                  <div className="report-custom-dates">
                    <TenantDateInput
                      label="From"
                      value={customFrom}
                      max={customTo || undefined}
                      onChange={(v) => v && setCustomFrom(v)}
                      compact
                      dateFormat={dateFormat}
                      locale={locale}
                    />
                    <TenantDateInput
                      label="To"
                      value={customTo}
                      min={customFrom || undefined}
                      onChange={(v) => v && setCustomTo(v)}
                      compact
                      dateFormat={dateFormat}
                      locale={locale}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      }
      onExport={exportCsv}
      exportDisabled={!data}
    >
      {error && <Notice error>{error}</Notice>}
      {!data && !error && <Loading />}
      {data && data.period && (
        <p className="muted report-range-note">
          Recorded {money(data.period.recorded_reporting_minor, reporting)}
          {" · "}
          Paid {money(data.period.paid_reporting_minor, reporting)}
          {" · "}
          Outstanding {money(data.period.outstanding_reporting_minor, reporting)}
        </p>
      )}
      {data && totals.length === 0 && (
        <Empty title="No expenses in this period">
          <p>Record operating costs under Finance → Expenses.</p>
        </Empty>
      )}
      {data && totals.length > 0 && (
        <div className="table-scroll">
          <table className="aging-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num-col">Currency</th>
                <th className="num-col">Recorded</th>
                <th className="num-col">Reporting</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((row) => (
                <tr key={`${row.category_name}-${row.currency}`}>
                  <td>{row.category_name}</td>
                  <td className="num-col">{row.currency}</td>
                  <td className="num-col">
                    {money(row.total_minor, row.currency)}
                  </td>
                  <td className="num-col">
                    {row.total_reporting_minor == null
                      ? "—"
                      : money(row.total_reporting_minor, reporting)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total (reporting)</td>
                <td className="num-col">{money(grand, reporting)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ReportShell>
  );
}

type AgingBucket = {
  currency: string;
  current_minor: number;
  days_1_30_minor: number;
  days_31_60_minor: number;
  days_61_90_minor: number;
  days_90_plus_minor: number;
  total_minor: number;
};

type AgingPartnerRow = {
  partner_id: string;
  partner_name: string;
  direction: "payable" | "receivable";
  buckets: AgingBucket[];
};

type AgingResponse = {
  reporting_currency: string;
  as_of: string;
  direction: string;
  rows: AgingPartnerRow[];
  totals_by_currency: ({ currency: string } & Omit<AgingBucket, "currency">)[];
  partner_list: { id: string; name: string }[];
};

// ─── Severity helper ─────────────────────────────────────────────────────────

function rowSeverity(buckets: AgingBucket[]): "green" | "amber" | "red" {
  const overdue60 = buckets.reduce(
    (s, b) => s + b.days_61_90_minor + b.days_90_plus_minor,
    0,
  );
  if (overdue60 > 0) return "red";
  const overdue30 = buckets.reduce(
    (s, b) => s + b.days_1_30_minor + b.days_31_60_minor,
    0,
  );
  if (overdue30 > 0) return "amber";
  return "green";
}

// ─── Single bucket amount ─────────────────────────────────────────────────────

function BucketAmt({ minor, currency }: { minor: number; currency: string }) {
  if (minor === 0) return <span className="aging-dash">—</span>;
  return <span>{money(minor, currency)}</span>;
}

// ─── Aging report ─────────────────────────────────────────────────────────────

export function AgingReport({ session }: { session: Session }) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: session.tenant.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const [asOf, setAsOf] = useState(today);
  const [direction, setDirection] = useState<"both" | "payable" | "receivable">(
    "both",
  );
  const [partnerId, setPartnerId] = useState("");
  const [directionOpen, setDirectionOpen] = useState(false);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const directionRef = useRef<HTMLDivElement>(null);
  const partnerRef = useRef<HTMLDivElement>(null);

  // Build query string — only append filters that differ from defaults
  const qs = new URLSearchParams();
  if (asOf !== today) qs.set("asOf", asOf);
  if (direction !== "both") qs.set("direction", direction);
  if (partnerId) qs.set("partnerId", partnerId);
  const qstr = qs.toString();

  const { data, error } = useResource<AgingResponse>(
    `finance/v1/finance-aging${qstr ? "?" + qstr : ""}`,
  );

  const resetFilters = useCallback(() => {
    setAsOf(today);
    setDirection("both");
    setPartnerId("");
  }, [today]);

  const partnerList = data?.partner_list ?? [];

  useEffect(() => {
    if (!directionOpen && !partnerOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        directionRef.current?.contains(target) ||
        partnerRef.current?.contains(target)
      ) {
        return;
      }
      setDirectionOpen(false);
      setPartnerOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [directionOpen, partnerOpen]);

  const locale = session.tenant.config.locale;
  const directionLabel =
    direction === "payable"
      ? "We owe"
      : direction === "receivable"
        ? "Owed to us"
        : "All directions";
  const partnerLabel =
    partnerList.find((partner) => partner.id === partnerId)?.name ??
    "All partners";
  const filterSummary = [
    formatMediumDate(asOf, locale),
    directionLabel,
    partnerId ? partnerLabel : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function exportCsv() {
    if (!data) return;
    const rows: (string | number)[][] = [
      ["As of", data.as_of],
      ["Direction", data.direction],
      [],
      [
        "Partner",
        "Type",
        "Currency",
        "Current minor",
        "1-30 minor",
        "31-60 minor",
        "61-90 minor",
        "90+ minor",
        "Total minor",
      ],
    ];
    for (const r of data.rows) {
      for (const b of r.buckets) {
        rows.push([
          r.partner_name,
          r.direction,
          b.currency,
          b.current_minor,
          b.days_1_30_minor,
          b.days_31_60_minor,
          b.days_61_90_minor,
          b.days_90_plus_minor,
          b.total_minor,
        ]);
      }
    }
    downloadCsv(`partner-aging-${data.as_of}.csv`, rows);
  }

  const filters = (
    <ReportFilterBar summary={filterSummary}>
      <TenantDateInput
        label="As of"
        value={asOf}
        onChange={(v) => setAsOf(v || today)}
        max={today}
        dateFormat={
          session.tenant.config.dateFormat as
            | "DD/MM/YYYY"
            | "MM/DD/YYYY"
            | "YYYY-MM-DD"
        }
        locale={session.tenant.config.locale}
        compact
      />

      <div className="filter-menu report-filter-menu" ref={directionRef}>
        <button
          type="button"
          className={
            "button secondary catalog-add-btn" +
            (directionOpen ? " active-filter" : "")
          }
          aria-label="Aging direction"
          aria-expanded={directionOpen}
          aria-haspopup="listbox"
          onClick={() => {
            setPartnerOpen(false);
            setDirectionOpen((open) => !open);
          }}
        >
          <span className="button-label">{directionLabel}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {directionOpen && (
          <div
            className="filter-popover"
            role="listbox"
            aria-label="Aging direction"
          >
            {(
              [
                ["both", "All directions"],
                ["payable", "We owe"],
                ["receivable", "Owed to us"],
              ] as const
            ).map(([value, caption]) => (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={direction === value}
                className={
                  "filter-range-option" +
                  (direction === value ? " selected" : "")
                }
                onClick={() => {
                  setDirection(value);
                  setDirectionOpen(false);
                }}
              >
                {caption}
              </button>
            ))}
          </div>
        )}
      </div>

      {partnerList.length > 0 && (
        <div className="filter-menu report-filter-menu" ref={partnerRef}>
          <button
            type="button"
            className={
              "button secondary catalog-add-btn" +
              (partnerOpen ? " active-filter" : "")
            }
            aria-label="Partner"
            aria-expanded={partnerOpen}
            aria-haspopup="listbox"
            onClick={() => {
              setDirectionOpen(false);
              setPartnerOpen((open) => !open);
            }}
          >
            <span className="button-label">{partnerLabel}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {partnerOpen && (
            <div className="filter-popover" role="listbox" aria-label="Partner">
              <button
                type="button"
                role="option"
                aria-selected={!partnerId}
                className={
                  "filter-range-option" + (!partnerId ? " selected" : "")
                }
                onClick={() => {
                  setPartnerId("");
                  setPartnerOpen(false);
                }}
              >
                All partners
              </button>
              {partnerList.map((partner) => (
                <button
                  key={partner.id}
                  type="button"
                  role="option"
                  aria-selected={partnerId === partner.id}
                  className={
                    "filter-range-option" +
                    (partnerId === partner.id ? " selected" : "")
                  }
                  onClick={() => {
                    setPartnerId(partner.id);
                    setPartnerOpen(false);
                  }}
                >
                  {partner.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {(asOf !== today || direction !== "both" || partnerId) && (
        <button
          type="button"
          className="button secondary catalog-add-btn"
          onClick={resetFilters}
        >
          Reset
        </button>
      )}
    </ReportFilterBar>
  );

  return (
    <ReportShell
      title="Partner aging"
      filters={filters}
      onExport={exportCsv}
      exportDisabled={!data || data.rows.length === 0}
    >

      {/* Report body */}
      {error && <Notice error>{error}</Notice>}

      {!error && data && data.rows.length === 0 && (
        <Empty title="No outstanding balances">
          <p>Nothing matches this filter — partners in range are settled.</p>
        </Empty>
      )}

      {!error && data && data.rows.length > 0 && (
        <div className="table-scroll">
          <table className="aging-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th
                  style={{
                    textAlign: "center",
                    fontSize: "0.72rem",
                    padding: "4px 8px",
                  }}
                >
                  Type
                </th>
                <th className="num-col">Currency</th>
                <th className="num-col">Current</th>
                <th className="num-col">1–30 days</th>
                <th className="num-col">31–60 days</th>
                <th className="num-col">61–90 days</th>
                <th className="num-col">90+ days</th>
                <th className="num-col">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const severity = rowSeverity(r.buckets);
                const rowClass = `aging-row aging-${severity}`;
                return r.buckets.map((b, bi) => (
                  <tr
                    key={`${r.partner_id}-${b.currency}`}
                    className={rowClass}
                  >
                    {/* Partner cell spans all currency rows */}
                    {bi === 0 && (
                      <>
                        <td
                          rowSpan={r.buckets.length}
                          className="aging-partner-cell"
                        >
                          <a
                            href={`/finance/partners/${r.partner_id}`}
                            className="aging-partner-link"
                          >
                            {r.partner_name}
                          </a>
                          {severity !== "green" && (
                            <span
                              className={`aging-severity-dot aging-severity-${severity}`}
                              title={
                                severity === "red"
                                  ? "61+ days overdue"
                                  : "1–60 days overdue"
                              }
                            />
                          )}
                        </td>
                        <td
                          rowSpan={r.buckets.length}
                          style={{ textAlign: "center" }}
                        >
                          <span
                            className={`aging-dir-badge aging-dir-${r.direction}`}
                          >
                            {r.direction === "payable"
                              ? "Payable"
                              : "Receivable"}
                          </span>
                        </td>
                      </>
                    )}
                    <td className="num-col aging-currency-cell">
                      {b.currency}
                    </td>
                    <td className="num-col">
                      <BucketAmt
                        minor={b.current_minor}
                        currency={b.currency}
                      />
                    </td>
                    <td className="num-col">
                      <BucketAmt
                        minor={b.days_1_30_minor}
                        currency={b.currency}
                      />
                    </td>
                    <td
                      className={`num-col ${b.days_31_60_minor > 0 ? "aging-amber-text" : ""}`}
                    >
                      <BucketAmt
                        minor={b.days_31_60_minor}
                        currency={b.currency}
                      />
                    </td>
                    <td
                      className={`num-col ${b.days_61_90_minor > 0 ? "aging-red-text" : ""}`}
                    >
                      <BucketAmt
                        minor={b.days_61_90_minor}
                        currency={b.currency}
                      />
                    </td>
                    <td
                      className={`num-col ${b.days_90_plus_minor > 0 ? "aging-red-text" : ""}`}
                    >
                      <BucketAmt
                        minor={b.days_90_plus_minor}
                        currency={b.currency}
                      />
                    </td>
                    <td className="num-col total-col">
                      {money(b.total_minor, b.currency)}
                    </td>
                  </tr>
                ));
              })}
            </tbody>

            {/* Footer totals — one row per currency */}
            {data.totals_by_currency.length > 0 && (
              <tfoot>
                {data.totals_by_currency.map((t) => (
                  <tr key={t.currency} className="aging-footer-row">
                    <td colSpan={2} className="aging-footer-label">
                      Total
                    </td>
                    <td className="num-col aging-currency-cell">
                      {t.currency}
                    </td>
                    <td className="num-col">
                      {money(t.current_minor, t.currency)}
                    </td>
                    <td className="num-col">
                      {money(t.days_1_30_minor, t.currency)}
                    </td>
                    <td className="num-col">
                      {money(t.days_31_60_minor, t.currency)}
                    </td>
                    <td className="num-col">
                      {money(t.days_61_90_minor, t.currency)}
                    </td>
                    <td className="num-col">
                      {money(t.days_90_plus_minor, t.currency)}
                    </td>
                    <td className="num-col total-col">
                      {money(t.total_minor, t.currency)}
                    </td>
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="aging-legend">
        <span className="aging-legend-item">
          <span className="aging-severity-dot aging-severity-green" /> Current
          only
        </span>
        <span className="aging-legend-item">
          <span className="aging-severity-dot aging-severity-amber" /> 1–60 days
          overdue
        </span>
        <span className="aging-legend-item">
          <span className="aging-severity-dot aging-severity-red" /> 60+ days
          overdue
        </span>
      </div>
    </ReportShell>
  );
}

