import { useEffect, useRef, useState, type ReactNode } from "react";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  OptionSheet,
  ProductCover,
  EMERGENCY_RELATIONSHIP_OTHER,
  EMERGENCY_RELATIONSHIPS,
  stayChoiceLabel,
  stayChoices,
} from "./chrome";
import {
  FALLBACK_CATEGORIES,
  formatMoney,
  matchStayPickupLocation,
  occupancyLabel,
  operationalLabel,
  paymentMethodLabel,
  TABLET_MIN_WIDTH,
  tripRunLeft,
  type BoardItem,
  type BoardPayload,
  type PartyCategory,
  type PickupLocationOption,
  type StayOption,
  type Trip,
  type WalkUpQuote,
} from "./field";

const STAY_NAME_OTHER = "__other__";
function Action({
  children,
  disabled,
  onPress,
  quiet = false,
}: {
  children: string;
  disabled?: boolean;
  onPress: () => void;
  quiet?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        quiet && styles.quiet,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, quiet && styles.quietText]}>
        {children}
      </Text>
    </Pressable>
  );
}

function shiftDay(iso: string, days: number) {
  const next = new Date(`${iso}T12:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function formatBoardDate(iso: string) {
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function isoDay(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function BookCalendar({
  date,
  minDate,
  visible,
  onClose,
  onSelect,
}: {
  date: string;
  minDate: string;
  visible: boolean;
  onClose: () => void;
  onSelect: (date: string) => void;
}) {
  const selected = new Date(`${date}T12:00:00`);
  const [year, setYear] = useState(selected.getFullYear());
  const [month, setMonth] = useState(selected.getMonth());
  useEffect(() => {
    if (!visible) return;
    const next = new Date(`${date}T12:00:00`);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  }, [visible, date]);
  const min = new Date(`${minDate}T12:00:00`);
  const firstWeekday = new Date(year, month, 1).getDay();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: lastDay }, (_, index) => index + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const monthStart = year * 12 + month;
  const minMonth = min.getFullYear() * 12 + min.getMonth();
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable style={styles.calBackdrop} onPress={onClose}>
        <Pressable style={styles.calCard} onPress={() => undefined}>
          <View style={styles.dateRow}>
            <Pressable
              disabled={monthStart <= minMonth}
              onPress={() => {
                if (month === 0) {
                  setYear(year - 1);
                  setMonth(11);
                } else setMonth(month - 1);
              }}
              style={[
                styles.dateChip,
                monthStart <= minMonth && styles.disabled,
              ]}
            >
              <Text style={styles.dateChipText}>‹</Text>
            </Pressable>
            <Text style={[styles.dateLabel, { flex: 1 }]}>{monthLabel}</Text>
            <Pressable
              onPress={() => {
                if (month === 11) {
                  setYear(year + 1);
                  setMonth(0);
                } else setMonth(month + 1);
              }}
              style={styles.dateChip}
            >
              <Text style={styles.dateChipText}>›</Text>
            </Pressable>
          </View>
          <View style={styles.calWeek}>
            {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
              <Text key={`${label}-${index}`} style={styles.calWeekday}>
                {label}
              </Text>
            ))}
          </View>
          <View style={styles.calGrid}>
            {cells.map((day, index) => {
              if (!day)
                return <View key={`empty-${index}`} style={styles.calDay} />;
              const iso = isoDay(year, month, day);
              const disabled = iso < minDate;
              const on = iso === date;
              return (
                <Pressable
                  key={iso}
                  disabled={disabled}
                  onPress={() => onSelect(iso)}
                  style={[
                    styles.calDay,
                    on && styles.calDayOn,
                    disabled && styles.disabled,
                  ]}
                >
                  <Text style={[styles.calDayText, on && styles.calDayTextOn]}>
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Action quiet onPress={onClose}>
            Close
          </Action>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function tenantDay(timezone?: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function ShareIcon({
  disabled,
  onPress,
}: {
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel="Share pickup list"
      disabled={disabled}
      onPress={onPress}
      style={[styles.iconBtn, disabled && styles.disabled]}
    >
      <View style={styles.shareGlyph}>
        <View style={styles.shareDot} />
        <View style={styles.shareArm} />
        <View style={[styles.shareDot, styles.shareDotRight]} />
        <View style={[styles.shareDot, styles.shareDotBottom]} />
      </View>
    </Pressable>
  );
}

function TourRow({
  item,
  status,
  statusWarn,
}: {
  item: BoardItem;
  status?: string;
  statusWarn?: boolean;
}) {
  return (
    <View style={styles.tourRow}>
      <View style={styles.coverClip}>
        <ProductCover path={item.cover_path} name={item.product_name} />
      </View>
      <View style={styles.tourBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.product_name}
        </Text>
        <Text style={styles.muted}>
          {new Date(item.starts_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          · {occupancyLabel(item)}
        </Text>
        {status ? (
          <Text style={statusWarn ? styles.warn : styles.muted} numberOfLines={2}>
            {status}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function DayBoard({
  board,
  busy,
  onOpen,
  onWalkUp,
  onWeather,
  onShare,
  onRefresh,
  onKiosk,
}: {
  board: BoardPayload;
  busy: boolean;
  onOpen: (item: BoardItem) => void;
  onWalkUp: (item: BoardItem) => void;
  onWeather: (item: BoardItem) => void;
  onShare: (item: BoardItem) => void;
  onRefresh: () => void;
  onKiosk?: () => void;
}) {
  const compactShare = useWindowDimensions().width < TABLET_MIN_WIDTH;
  return (
    <View style={styles.stack}>
      {onKiosk ? (
        <Action quiet disabled={busy} onPress={onKiosk}>
          Guest kiosk
        </Action>
      ) : null}
      <Text style={styles.muted}>
        {board.items.length
          ? `${board.items.length} departures · ${board.date}`
          : `No departures on ${board.date}.`}
      </Text>
      {board.items.map((item) => {
        const closed = item.operational_status !== "open";
        const left = tripRunLeft(item.trip_run_state);
        const remaining = item.capacity - item.committed;
        const walkInClosed = closed || left || remaining < 1;
        const status = [
          operationalLabel(item.operational_status),
          item.operational_reason,
          left
            ? "trip has left"
            : item.trip_run_state
              ? item.trip_run_state.replace(/_/g, " ")
              : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <View style={styles.card} key={item.id}>
            <TourRow item={item} status={status} statusWarn={closed || left} />
            <Text style={styles.muted}>
              {item.boarded_guests} boarded · {item.boarding_pending} pending
            </Text>
            {item.crew.length ? (
              <Text style={styles.muted}>
                Crew ·{" "}
                {item.crew
                  .map((member) => `${member.name} (${member.assignment_role})`)
                  .join(" · ")}
              </Text>
            ) : (
              <Text style={styles.warn}>No crew assigned</Text>
            )}
            <View style={styles.actions}>
              <Action disabled={busy} onPress={() => onOpen(item)}>
                Boarding
              </Action>
              {board.capabilities.walkUp && !walkInClosed ? (
                <Action disabled={busy} onPress={() => onWalkUp(item)}>
                  Walk-in
                </Action>
              ) : null}
              {board.capabilities.weather ? (
                <Action quiet disabled={busy} onPress={() => onWeather(item)}>
                  Weather
                </Action>
              ) : null}
              {board.capabilities.print ? (
                compactShare ? (
                  <ShareIcon disabled={busy} onPress={() => onShare(item)} />
                ) : (
                  <Action quiet disabled={busy} onPress={() => onShare(item)}>
                    Share PDF
                  </Action>
                )
              ) : null}
            </View>
            {board.capabilities.walkUp && walkInClosed ? (
              <Text style={styles.warn}>
                {left
                  ? "Walk-in closed · this trip has left"
                  : closed
                    ? "Walk-in closed"
                    : "Walk-in closed · no seats"}
              </Text>
            ) : null}
          </View>
        );
      })}
      <Action quiet disabled={busy} onPress={onRefresh}>
        Refresh board
      </Action>
    </View>
  );
}

export function tripsToBookItems(trips: Trip[]): BoardItem[] {
  return trips.map((trip) => {
    const guests = trip.guests.reduce((sum, guest) => sum + guest.party_size, 0);
    return {
      id: trip.id,
      starts_at: trip.starts_at,
      product_name: trip.product_name,
      cover_path: trip.cover_path,
      categories: FALLBACK_CATEGORIES,
      capacity: Math.max(guests, 1),
      committed: guests,
      confirmed_guests: guests,
      boarded_guests: trip.boarded_guests ?? 0,
      boarding_pending: trip.boarding_pending ?? 0,
      operational_status: trip.operational_status ?? "open",
      operational_reason: null,
      operational_version: 0,
      trip_run_state: trip.trip_run_state ?? null,
      crew: [],
    };
  });
}

export function BookBoard({
  items,
  date,
  minDate,
  busy,
  onDateChange,
  onBook,
}: {
  items: BoardItem[];
  date: string;
  minDate: string;
  busy: boolean;
  onDateChange: (date: string) => void;
  onBook: (item: BoardItem) => void;
}) {
  const open = items.filter(
    (item) =>
      item.operational_status === "open" && !tripRunLeft(item.trip_run_state),
  );
  const [calendarOpen, setCalendarOpen] = useState(false);
  const prev = shiftDay(date, -1);
  const next = shiftDay(date, 1);
  return (
    <View style={styles.stack}>
      <View style={styles.dateRow}>
        <Pressable
          disabled={busy || prev < minDate}
          onPress={() => onDateChange(prev)}
          style={[
            styles.dateChip,
            (busy || prev < minDate) && styles.disabled,
          ]}
        >
          <Text style={styles.dateChipText}>‹</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Choose booking date"
          disabled={busy}
          onPress={() => setCalendarOpen(true)}
          style={[styles.dateLabelHit, busy && styles.disabled]}
        >
          <Text style={styles.dateLabel} numberOfLines={2}>
            {formatBoardDate(date)}
          </Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => onDateChange(next)}
          style={[styles.dateChip, busy && styles.disabled]}
        >
          <Text style={styles.dateChipText}>›</Text>
        </Pressable>
      </View>
      <BookCalendar
        date={date}
        minDate={minDate}
        visible={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        onSelect={(nextDate) => {
          setCalendarOpen(false);
          if (nextDate !== date) onDateChange(nextDate);
        }}
      />
      <Text style={styles.muted}>
        Book a guest onto an open trip. Owner and admin see every departure on
        the selected day.
      </Text>
      {!open.length ? (
        <Text style={styles.muted}>No open trips to sell on this date.</Text>
      ) : (
        open.map((item) => {
          const remaining = Math.max(0, item.capacity - item.committed);
          return (
            <View style={styles.card} key={item.id}>
              <TourRow item={item} />
              <Text style={styles.muted}>{remaining} seats left</Text>
              <View style={[styles.actions, styles.actionsEnd]}>
                <Action
                  disabled={busy || remaining < 1}
                  onPress={() => onBook(item)}
                >
                  Book
                </Action>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

export function WeatherSheet({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: BoardItem;
  busy: boolean;
  onClose: () => void;
  onSave: (status: "open" | "weather_hold" | "closed", reason: string) => void;
}) {
  const [reason, setReason] = useState(item.operational_reason ?? "");
  const next =
    item.operational_status === "open"
      ? ([
          ["weather_hold", "Weather hold"],
          ["closed", "Close"],
        ] as const)
      : ([["open", "Reopen"]] as const);
  return (
    <View style={styles.stack}>
      <Text style={styles.muted}>
        {operationalLabel(item.operational_status)}. Give a reason for the audit
        trail.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Reason"
        value={reason}
        onChangeText={setReason}
      />
      {next.map(([status, label]) => (
        <Action
          key={status}
          disabled={busy || reason.trim().length < 1}
          onPress={() => onSave(status, reason.trim())}
        >
          {label}
        </Action>
      ))}
      <Action quiet onPress={onClose}>
        Cancel
      </Action>
    </View>
  );
}

function Accordion({
  title,
  hint,
  badge = "Optional",
  open,
  onToggle,
  children,
}: {
  title: string;
  hint?: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.accordion}>
      <Pressable onPress={onToggle} style={styles.accordionHead}>
        <View style={styles.accordionCopy}>
          <Text style={styles.accordionTitle}>{title}</Text>
          {hint ? (
            <Text style={styles.accordionHint} numberOfLines={2}>
              {hint}
            </Text>
          ) : null}
        </View>
        <Text style={styles.accordionBadge}>{badge}</Text>
        <Text style={styles.accordionChevron}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      {open ? <View style={styles.accordionBody}>{children}</View> : null}
    </View>
  );
}

function amountToMinor(value: string) {
  const amount = Number.parseFloat(value.replace(/,/g, "").trim());
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
}

function SelectField({
  label,
  value,
  placeholder,
  onPress,
  compact = false,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <View style={compact ? styles.fieldThird : styles.fieldHalf}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable onPress={onPress} style={styles.select}>
        <Text
          numberOfLines={1}
          style={value ? styles.selectValue : styles.selectPlaceholder}
        >
          {value || placeholder || "Select"}
        </Text>
        <Text style={styles.selectCaret}>▾</Text>
      </Pressable>
    </View>
  );
}

function partySeats(
  party: Record<string, number>,
  categories: PartyCategory[],
) {
  return categories.reduce((sum, category) => {
    if (!category.countsTowardCapacity) return sum;
    return sum + (party[category.slug] ?? 0);
  }, 0);
}

function initialParty(categories: PartyCategory[]) {
  const party: Record<string, number> = {};
  for (const category of categories) party[category.slug] = 0;
  const first =
    categories.find((category) => category.countsTowardCapacity) ??
    categories[0];
  if (first) party[first.slug] = 1;
  return party;
}

export function WalkUpSheet({
  item,
  busy,
  methods,
  held,
  error,
  pickupLocations,
  accommodations,
  vessels,
  allowUnresolvedPickup: _allowUnresolvedPickup,
  currency,
  onClose,
  onCreate,
  onPay,
}: {
  item: BoardItem;
  busy: boolean;
  methods: string[];
  held: { bookingId: string; quote: WalkUpQuote } | null;
  error?: string;
  pickupLocations: PickupLocationOption[];
  accommodations: StayOption[];
  vessels: StayOption[];
  allowUnresolvedPickup?: boolean;
  currency?: string | null;
  onClose: () => void;
  onCreate: (input: {
    party: Record<string, number>;
    leadName: string;
    leadEmail: string;
    leadPhone: string;
    guestNames: string[];
    pickup: Record<string, string>;
    stay: Record<string, string>;
    emergencyContact?: { name: string; phone: string; relationship: string };
    concession?: { discountMinor: number; reason: string; promoCode?: string };
    collection: "now" | "tab" | "link";
    payment?: { method: string };
  }) => void;
  onPay: (input: { method: string; amountMinor: number }) => void;
}) {
  const categories = (item.categories?.length
    ? item.categories
    : FALLBACK_CATEGORIES
  ).map((category) => ({
    slug: category.slug,
    label: category.label || category.slug,
    countsTowardCapacity: category.countsTowardCapacity !== false,
  }));
  const remaining = Math.max(0, item.capacity - item.committed);
  const [party, setParty] = useState(() => initialParty(categories));
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [pickupKind, setPickupKind] = useState<"none" | "selected" | "unresolved">(
    "none",
  );
  const [location, setLocation] = useState("");
  const [pickupNote, setPickupNote] = useState("");
  const [stayKind, setStayKind] = useState<(typeof stayChoices)[number]["value"]>(
    "none",
  );
  const [stayReferenceId, setStayReferenceId] = useState("");
  const [stayName, setStayName] = useState("");
  const [stayNameOther, setStayNameOther] = useState(false);
  const [stayDetail, setStayDetail] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [emergencyRelationship, setEmergencyRelationship] = useState("");
  const [emergencyRelationshipOther, setEmergencyRelationshipOther] =
    useState(false);
  const [extraNames, setExtraNames] = useState<string[]>([]);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [collection, setCollection] = useState<"now" | "tab" | "link">("now");
  const [method, setMethod] = useState(methods[0] ?? "cash");
  const [openGuests, setOpenGuests] = useState(false);
  const [openPickup, setOpenPickup] = useState(false);
  const [openDiscount, setOpenDiscount] = useState(false);
  const [picker, setPicker] = useState<
    | { kind: "party"; slug: string }
    | { kind: "pickup" }
    | { kind: "location" }
    | { kind: "stay" }
    | { kind: "stayName" }
    | { kind: "relationship" }
    | { kind: "method" }
    | { kind: "collection" }
    | null
  >(null);
  useEffect(() => {
    setParty(initialParty(categories));
    setPickupKind("none");
    setLocation("");
    setStayKind("none");
    setStayReferenceId("");
    setStayName("");
    setStayNameOther(false);
    setStayDetail("");
    setEmergencyName("");
    setEmergencyPhone("");
    setEmergencyRelationship("");
    setEmergencyRelationshipOther(false);
    setExtraNames([]);
    setDiscountAmount("");
    setDiscountReason("");
    setPromoCode("");
    setCollection("now");
    setOpenGuests(false);
    setOpenPickup(false);
    setOpenDiscount(false);
    stayPickupMatchRef.current = null;
  }, [item.id]);
  const stayPickupMatchRef = useRef<string | null>(null);
  useEffect(() => {
    if (stayKind !== "hotel" || pickupKind !== "selected") return;
    const match = matchStayPickupLocation(stayName, pickupLocations);
    if (!match) return;
    setLocation((current) => {
      if (!current || current === stayPickupMatchRef.current) {
        stayPickupMatchRef.current = match;
        return match;
      }
      return current;
    });
  }, [stayKind, stayName, pickupKind, pickupLocations]);
  const seats = partySeats(party, categories);
  const guestTotal = Object.values(party).reduce(
    (sum, count) => sum + count,
    0,
  );
  const extraCount = Math.max(0, guestTotal - 1);
  const extras = Array.from(
    { length: extraCount },
    (_, index) => extraNames[index] ?? "",
  );
  const pickupOptions = [
    { value: "none", label: "No pickup needed" },
    { value: "selected", label: "Requested pickup" },
  ];
  const collectionOptions = [
    { value: "now", label: "Pay now" },
    { value: "tab", label: "Tab — pay later" },
    { value: "link", label: "Payment link (Stripe)" },
  ];
  const stayNameOptions =
    stayKind === "hotel"
      ? [
          ...accommodations.map((item) => ({
            value: item.id,
            label: item.name,
          })),
          { value: STAY_NAME_OTHER, label: "Other" },
        ]
      : stayKind === "cruise"
        ? [
            { value: "", label: "Not recorded" },
            ...vessels.map((item) => ({ value: item.id, label: item.name })),
            { value: STAY_NAME_OTHER, label: "Other" },
          ]
        : [];
  const relationshipOptions = [
    ...EMERGENCY_RELATIONSHIPS.map((item) => ({ value: item, label: item })),
    {
      value: EMERGENCY_RELATIONSHIP_OTHER,
      label: EMERGENCY_RELATIONSHIP_OTHER,
    },
  ];
  const payMethods = methods.filter(
    (value) => value !== "online" && value !== "reseller_payment",
  );
  const discountMinor = amountToMinor(discountAmount);
  const discountReady = discountMinor < 1 || discountReason.trim().length >= 3;
  const stayReady =
    stayKind === "none" ||
    stayKind === "local" ||
    (stayKind === "cruise" && (stayNameOther ? stayName.trim().length > 0 : true)) ||
    (stayKind === "hotel" && stayName.trim().length > 0) ||
    (stayKind === "private_accommodation" &&
      stayName.trim().length > 0 &&
      stayDetail.trim().length > 0);
  const pickupReady =
    pickupKind === "none" ||
    (pickupKind === "selected" && location.length > 0) ||
    (pickupKind === "unresolved" && pickupNote.trim().length > 0);
  const emergencyPartial = Boolean(
    emergencyName.trim() ||
      emergencyPhone.trim() ||
      emergencyRelationship.trim() ||
      emergencyRelationshipOther,
  );
  const emergencyReady =
    !emergencyPartial ||
    Boolean(
      emergencyName.trim() &&
        emergencyPhone.trim() &&
        emergencyRelationship.trim(),
    );
  const guestsReady = Object.values(party).some((count) => count > 0);
  if (held) {
    return (
      <View style={styles.stack}>
        <Text style={styles.muted}>
          {formatMoney(held.quote.totalMinor, held.quote.currency)} due before
          this booking can confirm.
        </Text>
        {error ? <Text style={styles.warn}>{error}</Text> : null}
        <SelectField
          label="Payment method"
          value={paymentMethodLabel(method)}
          onPress={() => setPicker({ kind: "method" })}
        />
        <Action
          disabled={busy}
          onPress={() => onPay({ method, amountMinor: held.quote.totalMinor })}
        >
          {busy ? "Recording…" : "Record cash / manual"}
        </Action>
        <Action quiet onPress={onClose}>
          Cancel
        </Action>
        <OptionSheet
          title="Payment method"
          visible={picker?.kind === "method"}
          options={payMethods.map((value) => ({
            value,
            label: paymentMethodLabel(value),
          }))}
          selected={method}
          onSelect={setMethod}
          onClose={() => setPicker(null)}
        />
      </View>
    );
  }
  const pickerOptions =
    picker?.kind === "party"
      ? Array.from(
          {
            length:
              (categories.find((category) => category.slug === picker.slug)
                ?.countsTowardCapacity
                ? Math.max(
                    0,
                    remaining -
                      seats +
                      (party[picker.slug] ?? 0),
                  )
                : 8) + 1,
          },
          (_, count) => ({ value: String(count), label: String(count) }),
        )
      : picker?.kind === "pickup"
        ? pickupOptions
        : picker?.kind === "location"
          ? pickupLocations.map((stop) => ({
              value: stop.name,
              label: stop.name,
            }))
          : picker?.kind === "stay"
            ? stayChoices.map((choice) => ({
                value: choice.value,
                label: choice.label,
              }))
            : picker?.kind === "stayName"
              ? stayNameOptions
              : picker?.kind === "relationship"
                ? relationshipOptions
                : picker?.kind === "collection"
                  ? collectionOptions
                  : picker?.kind === "method"
                    ? payMethods.map((value) => ({
                        value,
                        label: paymentMethodLabel(value),
                      }))
                    : [];
  return (
    <View style={styles.stack}>
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      <Text style={styles.sectionTitle}>Party</Text>
      <View style={styles.partyRow}>
        {categories.map((category) => (
          <SelectField
            key={category.slug}
            compact
            label={category.label}
            value={String(party[category.slug] ?? 0)}
            onPress={() => setPicker({ kind: "party", slug: category.slug })}
          />
        ))}
      </View>
      <Text style={styles.muted}>
        {seats} seat{seats === 1 ? "" : "s"} of {remaining} remaining
      </Text>
      <Text style={styles.sectionTitle}>Lead guest</Text>
      <View style={styles.formGrid}>
        <View style={styles.fieldHalf}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Name as on the waiver"
            value={leadName}
            onChangeText={setLeadName}
          />
        </View>
        <View style={styles.fieldHalf}>
          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="guest@email.com"
            value={leadEmail}
            onChangeText={setLeadEmail}
          />
        </View>
        <View style={styles.fieldHalf}>
          <Text style={styles.fieldLabel}>Phone</Text>
          <TextInput
            style={styles.input}
            keyboardType="phone-pad"
            placeholder="Optional"
            value={leadPhone}
            onChangeText={setLeadPhone}
          />
        </View>
      </View>
      {extraCount ? (
        <Accordion
          title="Other guests"
          hint="Names can wait for the waiver"
          open={openGuests}
          onToggle={() => setOpenGuests((value) => !value)}
        >
          <View style={styles.formGrid}>
            {extras.map((name, index) => (
              <View style={styles.fieldHalf} key={`guest-${index}`}>
                <Text style={styles.fieldLabel}>Guest {index + 2}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Optional"
                  value={name}
                  onChangeText={(value) => {
                    const next = [...extras];
                    next[index] = value;
                    setExtraNames(next);
                  }}
                />
              </View>
            ))}
          </View>
        </Accordion>
      ) : null}
      <Accordion
        title="Stay and pickup"
        hint={
          pickupKind === "none" && stayKind === "none"
            ? "No stay · no pickup"
            : `${stayChoiceLabel(stayKind)} · ${
                pickupOptions.find((option) => option.value === pickupKind)
                  ?.label ?? "Pickup"
              }`
        }
        open={openPickup}
        onToggle={() => setOpenPickup((value) => !value)}
      >
        <SelectField
          label="Stay"
          value={stayChoiceLabel(stayKind)}
          onPress={() => setPicker({ kind: "stay" })}
        />
        {stayKind === "cruise" || stayKind === "hotel" ? (
          <View style={styles.formGrid}>
            <View style={styles.fieldHalf}>
              <SelectField
                label={stayKind === "cruise" ? "Vessel (optional)" : "Hotel"}
                value={
                  stayNameOther
                    ? "Other"
                    : stayName ||
                      (stayKind === "cruise" ? "Not recorded" : "Choose hotel")
                }
                placeholder={
                  stayKind === "cruise" ? "Not recorded" : "Choose hotel"
                }
                onPress={() => setPicker({ kind: "stayName" })}
              />
              {stayNameOther ? (
                <TextInput
                  style={styles.input}
                  placeholder={
                    stayKind === "cruise" ? "Ship name" : "Hotel name"
                  }
                  value={stayName}
                  onChangeText={setStayName}
                />
              ) : null}
            </View>
            <View style={styles.fieldHalf}>
              <Text style={styles.fieldLabel}>
                {stayKind === "cruise" ? "Cabin" : "Room"}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Optional"
                value={stayDetail}
                onChangeText={setStayDetail}
              />
            </View>
          </View>
        ) : null}
        {stayKind === "private_accommodation" || stayKind === "local" ? (
          <View style={styles.formGrid}>
            {stayKind === "private_accommodation" ? (
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Property</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Property name"
                  value={stayName}
                  onChangeText={setStayName}
                />
              </View>
            ) : null}
            <View style={styles.fieldHalf}>
              <Text style={styles.fieldLabel}>Address</Text>
              <TextInput
                style={styles.input}
                placeholder={
                  stayKind === "local" ? "Optional" : "Collection address"
                }
                value={stayDetail}
                onChangeText={setStayDetail}
              />
            </View>
          </View>
        ) : null}
        <View style={styles.formGrid}>
          <SelectField
            label="Pickup"
            value={
              pickupOptions.find((option) => option.value === pickupKind)
                ?.label ?? "No pickup needed"
            }
            onPress={() => setPicker({ kind: "pickup" })}
          />
          {pickupKind === "selected" ? (
            <SelectField
              label="Location"
              value={location}
              placeholder="Select a stop"
              onPress={() => setPicker({ kind: "location" })}
            />
          ) : null}
        </View>
        {pickupKind === "unresolved" ? (
          <View style={styles.fieldHalf}>
            <Text style={styles.fieldLabel}>Pickup note</Text>
            <TextInput
              style={styles.input}
              placeholder="Where to collect this guest"
              value={pickupNote}
              onChangeText={setPickupNote}
            />
          </View>
        ) : null}
        <Text style={styles.muted}>
          Emergency contact is optional. If any field is entered, complete all
          three.
        </Text>
        <View style={styles.formGrid}>
          <View style={styles.fieldHalf}>
            <Text style={styles.fieldLabel}>Emergency name</Text>
            <TextInput
              style={styles.input}
              placeholder="Optional"
              value={emergencyName}
              onChangeText={setEmergencyName}
            />
          </View>
          <View style={styles.fieldHalf}>
            <Text style={styles.fieldLabel}>Emergency phone</Text>
            <TextInput
              style={styles.input}
              keyboardType="phone-pad"
              placeholder="Optional"
              value={emergencyPhone}
              onChangeText={setEmergencyPhone}
            />
          </View>
        </View>
        <SelectField
          label="Relationship"
          value={
            emergencyRelationshipOther
              ? EMERGENCY_RELATIONSHIP_OTHER
              : emergencyRelationship || "Select"
          }
          placeholder="Select"
          onPress={() => setPicker({ kind: "relationship" })}
        />
        {emergencyRelationshipOther ? (
          <View style={styles.fieldHalf}>
            <Text style={styles.fieldLabel}>Other relationship</Text>
            <TextInput
              style={styles.input}
              placeholder="Describe the relationship"
              value={emergencyRelationship}
              onChangeText={setEmergencyRelationship}
            />
          </View>
        ) : null}
      </Accordion>
      <Accordion
        title="Discount"
        hint={
          discountMinor
            ? `${currency ?? ""} ${discountAmount} off`
            : "Staff concession on this booking"
        }
        open={openDiscount}
        onToggle={() => setOpenDiscount((value) => !value)}
      >
        <View style={styles.formGrid}>
          <View style={styles.fieldHalf}>
            <Text style={styles.fieldLabel}>
              Amount{currency ? ` · ${currency}` : ""}
            </Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              placeholder="0.00"
              value={discountAmount}
              onChangeText={setDiscountAmount}
            />
          </View>
          <View style={styles.fieldHalf}>
            <Text style={styles.fieldLabel}>Promo code</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="characters"
              placeholder="Optional"
              value={promoCode}
              onChangeText={setPromoCode}
            />
          </View>
          <View style={styles.fieldHalf}>
            <Text style={styles.fieldLabel}>Reason</Text>
            <TextInput
              style={styles.input}
              placeholder={discountMinor ? "Required" : "If discounted"}
              value={discountReason}
              onChangeText={setDiscountReason}
            />
          </View>
        </View>
      </Accordion>
      <Text style={styles.sectionTitle}>Payment</Text>
      <View style={styles.formGrid}>
        <SelectField
          label="Collection"
          value={
            collectionOptions.find((option) => option.value === collection)
              ?.label ?? "Pay now"
          }
          onPress={() => setPicker({ kind: "collection" })}
        />
        {collection === "now" ? (
          <SelectField
            label="Method"
            value={paymentMethodLabel(method)}
            onPress={() => setPicker({ kind: "method" })}
          />
        ) : null}
      </View>
      {collection === "tab" ? (
        <Text style={styles.muted}>
          Confirms the booking with the balance due. Collect at boarding or
          later.
        </Text>
      ) : null}
      {collection === "link" ? (
        <Text style={styles.warn}>
          Stripe Connect Checkout is not live yet. Use Pay now or Tab until
          online collection is enabled.
        </Text>
      ) : null}
      <Action
        disabled={
          busy ||
          !leadName.trim() ||
          !leadEmail.trim() ||
          !guestsReady ||
          seats > remaining ||
          !pickupReady ||
          !stayReady ||
          !emergencyReady ||
          !discountReady ||
          collection === "link"
        }
        onPress={() =>
          onCreate({
            party,
            leadName: leadName.trim(),
            leadEmail: leadEmail.trim(),
            leadPhone: leadPhone.trim(),
            guestNames: extras,
            pickup:
              pickupKind === "selected"
                ? {
                    kind: "selected",
                    location,
                    instructions: "",
                  }
                : pickupKind === "unresolved"
                  ? { kind: "unresolved", note: pickupNote.trim() }
                  : { kind: "none" },
            stay:
              stayKind === "cruise"
                ? {
                    kind: "cruise",
                    ...(stayReferenceId
                      ? { vesselId: stayReferenceId }
                      : {}),
                    ...(stayName.trim() ? { vesselName: stayName.trim() } : {}),
                    cabinNumber: stayDetail.trim(),
                  }
                : stayKind === "hotel"
                  ? {
                      kind: "hotel",
                      ...(stayReferenceId
                        ? { accommodationId: stayReferenceId }
                        : {}),
                      hotelName: stayName.trim(),
                      roomNumber: stayDetail.trim(),
                    }
                  : stayKind === "private_accommodation"
                    ? {
                        kind: "private_accommodation",
                        propertyName: stayName.trim(),
                        address: stayDetail.trim(),
                      }
                    : stayKind === "local"
                      ? { kind: "local", address: stayDetail.trim() }
                      : { kind: "none" },
            ...(emergencyPartial
              ? {
                  emergencyContact: {
                    name: emergencyName.trim(),
                    phone: emergencyPhone.trim(),
                    relationship: emergencyRelationship.trim(),
                  },
                }
              : {}),
            ...(discountMinor
              ? {
                  concession: {
                    discountMinor,
                    reason: discountReason.trim(),
                    ...(promoCode.trim() ? { promoCode: promoCode.trim() } : {}),
                  },
                }
              : {}),
            collection,
            ...(collection === "now" ? { payment: { method } } : {}),
          })
        }
      >
        {busy
          ? "Saving…"
          : collection === "tab"
            ? "Book on tab"
            : collection === "now"
              ? "Collect and confirm"
              : "Hold and confirm"}
      </Action>
      <Action quiet onPress={onClose}>
        Cancel
      </Action>
      <OptionSheet
        title={
          picker?.kind === "party"
            ? (categories.find((category) => category.slug === picker.slug)
                ?.label ?? "Guests")
            : picker?.kind === "pickup"
              ? "Pickup"
              : picker?.kind === "location"
                ? "Pickup location"
                : picker?.kind === "stay"
                  ? "Stay"
                  : picker?.kind === "stayName"
                    ? stayKind === "cruise"
                      ? "Vessel"
                      : "Hotel"
                    : picker?.kind === "relationship"
                      ? "Relationship"
                      : picker?.kind === "collection"
                        ? "Collection"
                        : picker?.kind === "method"
                          ? "Payment method"
                          : ""
        }
        visible={Boolean(picker)}
        options={pickerOptions}
        selected={
          picker?.kind === "party"
            ? String(party[picker.slug] ?? 0)
            : picker?.kind === "pickup"
              ? pickupKind
              : picker?.kind === "location"
                ? location
                : picker?.kind === "stay"
                  ? stayKind
                  : picker?.kind === "stayName"
                    ? stayNameOther
                      ? STAY_NAME_OTHER
                      : stayReferenceId
                    : picker?.kind === "relationship"
                      ? emergencyRelationshipOther
                        ? EMERGENCY_RELATIONSHIP_OTHER
                        : emergencyRelationship
                      : picker?.kind === "collection"
                        ? collection
                        : picker?.kind === "method"
                          ? method
                          : undefined
        }
        onSelect={(value) => {
          if (picker?.kind === "party")
            setParty((current) => ({
              ...current,
              [picker.slug]: Number(value),
            }));
          if (picker?.kind === "pickup") {
            setPickupKind(value as "none" | "selected" | "unresolved");
            if (value !== "selected") setLocation("");
          }
          if (picker?.kind === "location") setLocation(value);
          if (picker?.kind === "stay") {
            setStayKind(value as (typeof stayChoices)[number]["value"]);
            setStayReferenceId("");
            setStayName("");
            setStayNameOther(false);
            setStayDetail("");
          }
          if (picker?.kind === "stayName") {
            if (value === STAY_NAME_OTHER) {
              setStayNameOther(true);
              setStayReferenceId("");
              setStayName("");
            } else if (!value) {
              setStayNameOther(false);
              setStayReferenceId("");
              setStayName("");
            } else {
              setStayNameOther(false);
              setStayReferenceId(value);
              const match =
                stayKind === "hotel"
                  ? accommodations.find((item) => item.id === value)
                  : vessels.find((item) => item.id === value);
              setStayName(match?.name ?? "");
            }
          }
          if (picker?.kind === "relationship") {
            if (value === EMERGENCY_RELATIONSHIP_OTHER) {
              setEmergencyRelationshipOther(true);
              if (
                (EMERGENCY_RELATIONSHIPS as readonly string[]).includes(
                  emergencyRelationship,
                )
              ) {
                setEmergencyRelationship("");
              }
            } else {
              setEmergencyRelationshipOther(false);
              setEmergencyRelationship(value);
            }
          }
          if (picker?.kind === "collection")
            setCollection(value as "now" | "tab" | "link");
          if (picker?.kind === "method") setMethod(value);
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

function bytesToBase64(bytes: ArrayBuffer) {
  const u8 = new Uint8Array(bytes);
  const chunk = 0x2000;
  let binary = "";
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function sharePdfFile(filename: string, bytes: ArrayBuffer) {
  const directory = FileSystem.cacheDirectory;
  if (!directory)
    throw new Error("This device cannot save a PDF to share.");
  const safe = filename.replace(/[^\w.-]+/g, "_") || "document.pdf";
  const uri = `${directory}${safe}`;
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: filename,
    });
    return;
  }
  await Share.share({ url: uri, title: filename });
}

export async function sharePickupText(productName: string, body: string) {
  await Share.share({ title: `${productName} pickup list`, message: body });
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  card: {
    backgroundColor: "white",
    borderColor: "#dce7e4",
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  tourRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  coverClip: { borderRadius: 12, overflow: "hidden" },
  tourBody: { flex: 1, gap: 4, minWidth: 0 },
  cardTitle: { color: "#17353a", fontSize: 18, fontWeight: "800" },
  dateRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
  },
  dateChip: {
    backgroundColor: "#e7f1ef",
    borderRadius: 12,
    minWidth: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dateChipText: {
    color: "#17353a",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  dateLabelHit: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  dateLabel: {
    color: "#17353a",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  calBackdrop: {
    backgroundColor: "rgba(6,31,35,0.45)",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  calCard: {
    alignSelf: "center",
    backgroundColor: "white",
    borderRadius: 20,
    gap: 12,
    maxWidth: 440,
    padding: 18,
    width: "100%",
  },
  calWeek: { flexDirection: "row" },
  calWeekday: {
    color: "#5b7478",
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  calGrid: { flexDirection: "row", flexWrap: "wrap" },
  calDay: {
    alignItems: "center",
    aspectRatio: 1,
    justifyContent: "center",
    width: "14.28%",
  },
  calDayOn: {
    backgroundColor: "#087b72",
    borderRadius: 999,
  },
  calDayText: { color: "#17353a", fontWeight: "700" },
  calDayTextOn: { color: "white" },
  iconBtn: {
    alignItems: "center",
    backgroundColor: "#e7f1ef",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  shareGlyph: { height: 16, width: 16 },
  shareDot: {
    backgroundColor: "#17353a",
    borderRadius: 3,
    height: 5,
    left: 0,
    position: "absolute",
    top: 0,
    width: 5,
  },
  shareDotRight: { left: 11, top: 5 },
  shareDotBottom: { left: 0, top: 11 },
  shareArm: {
    backgroundColor: "#17353a",
    height: 2,
    left: 3,
    position: "absolute",
    top: 7,
    transform: [{ rotate: "-28deg" }],
    width: 12,
  },
  fieldLabel: {
    color: "#5b7478",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  sectionTitle: {
    color: "#17353a",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
    marginTop: 4,
  },
  formGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  accordion: {
    backgroundColor: "white",
    borderColor: "#dce7e4",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  accordionHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  accordionCopy: { flex: 1, gap: 2, minWidth: 0 },
  accordionTitle: { color: "#17353a", fontSize: 15, fontWeight: "800" },
  accordionHint: { color: "#5b7478", fontSize: 12, lineHeight: 16 },
  accordionBadge: {
    color: "#087b72",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  accordionChevron: { color: "#17353a", fontSize: 16, fontWeight: "800" },
  accordionBody: { gap: 10, paddingBottom: 12, paddingHorizontal: 12 },
  partyRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fieldHalf: { flexGrow: 1, flexBasis: 148, gap: 6, minWidth: 148 },
  fieldThird: { flexGrow: 1, flexBasis: "30%", gap: 6, minWidth: 0 },
  select: {
    alignItems: "center",
    backgroundColor: "white",
    borderColor: "#cbdad7",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectValue: { color: "#17353a", flex: 1, fontWeight: "600" },
  selectPlaceholder: { color: "#8aa0a3", flex: 1, fontWeight: "600" },
  selectCaret: { color: "#5b7478", fontWeight: "800", marginLeft: 8 },
  muted: { color: "#5b7478", lineHeight: 20 },
  warn: { color: "#b42318", fontWeight: "700", lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  actionsEnd: { justifyContent: "flex-end" },
  button: {
    backgroundColor: "#087b72",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonText: { color: "white", fontWeight: "700", textAlign: "center" },
  quiet: { backgroundColor: "#e7f1ef" },
  quietText: { color: "#17353a", textAlign: "center" },
  disabled: { opacity: 0.45 },
  input: {
    backgroundColor: "white",
    borderColor: "#cbdad7",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  choice: {
    borderColor: "#cbdad7",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  choiceSelected: { backgroundColor: "#087b72", borderColor: "#087b72" },
  choiceText: { color: "#17353a", fontWeight: "600" },
  choiceTextSelected: { color: "white", fontWeight: "700" },
});
