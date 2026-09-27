"use client";

import Link from "next/link";
import type { Session } from "@/lib/types";
import { money, useResource } from "@/lib/client";
import { downloadCsv } from "@/lib/reports-csv";
import { Empty, Loading, Notice } from "./common";
import { ReportShell, csvHeader, useReportPeriod } from "./reports-shell";

type Base = { range: { from: string; to: string }; currency: string };

function pct(part: number, whole: number) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}

// ─── Sales by product ────────────────────────────────────────────────────────

type ProductRow = {
  productId: string;
  name: string;
  departures: number;
  capacity: number;
  confirmed: number;
  cancelled: number;
  guests: number;
  bookedMinor: number;
  receivedMinor: number;
  otherCurrency: number;
};

export function SalesByProductReport({ session }: { session: Session }) {
  const period = useReportPeriod(session, {
    basis: true,
    defaultRange: "month",
  });
  const report = useResource<Base & { rows: ProductRow[] }>(
    `reports/v1/sales-by-product?${period.query}`,
  );
  const data = report.data;
  const { locale } = period;
  const totals = data?.rows.reduce(
    (t, r) => ({
      confirmed: t.confirmed + r.confirmed,
      guests: t.guests + r.guests,
      booked: t.booked + r.bookedMinor,
      received: t.received + r.receivedMinor,
      capacity: t.capacity + r.capacity,
    }),
    { confirmed: 0, guests: 0, booked: 0, received: 0, capacity: 0 },
  );

  function exportCsv() {
    if (!data) return;
    downloadCsv(`sales-by-product-${period.from}-${period.to}.csv`, [
      ...csvHeader(session, "Sales by product", period, data.currency),
      [
        "Product",
        "Departures",
        "Capacity",
        "Confirmed",
        "Cancelled",
        "Guests",
        "Occupancy %",
        "Booked",
        "Received",
        "Avg per guest",
      ],
      ...data.rows.map((r) => [
        r.name,
        r.departures,
        r.capacity,
        r.confirmed,
        r.cancelled,
        r.guests,
        r.capacity ? Math.round((r.guests / r.capacity) * 100) : "",
        r.bookedMinor / 100,
        r.receivedMinor / 100,
        r.guests ? Math.round(r.bookedMinor / r.guests) / 100 : "",
      ]),
    ]);
  }

  return (
    <ReportShell
      title="Sales by product"
      basis={`${period.basisLabel} · confirmed bookings`}
      filters={period.filters}
      onExport={exportCsv}
      exportDisabled={!data}
    >
      {report.error ? (
        <Notice error>{report.error}</Notice>
      ) : !data || !totals ? (
        <Loading />
      ) : !data.rows.length ? (
        <Empty title="No sales in this period">
          <p>Choose another period.</p>
        </Empty>
      ) : (
        <>
          <p className="muted report-range-note">
            Showing <strong>{period.rangeHint}</strong> · {data.currency}
          </p>
          <section className="metric-grid report-metrics compact">
            <div className="metric-card">
              <span>Booked value</span>
              <strong>{money(totals.booked, data.currency, locale)}</strong>
              <small>
                {money(totals.received, data.currency, locale)} received
              </small>
            </div>
            <div className="metric-card">
              <span>Guests</span>
              <strong>{totals.guests}</strong>
              <small>{totals.confirmed} confirmed bookings</small>
            </div>
            <div className="metric-card">
              <span>Occupancy</span>
              <strong>{pct(totals.guests, totals.capacity)}</strong>
              <small>of {totals.capacity} seats on open departures</small>
            </div>
          </section>
          <section className="panel">
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Departures</th>
                    <th className="num">Guests</th>
                    <th className="num">Occupancy</th>
                    <th className="num">Cancelled</th>
                    <th className="num">Booked</th>
                    <th className="num">Received</th>
                    <th className="num">Avg / guest</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.productId}>
                      <td>
                        <strong>{r.name}</strong>
                        {r.otherCurrency > 0 && (
                          <small className="muted">
                            {" "}
                            · {r.otherCurrency} in other currency
                          </small>
                        )}
                      </td>
                      <td className="num">{r.departures}</td>
                      <td className="num">{r.guests}</td>
                      <td className="num">{pct(r.guests, r.capacity)}</td>
                      <td className="num">
                        {r.cancelled}{" "}
                        <small className="muted">
                          ({pct(r.cancelled, r.confirmed + r.cancelled)})
                        </small>
                      </td>
                      <td className="num">
                        {money(r.bookedMinor, data.currency, locale)}
                      </td>
                      <td className="num">
                        {money(r.receivedMinor, data.currency, locale)}
                      </td>
                      <td className="num">
                        {r.guests
                          ? money(
                              Math.round(r.bookedMinor / r.guests),
                              data.currency,
                              locale,
                            )
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th />
                    <th className="num">{totals.guests}</th>
                    <th className="num">
                      {pct(totals.guests, totals.capacity)}
                    </th>
                    <th />
                    <th className="num">
                      {money(totals.booked, data.currency, locale)}
                    </th>
                    <th className="num">
                      {money(totals.received, data.currency, locale)}
                    </th>
                    <th />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
          <Notice>
            Occupancy compares confirmed guests with seats on non-closed
            departures in the period. Booked value is from each booking&apos;s
            immutable price snapshot.
          </Notice>
        </>
      )}
    </ReportShell>
  );
}

