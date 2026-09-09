"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, Clock, LockKeyhole } from "lucide-react";
import type { Session, Departure, Quote, Booking, Pickup } from "@/lib/types";
import {
  dateTime,
  digits,
  label,
  minor,
  money,
  useMutation,
  usePaged,
  useResource,
} from "@/lib/client";
import {
  Back,
  Field,
  Heading,
  Loading,
  More,
  Notice,
  readablePickup,
  Status,
} from "./common";

import { BookingHistory } from "./booking-changes";

function useRemaining(expiry?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return expiry
    ? Math.max(0, Math.ceil((new Date(expiry).getTime() - now) / 1000))
    : 0;
}
function QuoteSummary({ quote }: { quote: Quote }) {
  return (
    <>
      <div className="quote-lines">
        {quote.lines.map((l) => (
          <div key={l.category}>
            <span>
              {l.quantity} × {label(l.category)}
              <small>{money(l.unitAmountMinor, quote.currency)} each</small>
            </span>
            <strong>{money(l.amountMinor, quote.currency)}</strong>
          </div>
        ))}
        <div>
          <span>Tax</span>
          <span>{money(quote.taxMinor, quote.currency)}</span>
        </div>
      </div>
      <div className="quote-total">
        <span>Booking total</span>
        <strong>{money(quote.totalMinor, quote.currency)}</strong>
      </div>
    </>
  );
}
export function NewReservation({ session }: { session: Session }) {
  const departures = usePaged<Departure>("staff/v1/workspace/departures");
  const [departureId, setDepartureId] = useState(""),
    [party, setParty] = useState<Record<string, number>>({}),
    [hold, setHold] = useState<{
      holdId: string;
      quote: Quote;
      expiresAt: string;
    } | null>(null);
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [source, setSource] = useState(
      session.tenant.config.bookingSources[0] ?? "",
    ),
    [pickupKind, setPickupKind] = useState("none"),
    [location, setLocation] = useState(""),
    [instructions, setInstructions] = useState("");
  const holdMutation = useMutation(),
    bookingMutation = useMutation(),
    router = useRouter();
  const remaining = useRemaining(hold?.expiresAt),
    departure = departures.items.find((d) => d.id === departureId);
  useEffect(() => {
    setDepartureId(
      new URLSearchParams(window.location.search).get("departure") ?? "",
    );
  }, []);
  async function reserve(e: React.FormEvent) {
    e.preventDefault();
    const result = await holdMutation.run<{
      holdId: string;
      quote: Quote;
      expiresAt: string;
    }>("staff/v1/holds", { departureId, party });
    if (result) setHold(result);
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!hold || remaining <= 0) return;
    const pickup: Pickup =
      pickupKind === "none"
        ? { kind: "none" }
        : pickupKind === "selected"
          ? { kind: "selected", location, instructions }
          : { kind: "unresolved", note: instructions };
    const result = await bookingMutation.run<{ bookingId: string }>(
      "staff/v1/bookings",
      { holdId: hold.holdId, leadName: name, leadEmail: email, source, pickup },
    );
    if (result) router.push("/reservations/" + result.bookingId);
  }
  return (
    <>
      <Back href="/reservations">Reservations</Back>
      <Heading
        title="New reservation"
        description="Choose a departure, hold seats, then add your guest."
      />
      <div className="booking-grid">
        <div>
          <section className="panel form-panel">
            <div className="step-heading">
              <span>1</span>
              <div>
                <h2>Departure & party</h2>
                <p>Availability is checked when you hold seats.</p>
              </div>
              {hold && <Check className="step-check" size={20} />}
            </div>
            {departures.error && <Notice error>{departures.error}</Notice>}
            <form onSubmit={reserve}>
              <Field label="Departure">
                <select
                  required
                  value={departureId}
                  disabled={Boolean(hold)}
                  onChange={(e) => {
                    setDepartureId(e.target.value);
                    setParty({});
                  }}
                >
                  <option value="">Select a departure</option>
                  {departures.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.product_name} ·{" "}
                      {dateTime(d.starts_at, session.tenant.timezone)} ·{" "}
                      {d.available} seats
                    </option>
                  ))}
                </select>
              </Field>
              {departures.cursor && !hold && (
                <More {...departures} count={departures.items.length} />
              )}
              <div className="party-fields">
                {departure?.categories.map((c) => (
                  <Field
                    key={c.slug}
                    label={c.label}
                    hint={
                      c.countsTowardCapacity
                        ? "Uses seat capacity"
                        : "Does not use seat capacity"
                    }
                  >
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      step="1"
                      value={party[c.slug] ?? 0}
                      disabled={Boolean(hold)}
                      onChange={(e) =>
                        setParty({ ...party, [c.slug]: Number(e.target.value) })
                      }
                    />
                  </Field>
                ))}
              </div>
              {holdMutation.error && (
                <Notice error>{holdMutation.error}</Notice>
              )}
              {!hold && (
                <button
                  className="button"
                  disabled={!departure || holdMutation.busy}
                >
                  {holdMutation.busy ? "Checking availability…" : "Hold seats"}
                  <ArrowRight size={16} />
                </button>
              )}
            </form>
          </section>
          <section
            className={"panel form-panel " + (!hold ? "muted-panel" : "")}
          >
            <div className="step-heading">
              <span>2</span>
              <div>
                <h2>Guest & pickup</h2>
                <p>Lead traveler details and booking source.</p>
              </div>
            </div>
            <form onSubmit={create}>
              <fieldset
                disabled={!hold || remaining <= 0 || bookingMutation.busy}
              >
                <div className="form-grid">
                  <Field label="Lead traveler name">
                    <input
                      autoComplete="name"
                      required
                      maxLength={120}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Field label="Email address">
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                  <Field label="Booking source">
                    <select
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      {session.tenant.config.bookingSources.map((s) => (
                        <option key={s} value={s}>
                          {label(s)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Pickup disposition">
                    <select
                      value={pickupKind}
                      onChange={(e) => setPickupKind(e.target.value)}
                    >
                      <option value="none">No pickup needed</option>
                      <option value="selected">Pickup arranged</option>
                      <option value="unresolved">Pickup to arrange</option>
                    </select>
                  </Field>
                </div>
                {pickupKind === "selected" && (
                  <Field label="Pickup location">
                    <input
                      required
                      maxLength={120}
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                  </Field>
                )}
                {pickupKind !== "none" && (
                  <Field
                    label={
                      pickupKind === "unresolved"
                        ? "Pickup follow-up note"
                        : "Pickup instructions"
                    }
                  >
                    <textarea
                      maxLength={500}
                      required={pickupKind === "unresolved"}
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                    />
                  </Field>
                )}
                {pickupKind === "unresolved" &&
                  !hold?.quote.allowUnresolvedPickup && (
                    <Notice>
                      This tenant requires an arranged pickup before
                      confirmation. Choose an arranged pickup or no pickup to
                      complete this booking now.
                    </Notice>
                  )}
                <button
                  className="button"
                  disabled={!hold || remaining <= 0 || bookingMutation.busy}
                >
                  {bookingMutation.busy ? "Creating…" : "Create reservation"}
                  <ArrowRight size={16} />
                </button>
              </fieldset>
              {bookingMutation.error && (
                <Notice error>{bookingMutation.error}</Notice>
              )}
            </form>
          </section>
        </div>
        <aside className="panel summary-panel">
          <p className="eyebrow">RESERVATION SUMMARY</p>
          <h2>{departure?.product_name ?? "Choose a departure"}</h2>
          {departure && (
            <p className="muted">
              {dateTime(departure.starts_at, session.tenant.timezone)}
            </p>
          )}
          {hold ? (
            <>
              <div
                className={"hold-timer " + (remaining <= 0 ? "expired" : "")}
              >
                <Clock size={17} />
                {remaining > 0
                  ? `Seats held for ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                  : "Hold expired"}
              </div>
              <QuoteSummary quote={hold.quote} />
              <p className="policy-copy">
                {hold.quote.minimumPaidPercent}% payment required before
                confirmation.
              </p>
              {remaining <= 0 && (
                <Notice error>
                  These seats have been released.{" "}
                  <button
                    className="text-button"
                    onClick={() => {
                      setHold(null);
                      departures.reload();
                    }}
                  >
                    Create a new hold
                  </button>
                </Notice>
              )}
            </>
          ) : (
            <div className="quote-empty">
              <LockKeyhole size={24} />
              <p>Your price is calculated when seats are held.</p>
            </div>
          )}
          <div className="summary-footnote">
            Payment recording and final confirmation happen on the next screen.
          </div>
        </aside>
      </div>
    </>
  );
}
export function BookingDetail({
  session,
  bookingId,
}: {
  session: Session;
  bookingId: string;
}) {
  const booking = useResource<Booking>("staff/v1/bookings/" + bookingId),
    pay = useMutation(),
    confirm = useMutation();
  const [amount, setAmount] = useState(""),
    [method, setMethod] = useState(
      session.tenant.config.manualPaymentMethods[0] ?? "",
    ),
    [reference, setReference] = useState(""),
    [note, setNote] = useState(""),
    [inputError, setInputError] = useState(""),
    [success, setSuccess] = useState("");
  const [occurredAt] = useState(() => new Date().toISOString());
  const remaining = useRemaining(booking.data?.expiresAt);
  useEffect(() => {
    if (booking.data)
      setAmount(
        (
          booking.data.balanceMinor /
          10 ** digits(booking.data.quote.currency)
        ).toFixed(digits(booking.data.quote.currency)),
      );
  }, [booking.data]);
  if (booking.error)
    return (
      <Notice error>
        {booking.error}
        <button className="text-button" onClick={booking.reload}>
          Retry
        </button>
      </Notice>
    );
  if (!booking.data) return <Loading />;
  const b = booking.data;
  const expired =
      b.state === "expired" || (b.state === "held" && remaining === 0),
    required = Math.ceil(
      (b.quote.totalMinor * b.quote.minimumPaidPercent) / 100,
    ),
    eligible =
      b.paidMinor >= required &&
      b.state === "held" &&
      !expired &&
      (b.pickup.kind !== "unresolved" || b.quote.allowUnresolvedPickup);
  async function payment(e: React.FormEvent) {
    e.preventDefault();
    setInputError("");
    try {
      const result = await pay.run(`staff/v1/bookings/${bookingId}/payments`, {
        amountMinor: minor(amount, b.quote.currency),
        currency: b.quote.currency,
        method,
        status: "settled",
        reference,
        reason: note,
        occurredAt,
      });
      if (result) {
        setSuccess(
          "Payment recorded. Booking confirmation is a separate action.",
        );
        setReference("");
        setNote("");
        booking.reload();
      }
    } catch (e) {
      setInputError((e as Error).message);
    }
  }
  async function confirmation() {
    const result = await confirm.run(`staff/v1/bookings/${bookingId}/confirm`, {
      version: b.version,
    });
    if (result) {
      setSuccess(
        "Reservation confirmed. This party is now on the departure manifest.",
      );
      booking.reload();
    }
  }
  return (
    <>
      <Back href="/reservations">Reservations</Back>
      <Heading
        eyebrow={"BOOKING " + b.id.slice(0, 8).toUpperCase()}
        title={b.lead_name}
        description={b.lead_email}
        action={<Status state={expired ? "expired" : b.state} />}
      />
      {success && <Notice>{success}</Notice>}
      {b.state === "cancelled" && (
        <Notice>
          Reservation cancelled. Inventory has been released. Historical price
          and payment records are preserved; no refund has been issued.
        </Notice>
      )}
      {b.financeReviewRequired && (
        <Notice>
          Finance review required for retained payments or credit. No automatic
          refund or cancellation fee has been applied.
        </Notice>
      )}
      {!expired &&
        ["held", "confirmed"].includes(b.state) &&
        new Date(b.departure.starts_at).getTime() > Date.now() &&
        session.permissions.includes("bookings.write") && (
          <div className="booking-actions">
            <Link
              className="button secondary"
              href={"/reservations/" + b.id + "/amend"}
            >
              Amend reservation
            </Link>
            <Link
              className="text-link danger"
              href={"/reservations/" + b.id + "/cancel"}
            >
              Cancel reservation
            </Link>
          </div>
        )}
      <div className="booking-grid">
        <div>
          <section className="panel form-panel">
            <h2>Reservation details</h2>
            <dl className="detail-grid">
              <div>
                <dt>Guests</dt>
                <dd>
                  {Object.entries(b.party)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => `${v} ${label(k)}`)
                    .join(", ")}
                </dd>
              </div>
              <div>
                <dt>Booking source</dt>
                <dd>{label(b.source)}</dd>
              </div>
              <div>
                <dt>Pickup</dt>
                <dd>{readablePickup(b.pickup)}</dd>
              </div>
              <div>
                <dt>Reservation status</dt>
                <dd>{expired ? "Expired" : label(b.state)}</dd>
              </div>
            </dl>
            {session.permissions.includes("manifest.read") && (
              <Link
                className="text-link"
                href={`/departures/${b.departure_id}/manifest`}
              >
                Open departure manifest <ArrowRight size={16} />
              </Link>
            )}
          </section>
          {expired ? (
            <Notice error>
              This hold expired and cannot be confirmed.{" "}
              <Link href="/reservations/new">Start a new reservation</Link>.
            </Notice>
          ) : b.balanceMinor > 0 &&
            session.permissions.includes("payment.write") ? (
            <section className="panel form-panel">
              <div className="panel-heading plain">
                <h2>Record manual payment</h2>
                <span className="status held">Mock collection</span>
              </div>
              <p className="muted">
                Record money received using a tenant-approved method.
              </p>
              <form onSubmit={payment}>
                <div className="form-grid">
                  <Field label={"Amount received · " + b.quote.currency}>
                    <input
                      inputMode="decimal"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </Field>
                  <Field label="Payment method">
                    <select
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                    >
                      {session.tenant.config.manualPaymentMethods.map((m) => (
                        <option key={m} value={m}>
                          {label(m)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Receipt / bank reference">
                    <input
                      required
                      maxLength={120}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                    />
                  </Field>
                  <Field label="Collection note">
                    <input
                      required
                      maxLength={500}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field>
                </div>
                {(inputError || pay.error) && (
                  <Notice error>{inputError || pay.error}</Notice>
                )}
                <button
                  className="button secondary"
                  disabled={pay.busy || confirm.busy}
                >
                  {pay.busy ? "Recording…" : "Record payment"}
                </button>
              </form>
            </section>
          ) : b.balanceMinor === 0 && b.state !== "cancelled" ? (
            <div className="settled-note">
              <Check size={20} />
              <div>
                <strong>Balance settled</strong>
                <p>
                  {money(b.paidMinor, b.quote.currency)} recorded for this
                  booking.
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <aside className="panel summary-panel">
          <p className="eyebrow">PAYMENT & CONFIRMATION</p>
          <h2>Booking summary</h2>
          <QuoteSummary quote={b.quote} />
          <div className="balance-lines">
            <div>
              <span>Recorded payments</span>
              <strong>{money(b.paidMinor, b.quote.currency)}</strong>
            </div>
            <div>
              <span>
                {b.state === "cancelled"
                  ? "Historical balance"
                  : b.balanceMinor < 0
                    ? "Credit for review"
                    : "Balance due"}
              </span>
              <strong>
                {money(
                  b.state === "cancelled"
                    ? b.historicalBalanceMinor
                    : Math.abs(b.balanceMinor),
                  b.quote.currency,
                )}
              </strong>
            </div>
          </div>
          {b.state === "held" && !expired && (
            <div className="hold-timer">
              <Clock size={17} />
              Hold expires in {Math.floor(remaining / 60)}:
              {String(remaining % 60).padStart(2, "0")}
            </div>
          )}
          {b.state === "held" && (
            <>
              <p className="policy-copy">
                {money(required, b.quote.currency)} required to confirm (
                {b.quote.minimumPaidPercent}% of total).
              </p>
              {!eligible && !expired && (
                <p className="muted">
                  Record the required payment and resolve any required pickup
                  before confirming.
                </p>
              )}
              {confirm.error && <Notice error>{confirm.error}</Notice>}
              {session.permissions.includes("bookings.write") && (
                <button
                  className="button full"
                  disabled={!eligible || confirm.busy || pay.busy}
                  onClick={confirmation}
                >
                  {confirm.busy ? "Confirming…" : "Confirm reservation"}
                  <Check size={17} />
                </button>
              )}
            </>
          )}
          {b.state === "confirmed" && (
            <div className="confirmed-note">
              <Check size={20} />
              Confirmed · seats committed
            </div>
          )}
          <p className="summary-footnote">
            The accepted price is fixed. Changes to catalog prices do not change
            this booking.
          </p>
        </aside>
      </div>
      <BookingHistory key={b.version} bookingId={b.id} session={session} />
    </>
  );
}
