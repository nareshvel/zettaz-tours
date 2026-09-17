"use client";

import { BarChart2, FileText, TrendingUp, Users } from "lucide-react";
import { useCallback, useState } from "react";
import type { Session } from "@/lib/types";
import { money, useResource } from "@/lib/client";
import { TenantDateInput } from "./common";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  const overdue60 = buckets.reduce((s, b) => s + b.days_61_90_minor + b.days_90_plus_minor, 0);
  if (overdue60 > 0) return "red";
  const overdue30 = buckets.reduce((s, b) => s + b.days_1_30_minor + b.days_31_60_minor, 0);
  if (overdue30 > 0) return "amber";
  return "green";
}

// ─── Single bucket amount ─────────────────────────────────────────────────────

function BucketAmt({ minor, currency }: { minor: number; currency: string }) {
  if (minor === 0) return <span className="aging-dash">—</span>;
  return <span>{money(minor, currency)}</span>;
}

// ─── Aging report ─────────────────────────────────────────────────────────────

function AgingReport({ session }: { session: Session }) {
  const today = new Date().toISOString().slice(0, 10);

  const [asOf, setAsOf] = useState(today);
  const [direction, setDirection] = useState<"both" | "payable" | "receivable">("both");
  const [partnerId, setPartnerId] = useState("");

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

  return (
    <div className="aging-report-wrap">
      {/* Filter bar */}
      <div className="aging-filters">
        <TenantDateInput
          label="As of"
          value={asOf}
          onChange={(v) => setAsOf(v || today)}
          max={today}
          dateFormat={session.tenant.config.dateFormat as "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD"}
          locale={session.tenant.config.locale}
          compact
        />

        <label className="aging-filter-group">
          <span className="aging-filter-label">Direction</span>
          <select
            className="select-sm"
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
          >
            <option value="both">All</option>
            <option value="payable">Payable (we owe)</option>
            <option value="receivable">Receivable (owed to us)</option>
          </select>
        </label>

        {partnerList.length > 0 && (
          <label className="aging-filter-group">
            <span className="aging-filter-label">Partner</span>
            <select
              className="select-sm"
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
            >
              <option value="">All partners</option>
              {partnerList.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}

        {(asOf !== today || direction !== "both" || partnerId) && (
          <button className="btn-ghost btn-sm" onClick={resetFilters}>
            Reset
          </button>
        )}
      </div>

      {/* Report body */}
      {error && (
        <div className="report-unavailable">
          <p>Aging report unavailable — please try again shortly.</p>
        </div>
      )}

      {!error && data && data.rows.length === 0 && (
        <div className="report-empty">
          <p>No outstanding balances match this filter — all partners are settled.</p>
        </div>
      )}

      {!error && data && data.rows.length > 0 && (
        <div className="table-scroll">
          <table className="aging-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th style={{ textAlign: "center", fontSize: "0.72rem", padding: "4px 8px" }}>Type</th>
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
                  <tr key={`${r.partner_id}-${b.currency}`} className={rowClass}>
                    {/* Partner cell spans all currency rows */}
                    {bi === 0 && (
                      <>
                        <td rowSpan={r.buckets.length} className="aging-partner-cell">
                          <a
                            href={`/finance/partners/${r.partner_id}`}
                            className="aging-partner-link"
                          >
                            {r.partner_name}
                          </a>
                          {severity !== "green" && (
                            <span
                              className={`aging-severity-dot aging-severity-${severity}`}
                              title={severity === "red" ? "61+ days overdue" : "1–60 days overdue"}
                            />
                          )}
                        </td>
                        <td
                          rowSpan={r.buckets.length}
                          style={{ textAlign: "center" }}
                        >
                          <span className={`aging-dir-badge aging-dir-${r.direction}`}>
                            {r.direction === "payable" ? "Payable" : "Receivable"}
                          </span>
                        </td>
                      </>
                    )}
                    <td className="num-col aging-currency-cell">{b.currency}</td>
                    <td className="num-col"><BucketAmt minor={b.current_minor} currency={b.currency} /></td>
                    <td className="num-col"><BucketAmt minor={b.days_1_30_minor} currency={b.currency} /></td>
                    <td className={`num-col ${b.days_31_60_minor > 0 ? "aging-amber-text" : ""}`}>
                      <BucketAmt minor={b.days_31_60_minor} currency={b.currency} />
                    </td>
                    <td className={`num-col ${b.days_61_90_minor > 0 ? "aging-red-text" : ""}`}>
                      <BucketAmt minor={b.days_61_90_minor} currency={b.currency} />
                    </td>
                    <td className={`num-col ${b.days_90_plus_minor > 0 ? "aging-red-text" : ""}`}>
                      <BucketAmt minor={b.days_90_plus_minor} currency={b.currency} />
                    </td>
                    <td className="num-col total-col">{money(b.total_minor, b.currency)}</td>
                  </tr>
                ));
              })}
            </tbody>

            {/* Footer totals — one row per currency */}
            {data.totals_by_currency.length > 0 && (
              <tfoot>
                {data.totals_by_currency.map((t) => (
                  <tr key={t.currency} className="aging-footer-row">
                    <td colSpan={2} className="aging-footer-label">Total</td>
                    <td className="num-col aging-currency-cell">{t.currency}</td>
                    <td className="num-col">{money(t.current_minor, t.currency)}</td>
                    <td className="num-col">{money(t.days_1_30_minor, t.currency)}</td>
                    <td className="num-col">{money(t.days_31_60_minor, t.currency)}</td>
                    <td className="num-col">{money(t.days_61_90_minor, t.currency)}</td>
                    <td className="num-col">{money(t.days_90_plus_minor, t.currency)}</td>
                    <td className="num-col total-col">{money(t.total_minor, t.currency)}</td>
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
          <span className="aging-severity-dot aging-severity-green" /> Current only
        </span>
        <span className="aging-legend-item">
          <span className="aging-severity-dot aging-severity-amber" /> 1–60 days overdue
        </span>
        <span className="aging-legend-item">
          <span className="aging-severity-dot aging-severity-red" /> 60+ days overdue
        </span>
      </div>
    </div>
  );
}

// ─── Stub card ────────────────────────────────────────────────────────────────

function StubCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="report-stub-card">
      <div className="report-stub-icon">{icon}</div>
      <div className="report-stub-body">
        <h4 className="report-stub-title">{title}</h4>
        <p className="report-stub-desc">{description}</p>
        <span className="report-stub-badge">Coming soon</span>
      </div>
    </div>
  );
}

// ─── Finance Reports page ─────────────────────────────────────────────────────

export function FinanceReports({ session }: { session: Session }) {
  return (
    <div className="finance-reports-shell">
      <section className="report-section">
        <h3 className="finance-section-heading">Partner Aging Report</h3>
        <p className="report-section-desc">
          Outstanding balances by partner, grouped by how long they've been open.
          Click a partner's name to open their full ledger.
        </p>
        <AgingReport session={session} />
      </section>

      <section className="report-section">
        <h3 className="finance-section-heading">Coming Soon</h3>
        <div className="report-stub-list">
          <StubCard
            icon={<BarChart2 size={22} />}
            title="Expense Summary"
            description="Total operating costs by category for any selected period. Useful for budget reviews and year-end summaries."
          />
          <StubCard
            icon={<TrendingUp size={22} />}
            title="P&L Overview"
            description="Income from bookings minus operating expenses. Requires full booking revenue feed — available after launch stabilisation."
          />
          <StubCard
            icon={<Users size={22} />}
            title="Partner Statement"
            description="Full transaction ledger export per partner — PDF or CSV. Useful for partner reconciliation and audit."
          />
          <StubCard
            icon={<FileText size={22} />}
            title="Commission Summary"
            description="Commission accruals and payouts by partner and period. Includes commission-direction breakdown (receivable vs payable)."
          />
        </div>
      </section>
    </div>
  );
}
