"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Booking, Departure, Pickup, Quote, Session } from "@/lib/types";
import {
  dateTime,
  label,
  money,
  useMutation,
  usePaged,
  useResource,
} from "@/lib/client";
import { Back, Field, Heading, Loading, More, Notice } from "./common";

type ChangeQuote = {
  quoteId: string;
  version: number;
  quote: Quote;
  differenceMinor: number;
  previousTotalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  expiresAt: string;
  allowAmendmentBalance: boolean;
};
type Change = {
  id: string;
  version: number;
  kind: string;
  reason: string;
  occurred_at: string;
  before_data: { quote?: Quote; departure_id?: string; lead_name?: string };
  after_data: { quote?: Quote; financeReviewRequired?: boolean };
};
export function BookingHistory({
  bookingId,
  session,
}: {
  bookingId: string;
  session: Session;
}) {
  const history = useResource<Change[]>(
    `staff/v1/bookings/${bookingId}/changes`,
  );
  return (
    <section className="panel form-panel">
      <h2>Change history</h2>
      {history.error ? (
        <Notice error>{history.error}</Notice>
      ) : !history.data ? (
        <Loading />
      ) : !history.data.length ? (
        <p className="muted">No amendments or cancellations recorded.</p>
      ) : (
        history.data.map((c) => (
          <div className="history-item" key={c.id}>
            <strong>
              {label(c.kind)} · version {c.version}
            </strong>
            <small>{dateTime(c.occurred_at, session.tenant.timezone)}</small>
            <p>{c.reason}</p>
            {c.before_data.quote && c.after_data.quote && (
              <p className="muted">
                {money(
                  c.before_data.quote.totalMinor,
                  c.before_data.quote.currency,
                )}{" "}
                →{" "}
                {money(
                  c.after_data.quote.totalMinor,
                  c.after_data.quote.currency,
                )}
              </p>
            )}
            {c.after_data.financeReviewRequired && (
              <p className="muted">
                Finance review required. No refund issued.
              </p>
            )}
          </div>
        ))
      )}
    </section>
  );
}
export function BookingChangePage({
  session,
  bookingId,
  cancel = false,
}: {
  session: Session;
  bookingId: string;
  cancel?: boolean;
}) {
  const booking = useResource<Booking>(`staff/v1/bookings/${bookingId}`);
  return (
    <>
      <Back href={"/reservations/" + bookingId}>Reservation</Back>
      <Heading
        title={cancel ? "Cancel reservation" : "Amend reservation"}
        description="Every accepted change is versioned and recorded in the audit trail."
      />
      {booking.error ? (
        <Notice error>{booking.error}</Notice>
      ) : !booking.data ? (
        <Loading />
      ) : (
        <ChangeForm
          key={booking.data.version}
          booking={booking.data}
          session={session}
          cancel={cancel}
        />
      )}
    </>
  );
}
function ChangeForm({
  booking: b,
  session,
  cancel,
}: {
  booking: Booking;
  session: Session;
  cancel: boolean;
}) {
  const router = useRouter(),
    quoteMutation = useMutation(),
    accept = useMutation(),
    cancellation = useMutation();
  const departures = usePaged<Departure>("staff/v1/workspace/departures");
  const [departureId, setDepartureId] = useState(b.departure_id),
    [party, setParty] = useState(b.party),
    [name, setName] = useState(b.lead_name),
    [email, setEmail] = useState(b.lead_email),
    [pickup, setPickup] = useState<Pickup>(b.pickup),
    [reason, setReason] = useState(""),
    [quote, setQuote] = useState<ChangeQuote | null>(null),
    [ack, setAck] = useState(false),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const departure = departures.items.find((d) => d.id === departureId),
    expired = Boolean(quote && new Date(quote.expiresAt).getTime() <= now);
  const editable =
    ["held", "confirmed"].includes(b.state) &&
    new Date(b.departure.starts_at).getTime() > now &&
    (b.state === "confirmed" || new Date(b.expiresAt).getTime() > now);
  if (!editable)
    return (
      <Notice error>
        This reservation is no longer eligible for pre-departure changes.{" "}
        <Link href={"/reservations/" + b.id}>Return to reservation</Link>.
      </Notice>
    );
  async function preview(e: React.FormEvent) {
    e.preventDefault();
    const q = await quoteMutation.run<ChangeQuote>(
      `staff/v1/bookings/${b.id}/change-quotes`,
      {
        version: b.version,
        departureId,
        party,
        leadName: name,
        leadEmail: email,
        pickup,
        reason,
      },
    );
    if (q) setQuote(q);
  }
  async function apply() {
    const result = await accept.run(`staff/v1/bookings/${b.id}/changes`, {
      version: b.version,
      quoteId: quote?.quoteId,
    });
    if (result) router.push("/reservations/" + b.id);
  }
  async function cancelBooking(e: React.FormEvent) {
    e.preventDefault();
    const result = await cancellation.run(`staff/v1/bookings/${b.id}/cancel`, {
      version: b.version,
      reason,
    });
    if (result) router.push("/reservations/" + b.id);
  }
  if (cancel)
    return (
      <form className="panel form-panel wide-form" onSubmit={cancelBooking}>
        <h2>{b.lead_name}</h2>
        <p className="muted">
          {dateTime(b.departure.starts_at, session.tenant.timezone)}
        </p>
        <Notice>
          Cancellation releases this party’s seats and removes confirmed
          passengers from the manifest. It does not issue a refund or determine
          cancellation fees.
        </Notice>
        <dl className="detail-grid">
          <div>
            <dt>Historical booking total</dt>
            <dd>{money(b.quote.totalMinor, b.quote.currency)}</dd>
          </div>
          <div>
            <dt>Recorded payments preserved</dt>
            <dd>{money(b.paidMinor, b.quote.currency)}</dd>
          </div>
        </dl>
        <Field label="Cancellation reason">
          <textarea
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <label className="checkbox">
          <input
            type="checkbox"
            required
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          I understand that cancellation releases the seats and any payment
          records require separate finance review.
        </label>
        {cancellation.error && <Notice error>{cancellation.error}</Notice>}
        <div className="form-actions">
          <Link className="button secondary" href={"/reservations/" + b.id}>
            Keep reservation
          </Link>
          <button
            className="button destructive"
            disabled={!ack || cancellation.busy}
          >
            {cancellation.busy ? "Cancelling…" : "Cancel reservation"}
          </button>
        </div>
      </form>
    );
  const shortfall =
    quote &&
    !quote.allowAmendmentBalance &&
    b.state === "confirmed" &&
    BigInt(quote.paidMinor) * 100n <
      BigInt(quote.quote.totalMinor) * BigInt(quote.quote.minimumPaidPercent);
  return (
    <div className="booking-grid">
      <form className="panel form-panel" onSubmit={preview}>
        <fieldset disabled={Boolean(quote) || quoteMutation.busy}>
          <h2>Updated reservation details</h2>
          <div className="form-grid">
            <Field label="Lead traveler">
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </div>
          {b.state === "held" && (
            <Notice>
              Held reservations allow guest and pickup corrections. For a
              different departure or party, cancel this hold and start a new
              reservation.
            </Notice>
          )}
          <Field label="Departure">
            <select
              disabled={b.state !== "confirmed"}
              value={departureId}
              onChange={(e) => {
                setDepartureId(e.target.value);
                if (e.target.value !== b.departure_id) setParty({});
                else setParty(b.party);
              }}
            >
              {!departures.items.some((d) => d.id === b.departure_id) && (
                <option value={b.departure_id}>
                  Current departure ·{" "}
                  {dateTime(b.departure.starts_at, session.tenant.timezone)}
                </option>
              )}
              {departures.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.product_name} ·{" "}
                  {dateTime(d.starts_at, session.tenant.timezone)}
                </option>
              ))}
            </select>
          </Field>
          {departures.error && <Notice error>{departures.error}</Notice>}
          <More {...departures} count={departures.items.length} />
          <div className="party-fields">
            {(
              departure?.categories ??
              Object.keys(b.party).map((slug) => ({ slug, label: label(slug) }))
            ).map((c) => (
              <Field label={c.label} key={c.slug}>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  disabled={b.state !== "confirmed"}
                  value={party[c.slug] ?? 0}
                  onChange={(e) =>
                    setParty({ ...party, [c.slug]: Number(e.target.value) })
                  }
                />
              </Field>
            ))}
          </div>
          <Field label="Pickup disposition">
            <select
              value={pickup.kind}
              onChange={(e) =>
                setPickup(
                  e.target.value === "selected"
                    ? { kind: "selected", location: "", instructions: "" }
                    : e.target.value === "unresolved"
                      ? { kind: "unresolved", note: "" }
                      : { kind: "none" },
                )
              }
            >
              <option value="none">No pickup needed</option>
              <option value="selected">Pickup arranged</option>
              <option value="unresolved">Pickup to arrange</option>
            </select>
          </Field>
          {pickup.kind === "selected" && (
            <>
              <Field label="Pickup location">
                <input
                  required
                  maxLength={120}
                  value={pickup.location}
                  onChange={(e) =>
                    setPickup({ ...pickup, location: e.target.value })
                  }
                />
              </Field>
              <Field label="Pickup instructions">
                <textarea
                  maxLength={500}
                  value={pickup.instructions}
                  onChange={(e) =>
                    setPickup({ ...pickup, instructions: e.target.value })
                  }
                />
              </Field>
            </>
          )}
          {pickup.kind === "unresolved" && (
            <Field label="Follow-up note">
              <textarea
                required
                maxLength={500}
                value={pickup.note}
                onChange={(e) => setPickup({ ...pickup, note: e.target.value })}
              />
            </Field>
          )}
          <Field label="Reason for amendment">
            <textarea
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <button
            className="button"
            disabled={Boolean(quote) || quoteMutation.busy}
          >
            {quoteMutation.busy ? "Calculating…" : "Review change quote"}
          </button>
        </fieldset>
        {quoteMutation.error && <Notice error>{quoteMutation.error}</Notice>}
      </form>
      <aside className="panel summary-panel">
        <p className="eyebrow">REVIEW BEFORE ACCEPTING</p>
        <h2>Change summary</h2>
        {!quote ? (
          <p className="muted">
            Guest and pickup corrections preserve the price. Departure and party
            changes use current rates.
          </p>
        ) : (
          <>
            <div className="balance-lines">
              <div>
                <span>Previous total</span>
                <strong>
                  {money(quote.previousTotalMinor, quote.quote.currency)}
                </strong>
              </div>
              <div>
                <span>New total</span>
                <strong>
                  {money(quote.quote.totalMinor, quote.quote.currency)}
                </strong>
              </div>
              <div>
                <span>Price difference</span>
                <strong>
                  {money(quote.differenceMinor, quote.quote.currency)}
                </strong>
              </div>
              <div>
                <span>Payments retained</span>
                <strong>{money(quote.paidMinor, quote.quote.currency)}</strong>
              </div>
              <div>
                <span>
                  {quote.balanceMinor < 0 ? "Credit for review" : "New balance"}
                </span>
                <strong>
                  {money(Math.abs(quote.balanceMinor), quote.quote.currency)}
                </strong>
              </div>
            </div>
            <p className="policy-copy">
              Quote expires {dateTime(quote.expiresAt, session.tenant.timezone)}
              . Seats are checked again at acceptance; this quote does not hold
              inventory.
            </p>
            {quote.balanceMinor < 0 && (
              <Notice>
                Overpayment requires finance review. No refund is issued by
                accepting this amendment.
              </Notice>
            )}
            {shortfall && (
              <Notice error>
                The tenant’s amendment payment policy is not met. A higher total
                cannot be accepted through this workflow until that policy is
                satisfied.
              </Notice>
            )}
            {expired && (
              <Notice error>Quote expired. Request a fresh quote.</Notice>
            )}
            {accept.error && <Notice error>{accept.error}</Notice>}
            <div className="form-actions">
              <button
                className="button secondary"
                disabled={accept.busy}
                onClick={() => {
                  setQuote(null);
                  accept.clear();
                }}
              >
                Revise
              </button>
              <button
                className="button"
                disabled={expired || Boolean(shortfall) || accept.busy}
                onClick={apply}
              >
                {accept.busy ? "Applying…" : "Accept change"}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
