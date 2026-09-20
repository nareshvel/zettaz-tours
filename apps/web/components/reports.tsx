"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Landmark,
} from "lucide-react";
import type { Session } from "@/lib/types";
import {
  dateOnly,
  formatMediumDateRange,
  money,
  useResource,
} from "@/lib/client";
import { downloadCsv } from "@/lib/reports-csv";
import { Empty, Loading, Notice, TenantDateInput } from "./common";
import { ReportShell } from "./reports-shell";

type Report = {
  range: { from: string; to: string };
  currency: string;
  commercial: {
    bookings: number;
    confirmed: number;
    cancelled: number;
    bookedMinor: number;
    receivedMinor: number;
    guestBalanceMinor: number;
    partnerDueMinor: number;
  };
  operations: {
    departures: number;
    weatherHolds: number;
    closed: number;
    unassigned: number;
    unresolvedPickups: number;
  };
  days: {
    date: string;
    departures: number;
    confirmed_bookings: number;
    guests: number;
  }[];
};

type ReportRange =
  | "today"
  | "last_7"
  | "week"
  | "month"
  | "last_month"
  | "year"
  | "custom";

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

function sundayOf(day: string) {
  return shiftDay(mondayOf(day), 6);
}

function monthBounds(day: string): [string, string] {
  const [year, month] = day.split("-").map(Number);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return [from, to];
}

function previousMonthBounds(day: string): [string, string] {
  const [year, month] = day.split("-").map(Number);
  const prev = month === 1 ? [year - 1, 12] : [year, month - 1];
  return monthBounds(`${prev[0]}-${String(prev[1]).padStart(2, "0")}-01`);
}

function yearBounds(day: string): [string, string] {
  const year = day.slice(0, 4);
  return [`${year}-01-01`, `${year}-12-31`];
}

function rangeBounds(
  range: ReportRange,
  today: string,
  customFrom: string,
  customTo: string,
): [string, string] {
  if (range === "today") return [today, today];
  if (range === "last_7") return [shiftDay(today, -6), today];
  if (range === "week") return [mondayOf(today), sundayOf(today)];
  if (range === "month") return monthBounds(today);
  if (range === "last_month") return previousMonthBounds(today);
  if (range === "year") return yearBounds(today);
  return [customFrom, customTo];
}

