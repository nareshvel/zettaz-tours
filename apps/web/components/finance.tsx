"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { Session } from "@/lib/types";
import { formatMediumDateRange } from "@/lib/client";
import { Heading, TenantDateInput } from "./common";
import { FinancePartners } from "./finance-partners";
import { FinanceOverview } from "./finance-overview";
import { FinanceExpenses } from "./finance-expenses";
import { FinanceReports } from "./finance-reports";

export type PeriodKey =
  | "this_week"
  | "this_month"
  | "last_month"
  | "this_year"
  | "last_year"
  | "custom";

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_week: "This week",
  this_month: "This month",
  last_month: "Last month",
  this_year: "This year",
  last_year: "Last year",
  custom: "Custom",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function tenantDay(timezone: string, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return shiftDay(day, offset);
}

function monthBounds(day: string): [string, string] {
  const [year, month] = day.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [`${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(last)}`];
}

export function periodDates(
  key: PeriodKey,
  customFrom: string,
  customTo: string,
  timezone: string,
): { from: string; to: string } {
  const today = tenantDay(timezone);
  const [year, month] = today.split("-").map(Number);
  if (key === "custom") return { from: customFrom, to: customTo };
  if (key === "this_week") {
    const from = mondayOf(today);
    return { from, to: shiftDay(from, 6) };
  }
  if (key === "this_month") {
    const [from, to] = monthBounds(today);
    return { from, to };
  }
  if (key === "last_month") {
    const prev =
      month === 1 ? `${year - 1}-12-01` : `${year}-${pad(month - 1)}-01`;
    const [from, to] = monthBounds(prev);
    return { from, to };
  }
  if (key === "this_year") return { from: `${year}-01-01`, to: `${year}-12-31` };
  return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
}

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
      {actions ? <div className="catalog-view-actions">{actions}</div> : null}
    </div>
  );
}

const SECTION_HEADINGS: Record<
  FinanceSection,
  { title: string; description: string }
> = {
  overview: {
    title: "Finance",
    description:
      "Partner balances and operating expenses in the tenant reporting currency. Automatic FX conversion is off until an approved rate policy exists; expense bank rates stay on the expense they were entered with.",
  },
  partners: {
    title: "Partner accounts",
    description:
      "Commission accruals, collections, and settlement history per partner.",
  },
  expenses: {
    title: "Expenses",
    description:
      "Operating costs. Foreign-currency lines use the bank rate recorded on that expense — they are not converted later.",
  },
  reports: {
    title: "Finance reports",
    description:
      "Partner aging in recorded currencies. Exports and P&L remain Track B.",
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
  const timezone = session.tenant.timezone;
  const locale = session.tenant.config.locale;
  const dateFormat = session.tenant.config.dateFormat;
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
  const periodLabel =
    period === "custom"
      ? formatMediumDateRange(from, to, locale)
      : PERIOD_LABELS[period];

  const heading =
    section === "partners" && partnerId
      ? {
          title: "Partner account",
          description:
            "Transaction register and settlement history for this partner.",
        }
      : (SECTION_HEADINGS[section] ?? SECTION_HEADINGS.overview);

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
    setPeriodOpen(false);
    if (next === "custom") {
      setCustomFrom(from);
      setCustomTo(to);
    }
  }

  useEffect(() => {
    if (!periodOpen) return;
    const close = (event: MouseEvent) => {
      if (!periodRef.current?.contains(event.target as Node)) {
        setPeriodOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [periodOpen]);

  const periodActions = (
    <div className="filter-menu finance-period-menu" ref={periodRef}>
      <button
        type="button"
        className={
          "button secondary catalog-add-btn" + (periodOpen ? " active-filter" : "")
        }
        aria-label="Finance period"
        aria-expanded={periodOpen}
        aria-haspopup="listbox"
        onClick={() => setPeriodOpen((open) => !open)}
      >
        <span className="button-label">{PERIOD_LABELS[period]}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {periodOpen && (
        <div className="filter-popover" role="listbox" aria-label="Finance period">
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
        </div>
      )}
    </div>
  );

  return (
    <>
      <Heading
        eyebrow="FINANCE"
        title={heading.title}
        description={heading.description}
      />
      <FinanceNav
        section={section}
        actions={section === "overview" ? periodActions : undefined}
      />
      {section === "overview" && (
        <>
          {period === "custom" && (
            <div className="report-custom-dates">
              <TenantDateInput
                label="From"
                value={customFrom}
                max={customTo || undefined}
                onChange={setCustomFrom}
                dateFormat={dateFormat}
                locale={locale}
                compact
              />
              <TenantDateInput
                label="To"
                value={customTo}
                min={customFrom || undefined}
                onChange={setCustomTo}
                dateFormat={dateFormat}
                locale={locale}
                compact
              />
            </div>
          )}
          <FinanceOverview
            session={session}
            dateFrom={from}
            dateTo={to}
            periodLabel={periodLabel}
          />
        </>
      )}
      {section === "partners" && (
        <FinancePartners session={session} initialPartnerId={partnerId} />
      )}
      {section === "expenses" && <FinanceExpenses session={session} />}
      {section === "reports" && <FinanceReports session={session} />}
    </>
  );
}
