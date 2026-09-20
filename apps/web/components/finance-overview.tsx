"use client";

import { AlertCircle, Clock } from "lucide-react";
import Link from "next/link";
import type { Session } from "@/lib/types";
import { dateOnly, money, useResource } from "@/lib/client";
import { Empty, Loading, Notice } from "./common";

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkQueueItem = {
  id: string;
  partner_id: string;
  partner_name: string;
  priority: "overdue" | "due_soon" | "pending";
  action: string;
  amount_minor: number;
  currency: string;
  days_outstanding?: number;
  due_in_days?: number;
  link: string;
};

type NetPosition = {
  receivable_minor: number;
  payable_minor: number;
  overdue_minor: number;
  receivable_count: number;
  payable_count: number;
  overdue_count: number;
  currency: string;
};

type ActivityItem = {
  id: string;
  event_at: string;
  partner_name: string;
  description: string;
  amount_minor: number;
  currency: string;
  direction: "in" | "out" | "neutral";
};

type OverviewData = {
  work_queue: WorkQueueItem[];
  net_position: NetPosition;
  recent_activity: ActivityItem[];
};

type CategoryTotal = {
  category_name: string;
  total_minor: number;
  total_reporting_minor: number | null;
  currency: string;
};
type ExpenseListResponse = {
  expenses: unknown[];
  category_totals: CategoryTotal[];
  period?: {
    recorded_reporting_minor: number;
    outstanding_reporting_minor: number;
    paid_reporting_minor: number;
  };
  currency: string;
};

// ─── Work queue card ──────────────────────────────────────────────────────────

function priorityIcon(priority: WorkQueueItem["priority"]) {
  if (priority === "overdue")
    return <AlertCircle size={14} className="finance-priority-icon overdue" />;
  if (priority === "due_soon")
    return <Clock size={14} className="finance-priority-icon due-soon" />;
  return <Clock size={14} className="finance-priority-icon pending" />;
}

function WorkQueueCard({
  item,
  currency,
}: {
  item: WorkQueueItem;
  currency: string;
}) {
  return (
    <Link href={item.link} className={`finance-queue-card ${item.priority}`}>
      <div className="finance-queue-left">
        {priorityIcon(item.priority)}
        <div className="finance-queue-info">
          <span className="finance-queue-partner">{item.partner_name}</span>
          <span className="finance-queue-action">{item.action}</span>
        </div>
      </div>
      <div className="finance-queue-right">
        <span className="finance-queue-amount">
          {money(item.amount_minor, item.currency || currency)}
        </span>
        {item.days_outstanding != null && item.days_outstanding > 0 && (
          <span className="finance-queue-age overdue-text">
            {item.days_outstanding}d overdue
          </span>
        )}
        {item.due_in_days != null && item.due_in_days >= 0 && (
          <span className="finance-queue-age due-soon-text">
            due in {item.due_in_days}d
          </span>
        )}
      </div>
    </Link>
  );
}

// ─── Net position strip ───────────────────────────────────────────────────────

