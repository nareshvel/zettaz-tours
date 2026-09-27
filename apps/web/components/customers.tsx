"use client";
import Link from "next/link";
import { useState } from "react";
import {
  CalendarDays,
  Clock,
  CreditCard,
  FileSignature,
  Mail,
  Phone,
  Plus,
} from "lucide-react";
import type { Session } from "@/lib/types";
import { dateTime, label, money, usePaged, useResource } from "@/lib/client";
import {
  Back,
  Empty,
  Heading,
  Loading,
  More,
  Notice,
  SearchBox,
  Status,
} from "./common";

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  booking_count: number;
  latest_trip_at: string | null;
};
type CustomerBooking = {
  id: string;
  state: string;
  starts_at: string;
  product_name: string;
  source: string;
  party: Record<string, number>;
  currency: string;
  total_minor: string | number;
};
type TimelineEvent = Record<string, unknown> & {
  booking_id: string;
  kind: string;
  occurred_at: string;
};
type CustomerDetail = {
  customer: CustomerRow;
  bookings: CustomerBooking[];
  timeline: TimelineEvent[];
};

function guestCount(party: Record<string, number>) {
  return Object.values(party).reduce((sum, value) => sum + value, 0);
}

function timelineTitle(event: TimelineEvent) {
  if (event.kind === "booking") return "Trip";
  if (event.kind === "payment") return "Payment";
  if (event.kind === "waiver") return "Waiver";
  if (event.kind === "message") return "Message";
  return label(event.kind);
}