// ─── Booking sources ─────────────────────────────────────────────────────────

type SourceRow = {
  source: string;
  bookings: number;
  confirmed: number;
  cancelled: number;
  guests: number;
  bookedMinor: number;
};

const SOURCE_LABELS: Record<string, string> = {
  phone: "Phone",
  walk_in: "Walk-in",
  email: "Email",
  website: "Website",
  partner: "Partner",
  ota: "OTA",
  import: "Import",
  unknown: "Not recorded",
};

export function BookingSourcesReport({ session }: { session: Session }) {
  const period = useReportPeriod(session, {
    basis: true,
    defaultRange: "month",
  });
  const report = useResource<Base & { rows: SourceRow[] }>(
    `reports/v1/booking-sources?${period.query}`,
  );
  const data = report.data;
  const totalBooked = data?.rows.reduce((t, r) => t + r.bookedMinor, 0) ?? 0;
  const totalBookings = data?.rows.reduce((t, r) => t + r.bookings, 0) ?? 0;

  function exportCsv() {
    if (!data) return;
    downloadCsv(`booking-sources-${period.from}-${period.to}.csv`, [
      ...csvHeader(session, "Booking sources", period, data.currency),
      [
        "Source",
        "Bookings",
        "Confirmed",
        "Cancelled",
        "Guests",
        "Booked",
        "Share of value %",
      ],
      ...data.rows.map((r) => [
        SOURCE_LABELS[r.source] ?? r.source,
        r.bookings,
        r.confirmed,
        r.cancelled,
        r.guests,
        r.bookedMinor / 100,
        totalBooked ? Math.round((r.bookedMinor / totalBooked) * 100) : "",
      ]),
    ]);
  }

  return (
    <ReportShell
      title="Booking sources"
      basis={`${period.basisLabel} · where bookings came from`}
      filters={period.filters}
      onExport={exportCsv}
      exportDisabled={!data}
    >
      {report.error ? (
        <Notice error>{report.error}</Notice>
      ) : !data ? (
        <Loading />
      ) : !data.rows.length ? (
        <Empty title="No bookings in this period">
          <p>Choose another period.</p>
        </Empty>
      ) : (
        <>
          <p className="muted report-range-note">
            Showing <strong>{period.rangeHint}</strong> · {totalBookings}{" "}
            bookings · {data.currency}
          </p>
          <section className="panel">
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className="num">Bookings</th>
                    <th className="num">Confirmed</th>
                    <th className="num">Cancelled</th>
                    <th className="num">Guests</th>
                    <th className="num">Booked</th>
                    <th>Share of value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const share = totalBooked
                      ? (r.bookedMinor / totalBooked) * 100
                      : 0;
                    return (
                      <tr key={r.source}>
                        <td>
                          <strong>{SOURCE_LABELS[r.source] ?? r.source}</strong>
                        </td>
                        <td className="num">{r.bookings}</td>
                        <td className="num">{r.confirmed}</td>
                        <td className="num">{r.cancelled}</td>
                        <td className="num">{r.guests}</td>
                        <td className="num">
                          {money(r.bookedMinor, data.currency, period.locale)}
                        </td>
                        <td>
                          <div className="report-share">
                            <span style={{ width: `${share}%` }} />
                            <small>{Math.round(share)}%</small>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </ReportShell>
  );
}

// ─── Commission summary ──────────────────────────────────────────────────────

type CommissionRow = {
  partnerId: string;
  name: string;
  direction: "partner_owes_tenant" | "tenant_owes_partner";
  currency: string;
  bookings: number;
  guests: number;
  grossMinor: number;
  commissionMinor: number;
  settledMinor: number;
  outstandingMinor: number;
};

const DIRECTION: Record<CommissionRow["direction"], string> = {
  tenant_owes_partner: "We pay partner",
  partner_owes_tenant: "Partner pays us",
};

export function CommissionSummaryReport({ session }: { session: Session }) {
  const period = useReportPeriod(session, {
    basis: true,
    defaultRange: "month",
  });
  const report = useResource<Base & { rows: CommissionRow[] }>(
    `reports/v1/commission-summary?${period.query}`,
  );
  const data = report.data;
  const { locale } = period;

  function exportCsv() {
    if (!data) return;
    downloadCsv(`commission-summary-${period.from}-${period.to}.csv`, [
      ...csvHeader(session, "Commission summary", period, data.currency),
      [
        "Partner",
        "Direction",
        "Currency",
        "Bookings",
        "Guests",
        "Gross",
        "Commission",
        "Settled",
        "Outstanding",
      ],
      ...data.rows.map((r) => [
        r.name,
        DIRECTION[r.direction],
        r.currency,
        r.bookings,
        r.guests,
        r.grossMinor / 100,
        r.commissionMinor / 100,
        r.settledMinor / 100,
        r.outstandingMinor / 100,
      ]),
    ]);
  }

  const outstanding = (dir: CommissionRow["direction"]) =>
    (data?.rows ?? [])
      .filter((r) => r.direction === dir && r.currency === data?.currency)
      .reduce((t, r) => t + r.outstandingMinor, 0);

  return (
    <ReportShell
      title="Commission summary"
      basis={`${period.basisLabel} · attributed bookings, excluding cancelled`}
      filters={period.filters}
      onExport={exportCsv}
      exportDisabled={!data}
    >
      {report.error ? (
        <Notice error>{report.error}</Notice>
      ) : !data ? (
        <Loading />
      ) : !data.rows.length ? (
        <Empty title="No partner-attributed bookings in this period">
          <p>Commission appears here once bookings are linked to a partner.</p>
        </Empty>
      ) : (
        <>
          <p className="muted report-range-note">
            Showing <strong>{period.rangeHint}</strong>
          </p>
          <section className="metric-grid report-metrics compact">
            <div className="metric-card attention">
              <span>We owe partners</span>
              <strong>
                {money(
                  outstanding("tenant_owes_partner"),
                  data.currency,
                  locale,
                )}
              </strong>
              <small>outstanding commission</small>
            </div>
            <div className="metric-card">
              <span>Partners owe us</span>
              <strong>
                {money(
                  outstanding("partner_owes_tenant"),
                  data.currency,
                  locale,
                )}
              </strong>
              <small>outstanding commission</small>
            </div>
          </section>
          <section className="panel">
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Partner</th>
                    <th>Direction</th>
                    <th className="num">Bookings</th>
                    <th className="num">Guests</th>
                    <th className="num">Gross</th>
                    <th className="num">Commission</th>
                    <th className="num">Settled</th>
                    <th className="num">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={`${r.partnerId}-${r.direction}-${r.currency}`}>
                      <td>
                        <Link href={`/finance/partners/${r.partnerId}`}>
                          <strong>{r.name}</strong>
                        </Link>
                      </td>
                      <td>{DIRECTION[r.direction]}</td>
                      <td className="num">{r.bookings}</td>
                      <td className="num">{r.guests}</td>
                      <td className="num">
                        {money(r.grossMinor, r.currency, locale)}
                      </td>
                      <td className="num">
                        {money(r.commissionMinor, r.currency, locale)}
                      </td>
                      <td className="num">
                        {money(r.settledMinor, r.currency, locale)}
                      </td>
                      <td className="num">
                        <strong>
                          {money(r.outstandingMinor, r.currency, locale)}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <Notice>
            Commission uses the terms frozen on each booking when it was linked
            to the partner — later changes to partner terms do not rewrite
            history. Totals above include only {data.currency} rows.
          </Notice>
        </>
      )}
    </ReportShell>
  );
}
