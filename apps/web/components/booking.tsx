"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  LockKeyhole,
  Mail,
  Minus,
  Plus,
  ShoppingCart,
  Users,
  X,
  Printer,
  Download,
} from "lucide-react";
import type {
  Session,
  Departure,
  Quote,
  Booking,
  Pickup,
  Partner,
  BookingFinanceSummary,
  NotificationMessage,
  Product,
  AvailabilityMode,
} from "@/lib/types";
import { availabilityModes } from "@/lib/types";
import {
  bookingSourceLabel,
  dateTime,
  digits,
  downloadApiFile,
  fetchApiFile,
  label,
  minor,
  money,
  paymentMethodLabel,
  useMutation,
  usePaged,
  useResource,
} from "@/lib/client";
import { printDocument } from "@/lib/print-agent";
import {
  Field,
  FormActions,
  Loading,
  Notice,
  readablePickup,
  SearchBox,
  Status,
  TenantDateInput,
  Toggle,
} from "./common";

import { BookingHistory } from "./booking-changes";

type Passenger = {
  id: string;
  name: string;
  category: string;
  is_minor: boolean;
};
type PassengerDraft = {
  name: string;
  category: string;
  isMinor: boolean;
  identityPending?: boolean;
};

function departureHour(startsAt: string, timezone: string) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(startsAt)),
  );
}

function collectionModeLabel(mode: string) {
  if (mode === "guest_pays_tenant") return "Guest pays tenant";
  if (mode === "partner_collects_for_tenant")
    return "Partner collects for tenant";
  if (mode === "partner_invoice") return "Partner invoice";
  return label(mode);
}

function collectionModeHint(mode: string) {
  if (mode === "guest_pays_tenant")
    return "Guest pays the operator directly. The partner is attribution only.";
  if (mode === "partner_collects_for_tenant")
    return "Partner collects from the guest for the operator. Confirm without guest payment, then record a partner collection claim for finance review.";
  if (mode === "partner_invoice")
    return "Partner is invoiced for the booking total at confirmation. Guest payment is not required to confirm.";
  return "";
}

function partnerSettlementWithoutGuestPay(mode?: string | null) {
  return mode === "partner_invoice" || mode === "partner_collects_for_tenant";
}

function isPartnerResellerSource(source: string) {
  return source === "partner_reseller";
}

function safeReturnTo(value: string | null | undefined) {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://"))
    return null;
  return value;
}

function useRemaining(expiry?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiry) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiry]);
  return expiry
    ? Math.max(0, Math.ceil((new Date(expiry).getTime() - now) / 1000))
    : 0;
}

function BookingAccordion({
  id,
  title,
  hint,
  badge,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  badge?: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className={"booking-accordion" + (open ? " open" : "")}>
      <button
        type="button"
        className="booking-accordion-trigger"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <span>
          <strong>{title}</strong>
          {hint && <small>{hint}</small>}
        </span>
        <span className="booking-accordion-meta">
          {badge && <span className="optional-badge">{badge}</span>}
          <ChevronDown size={18} aria-hidden="true" />
        </span>
      </button>
      {open && <div className="booking-accordion-body">{children}</div>}
    </div>
  );
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
          <span>Subtotal</span>
          <span>{money(quote.subtotalMinor, quote.currency)}</span>
        </div>
        <div>
          <span>{quote.taxInclusive ? "Tax (included)" : "Tax"}</span>
          <span>{money(quote.taxMinor, quote.currency)}</span>
        </div>
        {quote.discountMinor ? (
          <div className="quote-discount">
            <span>
              Discount
              {quote.promoCode ? ` · ${quote.promoCode}` : ""}
              {quote.discountReason ? (
                <small>{quote.discountReason}</small>
              ) : null}
            </span>
            <strong>-{money(quote.discountMinor, quote.currency)}</strong>
          </div>
        ) : null}
      </div>
      <div className="quote-total">
        <span>Booking total</span>
        <strong>{money(quote.totalMinor, quote.currency)}</strong>
      </div>
    </>
  );
}

function categoryIsMinor(category: string) {
  return /(child|infant|minor|kid)/i.test(category);
}

function partyBadgeTone(category: string) {
  const value = category.toLowerCase();
  if (/(infant|baby)/.test(value)) return "infant";
  if (/(child|kid|minor)/.test(value)) return "child";
  if (/(senior|elder)/.test(value)) return "senior";
  return "adult";
}

function readableStay(stay?: Booking["stay"]) {
  if (!stay || stay.kind === "none") return "Not provided";
  if (stay.kind === "cruise")
    return [
      stay.vesselName || "Ship not recorded",
      stay.cabinNumber && `Cabin ${stay.cabinNumber}`,
    ]
      .filter(Boolean)
      .join(" · ");
  if (stay.kind === "hotel")
    return [stay.hotelName, stay.roomNumber && `Room ${stay.roomNumber}`]
      .filter(Boolean)
      .join(" · ");
  if (stay.kind === "private_accommodation")
    return [stay.propertyName, stay.address].filter(Boolean).join(" · ");
  return stay.address || "Local guest";
}