function NetPositionStrip({
  pos,
  expenseReportingTotal,
  unpaidReportingTotal,
  paidReportingTotal,
  expenseHasUnconverted,
  expenseReportingCurrency,
  periodLabel,
}: {
  pos: NetPosition;
  expenseReportingTotal: number;
  unpaidReportingTotal: number;
  paidReportingTotal: number;
  expenseHasUnconverted: boolean;
  expenseReportingCurrency: string;
  periodLabel: string;
}) {
  const expenseDisplay =
    expenseReportingTotal === 0 && !expenseHasUnconverted
      ? "—"
      : money(expenseReportingTotal, expenseReportingCurrency);
  const unpaidDisplay =
    unpaidReportingTotal === 0 && !expenseHasUnconverted
      ? "—"
      : money(unpaidReportingTotal, expenseReportingCurrency);
  const paidDisplay =
    paidReportingTotal === 0
      ? "—"
      : money(paidReportingTotal, expenseReportingCurrency);
  return (
    <div className="finance-net-position">
      <div className="finance-net-tile receivable">
        <span className="finance-net-label">Partners owe you</span>
        <span className="finance-net-amount">
          {money(pos.receivable_minor, pos.currency)}
        </span>
        <span className="finance-net-sub">
          {pos.receivable_count} partner{pos.receivable_count !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="finance-net-tile payable">
        <span className="finance-net-label">You owe partners</span>
        <span className="finance-net-amount">
          {money(pos.payable_minor, pos.currency)}
        </span>
        <span className="finance-net-sub">
          {pos.payable_count} partner{pos.payable_count !== 1 ? "s" : ""}
        </span>
      </div>
      {pos.overdue_minor > 0 && (
        <div className="finance-net-tile overdue">
          <span className="finance-net-label">Overdue partners</span>
          <span className="finance-net-amount overdue-text">
            {money(pos.overdue_minor, pos.currency)}
          </span>
          <span className="finance-net-sub">
            {pos.overdue_count} settlement{pos.overdue_count !== 1 ? "s" : ""}
          </span>
        </div>
      )}
      <Link className="finance-net-tile expenses" href="/finance/expenses">
        <span className="finance-net-label">Expenses · {periodLabel}</span>
        <span className="finance-net-amount">{expenseDisplay}</span>
        <span className="finance-net-sub">Recorded operating costs</span>
        {expenseHasUnconverted && (
          <span className="finance-net-sub attention-text">
            Some expenses have no bank rate and are excluded
          </span>
        )}
      </Link>
      <Link
        className={
          "finance-net-tile unpaid" +
          (unpaidReportingTotal > 0 ? " attention" : "")
        }
        href="/finance/expenses"
      >
        <span className="finance-net-label">Unpaid expenses · {periodLabel}</span>
        <span className="finance-net-amount">{unpaidDisplay}</span>
        <span className="finance-net-sub">
          Recorded bills minus vendor payments
        </span>
      </Link>
      <Link className="finance-net-tile expenses" href="/finance/expenses">
        <span className="finance-net-label">Paid to vendors · {periodLabel}</span>
        <span className="finance-net-amount">{paidDisplay}</span>
        <span className="finance-net-sub">Payments dated in this period</span>
      </Link>
    </div>
  );
}

function SkeletonStrip() {
  return (
    <div className="finance-net-position">
      {["receivable", "payable", "expenses", "unpaid"].map((cls) => (
        <div key={cls} className={`finance-net-tile ${cls}`}>
          <span className="finance-net-label">&nbsp;</span>
          <span
            className="finance-net-amount"
            style={{ color: "var(--muted)" }}
          >
            —
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Recent activity feed ─────────────────────────────────────────────────────

function ActivityFeed({
  items,
  dateFormat,
  locale,
}: {
  items: ActivityItem[];
  dateFormat: Session["tenant"]["config"]["dateFormat"];
  locale: string;
}) {
  return (
    <div className="finance-activity-feed">
      <h3 className="finance-section-heading">Recent activity</h3>
      {items.length === 0 ? (
        <Empty title="No recent activity">
          <p>Settlements and partner movements will appear here.</p>
        </Empty>
      ) : (
        <div className="finance-activity-list">
          {items.map((item) => (
            <div key={item.id} className="finance-activity-row">
              <span className="finance-activity-date">
                {dateOnly(item.event_at, dateFormat, locale)}
              </span>
              <span className="finance-activity-partner">
                {item.partner_name}
              </span>
              <span className="finance-activity-desc">{item.description}</span>
              <span className={`finance-activity-amount ${item.direction}`}>
                {item.direction === "in"
                  ? "+"
                  : item.direction === "out"
                    ? "−"
                    : ""}
                {money(item.amount_minor, item.currency)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Finance Overview page ────────────────────────────────────────────────────

export function FinanceOverview({
  session,
  dateFrom,
  dateTo,
  periodLabel,
}: {
  session: Session;
  dateFrom: string;
  dateTo: string;
  periodLabel: string;
}) {
  const { data, error } = useResource<OverviewData>(
    "finance/v1/finance-overview",
  );
  const { data: expenseData } = useResource<ExpenseListResponse>(
    `finance/v1/expenses?dateFrom=${dateFrom}&dateTo=${dateTo}`,
  );

  const reportingCurrency =
    session.tenant.config.reportingCurrency ??
    session.tenant.config.collectionCurrency ??
    "XCD";

  // Sum amount_reporting_minor — all converted to reporting currency at time of entry
  const expenseReportingTotal =
    expenseData?.period?.recorded_reporting_minor ??
    expenseData?.category_totals.reduce(
      (sum, ct) => sum + (ct.total_reporting_minor ?? 0),
      0,
    ) ??
    0;
  const unpaidReportingTotal =
    expenseData?.period?.outstanding_reporting_minor ?? expenseReportingTotal;
  const paidReportingTotal = expenseData?.period?.paid_reporting_minor ?? 0;
  // Flag any foreign-currency expense that was entered without a bank rate
  const expenseHasUnconverted =
    expenseData?.category_totals.some(
      (ct) =>
        ct.currency !== reportingCurrency && ct.total_reporting_minor == null,
    ) ?? false;

  if (error) {
    return <Notice error>{error}</Notice>;
  }
  if (!data) {
    return (
      <div className="finance-overview-shell">
        <SkeletonStrip />
        <Loading />
      </div>
    );
  }

  const { work_queue, net_position, recent_activity } = data;

  return (
    <div className="finance-overview-shell">
      <NetPositionStrip
        pos={net_position}
        expenseReportingTotal={expenseReportingTotal}
        unpaidReportingTotal={unpaidReportingTotal}
        paidReportingTotal={paidReportingTotal}
        expenseHasUnconverted={expenseHasUnconverted}
        expenseReportingCurrency={reportingCurrency}
        periodLabel={periodLabel}
      />
      <div className="finance-queue-section">
        <h3 className="finance-section-heading">Work queue</h3>
        {work_queue.length === 0 ? (
          <Empty title="All caught up">
            <p>No partner collections or settlements need a decision.</p>
          </Empty>
        ) : (
          <div className="finance-queue-list">
            {work_queue.map((item) => (
              <WorkQueueCard
                key={item.id}
                item={item}
                currency={net_position.currency}
              />
            ))}
          </div>
        )}
      </div>
      <ActivityFeed
        items={recent_activity}
        dateFormat={session.tenant.config.dateFormat}
        locale={session.tenant.config.locale}
      />
      <p className="finance-report-links">
        Reports:{" "}
        <Link href="/reports/partner-aging">Partner aging</Link>
        {" · "}
        <Link href="/reports/expense-summary">Expense summary</Link>
      </p>
    </div>
  );
}
