"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, Clock, LockKeyhole } from "lucide-react";
import type { Session, Departure, Quote, Booking, Pickup, Partner, BookingFinanceSummary, NotificationMessage } from "@/lib/types";
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

type Passenger = {
  id: string;
  name: string;
  category: string;
  is_minor: boolean;
};
type PassengerDraft = { name: string; category: string; isMinor: boolean };

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

function CustomerMessages({ bookingId, timezone, canRequest }: { bookingId: string; timezone: string; canRequest: boolean }) {
  const messages = useResource<NotificationMessage[]>(`staff/v1/bookings/${bookingId}/notifications`);
  const request = useMutation();
  const [success, setSuccess] = useState("");
  async function prepare(kind: NotificationMessage["kind"]) {
    const result = await request.run<NotificationMessage>(`staff/v1/bookings/${bookingId}/notifications`, { kind });
    if (result) {
      setSuccess("Communication prepared and held. It will not send until a tenant email provider is configured.");
      messages.reload();
    }
  }
  return <section className="panel form-panel">
    <h2>Customer communications</h2>
    <p className="muted">Prepare an auditable email request. Delivery remains held until an approved email provider is configured.</p>
    {canRequest && <div className="button-row">
      <button className="button secondary" disabled={request.busy} onClick={() => void prepare("booking_confirmation")}>Prepare confirmation</button>
      <button className="button secondary" disabled={request.busy} onClick={() => void prepare("payment_request")}>Prepare payment request</button>
      <button className="button secondary" disabled={request.busy} onClick={() => void prepare("waiver_request")}>Prepare waiver request</button>
      <button className="button secondary" disabled={request.busy} onClick={() => void prepare("cancellation")}>Prepare cancellation notice</button>
    </div>}
    {success && <Notice>{success}</Notice>}
    {(request.error || messages.error) && <Notice error>{request.error || messages.error}</Notice>}
    {messages.data?.length ? <div className="stack-list">{messages.data.map((message) => <div className="detail-row" key={message.id}><span><strong>{message.subject}</strong><small>{message.recipient} · {dateTime(message.requested_at, timezone)}</small></span><Status state={message.status} /></div>)}</div> : messages.data && <p className="muted">No communication requests have been prepared.</p>}
  </section>;
}
export function NewReservation({ session }: { session: Session }) {
  const departures = usePaged<Departure>("staff/v1/workspace/departures"),
    partners = useResource<Partner[]>("finance/v1/partners/available"),
    stays = useResource<{ cruiseCalls:{id:string;vessel_name:string;call_date:string;port_name:string;all_aboard_at:string|null}[]; accommodations:{id:string;name:string;address:string}[] }>("ops/v1/stays/options");
  const [departureId, setDepartureId] = useState(""),
    [party, setParty] = useState<Record<string, number>>({}),
    [hold, setHold] = useState<{
      holdId: string;
      quote: Quote;
      expiresAt: string;
    } | null>(null);
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [phone, setPhone] = useState(""),
    [purchaserIsLead, setPurchaserIsLead] = useState(true),
    [purchaserName, setPurchaserName] = useState(""),
    [purchaserEmail, setPurchaserEmail] = useState(""),
    [purchaserPhone, setPurchaserPhone] = useState(""),
    [emergencyName, setEmergencyName] = useState(""),
    [emergencyPhone, setEmergencyPhone] = useState(""),
    [emergencyRelationship, setEmergencyRelationship] = useState(""),
    [source, setSource] = useState(
      session.tenant.config.bookingSources[0] ?? "",
    ),
    [pickupKind, setPickupKind] = useState("none"),
    [location, setLocation] = useState(""),
    [instructions, setInstructions] = useState(""),
    [stayKind, setStayKind] = useState("none"),
    [stayReferenceId, setStayReferenceId] = useState(""),
    [unitNumber, setUnitNumber] = useState(""),
    [partnerId, setPartnerId] = useState(""),
    [partnerReference, setPartnerReference] = useState(""),
    [collectionMode, setCollectionMode] = useState("guest_pays_tenant"),
    [invoiceRequired, setInvoiceRequired] = useState(false);
  const [authorizeOverbook, setAuthorizeOverbook] = useState(false),
    [overbookReason, setOverbookReason] = useState("");
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
    }>(authorizeOverbook ? "staff/v1/overbook-holds" : "staff/v1/holds", {
      departureId,
      party,
      ...(authorizeOverbook ? { reason: overbookReason } : {}),
    });
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
      {
        holdId: hold.holdId,
        leadName: name,
        leadEmail: email,
        leadPhone: phone,
        ...(!purchaserIsLead ? { purchaser: { name: purchaserName, email: purchaserEmail, phone: purchaserPhone } } : {}),
        ...(emergencyName || emergencyPhone || emergencyRelationship ? { emergencyContact: { name: emergencyName, phone: emergencyPhone, relationship: emergencyRelationship } } : {}),
        source,
        pickup,
        stay: stayKind === "cruise" ? { kind:"cruise", cruiseCallId:stayReferenceId, vesselName:stays.data?.cruiseCalls.find(item=>item.id===stayReferenceId)?.vessel_name ?? "Cruise vessel", cabinNumber:unitNumber } : stayKind === "hotel" ? { kind:"hotel", accommodationId:stayReferenceId, hotelName:stays.data?.accommodations.find(item=>item.id===stayReferenceId)?.name ?? "Hotel", roomNumber:unitNumber } : { kind:"none" },
        ...(partnerId
          ? {
              partner: {
                partnerId,
                externalReference: partnerReference,
                collectionMode,
                invoiceRequired,
              },
            }
          : {}),
      },
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
              {session.permissions.includes("inventory.overbook") && !hold && (
                <div className="overbook-control">
                  <label className="toggle-row">
                    <input type="checkbox" checked={authorizeOverbook} onChange={(event) => setAuthorizeOverbook(event.target.checked)} />
                    <span>Authorize capacity exception</span>
                  </label>
                  {authorizeOverbook && (
                    <Field label="Overbooking reason" hint="Required, immutable and visible in the audit trail.">
                      <textarea required minLength={8} maxLength={500} value={overbookReason} onChange={(event) => setOverbookReason(event.target.value)} />
                    </Field>
                  )}
                </div>
              )}
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
                  <Field label="Phone number">
                    <input type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
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
                <div className="form-divider" />
                <div className="panel-heading plain"><div><h2>Purchaser & emergency contact</h2><p>Keep the person who paid separate from the lead traveler when needed.</p></div></div>
                <label className="toggle-row"><input type="checkbox" checked={purchaserIsLead} onChange={(event)=>setPurchaserIsLead(event.target.checked)}/><span>Lead traveler is the purchaser</span></label>
                {!purchaserIsLead&&<div className="form-grid">
                  <Field label="Purchaser name"><input required maxLength={120} value={purchaserName} onChange={(event)=>setPurchaserName(event.target.value)}/></Field>
                  <Field label="Purchaser email"><input required type="email" maxLength={254} value={purchaserEmail} onChange={(event)=>setPurchaserEmail(event.target.value)}/></Field>
                  <Field label="Purchaser phone"><input type="tel" maxLength={40} value={purchaserPhone} onChange={(event)=>setPurchaserPhone(event.target.value)}/></Field>
                </div>}
                <p className="muted">Emergency contact is optional. If any field is entered, complete all three.</p>
                <div className="form-grid">
                  <Field label="Emergency contact name"><input required={Boolean(emergencyPhone||emergencyRelationship)} maxLength={120} value={emergencyName} onChange={(event)=>setEmergencyName(event.target.value)}/></Field>
                  <Field label="Emergency phone"><input required={Boolean(emergencyName||emergencyRelationship)} type="tel" maxLength={40} value={emergencyPhone} onChange={(event)=>setEmergencyPhone(event.target.value)}/></Field>
                  <Field label="Relationship"><input required={Boolean(emergencyName||emergencyPhone)} maxLength={80} value={emergencyRelationship} onChange={(event)=>setEmergencyRelationship(event.target.value)}/></Field>
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
                <div className="form-divider" />
                <div className="panel-heading plain"><div><h2>Guest stay</h2><p>Optional cruise-call or hotel details used for pickup and day-of operations.</p></div></div>
                {stays.error ? <Notice error>{stays.error}</Notice> : <div className="form-grid">
                  <Field label="Guest origin">
                    <select value={stayKind} onChange={(e)=>{setStayKind(e.target.value);setStayReferenceId("");setUnitNumber("");}}>
                      <option value="none">No stay details</option>
                      <option value="cruise">Cruise ship</option>
                      <option value="hotel">Hotel</option>
                    </select>
                  </Field>
                  {stayKind === "cruise" && <Field label="Cruise call"><select required value={stayReferenceId} onChange={(e)=>setStayReferenceId(e.target.value)}><option value="">Choose vessel and call</option>{(stays.data?.cruiseCalls ?? []).map(item=><option key={item.id} value={item.id}>{item.vessel_name} · {item.call_date} · {item.port_name}</option>)}</select></Field>}
                  {stayKind === "hotel" && <Field label="Hotel"><select required value={stayReferenceId} onChange={(e)=>setStayReferenceId(e.target.value)}><option value="">Choose hotel</option>{(stays.data?.accommodations ?? []).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
                  {stayKind !== "none" && <Field label={stayKind === "cruise" ? "Cabin number · optional" : "Room number · optional"}><input maxLength={40} value={unitNumber} onChange={(e)=>setUnitNumber(e.target.value)} /></Field>}
                </div>}
                <div className="form-divider" />
                <div className="panel-heading plain">
                  <div>
                    <h2>Partner / reseller</h2>
                    <p>Optional attribution for a hotel or reseller booking.</p>
                  </div>
                </div>
                {partners.error ? (
                  <Notice error>{partners.error}</Notice>
                ) : (
                  <div className="form-grid">
                    <Field label="Partner organization">
                      <select
                        value={partnerId}
                        onChange={(e) => setPartnerId(e.target.value)}
                      >
                        <option value="">No partner attribution</option>
                        {(partners.data ?? []).map((partner) => (
                          <option key={partner.id} value={partner.id}>
                            {partner.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {partnerId && (
                      <Field label="Partner reference">
                        <input
                          maxLength={120}
                          value={partnerReference}
                          onChange={(e) => setPartnerReference(e.target.value)}
                          placeholder="Voucher or reservation reference"
                        />
                      </Field>
                    )}
                    {partnerId && (
                      <Field label="Collection arrangement">
                        <select value={collectionMode} onChange={(e) => setCollectionMode(e.target.value)}>
                          <option value="guest_pays_tenant">Guest pays tenant</option>
                          <option value="partner_collects_for_tenant">Partner collects for tenant</option>
                          <option value="partner_invoice">Partner invoice</option>
                        </select>
                      </Field>
                    )}
                    {partnerId && (
                      <label className="toggle-row">
                        <input type="checkbox" checked={invoiceRequired} onChange={(e) => setInvoiceRequired(e.target.checked)} />
                        <span>Invoice required</span>
                      </label>
                    )}
                  </div>
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
              {authorizeOverbook && <Notice>This hold is an authorized capacity exception. Confirmation may take the departure above its configured capacity.</Notice>}
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
    financeSummary = useResource<BookingFinanceSummary>(`finance/v1/bookings/${bookingId}/finance-summary`),
    passengers = useResource<Passenger[]>(`staff/v1/bookings/${bookingId}/passengers`),
    pay = useMutation(),
    adjustPayment = useMutation(),
    confirm = useMutation(),
    savePassengers = useMutation();
  const [amount, setAmount] = useState(""),
    [method, setMethod] = useState(
      session.tenant.config.manualPaymentMethods[0] ?? "",
    ),
    [reference, setReference] = useState(""),
    [note, setNote] = useState(""),
    [inputError, setInputError] = useState(""),
    [success, setSuccess] = useState("");
  const [adjustingPaymentId,setAdjustingPaymentId]=useState("");
  const [adjustmentReference,setAdjustmentReference]=useState("");
  const [adjustmentReason,setAdjustmentReason]=useState("");
  const [passengerDrafts, setPassengerDrafts] = useState<PassengerDraft[]>([]);
  const [rosterBookingId, setRosterBookingId] = useState("");
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
  useEffect(() => {
    if (!booking.data || rosterBookingId === booking.data.id || passengers.data?.length) return;
    const drafts = Object.entries(booking.data.party).flatMap(([category, quantity]) =>
      Array.from({ length: quantity }, () => ({ name: "", category, isMinor: category.toLowerCase().includes("child") })),
    );
    setPassengerDrafts(drafts);
    setRosterBookingId(booking.data.id);
  }, [booking.data, passengers.data?.length, rosterBookingId]);
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
  async function correctPayment(payment:Booking["payments"][number]){
    const result=await adjustPayment.run(`staff/v1/bookings/${bookingId}/payments/${payment.id}/adjustments`,{
      kind:payment.status==="pending"?"void":"reversal",
      reference:adjustmentReference,
      reason:adjustmentReason,
      occurredAt:new Date().toISOString(),
    });
    if(result){
      setSuccess(payment.status==="pending"?"Pending payment voided.":"External payment reversal recorded.");
      setAdjustingPaymentId("");setAdjustmentReference("");setAdjustmentReason("");booking.reload();
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
  async function recordRoster(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await savePassengers.run(`staff/v1/bookings/${bookingId}/passengers`, { passengers: passengerDrafts });
    if (result) {
      setSuccess("Passenger roster recorded. It is frozen when the reservation is confirmed.");
      passengers.reload();
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
              <div>
                <dt>Purchaser</dt>
                <dd>{b.purchaser.name} · {b.purchaser.email}{b.purchaser.phone ? ` · ${b.purchaser.phone}` : ""}</dd>
              </div>
              <div>
                <dt>Emergency contact</dt>
                <dd>{b.emergency_contact.name ? `${b.emergency_contact.name} · ${b.emergency_contact.relationship} · ${b.emergency_contact.phone}` : "Not provided"}</dd>
              </div>
            </dl>
            <Link className="text-link" href={`/customers/${b.customer_id}`}>Open customer history <ArrowRight size={16}/></Link>
            {session.permissions.includes("manifest.read") && (
              <Link
                className="text-link"
                href={`/departures/${b.departure_id}/manifest`}
              >
                Open departure manifest <ArrowRight size={16} />
              </Link>
            )}
          </section>
          {passengers.data && passengers.data.length > 0 ? (
            <section className="panel form-panel">
              <h2>Passenger roster</h2>
              <p className="muted">Recorded roster for this reservation.</p>
              <div className="stack-list">
                {passengers.data.map((passenger) => <div className="detail-row" key={passenger.id}><span><strong>{passenger.name}</strong><small>{label(passenger.category)}{passenger.is_minor ? " · minor" : ""}</small></span></div>)}
              </div>
            </section>
          ) : b.state === "held" && session.permissions.includes("bookings.write") ? (
            <section className="panel form-panel">
              <h2>Passenger roster</h2>
              <p className="muted">Record each traveller before confirming. A later amendment workflow will handle corrections.</p>
              <form onSubmit={recordRoster}>
                <div className="stack-list">
                  {passengerDrafts.map((passenger, index) => <div className="form-grid" key={`${passenger.category}-${index}`}><Field label={`Passenger ${index + 1} name`}><input required maxLength={120} value={passenger.name} onChange={(event) => setPassengerDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></Field><Field label="Passenger category"><input required maxLength={80} value={passenger.category} onChange={(event) => setPassengerDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value } : item))} /></Field></div>)}
                </div>
                {savePassengers.error && <Notice error>{savePassengers.error}</Notice>}
                <button className="button secondary" disabled={savePassengers.busy || passengerDrafts.length === 0}>{savePassengers.busy ? "Recording…" : "Record passenger roster"}</button>
              </form>
            </section>
          ) : null}
          {session.permissions.includes("notifications.read") && <CustomerMessages bookingId={bookingId} timezone={session.tenant.timezone} canRequest={session.permissions.includes("notifications.request")} />}
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
          {b.payments.length>0&&(
            <section className="panel form-panel">
              <h2>Payment history</h2>
              <p className="muted">Original entries remain immutable. Corrections are appended with their own reference and reason.</p>
              <div className="stack-list">
                {b.payments.map(payment=><div className="detail-row" key={payment.id}>
                  <span><strong>{money(payment.amount_minor,payment.currency)} · {label(payment.method)}</strong><small>{dateTime(payment.occurred_at,session.tenant.timezone)} · {payment.reference}</small>{payment.adjustment_id&&<small>{label(payment.adjustment_kind!)} · {payment.adjustment_reference} · {payment.adjustment_reason}</small>}</span>
                  {!payment.adjustment_id&&session.permissions.includes("payment.correct")&&<button className="button secondary" type="button" onClick={()=>setAdjustingPaymentId(payment.id)}>{payment.status==="pending"?"Void entry":"Record reversal"}</button>}
                </div>)}
              </div>
              {adjustingPaymentId&&<div className="form-grid">
                <Field label="Adjustment reference"><input required maxLength={120} value={adjustmentReference} onChange={event=>setAdjustmentReference(event.target.value)}/></Field>
                <Field label="Reason"><input required minLength={8} maxLength={500} value={adjustmentReason} onChange={event=>setAdjustmentReason(event.target.value)}/></Field>
                <div className="button-row"><button className="button secondary" type="button" disabled={adjustPayment.busy||!adjustmentReference.trim()||adjustmentReason.trim().length<8} onClick={()=>void correctPayment(b.payments.find(payment=>payment.id===adjustingPaymentId)!)}>{adjustPayment.busy?"Recording…":"Confirm correction"}</button><button className="text-button" type="button" onClick={()=>setAdjustingPaymentId("")}>Cancel</button></div>
              </div>}
              {adjustPayment.error&&<Notice error>{adjustPayment.error}</Notice>}
            </section>
          )}
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
            {financeSummary.data && (
              <>
                <div>
                  <span>Accepted partner credit</span>
                  <strong>{money(financeSummary.data.partnerCreditMinor, b.quote.currency)}</strong>
                </div>
                <div>
                  <span>Guest balance after credit</span>
                  <strong>{money(financeSummary.data.guestBalanceMinor, b.quote.currency)}</strong>
                </div>
                <div>
                  <span>Partner obligation</span>
                  <strong>{money(financeSummary.data.partnerObligationMinor, b.quote.currency)}</strong>
                </div>
              </>
            )}
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
