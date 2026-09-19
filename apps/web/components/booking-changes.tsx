"use client";
import { useEffect, useRef, useState } from "react";
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
import {
  ConfirmDialog,
  Field,
  FormActions,
  Loading,
  More,
  Notice,
} from "./common";

const PICKUP_LOCATION_OTHER = "__other__";

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
type DepartureLabel = {
  id: string;
  starts_at: string;
  product_name: string;
};
type Change = {
  id: string;
  version: number;
  kind: string;
  reason: string;
  occurred_at: string;
  before_data: {
    quote?: Quote;
    departure_id?: string;
    lead_name?: string;
    lead_email?: string;
    party?: Record<string, number>;
    pickup?: Pickup;
    state?: string;
    departure?: DepartureLabel | null;
  };
  after_data: {
    quote?: Quote;
    departure_id?: string;
    lead_name?: string;
    lead_email?: string;
    party?: Record<string, number>;
    pickup?: Pickup;
    state?: string;
    financeReviewRequired?: boolean;
    departure?: DepartureLabel | null;
  };
};

function partyText(party?: Record<string, number>) {
  if (!party) return "";
  return Object.entries(party)
    .filter(([, n]) => Number(n) > 0)
    .map(([name, n]) => `${n} ${name}`)
    .join(", ");
}

function pickupText(pickup?: Pickup) {
  if (!pickup || pickup.kind === "none") return "None";
  if (pickup.kind === "selected") {
    return [pickup.location, pickup.instructions].filter(Boolean).join(" — ");
  }
  if (pickup.kind === "unresolved") {
    return pickup.note ? `Unresolved — ${pickup.note}` : "Unresolved";
  }
  return "Pickup";
}

function departureText(
  data: Change["before_data"] | Change["after_data"],
  timezone: string,
) {
  if (data.departure) {
    return `${data.departure.product_name} · ${dateTime(data.departure.starts_at, timezone)}`;
  }
  if (data.departure_id) return data.departure_id.slice(0, 8).toUpperCase();
  return "";
}

