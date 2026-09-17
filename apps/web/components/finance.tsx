"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, Landmark, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import type { PartnerClaim, Session } from "@/lib/types";
import { dateTime, label, money, useMutation, useResource } from "@/lib/client";
import {
  ConfirmDialog,
  Empty,
  Field,
  Heading,
  Loading,
  Notice,
  Status,
  TenantDateInput,
} from "./common";
import { FinancePartners } from "./finance-partners";
import { FinanceOverview } from "./finance-overview";
import { FinanceExpenses } from "./finance-expenses";
import { FinanceReports } from "./finance-reports";

function amount(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

type StatementLine = {
  id: string;
  booking_id: string;
  partner_id: string;
  partner_name: string;
  amount_minor: string;
  currency: string;
  kind: string;
  created_at: string;
};

// ─── Period helpers ───────────────────────────────────────────────────────────

export type PeriodKey = "this_week" | "this_month" | "last_month" | "this_year" | "last_year" | "custom";

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_week:  "This Week",
  this_month: "This Month",
  last_month: "Last Month",
  this_year:  "This Year",
  last_year:  "Last Year",
  custom:     "Custom Range",
};

export function periodDates(key: PeriodKey, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (key === "custom") return { from: customFrom, to: customTo };

  const y = now.getFullYear();
  const m = now.getMonth();

  if (key === "this_week") {
    const dow = now.getDay();
    const mon = new Date(now); mon.setDate(now.getDate() - ((dow + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: iso(mon), to: iso(sun) };
  }
  if (key === "this_month") {
    return { from: `${y}-${pad(m + 1)}-01`, to: iso(new Date(y, m + 1, 0)) };
  }
  if (key === "last_month") {
    const lm = m === 0 ? 11 : m - 1;
    const ly = m === 0 ? y - 1 : y;
    return { from: `${ly}-${pad(lm + 1)}-01`, to: iso(new Date(ly, lm + 1, 0)) };
  }
  if (key === "this_year") {
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
}

// ─── Period selector (right-side slot for Overview tab) ───────────────────────

function PeriodSelector({
  period, onPeriod, customFrom, customTo, onCustomFrom, onCustomTo, dateFormat, locale,
}: {
  period: PeriodKey;
  onPeriod: (k: PeriodKey) => void;
  customFrom: string;
  customTo: string;
  onCustomFrom: (v: string) => void;
  onCustomTo: (v: string) => void;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  locale: string;
}) {
  return (
    <div className="finance-period-selector catalog-view-actions">
      {/* On mobile this collapses — the select itself stays, label hidden */}
      <label className="finance-period-label">Period</label>
      <select
        value={period}
        onChange={(e) => onPeriod(e.target.value as PeriodKey)}
        className="finance-period-select"
      >
        {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => (
          <option key={k} value={k}>{PERIOD_LABELS[k]}</option>
        ))}
      </select>
      {period === "custom" && (
        <>
          <div className="finance-period-date-wrap">
            <TenantDateInput
              label="From"
              value={customFrom}
              onChange={onCustomFrom}
              dateFormat={dateFormat}
              locale={locale}
              compact
            />
          </div>
          <span className="finance-period-dash">–</span>
          <div className="finance-period-date-wrap">
            <TenantDateInput
              label="To"
              value={customTo}
              onChange={onCustomTo}
              dateFormat={dateFormat}
              locale={locale}
              compact
            />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Shared subnav ────────────────────────────────────────────────────────────

export type FinanceSection = "overview" | "partners" | "expenses" | "reports";

function FinanceNav({
  section,
  actions,
}: {
  section: FinanceSection;
  actions?: React.ReactNode;
}) {
  const tabs: { href: string; label: string; key: FinanceSection }[] = [
    { href: "/finance/overview", label: "Overview", key: "overview" },
    { href: "/finance/partners", label: "Partners", key: "partners" },
    { href: "/finance/expenses", label: "Expenses", key: "expenses" },
    { href: "/finance/reports", label: "Reports", key: "reports" },
  ];
  return (
    <div className="view-action-bar">
      <div
        className="view-tabs compact"
        role="tablist"
        aria-label="Finance sections"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            className="view-tab-link"
            href={tab.href}
            role="tab"
            aria-selected={section === tab.key}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      {actions && (
        <div className="catalog-view-actions">
          {actions}
        </div>
      )}
    </div>
  );
}

// ─── Page shell ───────────────────────────────────────────────────────────────

const SECTION_HEADINGS: Record<FinanceSection, { title: string; description: string }> = {
  overview: {
    title: "Finance Overview",
    description: "Work queue, net financial position, and recent activity across all partners.",
  },
  partners: {
    title: "Partner Accounts",
    description: "Commission accruals, collections, and settlement history per partner.",
  },
  expenses: {
    title: "Expenses",
    description: "Operating costs — fuel, equipment, maintenance, licenses, and more.",
  },
  reports: {
    title: "Reports",
    description: "Partner aging, expense summaries, and financial statements.",
  },
};

export function Finance({
  session,
  section,
  partnerId,
}: {
  session: Session;
  section: FinanceSection;
  partnerId?: string;
}) {
  // Period state lives here so the selector can sit inline in the nav bar
  const [period, setPeriod] = useState<PeriodKey>("this_month");
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));

  const { from, to } = useMemo(
    () => periodDates(period, customFrom, customTo),
    [period, customFrom, customTo],
  );
  const periodLabel = period === "custom" ? `${from} – ${to}` : PERIOD_LABELS[period];

  const heading = section === "partners" && partnerId
    ? { title: "Partner Account", description: "Transaction register and settlement history for this partner." }
    : SECTION_HEADINGS[section] ?? SECTION_HEADINGS.overview;

  // Right-side slot differs per tab
  const navActions = section === "overview" ? (
    <PeriodSelector
      period={period} onPeriod={setPeriod}
      customFrom={customFrom} customTo={customTo}
      onCustomFrom={setCustomFrom} onCustomTo={setCustomTo}
      dateFormat={session.tenant.config.dateFormat as "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD"}
      locale={session.tenant.config.locale}
    />
  ) : undefined;

  return (
    <>
      <Heading eyebrow="FINANCE" title={heading.title} description={heading.description} />
      <FinanceNav section={section} actions={navActions} />
      {section === "overview" && (
        <FinanceOverview session={session} dateFrom={from} dateTo={to} periodLabel={periodLabel} />
      )}
      {section === "partners" && <FinancePartners session={session} initialPartnerId={partnerId} />}
      {section === "expenses" && <FinanceExpenses session={session} />}
      {section === "reports" && <FinanceReports session={session} />}
    </>
  );
}
