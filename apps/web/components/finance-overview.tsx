"use client";

import { AlertCircle, Clock } from "lucide-react";
import Link from "next/link";
import type { Session } from "@/lib/types";
import { money, useResource } from "@/lib/client";
import { Empty } from "./common";

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

function WorkQueueCard({ item, currency }: { item: WorkQueueItem; currency: string }) {
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

function NetPositionStrip({ pos, expenseReportingTotal, expenseHasUnconverted, expenseReportingCurrency, periodLabel }: {
  pos: NetPosition;
  expenseReportingTotal: number;
  expenseHasUnconverted: boolean;
  expenseReportingCurrency: string;
  periodLabel: string;
}) {
  return (
    <div className="finance-net-position">
      <div className="finance-net-tile receivable">
        <span className="finance-net-label">Partners owe you</span>
        <span className="finance-net-amount">{money(pos.receivable_minor, pos.currency)}</span>
        <span className="finance-net-sub">{pos.receivable_count} partner{pos.receivable_count !== 1 ? "s" : ""}</span>
      </div>
      <div className="finance-net-tile payable">
        <span className="finance-net-label">You owe partners</span>
        <span className="finance-net-amount">{money(pos.payable_minor, pos.currency)}</span>
        <span className="finance-net-sub">{pos.payable_count} partner{pos.payable_count !== 1 ? "s" : ""}</span>
      </div>
      {pos.overdue_minor > 0 && (
        <div className="finance-net-tile overdue">
          <span className="finance-net-label">Overdue</span>
          <span className="finance-net-amount overdue-text">{money(pos.overdue_minor, pos.currency)}</span>
          <span className="finance-net-sub">{pos.overdue_count} settlement{pos.overdue_count !== 1 ? "s" : ""}</span>
        </div>
      )}
      <div className="finance-net-tile expenses">
        <span className="finance-net-label">Expenses · {periodLabel}</span>
        <span className="finance-net-amount">
          {expenseReportingTotal === 0 && !expenseHasUnconverted
            ? "—"
            : money(expenseReportingTotal, expenseReportingCurrency)
          }
        </span>
        {expenseHasUnconverted && (
          <span className="finance-net-sub" style={{ color: "var(--warning, #c97700)", fontSize: "0.75rem" }}>
            ⚠ some expenses missing rate
          </span>
        )}
      </div>
    </div>
  );
}

function SkeletonStrip() {
  return (
    <div className="finance-net-position">
      {["receivable", "payable", "overdue", "expenses"].map((cls) => (
        <div key={cls} className={`finance-net-tile ${cls}`}>
          <span className="finance-net-label">&nbsp;</span>
          <span className="finance-net-amount" style={{ color: "var(--muted)" }}>—</span>
        </div>
      ))}
    </div>
  );
}

// ─── Recent activity feed ─────────────────────────────────────────────────────

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <div className="finance-activity-feed">
      <h3 className="finance-section-heading">Recent Activity</h3>
      {items.length === 0 ? (
        <p className="finance-activity-empty">No recent activity.</p>
      ) : (
        <div className="finance-activity-list">
          {items.map((item) => (
            <div key={item.id} className="finance-activity-row">
              <span className="finance-activity-date">
                {new Date(item.event_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
              <span className="finance-activity-partner">{item.partner_name}</span>
              <span className="finance-activity-desc">{item.description}</span>
              <span className={`finance-activity-amount ${item.direction}`}>
                {item.direction === "in" ? "+" : item.direction === "out" ? "−" : ""}
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
  const { data, error } = useResource<OverviewData>("finance/v1/finance-overview");
  const { data: expenseData } = useResource<ExpenseListResponse>(
    `finance/v1/expenses?dateFrom=${dateFrom}&dateTo=${dateTo}`,
  );

  const reportingCurrency = session.tenant.config.reportingCurrency
    ?? session.tenant.config.collectionCurrency ?? "XCD";

  // Sum amount_reporting_minor — all converted to reporting currency at time of entry
  const expenseReportingTotal = expenseData?.category_totals.reduce(
    (sum, ct) => sum + (ct.total_reporting_minor ?? 0), 0
  ) ?? 0;
  // Flag any foreign-currency expense that was entered without a bank rate
  const expenseHasUnconverted = expenseData?.category_totals.some(
    (ct) => ct.currency !== reportingCurrency && ct.total_reporting_minor == null
  ) ?? false;

  const loading = data === null && !error;

  if (loading || (!data && !error)) {
    return (
      <div className="finance-overview-shell">
        <SkeletonStrip />
        <div className="finance-queue-section">
          <h3 className="finance-section-heading">Work Queue</h3>
          <Empty title="All caught up">No actions required right now.</Empty>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="finance-overview-shell">
        <SkeletonStrip />
        <div className="finance-queue-section">
          <h3 className="finance-section-heading">Work Queue</h3>
          <Empty title="All caught up">No actions required right now.</Empty>
        </div>
      </div>
    );
  }

  const { work_queue, net_position, recent_activity } = data;

  return (
    <div className="finance-overview-shell">
      <NetPositionStrip
        pos={net_position}
        expenseReportingTotal={expenseReportingTotal}
        expenseHasUnconverted={expenseHasUnconverted}
        expenseReportingCurrency={reportingCurrency}
        periodLabel={periodLabel}
      />
      <div className="finance-queue-section">
        <h3 className="finance-section-heading">Work Queue</h3>
        {work_queue.length === 0 ? (
          <Empty title="All caught up">No actions required right now.</Empty>
        ) : (
          <div className="finance-queue-list">
            {work_queue.map((item) => (
              <WorkQueueCard key={item.id} item={item} currency={net_position.currency} />
            ))}
          </div>
        )}
      </div>
      <ActivityFeed items={recent_activity} />
    </div>
  );
}