export function PeriodOverviewReport({ session }: { session: Session }) {
  const today = tenantDay(session.tenant.timezone);
  const weekStart = mondayOf(today);
  const weekEnd = sundayOf(today);
  const [preset, setPreset] = useState<ReportRange>("week");
  const [customFrom, setCustomFrom] = useState(weekStart);
  const [customTo, setCustomTo] = useState(weekEnd);
  const [rangeOpen, setRangeOpen] = useState(false);
  const rangeRef = useRef<HTMLDivElement>(null);

  const [from, to] = rangeBounds(preset, today, customFrom, customTo);
  const report = useResource<Report>(
    `reports/v1/overview?${new URLSearchParams({ from, to }).toString()}`,
  );
  const locale = session.tenant.config.locale;
  const dateFormat = session.tenant.config.dateFormat;

  function selectPreset(next: ReportRange) {
    setPreset(next);
    if (next === "custom") {
      setCustomFrom(from);
      setCustomTo(to);
      return;
    }
    setRangeOpen(false);
  }

  useEffect(() => {
    if (!rangeOpen) return;
    function onPointer(event: MouseEvent) {
      if (
        rangeRef.current &&
        !rangeRef.current.contains(event.target as Node) &&
        !document.getElementById("tdp-popup")?.contains(event.target as Node)
      ) {
        setRangeOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setRangeOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [rangeOpen]);

  const rangeHint = formatMediumDateRange(from, to, locale);
  const data = report.data;

  const presets: { value: ReportRange; caption: string }[] = [
    { value: "today", caption: "Today" },
    { value: "last_7", caption: "Last 7 days" },
    { value: "week", caption: "This week" },
    { value: "month", caption: "This month" },
    { value: "last_month", caption: "Last month" },
    { value: "year", caption: "This year" },
    { value: "custom", caption: "Custom" },
  ];
  const presetLabel =
    presets.find((item) => item.value === preset)?.caption ?? "This week";

  function exportCsv() {
    if (!data) return;
    const c = data.currency;
    downloadCsv(`period-overview-${from}-${to}.csv`, [
      ["Basis", "Departure dates (tenant timezone)"],
      ["From", from],
      ["To", to],
      ["Timezone", session.tenant.timezone],
      ["Currency", c],
      [],
      ["Metric", "Value"],
      ["Confirmed bookings", data.commercial.confirmed],
      ["Bookings", data.commercial.bookings],
      ["Cancelled", data.commercial.cancelled],
      ["Booked value minor", data.commercial.bookedMinor],
      ["Settled guest receipts minor", data.commercial.receivedMinor],
      ["Guest balance minor", data.commercial.guestBalanceMinor],
      ["Partner obligations minor", data.commercial.partnerDueMinor],
      ["Departures", data.operations.departures],
      ["Weather holds", data.operations.weatherHolds],
      ["Closed", data.operations.closed],
      ["Unassigned", data.operations.unassigned],
      ["Unresolved pickups", data.operations.unresolvedPickups],
      [],
      ["Date", "Departures", "Confirmed bookings", "Guests"],
      ...data.days.map((row) => [
        row.date,
        row.departures,
        row.confirmed_bookings,
        row.guests,
      ]),
    ]);
  }

  const filters = (
    <>
      <div className="filter-menu report-filter-menu" ref={rangeRef}>
        <button
          type="button"
          className={
            "button secondary catalog-add-btn" +
            (rangeOpen ? " active-filter" : "")
          }
          aria-label="Report date range"
          aria-expanded={rangeOpen}
          aria-haspopup="listbox"
          onClick={() => setRangeOpen((open) => !open)}
        >
          <span className="button-label">{presetLabel}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {rangeOpen && (
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
                aria-selected={preset === item.value}
                className={
                  "filter-range-option" +
                  (preset === item.value ? " selected" : "")
                }
                onClick={() => selectPreset(item.value)}
              >
                {item.caption}
              </button>
            ))}
            {preset === "custom" && (
              <div className="report-custom-dates">
                <TenantDateInput
                  label="From"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={setCustomFrom}
                  locale={locale}
                  dateFormat={dateFormat}
                  compact
                />
                <TenantDateInput
                  label="To"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={setCustomTo}
                  locale={locale}
                  dateFormat={dateFormat}
                  compact
                />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <ReportShell
      title="Period overview"
      filters={filters}
      onExport={exportCsv}
      exportDisabled={!data}
    >
      {report.error ? (
        <Notice error>{report.error}</Notice>
      ) : !report.data ? (
        <Loading />
      ) : (
        <>
          <p className="muted report-range-note">
            Showing <strong>{rangeHint}</strong>
            {report.data ? ` · ${report.data.currency}` : ""}
          </p>
          <section className="metric-grid report-metrics">
            <div className="metric-card">
              <BarChart3 size={20} />
              <span>Confirmed bookings</span>
              <strong>{report.data.commercial.confirmed}</strong>
              <small>
                {report.data.commercial.bookings} total ·{" "}
                {report.data.commercial.cancelled} cancelled
              </small>
            </div>
            <div className="metric-card">
              <Landmark size={20} />
              <span>Booked value</span>
              <strong>
                {money(
                  report.data.commercial.bookedMinor,
                  report.data.currency,
                )}
              </strong>
              <small>
                {money(
                  report.data.commercial.receivedMinor,
                  report.data.currency,
                )}{" "}
                settled guest receipts
              </small>
            </div>
            <div
              className={
                "metric-card" +
                (report.data.commercial.guestBalanceMinor > 0
                  ? " attention"
                  : "")
              }
            >
              <AlertTriangle size={20} />
              <span>Guest balances</span>
              <strong>
                {money(
                  report.data.commercial.guestBalanceMinor,
                  report.data.currency,
                )}
              </strong>
              <small>
                {money(
                  report.data.commercial.partnerDueMinor,
                  report.data.currency,
                )}{" "}
                partner obligations
              </small>
            </div>
            <div className="metric-card">
              <CalendarDays size={20} />
              <span>Departures</span>
              <strong>{report.data.operations.departures}</strong>
              <small>
                {report.data.operations.unassigned} without assignments
              </small>
            </div>
          </section>

          <section className="panel report-exceptions">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">OPERATING EXCEPTIONS</p>
                <h2>Needs review</h2>
              </div>
            </div>
            <div className="report-exception-grid">
              {(
                [
                  ["Weather holds", report.data.operations.weatherHolds],
                  ["Closed departures", report.data.operations.closed],
                  ["Unassigned departures", report.data.operations.unassigned],
                  [
                    "Unresolved pickups",
                    report.data.operations.unresolvedPickups,
                  ],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className={
                    "report-exception" + (value > 0 ? " attention" : "")
                  }
                >
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="panel report-daily">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">DAILY ACTIVITY</p>
                <h2>Departure volume</h2>
              </div>
              <span className="muted">{session.tenant.timezone}</span>
            </div>
            {!report.data.days.length ? (
              <Empty title="No departures in this date range">
                <p>Choose another period to review scheduled activity.</p>
              </Empty>
            ) : (
              <>
                <div className="table-scroll report-daily-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Departures</th>
                        <th>Confirmed bookings</th>
                        <th>Guests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.data.days.map((row) => (
                        <tr key={row.date}>
                          <td>{dateOnly(row.date, dateFormat, locale)}</td>
                          <td>{row.departures}</td>
                          <td>{row.confirmed_bookings}</td>
                          <td>{row.guests}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="report-daily-cards">
                  {report.data.days.map((row) => (
                    <article key={row.date} className="report-day-card">
                      <strong>
                        {dateOnly(row.date, dateFormat, locale)}
                      </strong>
                      <div className="report-day-stats">
                        <span>
                          <strong>{row.departures}</strong> departures
                        </span>
                        <span>
                          <strong>{row.confirmed_bookings}</strong> bookings
                        </span>
                        <span>
                          <strong>{row.guests}</strong> guests
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>

          <Notice>
            Amounts use <strong>{report.data.currency}</strong>, the tenant
            reporting currency. Guest balances are after accepted partner
            credit. Cross-currency conversion stays disabled until an approved
            FX policy exists.
          </Notice>
        </>
      )}
    </ReportShell>
  );
}
