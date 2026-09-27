"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Session } from "@/lib/types";
import { Empty, Notice } from "./common";
import { PeriodOverviewReport } from "./reports";
import { AgingReport, ExpenseSummary } from "./finance-reports";
import {
  BookingSourcesReport,
  CommissionSummaryReport,
  SalesByProductReport,
} from "./reports-sales";

export type ReportGroup =
  "operations" | "money" | "partners" | "people" | "later";

export type ReportEntry = {
  slug: string;
  group: ReportGroup;
  title: string;
  description: string;
  permission?: string;
  status: "live" | "later" | "link";
  href?: string;
};

export const REPORT_GROUPS: { id: ReportGroup; label: string }[] = [
  { id: "operations", label: "Operations" },
  { id: "money", label: "Money" },
  { id: "partners", label: "Partners" },
  { id: "people", label: "People & compliance" },
  { id: "later", label: "Coming later" },
];

export const REPORT_CATALOG: ReportEntry[] = [
  {
    slug: "period-overview",
    group: "operations",
    title: "Period overview",
    description: "Bookings, value, and exceptions by departure date.",
    permission: "bookings.read",
    status: "live",
  },
  {
    slug: "partner-aging",
    group: "partners",
    title: "Partner aging",
    description: "Open partner balances by age.",
    permission: "partner.statement.read",
    status: "live",
  },
  {
    slug: "expense-summary",
    group: "money",
    title: "Expense summary",
    description: "Operating costs by category.",
    permission: "partner.statement.read",
    status: "live",
  },
  {
    slug: "sales-by-product",
    group: "money",
    title: "Sales by product",
    description: "Guests, occupancy, and value by product.",
    permission: "bookings.read",
    status: "live",
  },
  {
    slug: "booking-sources",
    group: "operations",
    title: "Booking sources",
    description: "Where bookings came from: phone, walk-in, partners, OTAs.",
    permission: "bookings.read",
    status: "live",
  },
  {
    slug: "commission-summary",
    group: "partners",
    title: "Commission summary",
    description: "Commission owed and settled by partner.",
    permission: "partner.statement.read",
    status: "live",
  },
  {
    slug: "customers",
    group: "people",
    title: "Customer directory",
    description: "Guests and their booking history.",
    permission: "bookings.read",
    status: "link",
    href: "/customers",
  },
  {
    slug: "audit",
    group: "people",
    title: "Audit log",
    description: "Who changed what, and when.",
    status: "link",
    href: "/audit",
  },
  {
    slug: "partner-statement",
    group: "later",
    title: "Partner statement PDF",
    description: "Printable ledger per partner.",
    status: "later",
  },
  {
    slug: "accounting-export",
    group: "later",
    title: "Accounting export",
    description: "Journal CSV for the accountant.",
    status: "later",
  },
  {
    slug: "pnl-overview",
    group: "later",
    title: "P&L overview",
    description: "Income minus operating expenses.",
    status: "later",
  },
];

export function canRunReport(session: Session, entry: ReportEntry) {
  if (!entry.permission) return true;
  return session.permissions.includes(entry.permission);
}

export function ReportsHub({
  session,
  slug,
}: {
  session: Session;
  slug?: string;
}) {
  const [showLater, setShowLater] = useState(false);
  const visible = REPORT_CATALOG.filter(
    (entry) => entry.status === "later" || canRunReport(session, entry),
  );
  const fallback =
    (canRunReport(session, REPORT_CATALOG[0])
      ? "period-overview"
      : visible.find((entry) => entry.status === "live")?.slug) ?? undefined;
  const effectiveSlug = slug ?? fallback;
  const selected = effectiveSlug
    ? REPORT_CATALOG.find((entry) => entry.slug === effectiveSlug)
    : undefined;
  const blocked =
    selected && selected.status !== "later" && !canRunReport(session, selected);

  return (
    <div className={"reports-hub" + (slug ? " has-slug" : "")}>
      <aside className="reports-catalog" aria-label="Report catalog">
        <div className="reports-catalog-head">
          <p className="eyebrow">INSIGHTS</p>
          <h1>Reports</h1>
        </div>
        {REPORT_GROUPS.map((group) => {
          const items = visible.filter((entry) => entry.group === group.id);
          if (items.length === 0) return null;
          const collapsed = group.id === "later" && !showLater;
          return (
            <section key={group.id} className="reports-catalog-group">
              {group.id === "later" ? (
                <h2>
                  <button
                    type="button"
                    className="reports-catalog-toggle"
                    aria-expanded={showLater}
                    onClick={() => setShowLater((v) => !v)}
                  >
                    {group.label} ({items.length}) {showLater ? "−" : "+"}
                  </button>
                </h2>
              ) : (
                <h2>{group.label}</h2>
              )}
              {!collapsed && (
                <ul>
                  {items.map((entry) => (
                    <li key={entry.slug}>
                      {entry.status === "link" && entry.href ? (
                        <Link
                          href={entry.href}
                          className="reports-catalog-item"
                        >
                          <strong>{entry.title}</strong>
                          <span>{entry.description}</span>
                        </Link>
                      ) : entry.status === "later" ? (
                        <div className="reports-catalog-item later">
                          <strong>
                            {entry.title}
                            <em>Not in this launch</em>
                          </strong>
                          <span>{entry.description}</span>
                        </div>
                      ) : (
                        <Link
                          href={
                            entry.slug === fallback
                              ? "/reports"
                              : `/reports/${entry.slug}`
                          }
                          className={
                            "reports-catalog-item" +
                            (selected?.slug === entry.slug ? " selected" : "")
                          }
                          aria-current={
                            selected?.slug === entry.slug ? "page" : undefined
                          }
                        >
                          <strong>{entry.title}</strong>
                          <span>{entry.description}</span>
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </aside>
      <div className="reports-viewer">
        {slug && (
          <Link href="/reports" className="back-link no-print reports-back">
            <ArrowLeft size={16} /> All reports
          </Link>
        )}
        {!effectiveSlug && (
          <Empty title="Choose a report">
            <p>Open a live report from the list.</p>
          </Empty>
        )}
        {blocked && (
          <Notice error>You do not have permission to run this report.</Notice>
        )}
        {selected && !blocked && selected.status === "live" && (
          <LiveReport session={session} slug={selected.slug} />
        )}
        {selected && selected.status === "later" && (
          <Empty title={selected.title}>
            <p>{selected.description}</p>
          </Empty>
        )}
        {slug && !REPORT_CATALOG.some((entry) => entry.slug === slug) && (
          <Notice>
            That report is not in the catalog.{" "}
            <Link href="/reports">Return to reports</Link>
          </Notice>
        )}
      </div>
    </div>
  );
}

function LiveReport({ session, slug }: { session: Session; slug: string }) {
  if (slug === "period-overview")
    return <PeriodOverviewReport session={session} />;
  if (slug === "partner-aging") return <AgingReport session={session} />;
  if (slug === "expense-summary") return <ExpenseSummary session={session} />;
  if (slug === "sales-by-product")
    return <SalesByProductReport session={session} />;
  if (slug === "booking-sources")
    return <BookingSourcesReport session={session} />;
  if (slug === "commission-summary")
    return <CommissionSummaryReport session={session} />;
  return null;
}