function CustomerMessages({
  bookingId,
  timezone,
  canRequest,
  balanceMinor,
}: {
  bookingId: string;
  timezone: string;
  canRequest: boolean;
  balanceMinor: number;
}) {
  const messages = useResource<NotificationMessage[]>(
    `staff/v1/bookings/${bookingId}/notifications`,
  );
  const request = useMutation();
  const retry = useMutation();
  const [success, setSuccess] = useState("");
  async function prepare(kind: NotificationMessage["kind"]) {
    const result = await request.run<NotificationMessage>(
      `staff/v1/bookings/${bookingId}/notifications`,
      { kind },
    );
    if (result) {
      if (result.status === "sent") setSuccess("Email sent to the guest.");
      else if (result.status === "failed")
        setSuccess(
          result.failure_detail
            ? `Send failed: ${result.failure_detail}. You can retry.`
            : "Send failed. You can retry.",
        );
      else if (result.status === "held_provider")
        setSuccess(
          "Communication saved but not sent — configure SMTP_HOST, SMTP_USER, and SMTP_PASS, then retry.",
        );
      else setSuccess("Communication prepared.");
      messages.reload();
    }
  }
  async function retrySend(messageId: string) {
    const result = await retry.run<NotificationMessage>(
      `staff/v1/bookings/${bookingId}/notifications/${messageId}/retry`,
      {},
    );
    if (result) {
      if (result.status === "sent") setSuccess("Email sent to the guest.");
      else if (result.status === "failed")
        setSuccess(
          result.failure_detail
            ? `Retry failed: ${result.failure_detail}`
            : "Retry failed.",
        );
      else if (result.status === "held_provider")
        setSuccess("Still held — SMTP is not configured on this server.");
      messages.reload();
    }
  }
  return (
    <section className="panel form-panel">
      <h2>Customer communications</h2>
      <p className="muted">
        Send auditable guest emails through the workspace SMTP settings. Failed
        or held messages can be retried.
      </p>
      {canRequest && (
        <div className="button-row comms-actions">
          <button
            className="button secondary"
            disabled={request.busy || retry.busy}
            onClick={() => void prepare("booking_confirmation")}
          >
            <Mail size={16} aria-hidden />
            Confirmation
          </button>
          <button
            className="button secondary"
            disabled={request.busy || retry.busy || balanceMinor <= 0}
            title={
              balanceMinor <= 0 ? "Balance is already paid in full" : undefined
            }
            onClick={() => void prepare("payment_request")}
          >
            <Mail size={16} aria-hidden />
            Payment request
          </button>
          <button
            className="button secondary"
            disabled={request.busy || retry.busy}
            onClick={() => void prepare("waiver_request")}
          >
            <Mail size={16} aria-hidden />
            Waiver request
          </button>
          <button
            className="button secondary"
            disabled={request.busy || retry.busy}
            onClick={() => void prepare("cancellation")}
          >
            <Mail size={16} aria-hidden />
            Cancellation notice
          </button>
        </div>
      )}
      {success && <Notice>{success}</Notice>}
      {(request.error || retry.error || messages.error) && (
        <Notice error>{request.error || retry.error || messages.error}</Notice>
      )}
      {messages.data?.length ? (
        <div className="stack-list">
          {messages.data.map((message) => (
            <div className="detail-row" key={message.id}>
              <span>
                <strong>{message.subject}</strong>
                <small>
                  {message.recipient} ·{" "}
                  {dateTime(message.requested_at, timezone)}
                  {message.failure_detail ? ` · ${message.failure_detail}` : ""}
                </small>
              </span>
              <span className="comms-row-actions">
                <Status state={message.status} />
                {canRequest &&
                  (message.status === "failed" ||
                    message.status === "held_provider") && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={retry.busy || request.busy}
                      onClick={() => void retrySend(message.id)}
                    >
                      Retry
                    </button>
                  )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        messages.data && (
          <p className="muted">No communication requests have been prepared.</p>
        )
      )}
    </section>
  );
}
export function AmendReservationPage({
  session,
  bookingId,
}: {
  session: Session;
  bookingId: string;
}) {
  const booking = useResource<Booking>("staff/v1/bookings/" + bookingId);
  if (booking.error) return <Notice error>{booking.error}</Notice>;
  if (!booking.data) return <Loading />;
  const b = booking.data;
  const editable =
    ["held", "confirmed"].includes(b.state) &&
    new Date(b.departure.starts_at).getTime() > Date.now() &&
    (b.state === "confirmed" || new Date(b.expiresAt).getTime() > Date.now());
  if (!editable)
    return (
      <Notice error>
        This reservation is no longer eligible for pre-departure changes.{" "}
        <Link href={"/reservations/" + bookingId}>Return to reservation</Link>.
      </Notice>
    );
  return <NewReservation key={b.version} session={session} amendBooking={b} />;
}

export function NewReservation({
  session,
  amendBooking,
}: {
  session: Session;
  amendBooking?: Booking;
}) {
  const amendMode = Boolean(amendBooking);
  const commercialLocked =
    amendMode && (amendBooking?.state === "held" || !amendBooking);
  const [departureSearch, setDepartureSearch] = useState("");
  const [timeWindow, setTimeWindow] = useState("all");
  const [showSoldOut, setShowSoldOut] = useState(true);
  const [departureDate, setDepartureDate] = useState(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: session.tenant.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const [selectedProductId, setSelectedProductId] = useState("all-scheduled");
  const [lockedDepartureId, setLockedDepartureId] = useState(
    amendBooking?.departure_id ?? "",
  );
  const products = useResource<Product[]>("admin/v1/products");
  const selectedProduct = products.data?.find(
    (item) => item.id === selectedProductId,
  );
  const selectedMode = (selectedProduct?.availability_mode ??
    "fixed_departure") as AvailabilityMode;
  const scheduledDiscovery =
    selectedProductId === "all-scheduled" ||
    (selectedProductId !== "" &&
      (availabilityModes[selectedMode]?.bookable ?? false));
  const departures = usePaged<Departure>(
      "staff/v1/workspace/departures",
      departureSearch,
      {
        view: "upcoming",
        ...(lockedDepartureId
          ? { departureId: lockedDepartureId }
          : {
              from: departureDate,
              to: departureDate,
              availabilityMode: "fixed_departure",
              ...(selectedProductId !== "all-scheduled"
                ? { productId: selectedProductId }
                : {}),
            }),
      },
      100,
    ),
    partners = useResource<Partner[]>("finance/v1/partners/available"),
    stays = useResource<{
      vessels: {
        id: string;
        name: string;
        cruise_line: string | null;
        tenant_owned: boolean;
      }[];
      accommodations: { id: string; name: string; address: string }[];
    }>("ops/v1/stays/options"),
    pickupLocations = useResource<
      {
        id: string;
        name: string;
        kind: string;
        address: string | null;
      }[]
    >("ops/v1/pickup-locations");
  const [departureId, setDepartureId] = useState(
      amendBooking?.departure_id ?? "",
    ),
    [party, setParty] = useState<Record<string, number>>(
      amendBooking?.party ?? {},
    ),
    [hold, setHold] = useState<{
      holdId: string;
      quote: Quote;
      expiresAt: string;
    } | null>(
      amendBooking
        ? {
            holdId: "amend",
            quote: amendBooking.quote,
            expiresAt: amendBooking.expiresAt,
          }
        : null,
    );
  const [name, setName] = useState(amendBooking?.lead_name ?? ""),
    [email, setEmail] = useState(amendBooking?.lead_email ?? ""),
    [phone, setPhone] = useState(amendBooking?.purchaser?.phone ?? ""),
    [purchaserIsLead, setPurchaserIsLead] = useState(() => {
      if (!amendBooking?.purchaser) return true;
      return (
        amendBooking.purchaser.name === amendBooking.lead_name &&
        amendBooking.purchaser.email === amendBooking.lead_email
      );
    }),
    [purchaserName, setPurchaserName] = useState(
      amendBooking?.purchaser?.name ?? "",
    ),
    [purchaserEmail, setPurchaserEmail] = useState(
      amendBooking?.purchaser?.email ?? "",
    ),
    [purchaserPhone, setPurchaserPhone] = useState(
      amendBooking?.purchaser?.phone ?? "",
    ),
    [emergencyName, setEmergencyName] = useState(
      amendBooking?.emergency_contact?.name ?? "",
    ),
    [emergencyPhone, setEmergencyPhone] = useState(
      amendBooking?.emergency_contact?.phone ?? "",
    ),
    [emergencyRelationship, setEmergencyRelationship] = useState(
      amendBooking?.emergency_contact?.relationship ?? "",
    ),
    [source, setSource] = useState(
      amendBooking?.source ?? session.tenant.config.bookingSources[0] ?? "",
    ),
    [pickupKind, setPickupKind] = useState(
      amendBooking?.pickup?.kind ?? "none",
    ),
    [location, setLocation] = useState(
      amendBooking?.pickup?.kind === "selected"
        ? amendBooking.pickup.location
        : "",
    ),
    [instructions, setInstructions] = useState(
      amendBooking?.pickup?.kind === "selected"
        ? amendBooking.pickup.instructions
        : amendBooking?.pickup?.kind === "unresolved"
          ? amendBooking.pickup.note
          : "",
    ),
    [stayKind, setStayKind] = useState(amendBooking?.stay?.kind ?? "none"),
    [stayReferenceId, setStayReferenceId] = useState(
      amendBooking?.stay?.kind === "cruise"
        ? (amendBooking.stay.vesselId ?? "")
        : amendBooking?.stay?.kind === "hotel"
          ? (amendBooking.stay.accommodationId ?? "")
          : "",
    ),
    [unitNumber, setUnitNumber] = useState(
      amendBooking?.stay?.kind === "cruise"
        ? (amendBooking.stay.cabinNumber ?? "")
        : amendBooking?.stay?.kind === "hotel"
          ? (amendBooking.stay.roomNumber ?? "")
          : "",
    ),
    [stayPropertyName, setStayPropertyName] = useState(
      amendBooking?.stay?.kind === "private_accommodation"
        ? amendBooking.stay.propertyName
        : amendBooking?.stay?.kind === "cruise"
          ? amendBooking.stay.vesselName
          : amendBooking?.stay?.kind === "hotel"
            ? amendBooking.stay.hotelName
            : "",
    ),
    [stayAddress, setStayAddress] = useState(
      amendBooking?.stay?.kind === "private_accommodation"
        ? amendBooking.stay.address
        : amendBooking?.stay?.kind === "local"
          ? (amendBooking.stay.address ?? "")
          : "",
    ),
    [discountAmount, setDiscountAmount] = useState(""),
    [promoCode, setPromoCode] = useState(""),
    [discountReason, setDiscountReason] = useState(""),
    [partnerId, setPartnerId] = useState(
      amendBooking?.partner?.partnerId ?? "",
    ),
    [partnerReference, setPartnerReference] = useState(
      amendBooking?.partner?.externalReference ?? "",
    ),
    [collectionMode, setCollectionMode] = useState(
      amendBooking?.partner?.collectionMode ?? "guest_pays_tenant",
    ),
    [invoiceRequired, setInvoiceRequired] = useState(
      amendBooking?.partner?.invoiceRequired ?? false,
    ),
    [leadIsTraveling, setLeadIsTraveling] = useState(true),
    [passengerDrafts, setPassengerDrafts] = useState<PassengerDraft[]>([]),
    [createdBookingId, setCreatedBookingId] = useState(""),
    [amendReason, setAmendReason] = useState(""),
    [changeQuote, setChangeQuote] = useState<{
      quoteId: string;
      version: number;
      quote: Quote;
      differenceMinor: number;
      previousTotalMinor: number;
      paidMinor: number;
      balanceMinor: number;
      expiresAt: string;
      allowAmendmentBalance: boolean;
    } | null>(null);
  const [authorizeOverbook, setAuthorizeOverbook] = useState(false),
    [overbookReason, setOverbookReason] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    lead: true,
    roster: false,
    pickup: amendMode,
    stay: amendMode,
    concession: !amendMode,
    contacts: amendMode,
  });
  const holdMutation = useMutation(),
    bookingMutation = useMutation(),
    rosterMutation = useMutation(),
    quoteMutation = useMutation(),
    acceptMutation = useMutation(),
    router = useRouter();
  const [returnTo, setReturnTo] = useState<string | null>(
    amendBooking ? `/reservations/${amendBooking.id}` : null,
  );
  const guestPanelRef = useRef<HTMLElement>(null);
  const leadNameRef = useRef<HTMLInputElement>(null);
  const remaining = useRemaining(amendMode ? undefined : hold?.expiresAt),
    departure = departures.items.find((d) => d.id === departureId);
  const partyTotal = Object.values(party).reduce((sum, n) => sum + n, 0);
  const flowReady = amendMode || Boolean(hold);
  const quoteExpired = Boolean(
    changeQuote && new Date(changeQuote.expiresAt).getTime() <= Date.now(),
  );
  const amendShortfall =
    changeQuote &&
    amendBooking?.state === "confirmed" &&
    !changeQuote.allowAmendmentBalance &&
    BigInt(changeQuote.paidMinor) * 100n <
      BigInt(changeQuote.quote.totalMinor) *
        BigInt(changeQuote.quote.minimumPaidPercent);
  const visibleDepartures = useMemo(
    () =>
      departures.items.filter((item) => {
        if (lockedDepartureId) return item.id === lockedDepartureId;
        if (!showSoldOut && item.available === 0) return false;
        const hour = departureHour(item.starts_at, session.tenant.timezone);
        if (timeWindow === "morning") return hour < 12;
        if (timeWindow === "afternoon") return hour >= 12 && hour < 17;
        if (timeWindow === "evening") return hour >= 17;
        return true;
      }),
    [
      departures.items,
      lockedDepartureId,
      session.tenant.timezone,
      showSoldOut,
      timeWindow,
    ],
  );
  useEffect(() => {
    if (amendMode) return;
    const params = new URLSearchParams(window.location.search);
    const fromDepartures = params.get("departure") ?? "";
    setLockedDepartureId(fromDepartures);
    setDepartureId(fromDepartures);
    setReturnTo(safeReturnTo(params.get("returnTo")));
    const product = params.get("product");
    if (product) setSelectedProductId(product);
    const date = params.get("date");
    if (date) setDepartureDate(date);
  }, [amendMode]);
  useEffect(() => {
    if (!amendBooking) return;
    setDepartureDate(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: session.tenant.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(amendBooking.departure.starts_at)),
    );
    if (amendBooking.departure.product_name) {
      // Keep all-scheduled discovery; product filter optional.
    }
  }, [amendBooking, session.tenant.timezone]);
  useEffect(() => {
    if (amendMode) return;
    if (!lockedDepartureId || !departures.items.length) return;
    const match = departures.items.find(
      (item) => item.id === lockedDepartureId,
    );
    if (!match) return;
    setDepartureId(match.id);
    setSelectedProductId(match.product_id);
    setDepartureDate(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: session.tenant.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(match.starts_at)),
    );
  }, [amendMode, lockedDepartureId, departures.items, session.tenant.timezone]);
  useEffect(() => {
    if (amendMode || !hold) return;
    guestPanelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    window.setTimeout(() => leadNameRef.current?.focus(), 250);
  }, [amendMode, hold?.holdId]);
  useEffect(() => {
    if (collectionMode === "partner_invoice") setInvoiceRequired(true);
  }, [collectionMode]);
  const partnerSourceSelected = isPartnerResellerSource(source);
  const selectedPartnerName =
    (partners.data ?? []).find((partner) => partner.id === partnerId)?.name ??
    "";
  const bookingSourceOptions = session.tenant.config.bookingSources.filter(
    (item) => item !== "viator" && item !== "get_your_guide",
  );
  useEffect(() => {
    if (
      bookingSourceOptions.length > 0 &&
      !bookingSourceOptions.includes(source)
    ) {
      setBookingSource(bookingSourceOptions[0]!);
    }
  }, [source, bookingSourceOptions.join("|")]);
  function setBookingSource(next: string) {
    setSource(next);
    if (isPartnerResellerSource(next)) {
      setOpenSections((current) => ({ ...current, lead: true }));
      return;
    }
    setPartnerId("");
    setPartnerReference("");
    setCollectionMode("guest_pays_tenant");
    setInvoiceRequired(false);
  }
  function toggleSection(key: string) {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  }
  function bumpParty(slug: string, delta: number) {
    setParty((current) => {
      const next = Math.max(0, Math.min(1000, (current[slug] ?? 0) + delta));
      return { ...current, [slug]: next };
    });
  }
  function changeDeparture() {
    if (amendMode) {
      if (commercialLocked) return;
      setChangeQuote(null);
      setLockedDepartureId("");
      setDepartureId("");
      setParty({});
      departures.reload();
      return;
    }
    if (hold && remaining > 0) {
      const ok = window.confirm(
        "Changing the departure releases the current seat hold. Continue?",
      );
      if (!ok) return;
    }
    setHold(null);
    setCreatedBookingId("");
    setPassengerDrafts([]);
    setAuthorizeOverbook(false);
    setOverbookReason("");
    setDepartureId("");
    setLockedDepartureId("");
    setParty({});
    departures.reload();
  }
  function buildPickup(): Pickup {
    return pickupKind === "none"
      ? { kind: "none" }
      : pickupKind === "selected"
        ? { kind: "selected", location, instructions }
        : { kind: "unresolved", note: instructions };
  }
  function buildStay() {
    return stayKind === "cruise"
      ? {
          kind: "cruise" as const,
          vesselId: stayReferenceId || undefined,
          // Omitted rather than defaulted: the ship is optional, and inventing
          // a name would put fabricated data on an emergency record.
          vesselName:
            stays.data?.vessels.find((item) => item.id === stayReferenceId)
              ?.name ||
            stayPropertyName ||
            undefined,
          cabinNumber: unitNumber,
        }
      : stayKind === "hotel"
        ? {
            kind: "hotel" as const,
            accommodationId: stayReferenceId || undefined,
            hotelName:
              stays.data?.accommodations.find(
                (item) => item.id === stayReferenceId,
              )?.name ||
              stayPropertyName ||
              "Hotel",
            roomNumber: unitNumber,
          }
        : stayKind === "private_accommodation"
          ? {
              kind: "private_accommodation" as const,
              propertyName: stayPropertyName,
              address: stayAddress,
            }
          : stayKind === "local"
            ? { kind: "local" as const, address: stayAddress }
            : { kind: "none" as const };
  }
  async function reserve(e: React.FormEvent) {
    e.preventDefault();
    if (amendMode) return;
    if (!scheduledDiscovery) return;
    const result = await holdMutation.run<{
      holdId: string;
      quote: Quote;
      expiresAt: string;
    }>(authorizeOverbook ? "staff/v1/overbook-holds" : "staff/v1/holds", {
      departureId,
      party,
      ...(authorizeOverbook ? { reason: overbookReason } : {}),
    });
    if (result) {
      setHold(result);
      setOpenSections({
        lead: true,
        roster: false,
        pickup: false,
        stay: false,
        concession: true,
        contacts: false,
      });
      setPassengerDrafts(
        (departure?.categories ?? []).flatMap((category) =>
          Array.from({ length: party[category.slug] ?? 0 }, () => ({
            name: "",
            category: category.slug,
            isMinor: categoryIsMinor(category.slug),
          })),
        ),
      );
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (amendMode) return submitAmend(e);
    if (!hold || remaining <= 0) return;
    if (partnerSourceSelected && !partnerId) return;
    const pickup: Pickup =
      pickupKind === "none"
        ? { kind: "none" }
        : pickupKind === "selected"
          ? { kind: "selected", location, instructions }
          : { kind: "unresolved", note: instructions };
    let bookingId = createdBookingId;
    if (!bookingId) {
      const result = await bookingMutation.run<{ bookingId: string }>(
        "staff/v1/bookings",
        {
          holdId: hold.holdId,
          leadName: name,
          leadEmail: email,
          leadPhone: phone,
          ...(!purchaserIsLead
            ? {
                purchaser: {
                  name: purchaserName,
                  email: purchaserEmail,
                  phone: purchaserPhone,
                },
              }
            : {}),
          ...(emergencyName || emergencyPhone || emergencyRelationship
            ? {
                emergencyContact: {
                  name: emergencyName,
                  phone: emergencyPhone,
                  relationship: emergencyRelationship,
                },
              }
            : {}),
          source: bookingSourceOptions.includes(source)
            ? source
            : (bookingSourceOptions[0] ?? source),
          pickup,
          stay:
            stayKind === "cruise"
              ? {
                  kind: "cruise",
                  vesselId: stayReferenceId,
                  vesselName: stays.data?.vessels.find(
                    (item) => item.id === stayReferenceId,
                  )?.name,
                  cabinNumber: unitNumber,
                }
              : stayKind === "hotel"
                ? {
                    kind: "hotel",
                    accommodationId: stayReferenceId,
                    hotelName:
                      stays.data?.accommodations.find(
                        (item) => item.id === stayReferenceId,
                      )?.name ?? "Hotel",
                    roomNumber: unitNumber,
                  }
                : stayKind === "private_accommodation"
                  ? {
                      kind: "private_accommodation",
                      propertyName: stayPropertyName,
                      address: stayAddress,
                    }
                  : stayKind === "local"
                    ? { kind: "local", address: stayAddress }
                    : { kind: "none" },
          ...(discountAmount.trim()
            ? {
                concession: {
                  discountMinor: minor(discountAmount, hold.quote.currency),
                  reason: discountReason.trim(),
                  promoCode: promoCode.trim(),
                },
              }
            : {}),
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
      if (!result) return;
      bookingId = result.bookingId;
      setCreatedBookingId(bookingId);
    }
    const firstPassenger = passengerDrafts.findIndex(() => true);
    const roster = passengerDrafts.map((passenger, index) => {
      const enteredName =
        leadIsTraveling && index === firstPassenger
          ? name.trim()
          : passenger.name.trim();
      return {
        name: enteredName || `Guest ${index + 1} · name required`,
        category: passenger.category,
        isMinor: categoryIsMinor(passenger.category),
        identityPending: !enteredName,
      };
    });
    const recorded = await rosterMutation.run(
      `staff/v1/bookings/${bookingId}/passengers`,
      { passengers: roster },
    );
    if (recorded) {
      const next = returnTo
        ? `/reservations/${bookingId}?returnTo=${encodeURIComponent(returnTo)}`
        : `/reservations/${bookingId}`;
      router.push(next);
    }
  }
  async function submitAmend(e: React.FormEvent) {
    e.preventDefault();
    if (!amendBooking || !amendReason.trim() || !departureId) return;
    const pickup = buildPickup();
    const stay = buildStay();
    const q = await quoteMutation.run<{
      quoteId: string;
      version: number;
      quote: Quote;
      differenceMinor: number;
      previousTotalMinor: number;
      paidMinor: number;
      balanceMinor: number;
      expiresAt: string;
      allowAmendmentBalance: boolean;
    }>(`staff/v1/bookings/${amendBooking.id}/change-quotes`, {
      version: amendBooking.version,
      departureId,
      party,
      leadName: name,
      leadEmail: email,
      leadPhone: phone,
      ...(!purchaserIsLead
        ? {
            purchaser: {
              name: purchaserName,
              email: purchaserEmail,
              phone: purchaserPhone,
            },
          }
        : {}),
      ...(emergencyName || emergencyPhone || emergencyRelationship
        ? {
            emergencyContact: {
              name: emergencyName || name,
              phone: emergencyPhone || phone || "n/a",
              relationship: emergencyRelationship || "other",
            },
          }
        : {}),
      pickup,
      stay,
      reason: amendReason.trim(),
    });
    if (q) setChangeQuote(q);
  }
  async function acceptAmend() {
    if (!amendBooking || !changeQuote) return;
    const priorParty = amendBooking.party;
    const partyChanged = Object.keys({ ...priorParty, ...party }).some(
      (key) => (priorParty[key] ?? 0) !== (party[key] ?? 0),
    );
    const result = await acceptMutation.run(
      `staff/v1/bookings/${amendBooking.id}/changes`,
      {
        version: amendBooking.version,
        quoteId: changeQuote.quoteId,
      },
    );
    if (result) {
      const params = new URLSearchParams();
      if (partyChanged) params.set("roster", "1");
      const query = params.toString();
      router.push(
        `/reservations/${amendBooking.id}${query ? `?${query}` : ""}`,
      );
    }
  }
  const partnerFields = partnerSourceSelected ? (
    <>
      <Field
        label="Partner organization"
        hint="Choose Viator, GetYourGuide, hotel, or another partner from the list — not as a separate booking source."
      >
        <select
          required
          value={partnerId}
          onChange={(e) => setPartnerId(e.target.value)}
        >
          <option value="">Select partner organization</option>
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
        <Field
          label="Collection arrangement"
          hint={collectionModeHint(collectionMode)}
        >
          <select
            value={collectionMode}
            onChange={(e) =>
              setCollectionMode(
                e.target.value as
                  | "guest_pays_tenant"
                  | "partner_collects_for_tenant"
                  | "partner_invoice",
              )
            }
          >
            <option value="guest_pays_tenant">Guest pays tenant</option>
            <option value="partner_collects_for_tenant">
              Partner collects for tenant
            </option>
            <option value="partner_invoice">Partner invoice</option>
          </select>
        </Field>
      )}
      {partnerId && collectionMode !== "partner_invoice" && (
        <Toggle
          className="toggle-end"
          label="Invoice required"
          checked={invoiceRequired}
          onChange={setInvoiceRequired}
        />
      )}
      {partnerId && collectionMode === "partner_invoice" && (
        <Notice>
          Partner invoice creates a partner obligation for the booking total at
          confirmation. Guest payment is not required on the next screen.
        </Notice>
      )}
    </>
  ) : null;
  const summaryBody = amendMode ? (
    <>
      <p className="eyebrow">REVIEW BEFORE ACCEPTING</p>
      <h2>
        {departure?.product_name ??
          amendBooking?.departure.product_name ??
          "Amendment"}
      </h2>
      {(departure || amendBooking) && (
        <p className="muted">
          {dateTime(
            departure?.starts_at ?? amendBooking!.departure.starts_at,
            session.tenant.timezone,
            session.tenant.config.locale,
            session.tenant.config.dateFormat,
            session.tenant.config.timeFormat,
          )}
        </p>
      )}
      {!changeQuote ? (
        <p className="muted">
          Guest, pickup, stay, and contact corrections preserve the price when
          departure and party stay the same. Commercial changes use current
          rates.
        </p>
      ) : (
        <>
          <div className="balance-lines">
            <div>
              <span>Previous total</span>
              <strong>
                {money(
                  changeQuote.previousTotalMinor,
                  changeQuote.quote.currency,
                )}
              </strong>
            </div>
            <div>
              <span>New total</span>
              <strong>
                {money(
                  changeQuote.quote.totalMinor,
                  changeQuote.quote.currency,
                )}
              </strong>
            </div>
            <div>
              <span>Price difference</span>
              <strong>
                {money(changeQuote.differenceMinor, changeQuote.quote.currency)}
              </strong>
            </div>
            <div>
              <span>Payments retained</span>
              <strong>
                {money(changeQuote.paidMinor, changeQuote.quote.currency)}
              </strong>
            </div>
            <div>
              <span>
                {changeQuote.balanceMinor < 0
                  ? "Credit for review"
                  : "New balance"}
              </span>
              <strong>
                {money(
                  Math.abs(changeQuote.balanceMinor),
                  changeQuote.quote.currency,
                )}
              </strong>
            </div>
          </div>
          <p className="policy-copy">
            Quote expires{" "}
            {dateTime(changeQuote.expiresAt, session.tenant.timezone)}. Seats
            are checked again at acceptance; this quote does not hold inventory.
          </p>
          {changeQuote.balanceMinor < 0 && (
            <Notice>
              Overpayment requires finance review. No refund is issued by
              accepting this amendment.
            </Notice>
          )}
          {amendShortfall && (
            <Notice error>
              The tenant’s amendment payment policy is not met. A higher total
              cannot be accepted through this workflow until that policy is
              satisfied.
            </Notice>
          )}
          {quoteExpired && (
            <Notice error>Quote expired. Request a fresh quote.</Notice>
          )}
          <FormActions stickyOnMobile>
            <button
              type="button"
              className="button secondary"
              disabled={acceptMutation.busy}
              onClick={() => {
                setChangeQuote(null);
                acceptMutation.clear();
              }}
            >
              Revise
            </button>
            <button
              type="button"
              className="button"
              disabled={
                quoteExpired || Boolean(amendShortfall) || acceptMutation.busy
              }
              onClick={() => void acceptAmend()}
            >
              {acceptMutation.busy ? "Applying…" : "Accept change"}
            </button>
          </FormActions>
        </>
      )}
    </>
  ) : (
    <>
      <p className="eyebrow">BOOKING SUMMARY</p>
      <h2>{departure?.product_name ?? "Select a departure"}</h2>
      {departure && (
        <p className="muted">
          {dateTime(
            departure.starts_at,
            session.tenant.timezone,
            session.tenant.config.locale,
            session.tenant.config.dateFormat,
            session.tenant.config.timeFormat,
          )}
        </p>
      )}
      {partyTotal > 0 && (
        <p className="booking-strip-meta">
          {partyTotal} {partyTotal === 1 ? "guest" : "guests"} selected
        </p>
      )}
      {hold ? (
        <>
          <div className={"hold-timer " + (remaining <= 0 ? "expired" : "")}>
            <Clock size={17} />
            {remaining > 0
              ? `Held ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
              : "Hold expired"}
          </div>
          <QuoteSummary quote={hold.quote} />
          {authorizeOverbook && (
            <Notice>
              Authorized capacity exception. Confirmation may exceed configured
              capacity.
            </Notice>
          )}
          {partnerId ? (
            <div className="balance-lines">
              <div>
                <span>Partner / reseller</span>
                <strong>{selectedPartnerName || "Selected"}</strong>
              </div>
              <div>
                <span>Collection</span>
                <strong>{collectionModeLabel(collectionMode)}</strong>
              </div>
              {partnerReference.trim() && (
                <div>
                  <span>Partner reference</span>
                  <strong>{partnerReference.trim()}</strong>
                </div>
              )}
              {(invoiceRequired || collectionMode === "partner_invoice") && (
                <div>
                  <span>Invoice</span>
                  <strong>Required</strong>
                </div>
              )}
            </div>
          ) : null}
          <p className="policy-copy">
            {partnerSettlementWithoutGuestPay(collectionMode) && partnerId
              ? collectionModeHint(collectionMode)
              : `${hold.quote.minimumPaidPercent}% guest payment required before confirmation.`}
          </p>
          {remaining <= 0 && (
            <Notice error>
              Seats released.{" "}
              <button
                type="button"
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
          <LockKeyhole size={22} />
          <p>Price appears after seats are held.</p>
        </div>
      )}
      <div className="summary-footnote">
        Payment and confirmation happen on the next screen.
      </div>
    </>
  );
  return (
    <div className="booking-flow">
      <div className="booking-flow-header">
        <h1>{amendMode ? "Amend reservation" : "New reservation"}</h1>
        <p className="booking-flow-subtitle">
          {amendMode
            ? "Update guest, pickup, stay, and (when confirmed) departure or party. Review a change quote before accepting."
            : "Find a departure, hold seats, then capture the guest."}
        </p>
      </div>
      {amendMode && commercialLocked && (
        <Notice>
          Held reservations allow guest, pickup, stay, and contact corrections.
          For a different departure or party size, confirm first or cancel and
          create a new reservation.
        </Notice>
      )}
      <div className="booking-strip" aria-live="polite">
        <div className="booking-strip-main">
          <strong>
            {departure?.product_name ??
              amendBooking?.departure.product_name ??
              "No departure yet"}
          </strong>
          <span>
            {departure || amendBooking
              ? dateTime(
                  departure?.starts_at ?? amendBooking!.departure.starts_at,
                  session.tenant.timezone,
                  session.tenant.config.locale,
                  session.tenant.config.dateFormat,
                  session.tenant.config.timeFormat,
                )
              : "Choose product, date, and time"}
          </span>
        </div>
        <div className="booking-strip-facts">
          <span>
            {partyTotal} {partyTotal === 1 ? "guest" : "guests"}
          </span>
          {amendMode ? (
            <span>{label(amendBooking?.state ?? "")}</span>
          ) : hold ? (
            <span className={remaining <= 0 ? "danger-text" : ""}>
              {remaining > 0
                ? `Hold ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                : "Hold expired"}
            </span>
          ) : (
            <span>No hold</span>
          )}
          <strong>
            {changeQuote
              ? money(changeQuote.quote.totalMinor, changeQuote.quote.currency)
              : hold
                ? money(hold.quote.totalMinor, hold.quote.currency)
                : "-"}
          </strong>
        </div>
      </div>
      <div className="booking-grid">
        <div className="booking-flow-main">
          <section className="panel form-panel">
            <div className="booking-phase-head">
              <span className="booking-phase-index">1</span>
              <div>
                <h2>
                  {amendMode
                    ? commercialLocked
                      ? "Current departure"
                      : departureId
                        ? "Selected departure"
                        : "Find departure"
                    : hold
                      ? "Departure held"
                      : lockedDepartureId
                        ? "Selected departure"
                        : "Find departure"}
                </h2>
                <p>
                  {amendMode
                    ? commercialLocked
                      ? "Departure and party are locked while this reservation is held."
                      : "Choose the updated departure and party, then review a change quote."
                    : hold
                      ? "Seats are reserved. Change only if you need a different departure."
                      : lockedDepartureId
                        ? "Booking into the departure opened from Departures. Change only if you need a different trip."
                        : "Pick the product and travel date, then choose a live departure."}
                </p>
              </div>
              {(hold || (amendMode && departureId)) && (
                <Check className="step-check" size={20} />
              )}
            </div>
            {departures.error && <Notice error>{departures.error}</Notice>}
            {products.error && <Notice error>{products.error}</Notice>}
            <form onSubmit={reserve}>
              {(hold && departure) ||
              (amendMode && departureId && (departure || amendBooking)) ? (
                <div className="departure-chip">
                  <div>
                    <small>
                      {amendMode ? "Departure" : "Selected departure"}
                    </small>
                    <strong>
                      {departure?.product_name ??
                        amendBooking?.departure.product_name}
                    </strong>
                    <p>
                      {dateTime(
                        departure?.starts_at ??
                          amendBooking!.departure.starts_at,
                        session.tenant.timezone,
                        session.tenant.config.locale,
                        session.tenant.config.dateFormat,
                        session.tenant.config.timeFormat,
                      )}
                      {partyTotal
                        ? ` · ${partyTotal} ${partyTotal === 1 ? "guest" : "guests"}`
                        : ""}
                    </p>
                  </div>
                  {!commercialLocked && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={changeDeparture}
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : null}
              {amendMode && departureId && (departure || amendBooking) ? (
                <div className="party-steppers">
                  {(
                    departure?.categories ??
                    Object.keys(party).map((slug) => ({
                      slug,
                      label: label(slug),
                      countsTowardCapacity: undefined,
                    }))
                  ).map((category) => (
                    <div className="party-stepper" key={category.slug}>
                      <div>
                        <strong>{category.label}</strong>
                        {category.countsTowardCapacity === undefined ? null : (
                          <small>
                            {category.countsTowardCapacity
                              ? "Uses seat capacity"
                              : "Does not use seat capacity"}
                          </small>
                        )}
                      </div>
                      <div className="party-stepper-controls">
                        <button
                          type="button"
                          aria-label={`Decrease ${category.label}`}
                          disabled={commercialLocked || Boolean(changeQuote)}
                          onClick={() => bumpParty(category.slug, -1)}
                        >
                          <Minus size={16} />
                        </button>
                        <span aria-live="polite">
                          {party[category.slug] ?? 0}
                        </span>
                        <button
                          type="button"
                          aria-label={`Increase ${category.label}`}
                          disabled={commercialLocked || Boolean(changeQuote)}
                          onClick={() => bumpParty(category.slug, 1)}
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : lockedDepartureId && departure && !hold ? (
                <div className="departure-chip">
                  <div>
                    <small>Selected departure</small>
                    <strong>{departure.product_name}</strong>
                    <p>
                      {dateTime(
                        departure.starts_at,
                        session.tenant.timezone,
                        session.tenant.config.locale,
                        session.tenant.config.dateFormat,
                        session.tenant.config.timeFormat,
                      )}
                      {` · ${departure.available} seat${
                        departure.available === 1 ? "" : "s"
                      } left`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={changeDeparture}
                  >
                    Change
                  </button>
                </div>
              ) : lockedDepartureId ? (
                departures.busy ? (
                  <Loading />
                ) : (
                  <Notice error>
                    That departure could not be loaded. Choose another trip or
                    change the selection.
                    <button
                      type="button"
                      className="text-link"
                      onClick={changeDeparture}
                    >
                      Find another departure
                    </button>
                  </Notice>
                )
              ) : (
                <div className="departure-finder booking-finder">
                  <div className="booking-finder-controls">
                    <Field label="Product">
                      <select
                        value={selectedProductId}
                        onChange={(event) => {
                          setSelectedProductId(event.target.value);
                          setDepartureId("");
                          setParty({});
                        }}
                      >
                        <option value="all-scheduled">
                          All scheduled departures
                        </option>
                        {(products.data ?? [])
                          .filter(
                            (item) => (item.status ?? "active") === "active",
                          )
                          .map((item) => {
                            const mode = (item.availability_mode ??
                              "fixed_departure") as AvailabilityMode;
                            const meta = availabilityModes[mode];
                            return (
                              <option key={item.id} value={item.id}>
                                {item.customer_title ?? item.name}
                                {meta ? ` · ${meta.label}` : ""}
                              </option>
                            );
                          })}
                      </select>
                    </Field>
                    <TenantDateInput
                      label="Travel date"
                      value={departureDate}
                      onChange={(value) => {
                        setDepartureDate(value);
                        setDepartureId("");
                        setParty({});
                      }}
                      locale={session.tenant.config.locale}
                      dateFormat={session.tenant.config.dateFormat}
                    />
                    <Field label="Search">
                      <SearchBox
                        value={departureSearch}
                        onChange={setDepartureSearch}
                        placeholder="Filter by experience name"
                      />
                    </Field>
                  </div>
                  {!scheduledDiscovery && selectedProduct && (
                    <div className="departure-empty mode-unsupported">
                      <LockKeyhole size={24} />
                      <strong>
                        {availabilityModes[selectedMode]?.label ??
                          label(selectedMode)}{" "}
                        is not booked here
                      </strong>
                      <p>
                        {availabilityModes[selectedMode]?.summary} Do not create
                        a fake departure for this mode.
                      </p>
                    </div>
                  )}
                  {scheduledDiscovery && (
                    <>
                      <div className="booking-finder-toolbar">
                        <div
                          className="time-filters"
                          aria-label="Departure time"
                        >
                          {(
                            [
                              ["all", "Any time"],
                              ["morning", "Morning"],
                              ["afternoon", "Afternoon"],
                              ["evening", "Evening"],
                            ] as const
                          ).map(([value, copy]) => (
                            <button
                              type="button"
                              key={value}
                              className={timeWindow === value ? "active" : ""}
                              aria-pressed={timeWindow === value}
                              onClick={() => setTimeWindow(value)}
                            >
                              {copy}
                            </button>
                          ))}
                        </div>
                        <Toggle
                          className="toggle-inline sold-out-toggle"
                          label="Show sold out"
                          checked={showSoldOut}
                          onChange={setShowSoldOut}
                        />
                      </div>
                      {departures.busy && !departures.items.length ? (
                        <Loading />
                      ) : visibleDepartures.length ? (
                        <>
                          <div className="finder-result-count">
                            <strong>{visibleDepartures.length}</strong>{" "}
                            departure
                            {visibleDepartures.length === 1 ? "" : "s"}
                          </div>
                          <div
                            className="departure-list"
                            role="radiogroup"
                            aria-label="Available departures"
                          >
                            {visibleDepartures.map((item) => {
                              const disabled =
                                item.available === 0 &&
                                !session.permissions.includes(
                                  "inventory.overbook",
                                );
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  role="radio"
                                  aria-checked={departureId === item.id}
                                  disabled={disabled}
                                  className={
                                    "departure-list-row" +
                                    (departureId === item.id ? " selected" : "")
                                  }
                                  onClick={() => {
                                    setDepartureId(item.id);
                                    setParty({});
                                  }}
                                >
                                  <span className="departure-list-time">
                                    {dateTime(
                                      item.starts_at,
                                      session.tenant.timezone,
                                      session.tenant.config.locale,
                                      session.tenant.config.dateFormat,
                                      session.tenant.config.timeFormat,
                                    )}
                                  </span>
                                  <span className="departure-list-copy">
                                    <strong>{item.product_name}</strong>
                                    <small>
                                      {item.option_name}
                                      {item.duration_minutes
                                        ? ` · ${Math.floor(item.duration_minutes / 60)}h${
                                            item.duration_minutes % 60
                                              ? ` ${item.duration_minutes % 60}m`
                                              : ""
                                          }`
                                        : ""}
                                    </small>
                                  </span>
                                  <span
                                    className={
                                      "availability-pill" +
                                      (item.available <= 3 ? " limited" : "")
                                    }
                                  >
                                    <Users size={14} />
                                    {item.available > 0
                                      ? `${item.available} left`
                                      : "Sold out"}
                                  </span>
                                  {departureId === item.id && (
                                    <Check size={18} aria-hidden="true" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <div className="departure-empty">
                          <CalendarDays size={24} />
                          <strong>No departures found</strong>
                          <p>
                            Try another date, clear time filters, or choose a
                            different product.
                          </p>
                        </div>
                      )}
                      {departures.cursor && (
                        <Notice>
                          Showing the first 100 matching departures. Narrow the
                          search to continue.
                        </Notice>
                      )}
                    </>
                  )}
                </div>
              )}
              {scheduledDiscovery && departure && !hold && (
                <div className="party-steppers">
                  <div className="booking-phase-subhead">
                    <h3>Party size</h3>
                    <p>Set guests before holding seats.</p>
                  </div>
                  {departure.categories.map((category) => (
                    <div className="party-stepper" key={category.slug}>
                      <div>
                        <strong>{category.label}</strong>
                        <small>
                          {category.countsTowardCapacity
                            ? "Uses seat capacity"
                            : "Does not use seat capacity"}
                        </small>
                      </div>
                      <div className="party-stepper-controls">
                        <button
                          type="button"
                          aria-label={`Decrease ${category.label}`}
                          onClick={() => bumpParty(category.slug, -1)}
                        >
                          <Minus size={16} />
                        </button>
                        <span aria-live="polite">
                          {party[category.slug] ?? 0}
                        </span>
                        <button
                          type="button"
                          aria-label={`Increase ${category.label}`}
                          onClick={() => bumpParty(category.slug, 1)}
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {scheduledDiscovery &&
                session.permissions.includes("inventory.overbook") &&
                !hold &&
                !amendMode &&
                departure && (
                  <div className="overbook-control">
                    <Toggle
                      className="toggle-end"
                      label="Authorize capacity exception"
                      checked={authorizeOverbook}
                      onChange={setAuthorizeOverbook}
                    />
                    {authorizeOverbook && (
                      <Field
                        label="Overbooking reason"
                        hint="Required, immutable, and visible in the audit trail."
                      >
                        <textarea
                          required
                          minLength={8}
                          maxLength={500}
                          value={overbookReason}
                          onChange={(event) =>
                            setOverbookReason(event.target.value)
                          }
                        />
                      </Field>
                    )}
                  </div>
                )}
              {holdMutation.error && (
                <Notice error>{holdMutation.error}</Notice>
              )}
              {scheduledDiscovery && !hold && !amendMode && (
                <div className="form-actions mobile-sticky">
                  <button
                    className="button"
                    disabled={
                      !departure ||
                      partyTotal < 1 ||
                      holdMutation.busy ||
                      (authorizeOverbook && overbookReason.trim().length < 8)
                    }
                  >
                    {holdMutation.busy
                      ? "Checking availability…"
                      : "Hold seats"}
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </form>
          </section>
          <section
            ref={guestPanelRef}
            className={
              "panel form-panel booking-guest-panel" +
              (!flowReady ? " muted-panel" : "")
            }
          >
            <div className="booking-phase-head">
              <span className="booking-phase-index">2</span>
              <div>
                <h2>Guest details</h2>
                <p>
                  {amendMode
                    ? "Update lead, contacts, pickup, and stay. Traveller roster is managed on the reservation page."
                    : hold
                      ? "Required lead details first. Optional sections stay collapsed."
                      : "Unlocks after seats are held."}
                </p>
              </div>
            </div>
            <form onSubmit={create}>
              <fieldset
                disabled={
                  amendMode
                    ? Boolean(changeQuote) ||
                      quoteMutation.busy ||
                      acceptMutation.busy
                    : !hold ||
                      (remaining <= 0 && !createdBookingId) ||
                      bookingMutation.busy ||
                      rosterMutation.busy
                }
              >
                <BookingAccordion
                  id="lead"
                  title="Lead & source"
                  hint="Required to create the reservation"
                  open={Boolean(openSections.lead)}
                  onToggle={toggleSection}
                >
                  <div className="form-grid">
                    <Field label="Lead traveler name">
                      <input
                        ref={leadNameRef}
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
                      <input
                        type="tel"
                        autoComplete="tel"
                        maxLength={40}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Booking source"
                      hint={
                        amendMode
                          ? "Source and partner settlement stay as recorded on this reservation."
                          : partnerSourceSelected
                            ? "Pick the partner organization below (Viator, GetYourGuide, hotel, and others live there)."
                            : undefined
                      }
                    >
                      <select
                        disabled={amendMode}
                        value={
                          bookingSourceOptions.includes(source)
                            ? source
                            : (bookingSourceOptions[0] ?? "")
                        }
                        onChange={(e) => setBookingSource(e.target.value)}
                      >
                        {bookingSourceOptions.map((s) => (
                          <option key={s} value={s}>
                            {bookingSourceLabel(s)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {!amendMode && partnerFields}
                    {amendMode && amendBooking?.partner && (
                      <p className="muted">
                        Partner {amendBooking.partner.partnerName} ·{" "}
                        {collectionModeLabel(
                          amendBooking.partner.collectionMode,
                        )}
                      </p>
                    )}
                  </div>
                </BookingAccordion>
                {!amendMode && (
                  <BookingAccordion
                    id="roster"
                    title="Travel party names"
                    hint="Can be completed before waiver signing"
                    badge="Optional now"
                    open={Boolean(openSections.roster)}
                    onToggle={toggleSection}
                  >
                    <Toggle
                      className="toggle-end lead-traveler-toggle"
                      label="Lead traveler is joining this departure"
                      checked={leadIsTraveling}
                      onChange={setLeadIsTraveling}
                    />
                    <div className="guest-roster-editor">
                      {passengerDrafts.map((passenger, index) => {
                        const isLead = leadIsTraveling && index === 0;
                        const categoryLabel =
                          departure?.categories.find(
                            (category) => category.slug === passenger.category,
                          )?.label ?? label(passenger.category);
                        return (
                          <div className="guest-roster-row" key={index}>
                            <span className="guest-number">{index + 1}</span>
                            <Field
                              label={`${categoryLabel} name`}
                              hint={
                                isLead
                                  ? "Uses the lead traveler name"
                                  : categoryIsMinor(passenger.category)
                                    ? "Minor/infant from party selection"
                                    : "Can be completed at waiver signing"
                              }
                            >
                              <input
                                maxLength={120}
                                value={isLead ? name : passenger.name}
                                disabled={isLead}
                                placeholder={
                                  isLead
                                    ? "Enter lead traveler above"
                                    : "Name pending"
                                }
                                onChange={(event) =>
                                  setPassengerDrafts((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, name: event.target.value }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            </Field>
                          </div>
                        );
                      })}
                    </div>
                    <div className="roster-note">
                      <Users size={18} />
                      <p>
                        Blank names save as pending guest slots for day-of
                        completion.
                      </p>
                    </div>
                  </BookingAccordion>
                )}
                <BookingAccordion
                  id="pickup"
                  title="Pickup"
                  hint="Optional logistics"
                  open={Boolean(openSections.pickup)}
                  onToggle={toggleSection}
                >
                  <div className="form-grid">
                    <Field label="Pickup disposition">
                      <select
                        value={pickupKind}
                        onChange={(e) =>
                          setPickupKind(
                            e.target.value as
                              "none" | "selected" | "unresolved",
                          )
                        }
                      >
                        <option value="none">No pickup needed</option>
                        <option value="selected">Pickup arranged</option>
                        <option value="unresolved">Pickup to arrange</option>
                      </select>
                    </Field>
                  </div>
                  {pickupKind === "selected" && (
                    <Field
                      label="Pickup location"
                      hint="From the tenant's pickup locations. Add a missing one under Settings › Pickup locations."
                    >
                      <select
                        required
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                      >
                        <option value="">Select a pickup location</option>
                        {(pickupLocations.data ?? []).map((item) => (
                          <option key={item.id} value={item.name}>
                            {item.name}
                            {item.address ? ` — ${item.address}` : ""}
                          </option>
                        ))}
                        {/* An older booking may name a place that has since
                            been renamed or retired. Keeping it as an option
                            means amending some other field cannot silently
                            rewrite where the guest is being collected. */}
                        {location &&
                          !(pickupLocations.data ?? []).some(
                            (item) => item.name === location,
                          ) && (
                            <option value={location}>
                              {location} (not in settings)
                            </option>
                          )}
                      </select>
                    </Field>
                  )}
                  {pickupKind === "selected" &&
                    pickupLocations.data &&
                    !pickupLocations.data.length && (
                      <Notice>
                        No pickup locations have been set up yet. Add them under
                        Settings › Pickup locations so staff pick from a known
                        list instead of typing.
                      </Notice>
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
                        confirmation.
                      </Notice>
                    )}
                </BookingAccordion>
                <BookingAccordion
                  id="stay"
                  title="Guest stay"
                  hint="Cruise call or hotel"
                  badge="Optional"
                  open={Boolean(openSections.stay)}
                  onToggle={toggleSection}
                >
                  {stays.error ? (
                    <Notice error>{stays.error}</Notice>
                  ) : (
                    <div className="form-grid">
                      <Field label="Guest origin">
                        <select
                          value={stayKind}
                          onChange={(e) => {
                            setStayKind(
                              e.target.value as
                                | "none"
                                | "cruise"
                                | "hotel"
                                | "private_accommodation"
                                | "local",
                            );
                            setStayReferenceId("");
                            setUnitNumber("");
                            setStayPropertyName("");
                            setStayAddress("");
                          }}
                        >
                          <option value="none">No stay details</option>
                          <option value="cruise">Cruise ship</option>
                          <option value="hotel">Hotel</option>
                          <option value="private_accommodation">
                            Airbnb / private
                          </option>
                          <option value="local">Local</option>
                        </select>
                      </Field>
                      {stayKind === "cruise" && (
                        <Field
                          label="Cruise ship"
                          hint="Optional. Shown on the waiver and used for emergency contact."
                        >
                          <select
                            value={stayReferenceId}
                            onChange={(e) => setStayReferenceId(e.target.value)}
                          >
                            <option value="">Not recorded</option>
                            {(stays.data?.vessels ?? []).map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                                {item.cruise_line
                                  ? ` — ${item.cruise_line}`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                      {stayKind === "hotel" && (
                        <Field label="Hotel">
                          <select
                            required
                            value={stayReferenceId}
                            onChange={(e) => setStayReferenceId(e.target.value)}
                          >
                            <option value="">Choose hotel</option>
                            {(stays.data?.accommodations ?? []).map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                      {stayKind === "private_accommodation" && (
                        <Field label="Property name">
                          <input
                            required
                            maxLength={160}
                            value={stayPropertyName}
                            onChange={(e) =>
                              setStayPropertyName(e.target.value)
                            }
                            placeholder="Airbnb or private property"
                          />
                        </Field>
                      )}
                      {(stayKind === "cruise" || stayKind === "hotel") && (
                        <Field
                          label={
                            stayKind === "cruise"
                              ? "Cabin number · optional"
                              : "Room number · optional"
                          }
                        >
                          <input
                            maxLength={40}
                            value={unitNumber}
                            onChange={(e) => setUnitNumber(e.target.value)}
                          />
                        </Field>
                      )}
                      {(stayKind === "private_accommodation" ||
                        stayKind === "local") && (
                        <Field
                          label={
                            stayKind === "local"
                              ? "Local address · optional"
                              : "Property address"
                          }
                        >
                          <input
                            required={stayKind === "private_accommodation"}
                            maxLength={300}
                            value={stayAddress}
                            onChange={(e) => setStayAddress(e.target.value)}
                          />
                        </Field>
                      )}
                    </div>
                  )}
                </BookingAccordion>
                {!amendMode && (
                  <BookingAccordion
                    id="concession"
                    title="Discount & promo"
                    hint="Staff concession on this hold"
                    badge="Optional"
                    open={Boolean(openSections.concession)}
                    onToggle={toggleSection}
                  >
                    <p className="muted">
                      Free-text promo references are audited with the
                      reservation. A full promo catalog remains deferred.
                    </p>
                    <div className="form-grid">
                      <Field
                        label={`Discount amount · ${hold?.quote.currency ?? ""}`}
                      >
                        <input
                          inputMode="decimal"
                          maxLength={20}
                          value={discountAmount}
                          onChange={(e) => setDiscountAmount(e.target.value)}
                          placeholder="0.00"
                        />
                      </Field>
                      <Field label="Promo code · optional">
                        <input
                          maxLength={40}
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value)}
                          placeholder="Reference only"
                        />
                      </Field>
                      <Field
                        label="Discount reason"
                        hint="Required when a discount is applied."
                      >
                        <input
                          required={Boolean(discountAmount.trim())}
                          minLength={3}
                          maxLength={500}
                          value={discountReason}
                          onChange={(e) => setDiscountReason(e.target.value)}
                          placeholder="Why this concession is authorized"
                        />
                      </Field>
                    </div>
                  </BookingAccordion>
                )}
                <BookingAccordion
                  id="contacts"
                  title="Purchaser & emergency"
                  hint="Only when different from the lead"
                  badge="Optional"
                  open={Boolean(openSections.contacts)}
                  onToggle={toggleSection}
                >
                  <Toggle
                    className="toggle-end"
                    label="Lead traveler is the purchaser"
                    checked={purchaserIsLead}
                    onChange={setPurchaserIsLead}
                  />
                  {!purchaserIsLead && (
                    <div className="form-grid">
                      <Field label="Purchaser name">
                        <input
                          required
                          maxLength={120}
                          value={purchaserName}
                          onChange={(event) =>
                            setPurchaserName(event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Purchaser email">
                        <input
                          required
                          type="email"
                          maxLength={254}
                          value={purchaserEmail}
                          onChange={(event) =>
                            setPurchaserEmail(event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Purchaser phone">
                        <input
                          type="tel"
                          maxLength={40}
                          value={purchaserPhone}
                          onChange={(event) =>
                            setPurchaserPhone(event.target.value)
                          }
                        />
                      </Field>
                    </div>
                  )}
                  <p className="muted">
                    Emergency contact is optional. If any field is entered,
                    complete all three.
                  </p>
                  <div className="form-grid">
                    <Field label="Emergency contact name">
                      <input
                        required={Boolean(
                          emergencyPhone || emergencyRelationship,
                        )}
                        maxLength={120}
                        value={emergencyName}
                        onChange={(event) =>
                          setEmergencyName(event.target.value)
                        }
                      />
                    </Field>
                    <Field label="Emergency phone">
                      <input
                        required={Boolean(
                          emergencyName || emergencyRelationship,
                        )}
                        type="tel"
                        maxLength={40}
                        value={emergencyPhone}
                        onChange={(event) =>
                          setEmergencyPhone(event.target.value)
                        }
                      />
                    </Field>
                    <Field label="Relationship">
                      <input
                        required={Boolean(emergencyName || emergencyPhone)}
                        maxLength={80}
                        value={emergencyRelationship}
                        onChange={(event) =>
                          setEmergencyRelationship(event.target.value)
                        }
                      />
                    </Field>
                  </div>
                </BookingAccordion>
                {amendMode && (
                  <Field label="Reason for amendment" required>
                    <textarea
                      required
                      maxLength={500}
                      value={amendReason}
                      onChange={(e) => setAmendReason(e.target.value)}
                      placeholder="Why this change is being made"
                    />
                  </Field>
                )}
                <div className="form-actions mobile-sticky">
                  {amendMode ? (
                    <button
                      className="button"
                      disabled={
                        !departureId ||
                        partyTotal < 1 ||
                        !amendReason.trim() ||
                        quoteMutation.busy ||
                        Boolean(changeQuote)
                      }
                    >
                      {quoteMutation.busy
                        ? "Calculating…"
                        : "Review change quote"}
                      <ArrowRight size={16} />
                    </button>
                  ) : (
                    <button
                      className="button"
                      disabled={
                        !hold ||
                        (remaining <= 0 && !createdBookingId) ||
                        bookingMutation.busy ||
                        rosterMutation.busy ||
                        (partnerSourceSelected && !partnerId) ||
                        (Boolean(discountAmount.trim()) &&
                          discountReason.trim().length < 3)
                      }
                    >
                      {bookingMutation.busy
                        ? "Creating reservation…"
                        : rosterMutation.busy
                          ? "Saving guest roster…"
                          : createdBookingId
                            ? "Retry guest roster"
                            : "Create reservation"}
                      <ArrowRight size={16} />
                    </button>
                  )}
                  {!amendMode &&
                    hold &&
                    remaining <= 0 &&
                    !createdBookingId && (
                      <span className="muted">
                        Hold expired — create a new hold first.
                      </span>
                    )}
                </div>
              </fieldset>
              {quoteMutation.error && (
                <Notice error>{quoteMutation.error}</Notice>
              )}
              {acceptMutation.error && (
                <Notice error>{acceptMutation.error}</Notice>
              )}
              {bookingMutation.error && (
                <Notice error>{bookingMutation.error}</Notice>
              )}
              {rosterMutation.error && (
                <Notice error>
                  The reservation was created, but its guest roster still needs
                  to be saved. Retry to finish without creating a duplicate.
                  {` ${rosterMutation.error}`}
                </Notice>
              )}
            </form>
          </section>
        </div>
        <aside className="panel summary-panel booking-summary-rail">
          {summaryBody}
        </aside>
      </div>
    </div>
  );
}

export function BookingDetail({
  session,
  bookingId,
}: {
  session: Session;
  bookingId: string;
}) {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [rosterNotice, setRosterNotice] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setReturnTo(safeReturnTo(params.get("returnTo")));
    setRosterNotice(params.get("roster") === "1");
  }, []);
  const booking = useResource<Booking>("staff/v1/bookings/" + bookingId),
    financeSummary = useResource<BookingFinanceSummary>(
      booking.data?.hasPartnerSnapshot
        ? `finance/v1/bookings/${bookingId}/finance-summary`
        : null,
    ),
    passengers = useResource<Passenger[]>(
      `staff/v1/bookings/${bookingId}/passengers`,
    ),
    pay = useMutation(),
    adjustPayment = useMutation(),
    confirm = useMutation(),
    reviveHold = useMutation(),
    concessionMutation = useMutation(),
    savePassengers = useMutation(),
    printJob = useMutation();
  const [amount, setAmount] = useState(""),
    [method, setMethod] = useState(""),
    [reference, setReference] = useState(""),
    [note, setNote] = useState(""),
    [discountAmount, setDiscountAmount] = useState(""),
    [promoCode, setPromoCode] = useState(""),
    [discountReason, setDiscountReason] = useState(""),
    [inputError, setInputError] = useState(""),
    [success, setSuccess] = useState("");
  const [printError, setPrintError] = useState("");
  const [adjustingPaymentId, setAdjustingPaymentId] = useState("");
  const [adjustmentReference, setAdjustmentReference] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [passengerDrafts, setPassengerDrafts] = useState<PassengerDraft[]>([]);
  const [rosterBookingId, setRosterBookingId] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [compactSummary, setCompactSummary] = useState(false);
  const [occurredAt] = useState(() => new Date().toISOString());
  const remaining = useRemaining(booking.data?.expiresAt);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1280px)");
    const sync = () => {
      setCompactSummary(media.matches);
      if (!media.matches) setSummaryOpen(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!summaryOpen || !compactSummary) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSummaryOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [summaryOpen, compactSummary]);
  // Close the mobile sheet if the booking no longer needs a payment/confirm action.
  useEffect(() => {
    if (!booking.data) return;
    const partnerSettles =
      booking.data.partner?.collectionMode === "partner_invoice" ||
      booking.data.partner?.collectionMode === "partner_collects_for_tenant";
    const actionable =
      booking.data.state === "held" ||
      (booking.data.state === "confirmed" &&
        booking.data.balanceMinor !== 0 &&
        !partnerSettles);
    if (!actionable) setSummaryOpen(false);
  }, [booking.data]);
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
    if (
      !booking.data ||
      rosterBookingId === booking.data.id ||
      passengers.data?.length
    )
      return;
    const drafts = Object.entries(booking.data.party).flatMap(
      ([category, quantity]) =>
        Array.from({ length: quantity }, () => ({
          name: "",
          category,
          isMinor: categoryIsMinor(category),
        })),
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
    );
  async function correctPayment(payment: Booking["payments"][number]) {
    const result = await adjustPayment.run(
      `staff/v1/bookings/${bookingId}/payments/${payment.id}/adjustments`,
      {
        kind: payment.status === "pending" ? "void" : "reversal",
        reference: adjustmentReference,
        reason: adjustmentReason,
        occurredAt: new Date().toISOString(),
      },
    );
    if (result) {
      setSuccess(
        payment.status === "pending"
          ? "Pending payment voided."
          : "External payment reversal recorded.",
      );
      setAdjustingPaymentId("");
      setAdjustmentReference("");
      setAdjustmentReason("");
      booking.reload();
    }
  }
  async function confirmation() {
    const result = await confirm.run(`staff/v1/bookings/${bookingId}/confirm`, {
      version: b.version,
    });
    if (result) {
      router.push(returnTo ?? "/reservations");
    }
  }
  const canPrint = session.permissions.includes("print.jobs.create");
  async function printReservation() {
    setPrintError("");
    try {
      await printDocument(
        {
          documentType: "receipt",
          sourceType: "booking",
          sourceId: bookingId,
          fallbackName: `receipt-${bookingId.slice(0, 8)}.pdf`,
        },
        printJob.run,
        fetchApiFile,
      );
    } catch (error) {
      setPrintError(
        printJob.error || (error as Error).message || "Could not print.",
      );
    }
  }
  async function downloadReservationPdf() {
    setPrintError("");
    const result = await printJob.run<{ id: string }>("ops/v1/print-jobs", {
      documentType: "receipt",
      sourceType: "booking",
      sourceId: bookingId,
    });
    if (!result) {
      setPrintError(printJob.error || "Could not prepare PDF.");
      return;
    }
    try {
      await downloadApiFile(
        `ops/v1/print-jobs/${result.id}/pdf`,
        `receipt-${bookingId.slice(0, 8)}.pdf`,
      );
    } catch (error) {
      setPrintError((error as Error).message);
    }
  }
  async function payAndConfirm() {
    setInputError("");
    if (b.balanceMinor > 0 && method) {
      if (!session.permissions.includes("payment.write")) {
        setInputError("Payment permission is required to record collection.");
        return;
      }
      try {
        const paid = await pay.run(`staff/v1/bookings/${bookingId}/payments`, {
          amountMinor: minor(amount, b.quote.currency),
          currency: b.quote.currency,
          method,
          status: "settled",
          reference: reference.trim(),
          reason: note.trim(),
          occurredAt,
        });
        if (!paid) return;
      } catch (e) {
        setInputError((e as Error).message);
        return;
      }
    }
    await confirmation();
  }
  async function restoreHold() {
    const result = await reviveHold.run(
      `staff/v1/bookings/${bookingId}/revive-hold`,
      {},
    );
    if (result) {
      setSuccess(
        "Hold restored. Record payment if needed, then confirm the reservation.",
      );
      booking.reload();
    }
  }
  async function applyDiscount(event: React.FormEvent) {
    event.preventDefault();
    if (!discountReady || discountReason.trim().length < 3) return;
    const result = await concessionMutation.run(
      `staff/v1/bookings/${bookingId}/concession`,
      {
        discountMinor: minor(discountAmount, b.quote.currency),
        reason: discountReason.trim(),
        promoCode: promoCode.trim(),
      },
    );
    if (result) {
      setSuccess("Discount applied to this reservation.");
      setDiscountAmount("");
      setPromoCode("");
      setDiscountReason("");
      booking.reload();
    }
  }
  async function recordRoster(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await savePassengers.run(
      `staff/v1/bookings/${bookingId}/passengers`,
      { passengers: passengerDrafts },
    );
    if (result) {
      setSuccess(
        "Passenger roster recorded. It is frozen when the reservation is confirmed.",
      );
      passengers.reload();
    }
  }
  const paymentForm =
    !expired &&
    b.balanceMinor > 0 &&
    session.permissions.includes("payment.write") &&
    !partnerSettlementWithoutGuestPay(b.partner?.collectionMode) ? (
      <div className="booking-payment-form">
        <div className="form-grid">
          <Field label={"Amount received · " + b.quote.currency}>
            <input
              className="amount-input"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Payment method">
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Select</option>
              {session.tenant.config.manualPaymentMethods.map((m) => (
                <option key={m} value={m}>
                  {paymentMethodLabel(m)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Receipt / bank reference">
            <input
              maxLength={120}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
          <Field label="Collection note">
            <input
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        {(inputError || pay.error) && (
          <Notice error>{inputError || pay.error}</Notice>
        )}
      </div>
    ) : null;

  let paymentAmountMinor = 0;
  let paymentAmountValid = false;
  try {
    if (amount.trim()) {
      paymentAmountMinor = minor(amount, b.quote.currency);
      paymentAmountValid = paymentAmountMinor > 0;
    }
  } catch {
    paymentAmountValid = false;
  }
  const discountValue = Number(discountAmount);
  const discountReady =
    discountAmount.trim() !== "" &&
    Number.isFinite(discountValue) &&
    discountValue > 0;
  const pickupReady =
    b.pickup.kind !== "unresolved" || b.quote.allowUnresolvedPickup;
  const partnerSettles = partnerSettlementWithoutGuestPay(
    b.partner?.collectionMode,
  );
  const alreadyFunded = b.paidMinor >= required;
  const fundingReady =
    partnerSettles ||
    alreadyFunded ||
    (Boolean(method) &&
      paymentAmountValid &&
      b.paidMinor + paymentAmountMinor >= required);
  const canConfirm =
    b.state === "held" &&
    !expired &&
    pickupReady &&
    fundingReady &&
    session.permissions.includes("bookings.write") &&
    (partnerSettles ||
      alreadyFunded ||
      (Boolean(method) && session.permissions.includes("payment.write")));
  // Mobile FAB opens the payment/confirm sheet — only when there is something
  // to do (hold flow, or confirmed guest balance still collectible here).
  const summaryActionable =
    b.state === "held" ||
    (b.state === "confirmed" &&
      b.balanceMinor !== 0 &&
      !partnerSettles &&
      session.permissions.includes("payment.write"));
  const sheetOpen = summaryOpen && summaryActionable;

  return (
    <div
      className={
        "booking-detail" +
        (compactSummary && summaryActionable ? " has-summary-fab" : "")
      }
    >
      <div className="booking-detail-header">
        <p className="eyebrow">{"BOOKING " + b.id.slice(0, 8).toUpperCase()}</p>
        <div className="booking-detail-title-row">
          <h1>{b.lead_name}</h1>
          <Status state={expired ? "expired" : b.state} />
        </div>
        <div className="booking-detail-meta-row">
          <p className="booking-detail-email">{b.lead_email}</p>
          <div className="doc-actions booking-print-actions no-print">
            {canPrint && (
              <button
                type="button"
                className="button secondary icon-only-action"
                disabled={printJob.busy}
                onClick={() => void printReservation()}
                aria-label="Print reservation"
                title={printJob.busy ? "Preparing print" : "Print reservation"}
              >
                <Printer size={16} aria-hidden="true" />
                <span className="button-label">
                  {printJob.busy ? "Preparing…" : "Print"}
                </span>
              </button>
            )}
            {canPrint && (
              <button
                type="button"
                className="button secondary icon-only-action"
                disabled={printJob.busy}
                onClick={() => void downloadReservationPdf()}
                aria-label="Download PDF"
                title={printJob.busy ? "Preparing PDF" : "Download PDF"}
              >
                <Download size={16} aria-hidden="true" />
                <span className="button-label">
                  {printJob.busy ? "Preparing…" : "PDF"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
      {(printError || printJob.error) && (
        <Notice error>{printError || printJob.error}</Notice>
      )}
      <section className="print-only reservation-print-page" aria-hidden="true">
        <div className="reservation-print-masthead">
          <strong>{session.tenant.name}</strong>
          <span>
            Reservation {b.id.slice(0, 8).toUpperCase()} ·{" "}
            {expired ? "Expired" : label(b.state)}
          </span>
        </div>
        <p>
          {b.departure.product_name ?? "Experience"} ·{" "}
          {dateTime(
            b.departure.starts_at,
            session.tenant.timezone,
            session.tenant.config.locale,
            session.tenant.config.dateFormat,
            session.tenant.config.timeFormat,
          )}
        </p>
        <p>
          {b.lead_name} · {b.lead_email}
        </p>
        <p>
          Total {money(b.quote.totalMinor, b.quote.currency)} · Paid{" "}
          {money(b.paidMinor, b.quote.currency)} · Balance{" "}
          {money(
            b.state === "cancelled"
              ? b.historicalBalanceMinor
              : Math.abs(b.balanceMinor),
            b.quote.currency,
          )}
        </p>
        {(passengers.data ?? []).length > 0 ? (
          <ul>
            {(passengers.data ?? []).map((passenger) => (
              <li key={passenger.id}>
                {passenger.name} ({passenger.category}
                {passenger.is_minor ? ", minor" : ""})
              </li>
            ))}
          </ul>
        ) : null}
        {b.payments.length > 0 ? (
          <ul>
            {b.payments.map((payment) => (
              <li key={payment.id}>
                {money(payment.amount_minor, payment.currency)} ·{" "}
                {label(payment.method)}
                {payment.passenger_name ? ` · ${payment.passenger_name}` : ""}
                {payment.reference ? ` · ${payment.reference}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {rosterNotice && (
        <Notice>
          Party size changed. Update the traveller roster to match the new
          party.
        </Notice>
      )}
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
      <section
        className="panel booking-money-strip"
        aria-label="Booking money summary"
      >
        <div>
          <span>Total</span>
          <strong>{money(b.quote.totalMinor, b.quote.currency)}</strong>
        </div>
        <div>
          <span>Paid</span>
          <strong>{money(b.paidMinor, b.quote.currency)}</strong>
        </div>
        <div>
          <span>
            {b.state === "cancelled"
              ? "Historical balance"
              : b.balanceMinor < 0
                ? "Credit"
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
        <div>
          <span>Status</span>
          <strong>{expired ? "Expired" : label(b.state)}</strong>
        </div>
      </section>
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
              className="button destructive"
              href={"/reservations/" + b.id + "/cancel"}
            >
              Cancel reservation
            </Link>
          </div>
        )}
      <div className="booking-detail-layout">
        <article className="panel booking-detail-main">
          <section className="booking-detail-section">
            <h2>Overview</h2>
            <dl className="detail-grid compact">
              <div className="detail-wide detail-inline">
                <dt>Experience</dt>
                <dd>
                  <strong>{b.departure.product_name ?? "Experience"}</strong>
                </dd>
              </div>
              <div>
                <dt>Departure</dt>
                <dd>
                  {dateTime(
                    b.departure.starts_at,
                    session.tenant.timezone,
                    session.tenant.config.locale,
                    session.tenant.config.dateFormat,
                    session.tenant.config.timeFormat,
                  )}
                </dd>
              </div>
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
                <dt>Source</dt>
                <dd>{label(b.source)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{expired ? "Expired" : label(b.state)}</dd>
              </div>
              <div>
                <dt>Pickup</dt>
                <dd>{readablePickup(b.pickup)}</dd>
              </div>
              <div>
                <dt>Guest origin</dt>
                <dd>{readableStay(b.stay)}</dd>
              </div>
              {b.partner && (
                <>
                  <div className="detail-wide">
                    <dt>Partner / reseller</dt>
                    <dd>
                      {b.partner.partnerName}
                      {b.partner.externalReference
                        ? ` · ${b.partner.externalReference}`
                        : ""}
                    </dd>
                  </div>
                  <div className="detail-wide">
                    <dt>Collection</dt>
                    <dd>
                      {collectionModeLabel(b.partner.collectionMode)}
                      {b.partner.invoiceRequired ||
                      b.partner.collectionMode === "partner_invoice"
                        ? " · Invoice required"
                        : ""}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </section>

          <section className="booking-detail-section">
            <h2>Contacts</h2>
            <dl className="detail-grid compact">
              <div className="detail-wide">
                <dt>Lead traveler</dt>
                <dd>
                  {b.lead_name}
                  {b.lead_email ? ` · ${b.lead_email}` : ""}
                </dd>
              </div>
              <div className="detail-wide">
                <dt>Purchaser</dt>
                <dd>
                  {b.purchaser.name} · {b.purchaser.email}
                  {b.purchaser.phone ? ` · ${b.purchaser.phone}` : ""}
                </dd>
              </div>
              <div className="detail-wide">
                <dt>Emergency</dt>
                <dd>
                  {b.emergency_contact.name
                    ? `${b.emergency_contact.name} · ${b.emergency_contact.relationship} · ${b.emergency_contact.phone}`
                    : "Not provided"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="booking-detail-section">
            <h2>Travel party</h2>
            {passengers.data && passengers.data.length > 0 ? (
              <div
                className="party-name-badges"
                aria-label="Travel party names"
              >
                {passengers.data.map((passenger) => (
                  <span
                    className={
                      "party-name-badge tone-" +
                      partyBadgeTone(passenger.category)
                    }
                    key={passenger.id}
                    title={
                      label(passenger.category) +
                      (passenger.is_minor ? " · minor" : "")
                    }
                  >
                    <strong>{passenger.name}</strong>
                    <small>{label(passenger.category)}</small>
                  </span>
                ))}
              </div>
            ) : b.state === "held" &&
              session.permissions.includes("bookings.write") ? (
              <form onSubmit={recordRoster}>
                <p className="muted">
                  Record each traveller before confirming. Category comes from
                  the party selection.
                </p>
                <div className="stack-list compact">
                  {passengerDrafts.map((passenger, index) => (
                    <div className="guest-roster-row" key={index}>
                      <span className="guest-number">{index + 1}</span>
                      <Field label={`${label(passenger.category)} name`}>
                        <input
                          required
                          maxLength={120}
                          value={passenger.name}
                          onChange={(event) =>
                            setPassengerDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, name: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                  ))}
                </div>
                {savePassengers.error && (
                  <Notice error>{savePassengers.error}</Notice>
                )}
                <button
                  className="button secondary"
                  disabled={savePassengers.busy || passengerDrafts.length === 0}
                >
                  {savePassengers.busy
                    ? "Recording…"
                    : "Record passenger roster"}
                </button>
              </form>
            ) : (
              <p className="muted">No passenger names recorded yet.</p>
            )}
          </section>

          {b.payments.length > 0 && (
            <section className="booking-detail-section">
              <h2>Payment history</h2>
              <div className="stack-list compact">
                {b.payments.map((payment) => (
                  <div className="detail-row" key={payment.id}>
                    <span>
                      <strong>
                        {money(payment.amount_minor, payment.currency)} ·{" "}
                        {label(payment.method)}
                      </strong>
                      <small>
                        {dateTime(payment.occurred_at, session.tenant.timezone)}{" "}
                        · {payment.reference}
                        {payment.passenger_name
                          ? ` · ${payment.passenger_name}`
                          : ""}
                      </small>
                      {payment.adjustment_id && (
                        <small>
                          {label(payment.adjustment_kind!)} ·{" "}
                          {payment.adjustment_reference} ·{" "}
                          {payment.adjustment_reason}
                        </small>
                      )}
                    </span>
                    {!payment.adjustment_id &&
                      session.permissions.includes("payment.correct") && (
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => setAdjustingPaymentId(payment.id)}
                        >
                          {payment.status === "pending"
                            ? "Void entry"
                            : "Record reversal"}
                        </button>
                      )}
                  </div>
                ))}
              </div>
              {adjustingPaymentId && (
                <div className="form-grid">
                  <Field label="Adjustment reference">
                    <input
                      required
                      maxLength={120}
                      value={adjustmentReference}
                      onChange={(event) =>
                        setAdjustmentReference(event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Reason">
                    <input
                      required
                      minLength={8}
                      maxLength={500}
                      value={adjustmentReason}
                      onChange={(event) =>
                        setAdjustmentReason(event.target.value)
                      }
                    />
                  </Field>
                  <div className="button-row">
                    <button
                      className="button secondary"
                      type="button"
                      disabled={
                        adjustPayment.busy ||
                        !adjustmentReference.trim() ||
                        adjustmentReason.trim().length < 8
                      }
                      onClick={() =>
                        void correctPayment(
                          b.payments.find(
                            (payment) => payment.id === adjustingPaymentId,
                          )!,
                        )
                      }
                    >
                      {adjustPayment.busy ? "Recording…" : "Confirm correction"}
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => setAdjustingPaymentId("")}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {adjustPayment.error && (
                <Notice error>{adjustPayment.error}</Notice>
              )}
            </section>
          )}

          {session.permissions.includes("notifications.read") && (
            <section className="booking-detail-section">
              <CustomerMessages
                bookingId={bookingId}
                timezone={session.tenant.timezone}
                canRequest={session.permissions.includes(
                  "notifications.request",
                )}
                balanceMinor={b.balanceMinor}
              />
            </section>
          )}

          <section className="booking-detail-section">
            <BookingHistory
              key={b.version}
              bookingId={b.id}
              session={session}
            />
          </section>
        </article>

        <div
          className={"booking-summary-scrim" + (sheetOpen ? " open" : "")}
          aria-hidden={!sheetOpen}
          onClick={() => setSummaryOpen(false)}
        />
        <aside
          className={
            "panel summary-panel booking-detail-rail" +
            (sheetOpen ? " open" : "")
          }
          id="booking-summary-panel"
          aria-hidden={compactSummary ? !sheetOpen : undefined}
          aria-modal={compactSummary && sheetOpen ? true : undefined}
          role={compactSummary && sheetOpen ? "dialog" : undefined}
          aria-label="Booking summary"
          {...(compactSummary && !sheetOpen ? { inert: true } : {})}
        >
          <div className="booking-summary-sheet-head">
            <div>
              <p className="eyebrow">PAYMENT & CONFIRMATION</p>
              <h2>Booking summary</h2>
            </div>
            <button
              type="button"
              className="icon-button booking-summary-close"
              aria-label="Close booking summary"
              onClick={() => setSummaryOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="booking-summary-desktop-head">
            <p className="eyebrow">PAYMENT & CONFIRMATION</p>
            <h2>Booking summary</h2>
          </div>
          <QuoteSummary quote={b.quote} />
          {b.partner && (
            <div className="balance-lines">
              <div>
                <span>Partner / reseller</span>
                <strong>{b.partner.partnerName}</strong>
              </div>
              <div>
                <span>Collection</span>
                <strong>{collectionModeLabel(b.partner.collectionMode)}</strong>
              </div>
              {b.partner.externalReference ? (
                <div>
                  <span>Partner reference</span>
                  <strong>{b.partner.externalReference}</strong>
                </div>
              ) : null}
            </div>
          )}
          {partnerSettles && b.state === "held" && !expired && (
            <Notice>{collectionModeHint(b.partner!.collectionMode)}</Notice>
          )}
          {!expired &&
            b.state === "held" &&
            !b.quote.discountMinor &&
            session.permissions.includes("bookings.write") && (
              <form
                className="booking-concession-form"
                onSubmit={(event) => void applyDiscount(event)}
              >
                <p className="eyebrow">DISCOUNT & PROMO</p>
                <div className="form-grid">
                  <Field label={`Discount · ${b.quote.currency}`}>
                    <input
                      className="amount-input"
                      inputMode="decimal"
                      maxLength={20}
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </Field>
                  <Field label="Promo code">
                    <input
                      maxLength={40}
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                    />
                  </Field>
                </div>
                {discountReady && (
                  <div className="concession-action-row">
                    <Field
                      label="Discount reason"
                      hint={
                        discountReason.trim().length < 3
                          ? "Enter at least 3 characters"
                          : undefined
                      }
                    >
                      <input
                        required
                        minLength={3}
                        maxLength={500}
                        value={discountReason}
                        onChange={(e) => setDiscountReason(e.target.value)}
                        placeholder="Why this concession is authorized"
                      />
                    </Field>
                    <button
                      type="submit"
                      className="button secondary"
                      disabled={
                        concessionMutation.busy ||
                        discountReason.trim().length < 3
                      }
                    >
                      {concessionMutation.busy ? "Applying…" : "Apply discount"}
                    </button>
                  </div>
                )}
                {concessionMutation.error && (
                  <Notice error>{concessionMutation.error}</Notice>
                )}
              </form>
            )}
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
                  <strong>
                    {money(
                      financeSummary.data.partnerCreditMinor,
                      b.quote.currency,
                    )}
                  </strong>
                </div>
                <div>
                  <span>Guest balance after credit</span>
                  <strong>
                    {money(
                      financeSummary.data.guestBalanceMinor,
                      b.quote.currency,
                    )}
                  </strong>
                </div>
                <div>
                  <span>
                    {financeSummary.data.collectionMode === "partner_invoice"
                      ? "Partner invoice obligation"
                      : "Partner obligation"}
                  </span>
                  <strong>
                    {money(
                      financeSummary.data.partnerObligationMinor,
                      b.quote.currency,
                    )}
                  </strong>
                </div>
              </>
            )}
          </div>
          {expired ? (
            <div className="expired-hold-panel">
              <Notice error>
                This hold expired and seats were released. Restore the hold to
                continue payment and confirmation if capacity is still
                available.
              </Notice>
              {session.permissions.includes("bookings.write") && (
                <button
                  type="button"
                  className="button full"
                  disabled={reviveHold.busy}
                  onClick={() => void restoreHold()}
                >
                  {reviveHold.busy
                    ? "Restoring hold…"
                    : "Restore hold & continue"}
                </button>
              )}
              {reviveHold.error && <Notice error>{reviveHold.error}</Notice>}
              <p className="muted">
                Or <Link href="/reservations/new">start a new reservation</Link>{" "}
                if this departure is full.
              </p>
            </div>
          ) : null}
          {paymentForm}
          {!expired && b.balanceMinor === 0 && b.state !== "cancelled" ? (
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
                {partnerSettles
                  ? b.partner?.collectionMode === "partner_invoice"
                    ? "Partner invoice covers confirmation. Guest payment is not required."
                    : "Partner collection covers confirmation. Record the claim under Partners / Resellers after confirm."
                  : `${money(required, b.quote.currency)} guest payment required to confirm (${b.quote.minimumPaidPercent}% of total).`}
              </p>
              {!canConfirm && !expired && (
                <p className="muted">
                  {pickupReady
                    ? partnerSettles
                      ? "Resolve any blocking issues, then confirm."
                      : "Select a guest payment method and amount that meets the required total, then confirm."
                    : "Resolve required pickup before confirming."}
                </p>
              )}
              {(confirm.error || inputError) && (
                <Notice error>{confirm.error || inputError}</Notice>
              )}
              {session.permissions.includes("bookings.write") && (
                <button
                  className="button full"
                  disabled={!canConfirm || confirm.busy || pay.busy}
                  onClick={() => void payAndConfirm()}
                >
                  {pay.busy || confirm.busy
                    ? method && b.balanceMinor > 0 && !partnerSettles
                      ? "Recording & confirming…"
                      : "Confirming…"
                    : method && b.balanceMinor > 0 && !partnerSettles
                      ? "Record payment & confirm"
                      : "Confirm reservation"}
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
            {b.partner?.collectionMode === "partner_collects_for_tenant"
              ? "Partner collections are recorded under Partners / Resellers and verified by finance. Do not enter them as guest payments."
              : b.partner?.collectionMode === "partner_invoice"
                ? "Partner invoice obligations appear under Partners / Resellers after confirmation."
                : b.partner?.collectionMode === "guest_pays_tenant"
                  ? "Partner is attribution only. Record guest payments to the operator here."
                  : "Guest payments to the operator are recorded here. Partner collection claims use Partners / Resellers."}
          </p>
        </aside>
        {compactSummary && summaryActionable ? (
          <button
            type="button"
            className={"booking-summary-fab" + (sheetOpen ? " is-hidden" : "")}
            aria-expanded={sheetOpen}
            aria-controls="booking-summary-panel"
            onClick={() => setSummaryOpen(true)}
          >
            <ShoppingCart size={22} aria-hidden />
            <span className="booking-summary-fab-label">
              {b.state === "held" && !expired
                ? partnerSettles || alreadyFunded
                  ? "Confirm"
                  : "Pay & confirm"
                : b.balanceMinor < 0
                  ? "Credit"
                  : "Collect"}
            </span>
            <span className="booking-summary-fab-amount">
              {b.balanceMinor !== 0
                ? money(Math.abs(b.balanceMinor), b.quote.currency)
                : money(b.quote.totalMinor, b.quote.currency)}
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