function timelineDetail(
  event: TimelineEvent,
  bookings: CustomerBooking[],
  timezone: string,
) {
  const booking = bookings.find((item) => item.id === event.booking_id);
  const trip = booking?.product_name ?? "Reservation";
  if (event.kind === "booking") {
    return `${trip}${event.state ? ` · ${label(String(event.state))}` : ""}`;
  }
  if (event.kind === "payment") {
    const amount =
      event.amount_minor != null && event.currency
        ? money(Number(event.amount_minor), String(event.currency))
        : "";
    return [
      amount,
      event.method && label(String(event.method)),
      event.status && label(String(event.status)),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (event.kind === "waiver") {
    return event.signer_capacity
      ? `Signed as ${label(String(event.signer_capacity))}`
      : "Signed";
  }
  if (event.kind === "message") {
    return [
      event.channel && label(String(event.channel)),
      event.subject,
      event.status && label(String(event.status)),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (event.reason) return String(event.reason);
  return `${trip} · ${dateTime(event.occurred_at, timezone)}`;
}

export function Customers({ session }: { session: Session }) {
  const [search, setSearch] = useState("");
  const customers = usePaged<CustomerRow>("staff/v1/customers", search);
  const bookingsInView = customers.items.reduce(
    (sum, customer) => sum + customer.booking_count,
    0,
  );
  const repeatGuests = customers.items.filter(
    (customer) => customer.booking_count > 1,
  ).length;
  const withPhone = customers.items.filter((customer) => customer.phone).length;
  return (
    <>
      <Heading
        eyebrow="INSIGHTS"
        title="Customers"
        description="Guests are matched by email. Open a record for linked bookings — purchaser and emergency contacts stay on each reservation."
      />
      <div
        className="catalog-metrics edge-left"
        aria-label="Loaded customer summary"
      >
        <div>
          <strong>{customers.items.length}</strong>
          <span>Guests in view</span>
        </div>
        <div>
          <strong>{bookingsInView}</strong>
          <span>Linked bookings</span>
        </div>
        <div>
          <strong>{repeatGuests}</strong>
          <span>Repeat guests</span>
        </div>
        <div>
          <strong>{withPhone}</strong>
          <span>With phone</span>
        </div>
      </div>
      {customers.error && <Notice error>{customers.error}</Notice>}
      <section className="panel">
        <div className="list-action-bar">
          <div className="list-action-search">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search name, email or phone"
            />
          </div>
        </div>
        {!customers.items.length && customers.busy ? (
          <Loading />
        ) : !customers.items.length ? (
          <Empty title={search ? "No matching guests" : "No customers found"}>
            <p>
              {search
                ? "Try another name, email, or phone. Same name or phone with a different email is a separate record — merge is not available yet."
                : "Customers are created automatically from reservation lead travelers."}
            </p>
          </Empty>
        ) : (
          <div className="customer-list">
            {customers.items.map((customer) => (
              <Link href={`/customers/${customer.id}`} key={customer.id}>
                <span className="customer-name-block">
                  <strong>{customer.name}</strong>
                  <small>
                    {customer.email}
                    {customer.phone ? ` · ${customer.phone}` : ""}
                  </small>
                  {customer.booking_count > 1 ? (
                    <span className="status held">Repeat guest</span>
                  ) : null}
                </span>
                <span>
                  <strong>{customer.booking_count}</strong>
                  <small>
                    {customer.booking_count === 1 ? "booking" : "bookings"}
                  </small>
                </span>
                <span>
                  <strong>
                    {customer.latest_trip_at
                      ? dateTime(
                          customer.latest_trip_at,
                          session.tenant.timezone,
                        )
                      : "—"}
                  </strong>
                  <small>latest trip</small>
                </span>
              </Link>
            ))}
            <More {...customers} count={customers.items.length} />
          </div>
        )}
      </section>
    </>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function dayParts(iso: string, timezone: string) {
  const date = new Date(iso);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en", { timeZone: timezone, ...options }).format(
      date,
    );
  return {
    day: part({ day: "2-digit" }),
    month: part({ month: "short" }),
    year: part({ year: "numeric" }),
    time: part({ hour: "numeric", minute: "2-digit" }),
  };
}

const TIMELINE_ICON: Record<string, React.ReactNode> = {
  booking: <CalendarDays size={15} />,
  payment: <CreditCard size={15} />,
  waiver: <FileSignature size={15} />,
  message: <Mail size={15} />,
};

function BookingRow({
  booking,
  timezone,
}: {
  booking: CustomerBooking;
  timezone: string;
}) {
  const d = dayParts(booking.starts_at, timezone);
  return (
    <Link className="customer-trip" href={`/reservations/${booking.id}`}>
      <span className="customer-trip-date" aria-hidden="true">
        <small>{d.month}</small>
        <strong>{d.day}</strong>
        <small>{d.year}</small>
      </span>
      <span className="customer-trip-main">
        <strong>{booking.product_name}</strong>
        <small>
          {d.time} · {guestCount(booking.party)}{" "}
          {guestCount(booking.party) === 1 ? "guest" : "guests"}
          {booking.source ? ` · ${label(booking.source)}` : ""}
        </small>
      </span>
      <span className="customer-trip-side">
        <strong>{money(Number(booking.total_minor), booking.currency)}</strong>
        <Status state={booking.state} />
      </span>
    </Link>
  );
}

export function CustomerDetailPage({
  session,
  customerId,
}: {
  session: Session;
  customerId: string;
}) {
  const resource = useResource<CustomerDetail>(
    `staff/v1/customers/${customerId}`,
  );
  if (resource.error)
    return (
      <>
        <Back href="/customers">Customers</Back>
        <Notice error>{resource.error}</Notice>
      </>
    );
  if (!resource.data)
    return (
      <>
        <Back href="/customers">Customers</Back>
        <Loading />
      </>
    );
  const { customer, bookings, timeline } = resource.data;
  const timezone = session.tenant.timezone;
  const now = Date.now();
  const active = bookings.filter((b) => b.state !== "cancelled");
  const upcoming = bookings
    .filter((b) => new Date(b.starts_at).getTime() >= now)
    .sort((x, y) => x.starts_at.localeCompare(y.starts_at));
  const past = bookings.filter((b) => new Date(b.starts_at).getTime() < now);
  const confirmed = bookings.filter((b) => b.state === "confirmed");
  const currencies = [...new Set(confirmed.map((b) => b.currency))];
  const lifetime =
    currencies.length === 1
      ? money(
          confirmed.reduce((t, b) => t + Number(b.total_minor), 0),
          currencies[0],
        )
      : currencies.length
        ? "Mixed currencies"
        : "—";
  const guestsTravelled = confirmed.reduce(
    (t, b) => t + guestCount(b.party),
    0,
  );
  const nextTrip = upcoming.find((b) => b.state !== "cancelled");
  const lastTrip = past.find((b) => b.state !== "cancelled");
  const since = (customer as CustomerRow & { created_at?: string }).created_at;
  return (
    <>
      <Back href="/customers">Customers</Back>
      <section className="customer-hero">
        <div className="customer-avatar" aria-hidden="true">
          {initials(customer.name)}
        </div>
        <div className="customer-hero-main">
          <p className="eyebrow">GUEST</p>
          <h1>{customer.name}</h1>
          <div className="customer-hero-contacts">
            <a href={`mailto:${customer.email}`}>
              <Mail size={15} /> {customer.email}
            </a>
            {customer.phone ? (
              <a href={`tel:${customer.phone}`}>
                <Phone size={15} /> {customer.phone}
              </a>
            ) : (
              <span className="muted">
                <Phone size={15} /> No phone on file
              </span>
            )}
            {since && (
              <span className="muted">
                <Clock size={15} /> Guest since{" "}
                {new Intl.DateTimeFormat("en", {
                  timeZone: timezone,
                  month: "short",
                  year: "numeric",
                }).format(new Date(since))}
              </span>
            )}
          </div>
        </div>
        <div className="customer-hero-actions">
          <Link className="button" href="/reservations/new">
            <Plus size={16} /> New reservation
          </Link>
        </div>
      </section>

      <div className="catalog-metrics edge-left" aria-label="Guest summary">
        <div>
          <strong>{active.length}</strong>
          <span>
            {active.length === 1 ? "Trip booked" : "Trips booked"}
            {bookings.length > active.length
              ? ` · ${bookings.length - active.length} cancelled`
              : ""}
          </span>
        </div>
        <div className="good">
          <strong>{lifetime}</strong>
          <span>Confirmed booking value</span>
        </div>
        <div>
          <strong>{guestsTravelled}</strong>
          <span>Guests on confirmed trips</span>
        </div>
        <div className={nextTrip ? "attention" : ""}>
          <strong>
            {nextTrip
              ? dateTime(nextTrip.starts_at, timezone)
              : lastTrip
                ? dateTime(lastTrip.starts_at, timezone)
                : "—"}
          </strong>
          <span>{nextTrip ? "Next trip" : "Last trip"}</span>
        </div>
      </div>

      <div className="customer-detail-grid">
        <section className="panel customer-panel">
          <div className="customer-panel-head">
            <h2>Trips</h2>
            <span className="muted">{bookings.length} total</span>
          </div>
          {!bookings.length ? (
            <p className="muted customer-empty">No linked bookings.</p>
          ) : (
            <>
              {upcoming.length > 0 && (
                <>
                  <p className="customer-group-label">Upcoming</p>
                  <div className="customer-trip-list">
                    {upcoming.map((booking) => (
                      <BookingRow
                        key={booking.id}
                        booking={booking}
                        timezone={timezone}
                      />
                    ))}
                  </div>
                </>
              )}
              {past.length > 0 && (
                <>
                  <p className="customer-group-label">Past</p>
                  <div className="customer-trip-list">
                    {past.map((booking) => (
                      <BookingRow
                        key={booking.id}
                        booking={booking}
                        timezone={timezone}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>
        <section className="panel customer-panel">
          <div className="customer-panel-head">
            <h2>Activity</h2>
            <span className="muted">{timeline.length} events</span>
          </div>
          {!timeline.length ? (
            <p className="muted customer-empty">No activity recorded.</p>
          ) : (
            <ol className="customer-activity">
              {timeline.map((event, index) => (
                <li
                  key={`${event.booking_id}:${event.kind}:${event.occurred_at}:${index}`}
                  className={`kind-${event.kind}`}
                >
                  <span className="customer-activity-icon">
                    {TIMELINE_ICON[event.kind] ?? <Clock size={15} />}
                  </span>
                  <Link href={`/reservations/${event.booking_id}`}>
                    <span className="customer-activity-top">
                      <strong>{timelineTitle(event)}</strong>
                      <small>{dateTime(event.occurred_at, timezone)}</small>
                    </span>
                    <p>{timelineDetail(event, bookings, timezone)}</p>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <p className="customer-privacy-note">
        This record is shared across bookings and matched by email. Purchaser
        and emergency contacts stay on each reservation — open a trip to see
        them.
      </p>
    </>
  );
}