function changeLines(
  change: Change,
  timezone: string,
): Array<{ label: string; from: string; to: string }> {
  const before = change.before_data;
  const after = change.after_data;
  const lines: Array<{ label: string; from: string; to: string }> = [];
  const beforeDep = departureText(before, timezone);
  const afterDep = departureText(after, timezone);
  if (beforeDep && afterDep && before.departure_id !== after.departure_id) {
    lines.push({ label: "Departure", from: beforeDep, to: afterDep });
  }
  const beforeParty = partyText(before.party);
  const afterParty = partyText(after.party);
  if (beforeParty !== afterParty && (beforeParty || afterParty)) {
    lines.push({
      label: "Guests",
      from: beforeParty || "—",
      to: afterParty || "—",
    });
  }
  if (
    before.lead_name !== after.lead_name &&
    (before.lead_name || after.lead_name)
  ) {
    lines.push({
      label: "Lead guest",
      from: before.lead_name || "—",
      to: after.lead_name || "—",
    });
  }
  if (
    before.lead_email !== after.lead_email &&
    (before.lead_email || after.lead_email)
  ) {
    lines.push({
      label: "Email",
      from: before.lead_email || "—",
      to: after.lead_email || "—",
    });
  }
  const beforePickup = before.pickup ? pickupText(before.pickup) : "";
  const afterPickup = after.pickup ? pickupText(after.pickup) : "";
  if (
    JSON.stringify(before.pickup ?? null) !==
      JSON.stringify(after.pickup ?? null) &&
    (beforePickup || afterPickup)
  ) {
    lines.push({
      label: "Pickup",
      from: beforePickup || "—",
      to: afterPickup || "—",
    });
  }
  if (before.quote && after.quote) {
    const fromMoney = money(before.quote.totalMinor, before.quote.currency);
    const toMoney = money(after.quote.totalMinor, after.quote.currency);
    if (
      before.quote.totalMinor !== after.quote.totalMinor ||
      before.quote.currency !== after.quote.currency
    ) {
      lines.push({ label: "Total", from: fromMoney, to: toMoney });
    }
  }
  if (before.state !== after.state && (before.state || after.state)) {
    lines.push({
      label: "Status",
      from: before.state ? label(before.state) : "—",
      to: after.state ? label(after.state) : "—",
    });
  }
  return lines;
}

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
        history.data.map((c) => {
          const lines = changeLines(c, session.tenant.timezone);
          return (
            <article className="history-item" key={c.id}>
              <div className="history-item-head">
                <strong>
                  {label(c.kind)} · v{c.version}
                </strong>
                <small>
                  {dateTime(c.occurred_at, session.tenant.timezone)}
                </small>
              </div>
              {c.reason ? <p>{c.reason}</p> : null}
              {lines.length > 0 && (
                <ul className="history-diff-list">
                  {lines.map((line) => (
                    <li key={line.label}>
                      <span className="history-diff-label">{line.label}</span>
                      <span className="history-diff-values">
                        {line.from} → {line.to}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {c.after_data.financeReviewRequired && (
                <span className="status held">Finance review</span>
              )}
            </article>
          );
        })
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
      <div className="booking-flow-header">
        <h1>{cancel ? "Cancel reservation" : "Amend reservation"}</h1>
        <p className="booking-flow-subtitle">
          Every accepted change is versioned and recorded in the audit trail.
        </p>
      </div>
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
  const pickupLocations = useResource<
    {
      id: string;
      name: string;
      kind: string;
      address: string | null;
    }[]
  >("ops/v1/pickup-locations");
  const [departureId, setDepartureId] = useState(b.departure_id),
    [party, setParty] = useState(b.party),
    [name, setName] = useState(b.lead_name),
    [email, setEmail] = useState(b.lead_email),
    [pickup, setPickup] = useState<Pickup>(b.pickup),
    [pickupLocationOther, setPickupLocationOther] = useState(false),
    [reason, setReason] = useState(""),
    [quote, setQuote] = useState<ChangeQuote | null>(null),
    [ack, setAck] = useState(false),
    [cancelOpen, setCancelOpen] = useState(false),
    [now, setNow] = useState(Date.now());
  const quoteReadyRef = useRef<HTMLDivElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (pickup.kind !== "selected") {
      setPickupLocationOther(false);
      return;
    }
    const names = pickupLocations.data;
    if (!names) return;
    setPickupLocationOther(!names.some((item) => item.name === pickup.location));
  }, [pickup, pickupLocations.data]);
  useEffect(() => {
    if (!quote) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    quoteReadyRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
    const timer = window.setTimeout(
      () => acceptRef.current?.focus({ preventScroll: true }),
      reduceMotion ? 0 : 280,
    );
    return () => window.clearTimeout(timer);
  }, [quote?.quoteId]);
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
    if (!ack || !reason.trim()) return;
    setCancelOpen(true);
  }
  async function confirmCancel() {
    const result = await cancellation.run(`staff/v1/bookings/${b.id}/cancel`, {
      version: b.version,
      reason,
    });
    if (result) router.push("/reservations/" + b.id);
  }
  if (cancel)
    return (
      <>
        <form
          className="panel form-panel wide-form booking-cancel-form"
          onSubmit={cancelBooking}
        >
          <h2>{b.lead_name}</h2>
          <p className="muted">
            {dateTime(b.departure.starts_at, session.tenant.timezone)}
          </p>
          <Notice>
            Cancellation releases this party’s seats and removes confirmed
            passengers from the manifest. It does not issue a refund or
            determine cancellation fees.
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
          <Field label="Cancellation reason" required>
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
          <FormActions stickyOnMobile>
            <Link className="button secondary" href={"/reservations/" + b.id}>
              Keep reservation
            </Link>
            <button
              className="button destructive"
              disabled={!ack || !reason.trim() || cancellation.busy}
            >
              {cancellation.busy ? "Cancelling…" : "Cancel reservation"}
            </button>
          </FormActions>
        </form>
        <ConfirmDialog
          open={cancelOpen}
          title="Cancel this reservation?"
          description="Seats will be released and passengers removed from the manifest. Payment records are preserved for finance review — no refund is issued by this action."
          confirmLabel="Cancel reservation"
          cancelLabel="Keep reservation"
          danger
          busy={cancellation.busy}
          error={cancellation.error}
          onClose={() => {
            if (!cancellation.busy) setCancelOpen(false);
          }}
          onConfirm={() => void confirmCancel()}
        />
      </>
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
              <option value="selected">Requested pickup</option>
              {pickup.kind === "unresolved" && (
                <option value="unresolved">Pickup to arrange</option>
              )}
            </select>
          </Field>
          {pickup.kind === "selected" && (
            <>
              <Field
                label="Pickup location"
                hint="Choose a common pickup, or Other to type a place that is not in the list."
              >
                <select
                  required
                  value={
                    pickupLocationOther
                      ? PICKUP_LOCATION_OTHER
                      : pickup.location
                  }
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === PICKUP_LOCATION_OTHER) {
                      setPickupLocationOther(true);
                      setPickup({
                        ...pickup,
                        location: (pickupLocations.data ?? []).some(
                          (item) => item.name === pickup.location,
                        )
                          ? ""
                          : pickup.location,
                      });
                      return;
                    }
                    setPickupLocationOther(false);
                    setPickup({ ...pickup, location: next });
                  }}
                >
                  <option value="">Select a pickup location</option>
                  {(pickupLocations.data ?? []).map((item) => (
                    <option key={item.id} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                  <option value={PICKUP_LOCATION_OTHER}>Other</option>
                </select>
              </Field>
              {pickupLocationOther && (
                <Field label="Other pickup location">
                  <input
                    required
                    maxLength={120}
                    value={pickup.location}
                    onChange={(e) =>
                      setPickup({ ...pickup, location: e.target.value })
                    }
                    placeholder="Hotel, dock, or meeting point"
                  />
                </Field>
              )}
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
          {!quote && (
            <FormActions stickyOnMobile>
              <Link className="button secondary" href={"/reservations/" + b.id}>
                Cancel
              </Link>
              <button className="button" disabled={quoteMutation.busy}>
                {quoteMutation.busy ? "Calculating…" : "Review change quote"}
              </button>
            </FormActions>
          )}
        </fieldset>
        {quote && (
          <div
            className="amend-quote-ready"
            ref={quoteReadyRef}
            tabIndex={-1}
            aria-live="polite"
          >
            <p className="amend-quote-ready-copy">
              Change quote ready
              {` · new total ${money(quote.quote.totalMinor, quote.quote.currency)}`}
              . Accept to apply, or cancel to leave without changing this
              reservation.
            </p>
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
            <FormActions stickyOnMobile>
              <Link className="button secondary" href={"/reservations/" + b.id}>
                Cancel
              </Link>
              <button
                type="button"
                className="button"
                ref={acceptRef}
                disabled={expired || Boolean(shortfall) || accept.busy}
                onClick={apply}
              >
                {accept.busy ? "Applying…" : "Accept change"}
              </button>
            </FormActions>
          </div>
        )}
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
            <FormActions stickyOnMobile>
              <Link className="button secondary" href={"/reservations/" + b.id}>
                Cancel
              </Link>
              <button
                type="button"
                className="button"
                disabled={expired || Boolean(shortfall) || accept.busy}
                onClick={apply}
              >
                {accept.busy ? "Applying…" : "Accept change"}
              </button>
            </FormActions>
          </>
        )}
      </aside>
    </div>
  );
}
