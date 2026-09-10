"use client";
import { useState } from "react";
import { AlertTriangle, BarChart3, CalendarDays, Landmark } from "lucide-react";
import type { Session } from "@/lib/types";
import { money, useResource } from "@/lib/client";
import { Empty, Heading, Loading, Notice } from "./common";

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
const day = (date: Date) => date.toISOString().slice(0, 10);
function initialRange() {
  const now = new Date();
  return {
    from: day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    to: day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))),
  };
}

export function Reports({ session }: { session: Session }) {
  const [range, setRange] = useState(initialRange);
  const [applied, setApplied] = useState(initialRange);
  const report = useResource<Report>(
    `reports/v1/overview?${new URLSearchParams(applied).toString()}`,
  );
  return (
    <>
      <Heading
        eyebrow="REPORTING"
        title="Reports"
        description="Operational and commercial facts for the selected departure dates."
      />
      <section className="panel report-filter">
        <label className="field">
          <span>From</span>
          <input
            type="date"
            value={range.from}
            onChange={(event) =>
              setRange({ ...range, from: event.target.value })
            }
          />
        </label>
        <label className="field">
          <span>To</span>
          <input
            type="date"
            value={range.to}
            onChange={(event) => setRange({ ...range, to: event.target.value })}
          />
        </label>
        <button
          className="button"
          disabled={!range.from || !range.to || range.from > range.to}
          onClick={() => setApplied(range)}
        >
          Apply dates
        </button>
      </section>
      {report.error ? (
        <Notice error>{report.error}</Notice>
      ) : !report.data ? (
        <Loading />
      ) : (
        <>
          <section className="metric-grid report-metrics">
            <div className="metric-card">
              <BarChart3 size={20} />
              <span>Confirmed bookings</span>
              <strong>{report.data.commercial.confirmed}</strong>
              <small>{report.data.commercial.cancelled} cancelled</small>
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
                received
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
                partner due
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
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">OPERATING EXCEPTIONS</p>
                <h2>Action requiring review</h2>
              </div>
            </div>
            <div className="detail-grid">
              <div>
                <span>Weather holds</span>
                <strong>{report.data.operations.weatherHolds}</strong>
              </div>
              <div>
                <span>Closed departures</span>
                <strong>{report.data.operations.closed}</strong>
              </div>
              <div>
                <span>Unassigned departures</span>
                <strong>{report.data.operations.unassigned}</strong>
              </div>
              <div>
                <span>Unresolved pickups</span>
                <strong>{report.data.operations.unresolvedPickups}</strong>
              </div>
            </div>
          </section>
          <section className="panel">
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
              <div className="table-scroll">
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
            )}
          </section>
          <Notice>
            Amounts use {report.data.currency}, the tenant reporting currency.
            Cross-currency conversion remains disabled until an approved FX
            policy exists.
          </Notice>
        </>
      )}
    </>
  );
}
