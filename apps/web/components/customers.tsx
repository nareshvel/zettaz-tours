"use client";
import Link from "next/link";
import { useState } from "react";
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
        className="catalog-metrics reservation-insights"
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
  return (
    <>
      <Back href="/customers">Customers</Back>
      <Heading
        eyebrow="INSIGHTS"
        title={customer.name}
        description="Shared guest record matched by email. Booking-specific contacts stay on the reservation."
      />
      <div
        className="catalog-metrics reservation-insights customer-contact-facts"
        aria-label="Customer contact"
      >
        <div>
          <strong>{customer.email}</strong>
          <span>Email</span>
        </div>
        <div>
          <strong>{customer.phone || "—"}</strong>
          <span>Phone</span>
        </div>
        <div>
          <strong>{bookings.length}</strong>
          <span>
            {bookings.length === 1 ? "Linked booking" : "Linked bookings"}
          </span>
        </div>
      </div>
      <p className="customer-privacy-note">
        Purchaser and emergency contacts are stored on each reservation, not on
        this shared record. Open a booking to read those details.
      </p>
      <div className="customer-detail-grid">
        <section className="panel form-card">
          <h2>Bookings</h2>
          {!bookings.length ? (
            <p className="muted">No linked bookings.</p>
          ) : (
            <div className="stack-list">
              {bookings.map((booking) => (
                <Link
                  className="detail-row"
                  href={`/reservations/${booking.id}`}
                  key={booking.id}
                >
                  <span>
                    <strong>{booking.product_name}</strong>
                    <small>
                      {dateTime(booking.starts_at, session.tenant.timezone)} ·{" "}
                      {guestCount(booking.party)} guests
                      {booking.source ? ` · ${label(booking.source)}` : ""}
                    </small>
                  </span>
                  <span>
                    <strong>
                      {money(Number(booking.total_minor), booking.currency)}
                    </strong>
                    <Status state={booking.state} />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="panel form-card">
          <h2>Activity</h2>
          {!timeline.length ? (
            <p className="muted">No activity recorded.</p>
          ) : (
            <div className="timeline-list">
              {timeline.map((event, index) => (
                <div
                  key={`${event.booking_id}:${event.kind}:${event.occurred_at}:${index}`}
                >
                  <span className="timeline-dot" />
                  <Link href={`/reservations/${event.booking_id}`}>
                    <strong>{timelineTitle(event)}</strong>
                    <small>
                      {dateTime(event.occurred_at, session.tenant.timezone)}
                    </small>
                    <p>
                      {timelineDetail(event, bookings, session.tenant.timezone)}
                    </p>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
