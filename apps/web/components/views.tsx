"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Plus,
  ArrowUpRight,
  ChevronRight,
  Printer,
  CalendarDays,
} from "lucide-react";
import type {
  Session,
  Departure,
  Reservation,
  Manifest,
  Audit,
  Page,
} from "@/lib/types";
import { dateTime, label, money, usePaged, useResource } from "@/lib/client";
import {
  Back,
  Empty,
  Heading,
  Loading,
  More,
  Notice,
  readablePickup,
  SearchBox,
  Status,
} from "./common";

export function Overview({ session }: { session: Session }) {
  const summary = useResource<{
    upcoming_departures: number;
    confirmed_bookings: number;
    confirmed_guests: number;
    held_bookings: number;
  }>("staff/v1/workspace/summary");
  const departures = useResource<Page<Departure>>(
    "staff/v1/workspace/departures?limit=5",
  );
  const reservations = useResource<Page<Reservation>>(
    "staff/v1/workspace/reservations?limit=5",
  );
  const stats = summary.data;
  return (
    <>
      <Heading
        eyebrow="YOUR OPERATION"
        title="Overview"
        description={session.tenant.name}
        action={
          session.permissions.includes("bookings.write") && (
            <Link href="/reservations/new" className="button">
              <Plus size={17} />
              New reservation
            </Link>
          )
        }
      />
      {summary.error && <Notice error>{summary.error}</Notice>}
      <div className="stats-grid">
        {[
          [
            "Upcoming departures",
            stats?.upcoming_departures,
            "Scheduled ahead",
          ],
          [
            "Confirmed bookings",
            stats?.confirmed_bookings,
            "All departure dates",
          ],
          ["Confirmed guests", stats?.confirmed_guests, "All departure dates"],
          ["Reservations on hold", stats?.held_bookings, "Unexpired holds"],
        ].map(([title, value, note]) => (
          <div className="stat" key={String(title)}>
            <span>{title}</span>
            <strong>{value ?? "—"}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">DEPARTURE CALENDAR</p>
              <h2>Scheduled departures</h2>
            </div>
            <Link className="text-link" href="/departures">
              View all <ArrowUpRight size={15} />
            </Link>
          </div>
          {departures.error ? (
            <Notice error>{departures.error}</Notice>
          ) : !departures.data ? (
            <Loading />
          ) : !departures.data.items.length ? (
            <Empty title="No departures yet">
              <Link href="/departures/new">Create a schedule</Link>
            </Empty>
          ) : (
            <div className="departure-list">
              {departures.data.items.map((d) => (
                <div className="departure-row" key={d.id}>
                  <div className="date-tile">
                    <span>
                      {new Intl.DateTimeFormat("en", {
                        month: "short",
                        timeZone: session.tenant.timezone,
                      }).format(new Date(d.starts_at))}
                    </span>
                    <strong>
                      {new Intl.DateTimeFormat("en", {
                        day: "numeric",
                        timeZone: session.tenant.timezone,
                      }).format(new Date(d.starts_at))}
                    </strong>
                  </div>
                  <div className="departure-info">
                    <h3>{d.product_name}</h3>
                    <p>{dateTime(d.starts_at, session.tenant.timezone)}</p>
                    <div className="capacity-line">
                      <span className="capacity-track">
                        <i
                          style={{
                            width: `${(d.committed / d.capacity) * 100}%`,
                          }}
                        />
                      </span>
                      <small>
                        {d.committed}/{d.capacity} seats committed
                      </small>
                    </div>
                  </div>
                  <Link
                    className="icon-link"
                    aria-label={`Open ${d.product_name} manifest`}
                    href={
                      session.permissions.includes("manifest.read")
                        ? `/departures/${d.id}/manifest`
                        : "/departures"
                    }
                  >
                    <ChevronRight size={19} />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel quick-panel">
          <p className="eyebrow">DAILY WORK</p>
          <h2>Keep things moving.</h2>
          <p>Manage a booking from the first call to the departure manifest.</p>
          {[
            [
              "/reservations",
              "Reservations",
              "Find a guest, record payment, confirm.",
            ],
            [
              "/departures",
              "Departures & manifests",
              "Review seats and passenger lists.",
            ],
            [
              "/settings",
              "Tenant configuration",
              "Manage your booking policies.",
            ],
          ]
            .filter(
              ([href]) =>
                href !== "/settings" ||
                session.permissions.includes("config.write"),
            )
            .map(([href, title, note]) => (
              <Link className="quick-link" key={href} href={href}>
                <div>
                  <strong>{title}</strong>
                  <small>{note}</small>
                </div>
                <ArrowUpRight size={18} />
              </Link>
            ))}
          <div className="policy-note">
            <CalendarDays size={19} />
            <span>
              Dates and departure times follow
              <br />
              <strong>{session.tenant.timezone}</strong>
            </span>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Reservation snapshot</h2>
          <Link className="text-link" href="/reservations">
            View all <ArrowUpRight size={15} />
          </Link>
        </div>
        {reservations.error ? (
          <Notice error>{reservations.error}</Notice>
        ) : !reservations.data ? (
          <Loading />
        ) : (
          <ReservationTable items={reservations.data.items} session={session} />
        )}
      </section>
    </>
  );
}
function ReservationTable({
  items,
  session,
}: {
  items: Reservation[];
  session: Session;
}) {
  return !items.length ? (
    <Empty title="No reservations found">
      <p>Create a reservation or adjust your search.</p>
    </Empty>
  ) : (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Guest / reference</th>
            <th>Tour & departure</th>
            <th>Guests</th>
            <th>Status</th>
            <th className="numeric">Balance due</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td>
                <Link className="cell-title" href={"/reservations/" + r.id}>
                  {r.lead_name}
                </Link>
                <small className="mono">
                  {r.id.slice(0, 8).toUpperCase()} · {label(r.source)}
                </small>
              </td>
              <td>
                <strong>{r.product_name}</strong>
                <small>{dateTime(r.starts_at, session.tenant.timezone)}</small>
              </td>
              <td>{Object.values(r.party).reduce((s, v) => s + v, 0)}</td>
              <td>
                <Status state={r.state} />
              </td>
              <td className="numeric">
                {r.state === "cancelled"
                  ? "—"
                  : money(r.total_minor - r.paid_minor, r.currency)}
              </td>
              <td>
                <Link
                  className="icon-link"
                  href={"/reservations/" + r.id}
                  aria-label={`View ${r.lead_name}`}
                >
                  <ChevronRight size={17} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Reservations({ session }: { session: Session }) {
  const [search, setSearch] = useState("");
  const list = usePaged<Reservation>("staff/v1/workspace/reservations", search);
  return (
    <>
      <Heading
        title="Reservations"
        description="Guest details, payment records and booking status."
        action={
          session.permissions.includes("bookings.write") && (
            <Link className="button" href="/reservations/new">
              <Plus size={17} />
              New reservation
            </Link>
          )
        }
      />
      <section className="panel">
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search guest or booking reference"
          />
          <span className="muted">All booking states</span>
        </div>
        {list.error && <Notice error>{list.error}</Notice>}
        {list.busy && !list.items.length ? (
          <Loading />
        ) : (
          <ReservationTable items={list.items} session={session} />
        )}
        <More {...list} count={list.items.length} />
      </section>
    </>
  );
}
export function Departures({ session }: { session: Session }) {
  const [search, setSearch] = useState("");
  const list = usePaged<Departure>("staff/v1/workspace/departures", search);
  return (
    <>
      <Heading
        title="Departures"
        description="Seat availability and passenger manifests."
        action={
          session.permissions.includes("catalog.write") && (
            <Link className="button" href="/departures/new">
              <Plus size={17} />
              Create schedule
            </Link>
          )
        }
      />
      <section className="panel">
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search tour"
          />
          <span className="muted">{session.tenant.timezone}</span>
        </div>
        {list.error && <Notice error>{list.error}</Notice>}
        {list.busy && !list.items.length ? (
          <Loading />
        ) : !list.items.length ? (
          <Empty title="No departures found">
            <p>Configure a product and create a recurring schedule.</p>
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Tour</th>
                  <th>Departure</th>
                  <th>Seats committed</th>
                  <th>Available now</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.product_name}</strong>
                      <small>{d.option_name}</small>
                    </td>
                    <td>{dateTime(d.starts_at, session.tenant.timezone)}</td>
                    <td>
                      {d.committed} / {d.capacity}
                    </td>
                    <td>
                      <span className="seat-count">{d.available}</span>
                    </td>
                    <td>
                      <div className="row-actions">
                        {session.permissions.includes("manifest.read") && (
                          <Link
                            className="text-link"
                            href={`/departures/${d.id}/manifest`}
                          >
                            Manifest
                          </Link>
                        )}
                        {session.permissions.includes("bookings.write") &&
                          d.available > 0 && (
                            <Link
                              className="text-link"
                              href={`/reservations/new?departure=${d.id}`}
                            >
                              Book
                            </Link>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <More {...list} count={list.items.length} />
      </section>
    </>
  );
}
export function ManifestView({
  session,
  departureId,
}: {
  session: Session;
  departureId: string;
}) {
  const { data, error } = useResource<Manifest>(
    `ops/v1/departures/${departureId}/manifest`,
  );
  return (
    <>
      <Back href="/departures">Departures</Back>
      <Heading
        eyebrow="OPERATIONS"
        title="Departure manifest"
        description={
          data
            ? dateTime(data.departure.starts_at, session.tenant.timezone)
            : undefined
        }
        action={
          <button
            className="button secondary no-print"
            onClick={() => window.print()}
            disabled={!data}
          >
            <Printer size={17} />
            Print manifest
          </button>
        }
      />
      <div className="print-only">
        {session.tenant.name} · Mock data · {session.tenant.timezone}
      </div>
      {error ? (
        <Notice error>{error}</Notice>
      ) : !data ? (
        <Loading />
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <h2>Confirmed passengers</h2>
            <span className="status confirmed">
              {data.bookings.reduce((s, b) => s + b.party_size, 0)} guests
            </span>
          </div>
          {!data.bookings.length ? (
            <Empty title="No confirmed bookings yet">
              <p>Held reservations appear here only after confirmation.</p>
            </Empty>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Lead traveler</th>
                    <th>Party</th>
                    <th>Pickup disposition</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bookings.map((b) => (
                    <tr key={b.booking_id}>
                      <td>
                        <strong>{b.lead_name}</strong>
                      </td>
                      <td>
                        {Object.entries(b.party)
                          .filter(([, v]) => v > 0)
                          .map(([k, v]) => `${v} ${label(k)}`)
                          .join(", ")}
                      </td>
                      <td>
                        {readablePickup(b.pickup)}
                        {b.pickup.kind === "selected" && (
                          <small>{b.pickup.instructions}</small>
                        )}
                      </td>
                      <td className="mono">
                        {b.booking_id.slice(0, 8).toUpperCase()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
export function AuditView({ session }: { session: Session }) {
  const { data, error } = useResource<Audit[]>("ops/v1/audit");
  return (
    <>
      <Heading
        title="Audit trail"
        description="The latest 100 recorded changes in this tenant."
      />
      {error ? (
        <Notice error>{error}</Notice>
      ) : !data ? (
        <Loading />
      ) : (
        <section className="panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Record</th>
                  <th>Actor</th>
                  <th>Recorded at</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{label(e.action.replaceAll(".", " "))}</strong>
                    </td>
                    <td className="mono">{e.aggregate_id.slice(0, 8)}</td>
                    <td className="mono">{e.actor_id.slice(0, 8)}</td>
                    <td>{dateTime(e.occurred_at, session.tenant.timezone)}</td>
                    <td>{e.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
