"use client";

import Link from "next/link";
import { AlertTriangle, BarChart3, CalendarDays, Landmark } from "lucide-react";
import type { Session } from "@/lib/types";
import { dateOnly, money, useResource } from "@/lib/client";
import { downloadCsv } from "@/lib/reports-csv";
import { percentChange } from "@/lib/report-period";
import { Empty, Loading, Notice } from "./common";
import { ReportShell, csvHeader, useReportPeriod } from "./reports-shell";

type Report = {
  range: { from: string; to: string };
  basis: "departure" | "booked";
  currency: string;
  commercial: {
    bookings: number;
    confirmed: number;
    held: number;
    cancelled: number;
    otherCurrency: number;
    bookedMinor: number;
    receivedMinor: number;
    receivedUnconfirmedMinor: number;
    partnerCreditMinor: number;
    guestBalanceMinor: number;
    partnerDueMinor: number;
  };
  previous: {
    range: { from: string; to: string };
    confirmed: number;
    bookedMinor: number;
    receivedMinor: number;
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

export function Delta({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) {
  const change = percentChange(current, previous);
  if (change === null)
    return <em className="report-delta muted">no prior data</em>;
  const tone = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return (
    <em
      className={`report-delta ${tone}`}
      title="Compared with the previous period of equal length"
    >
      {change > 0 ? "▲" : change < 0 ? "▼" : "•"} {Math.abs(change)}% vs prior
    </em>
  );
}

export function PeriodOverviewReport({ session }: { session: Session }) {
  const period = useReportPeriod(session, { basis: true });
  const report = useResource<Report>(`reports/v1/overview?${period.query}`);
  const data = report.data;
  const { locale, dateFormat } = period;

  function exportCsv() {
    if (!data) return;
    const c = data.commercial;
    downloadCsv(`period-overview-${period.from}-${period.to}.csv`, [
      ...csvHeader(session, "Period overview", period, data.currency),
      ["Metric", "Value"],
      ["Bookings", c.bookings],
      ["Confirmed", c.confirmed],
      ["Held (not confirmed)", c.held],
      ["Cancelled", c.cancelled],
      ["Booked value (confirmed)", c.bookedMinor / 100],
      ["Received on confirmed bookings", c.receivedMinor / 100],
      ["Accepted partner credit", c.partnerCreditMinor / 100],
      ["Guest balance", c.guestBalanceMinor / 100],
      ["Received on held/cancelled bookings", c.receivedUnconfirmedMinor / 100],
      ["Partner obligations", c.partnerDueMinor / 100],
      ["Bookings in another currency (excluded)", c.otherCurrency],
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

  // Short ranges list every calendar day; long ranges list active days only.
  const rows = data
    ? data.days.length > 31
      ? data.days.filter((d) => d.departures > 0)
      : data.days
    : [];
  const maxGuests = data ? Math.max(1, ...data.days.map((d) => d.guests)) : 1;
  const showChart = data && data.days.length > 1 && data.days.length <= 62;

  return (
    <ReportShell
      title="Period overview"
      basis={`${period.basisLabel} · ${session.tenant.timezone}`}
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
          <section className="metric-grid report-metrics">
            <Link className="metric-card metric-link" href="/reservations">
              <BarChart3 size={20} />
              <span>Confirmed bookings</span>
              <strong>{data.commercial.confirmed}</strong>
              <small>
                {data.commercial.held} held · {data.commercial.cancelled}{" "}
                cancelled · {data.commercial.bookings} total
              </small>
              <Delta
                current={data.commercial.confirmed}
                previous={data.previous.confirmed}
              />
            </Link>
            <div className="metric-card">
              <Landmark size={20} />
              <span>Booked value</span>
              <strong>
                {money(data.commercial.bookedMinor, data.currency, locale)}
              </strong>
              <small>
                {money(data.commercial.receivedMinor, data.currency, locale)}{" "}
                received
              </small>
              <Delta
                current={data.commercial.bookedMinor}
                previous={data.previous.bookedMinor}
              />
            </div>
            <div
              className={
                "metric-card" +
                (data.commercial.guestBalanceMinor > 0 ? " attention" : "")
              }
            >
              <AlertTriangle size={20} />
              <span>Guest balances</span>
              <strong>
                {money(
                  data.commercial.guestBalanceMinor,
                  data.currency,
                  locale,
                )}
              </strong>
              <small>
                {money(data.commercial.partnerDueMinor, data.currency, locale)}{" "}
                partner obligations
              </small>
            </div>
            <Link className="metric-card metric-link" href="/departures">
              <CalendarDays size={20} />
              <span>Departures</span>
              <strong>{data.operations.departures}</strong>
              <small>{data.operations.unassigned} without assignments</small>
            </Link>
          </section>

          <p className="report-reconcile muted">
            Booked {money(data.commercial.bookedMinor, data.currency, locale)} −
            received{" "}
            {money(data.commercial.receivedMinor, data.currency, locale)} −
            partner credit{" "}
            {money(data.commercial.partnerCreditMinor, data.currency, locale)} =
            guest balance{" "}
            <strong>
              {money(data.commercial.guestBalanceMinor, data.currency, locale)}
            </strong>
            <span className="muted">
              {" "}
              (confirmed bookings only; overpaid bookings count as zero)
            </span>
          </p>

          {data.commercial.receivedUnconfirmedMinor > 0 && (
            <Notice>
              {money(
                data.commercial.receivedUnconfirmedMinor,
                data.currency,
                locale,
              )}{" "}
              was received on held or cancelled bookings. It is not counted
              above — review for confirmation or refund.
            </Notice>
          )}
          {data.commercial.otherCurrency > 0 && (
            <Notice>
              {data.commercial.otherCurrency} booking
              {data.commercial.otherCurrency === 1 ? " is" : "s are"} priced in
              another currency and excluded from money totals until an FX policy
              is approved.
            </Notice>
          )}

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
                  ["Weather holds", data.operations.weatherHolds, "/day-board"],
                  ["Closed departures", data.operations.closed, "/departures"],
                  [
                    "Unassigned departures",
                    data.operations.unassigned,
                    "/departures",
                  ],
                  [
                    "Unresolved pickups",
                    data.operations.unresolvedPickups,
                    "/day-board",
                  ],
                ] as const
              ).map(([label, value, href]) => (
                <Link
                  key={label}
                  href={href}
                  className={
                    "report-exception" + (value > 0 ? " attention" : "")
                  }
                >
                  <span>{label}</span>
                  <strong>{value}</strong>
                </Link>
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
            {!data.days.some((d) => d.departures > 0) ? (
              <Empty title="No departures in this date range">
                <p>Choose another period to review scheduled activity.</p>
              </Empty>
            ) : (
              <>
                {showChart && (
                  <div
                    className="report-bars"
                    aria-label="Guests per day"
                    role="img"
                  >
                    {data.days.map((row) => (
                      <div
                        key={row.date}
                        className="report-bar"
                        title={`${dateOnly(row.date, dateFormat, locale)}: ${row.guests} guests`}
                      >
                        <span
                          style={{
                            height: `${(row.guests / maxGuests) * 100}%`,
                          }}
                        />
                        <small>{row.date.slice(8)}</small>
                      </div>
                    ))}
                  </div>
                )}
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
                      {rows.map((row) => (
                        <tr
                          key={row.date}
                          className={row.departures ? "" : "muted"}
                        >
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
                  {rows.map((row) => (
                    <article key={row.date} className="report-day-card">
                      <strong>{dateOnly(row.date, dateFormat, locale)}</strong>
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
            Amounts use <strong>{data.currency}</strong>, the tenant reporting
            currency. Exceptions and the daily table always use departure dates.
            Cross-currency conversion stays disabled until an approved FX policy
            exists.
          </Notice>
        </>
      )}
    </ReportShell>
  );
}
