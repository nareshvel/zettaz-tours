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
type CustomerDetail = {
  customer: CustomerRow;
  bookings: Array<{
    id: string;
    state: string;
    starts_at: string;
    product_name: string;
    source: string;
    party: Record<string, number>;
    currency: string;
    total_minor: string | number;
    purchaser: { name: string; email: string; phone: string };
    emergency_contact: { name?: string; phone?: string; relationship?: string };
  }>;
  timeline: Array<
    Record<string, unknown> & {
      booking_id: string;
      kind: string;
      occurred_at: string;
    }
  >;
};

export function Customers({ session }: { session: Session }) {
  const [search, setSearch] = useState("");
  const customers = usePaged<CustomerRow>("staff/v1/customers", search);
  return (
    <>
      <Heading
        eyebrow="RESERVATIONS"
        title="Customers"
        description="Find guests, review possible duplicates, and open their booking history."
      />
      <SearchBox
        value={search}
        onChange={setSearch}
        placeholder="Search name, email or phone"
      />
      {customers.error && <Notice error>{customers.error}</Notice>}
      {!customers.items.length && customers.busy ? (
        <Loading />
      ) : !customers.items.length ? (
        <Empty title="No customers found">
          <p>
            Customers are created automatically from reservation lead travelers.
          </p>
        </Empty>
      ) : (
        <div className="panel customer-list">
          {customers.items.map((customer) => (
            <Link href={`/customers/${customer.id}`} key={customer.id}>
              <span>
                <strong>{customer.name}</strong>
                <small>
                  {customer.email}
                  {customer.phone ? ` · ${customer.phone}` : ""}
                </small>
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
                    ? dateTime(customer.latest_trip_at, session.tenant.timezone)
                    : "—"}
                </strong>
                <small>latest trip</small>
              </span>
            </Link>
          ))}
          <More {...customers} count={customers.items.length} />
        </div>
      )}
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
        eyebrow="CUSTOMER"
        title={customer.name}
        description={`${customer.email}${customer.phone ? ` · ${customer.phone}` : ""}`}
      />
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
                      {Object.values(booking.party).reduce(
                        (sum, value) => sum + value,
                        0,
                      )}{" "}
                      guests
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
          <h2>Customer timeline</h2>
          {!timeline.length ? (
            <p className="muted">No activity recorded.</p>
          ) : (
            <div className="timeline-list">
              {timeline.map((event, index) => (
                <div
                  key={`${event.booking_id}:${event.kind}:${event.occurred_at}:${index}`}
                >
                  <span className="timeline-dot" />
                  <div>
                    <strong>{label(event.kind)}</strong>
                    <small>
                      {dateTime(event.occurred_at, session.tenant.timezone)} ·
                      Booking {event.booking_id.slice(0, 8)}
                    </small>
                    {event.reason ? <p>{String(event.reason)}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
