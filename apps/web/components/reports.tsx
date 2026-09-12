"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Landmark,
  ListFilter,
} from "lucide-react";
import type { Session } from "@/lib/types";
import { money, useResource } from "@/lib/client";
import {
  Empty,
  Heading,
  Loading,
  Notice,
  TenantDateInput,
} from "./common";

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

type ReportRange = "today" | "week" | "month" | "last_month" | "custom";

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
  return monthBounds(
    `${prev[0]}-${String(prev[1]).padStart(2, "0")}-01`,
  );
}

function rangeBounds(
  range: ReportRange,
  today: string,
  customFrom: string,
  customTo: string,
): [string, string] {
  if (range === "today") return [today, today];
  if (range === "week") return [mondayOf(today), sundayOf(today)];
  if (range === "month") return monthBounds(today);
  if (range === "last_month") return previousMonthBounds(today);
  return [customFrom, customTo];
}

export function Reports({ session }: { session: Session }) {
  const today = tenantDay(session.tenant.timezone);
  const weekStart = mondayOf(today);
  const weekEnd = sundayOf(today);
  const [preset, setPreset] = useState<ReportRange>("week");
  const [customFrom, setCustomFrom] = useState(weekStart);
  const [customTo, setCustomTo] = useState(weekEnd);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const [from, to] = rangeBounds(preset, today, customFrom, customTo);
  const report = useResource<Report>(
    `reports/v1/overview?${new URLSearchParams({ from, to }).toString()}`,
  );

  useEffect(() => {
    if (!filtersOpen) return;
    function onPointer(event: MouseEvent) {
      if (
        filterRef.current &&
        !filterRef.current.contains(event.target as Node)
      ) {
        setFiltersOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  function selectPreset(next: ReportRange) {
    setPreset(next);
    if (next === "custom") {
      setCustomFrom(from);
      setCustomTo(to);
    }
  }

  function resetView() {
    setPreset("week");
    setCustomFrom(weekStart);
    setCustomTo(weekEnd);
    setFiltersOpen(false);
  }

  const rangeLabel =
    preset === "today"
      ? "Today"
      : preset === "week"
        ? "This week"
        : preset === "month"
          ? "This month"
          : preset === "last_month"
            ? "Last month"
            : "Custom range";
  const filterCount = preset === "week" ? 0 : 1;
  const rangeHint =
    preset === "today"
      ? today
      : preset === "week"
        ? `${weekStart} – ${weekEnd}`
        : preset === "month"
          ? `${monthBounds(today)[0]} – ${monthBounds(today)[1]}`
          : preset === "last_month"
            ? `${previousMonthBounds(today)[0]} – ${previousMonthBounds(today)[1]}`
            : `${customFrom} – ${customTo}`;

  return (
    <>
      <Heading
        eyebrow="REPORTING"
        title="Reports"
        description={`Departure-date facts in ${session.tenant.timezone}. Commercial totals use the tenant reporting currency only — no FX conversion.`}
        action={
          <div className="filter-menu report-filter-menu" ref={filterRef}>
            <button
              type="button"
              className={
                "button secondary catalog-add-btn" +
                (filtersOpen || filterCount ? " active-filter" : "")
              }
              aria-label="Filter reports"
              aria-expanded={filtersOpen}
              aria-haspopup="dialog"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <ListFilter size={17} />
              <span className="button-label">{rangeLabel}</span>
              {filterCount > 0 && (
                <span className="filter-count">{filterCount}</span>
              )}
            </button>
            {filtersOpen && (
              <div
                className="filter-popover"
                role="dialog"
                aria-label="Report date filters"
              >
                <div className="filter-popover-head">
                  <strong>Date range</strong>
                  <span>{rangeHint}</span>
                </div>
                <div className="compact-control">
                  <span>Departure dates</span>
                  <div
                    className="filter-range-options"
                    role="radiogroup"
                    aria-label="Date range"
                  >
                    {(
                      [
                        ["today", "Today"],
                        ["week", "This week"],
                        ["month", "This month"],
                        ["last_month", "Last month"],
                        ["custom", "Custom range"],
                      ] as const
                    ).map(([value, caption]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={preset === value}
                        className={
                          "filter-range-option" +
                          (preset === value ? " selected" : "")
                        }
                        onClick={() => selectPreset(value)}
                      >
                        {caption}
                      </button>
                    ))}
                  </div>
                </div>
                {preset === "custom" && (
                  <div className="filter-custom-range">
                    <TenantDateInput
                      label="From"
                      value={customFrom}
                      max={customTo || undefined}
                      onChange={setCustomFrom}
                      locale={session.tenant.config.locale}
                      dateFormat={session.tenant.config.dateFormat}
                      compact
                    />
                    <TenantDateInput
                      label="To"
                      value={customTo}
                      min={customFrom || undefined}
                      onChange={setCustomTo}
                      locale={session.tenant.config.locale}
                      dateFormat={session.tenant.config.dateFormat}
                      compact
                    />
                  </div>
                )}
                {preset !== "custom" && (
                  <p className="filter-range-hint muted">{rangeHint}</p>
                )}
                <p className="filter-range-hint muted">
                  Population is departures whose local start date falls in
                  range
                  {report.data ? ` · ${report.data.currency}` : ""}.
                </p>
                <div className="filter-popover-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={resetView}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setFiltersOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        }
      />

      {report.error ? (
        <Notice error>{report.error}</Notice>
      ) : !report.data ? (
        <Loading />
      ) : (
        <>
          <p className="muted report-range-note">
            Showing <strong>{rangeHint}</strong>
            {report.data ? ` · ${report.data.currency}` : ""}.
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
            <div className="metric-card">
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
                  [
                    "Unassigned departures",
                    report.data.operations.unassigned,
                  ],
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
                          <td>{row.date}</td>
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
                      <strong>{row.date}</strong>
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
            FX policy exists. Exports remain Track B.
          </Notice>
        </>
      )}
    </>
  );
}
