export type Passenger = {
  id: string;
  name: string;
  category: string;
  is_minor: boolean;
  identity_pending: boolean;
  checkin_state: string | null;
  waiver_signed: boolean;
};
export type Stay = {
  kind?: string;
  vesselName?: string;
  hotelName?: string;
  propertyName?: string;
  cabinNumber?: string;
  roomNumber?: string;
  address?: string;
  allAboardAt?: string;
  all_aboard_at?: string;
};
export type PickupStop = {
  booking_id: string;
  sequence: number;
  pickup_at: string;
  location_name: string;
  lead_name: string;
  party_size: number;
  notes?: string | null;
};
export type PickupException = {
  booking_id: string;
  lead_name: string;
  pickup_kind: string;
  party_size: number;
};
export type Guest = {
  booking_id: string;
  lead_name: string;
  party_size: number;
  pickup: { kind?: string; location?: string; note?: string };
  stay: Stay;
  checkin_state: string;
  boarding_clearance?: "due" | "settled" | "partner";
  guest_balance_minor?: number;
  currency?: string;
  passengers: Passenger[];
};
export type Trip = {
  id: string;
  starts_at: string;
  product_name: string;
  cover_path?: string | null;
  assignment_roles: string[];
  operational_status?: string;
  trip_run_state?: string | null;
  boarded_guests?: number;
  no_show_guests?: number;
  boarding_pending?: number;
  pickup_stops?: PickupStop[];
  pickup_exceptions?: PickupException[];
  guests: Guest[];
};

const pickupLabels: Record<string, string> = {
  none: "no pickup",
  selected: "arranged pickup",
  unresolved: "pickup unresolved",
};
const stayLabels: Record<string, string> = {
  none: "Local / no stay",
  cruise: "Cruise",
  hotel: "Hotel",
  private_accommodation: "Private stay",
  local: "Local",
};

export function pickupLabel(kind?: string) {
  return pickupLabels[kind ?? "none"] ?? kind ?? "no pickup";
}

export function stayLabel(stay?: Stay) {
  const kind = stay?.kind ?? "none";
  const name =
    stay?.vesselName || stay?.hotelName || stay?.propertyName || stay?.address;
  const unit = stay?.cabinNumber || stay?.roomNumber;
  const base = stayLabels[kind] ?? kind;
  if (name && unit) return `${base} · ${name} · ${unit}`;
  if (name) return `${base} · ${name}`;
  return base;
}

export function allAboardLabel(stay?: Stay) {
  const value = stay?.allAboardAt ?? stay?.all_aboard_at;
  if (!value) return null;
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function clearanceLabel(guest: Guest) {
  if (guest.boarding_clearance === "partner") return "Partner settled";
  if (guest.boarding_clearance === "due") {
    const amount = guest.guest_balance_minor ?? 0;
    const currency = guest.currency ?? "USD";
    try {
      return `Balance due · ${new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
      }).format(amount / 100)}`;
    } catch {
      return `Balance due · ${currency} ${(amount / 100).toFixed(2)}`;
    }
  }
  return "Settled";
}

export function formatMoney(amountMinor: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

export function suggestedBoardingShare(
  balanceMinor: number,
  rosterCount: number,
) {
  if (balanceMinor <= 0) return 0;
  if (rosterCount <= 1) return balanceMinor;
  const share = Math.floor(balanceMinor / rosterCount);
  const lastShare = balanceMinor - share * (rosterCount - 1);
  return balanceMinor <= lastShare ? balanceMinor : share;
}

export function attributionPassenger(guest: Guest, passenger?: Passenger) {
  if (!passenger) return undefined;
  if (!passenger.is_minor) return passenger;
  return guest.passengers.find((person) => !person.is_minor) ?? passenger;
}

export function paymentMethodLabel(method: string) {
  return method.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type CrewMember = {
  assignment_role: string;
  name: string;
};
export type BoardCapabilities = {
  walkUp: boolean;
  weather: boolean;
  print: boolean;
  checkin: boolean;
};
export type PartyCategory = {
  slug: string;
  label: string;
  countsTowardCapacity: boolean;
};
export type PickupLocationOption = { id: string; name: string };
export type BoardItem = {
  id: string;
  starts_at: string;
  product_name: string;
  cover_path?: string | null;
  categories?: PartyCategory[];
  capacity: number;
  committed: number;
  confirmed_guests: number;
  boarded_guests: number;
  boarding_pending: number;
  operational_status: string;
  operational_reason: string | null;
  operational_version: number;
  trip_run_state: string | null;
  crew: CrewMember[];
};
export type BoardPayload = {
  date: string;
  capabilities: BoardCapabilities;
  items: BoardItem[];
  pickupLocations?: PickupLocationOption[];
  allowUnresolvedPickup?: boolean;
  paymentMethods?: string[];
  collectionCurrency?: string | null;
  waiverTemplate?: {
    id: string;
    version: number;
    title: string;
    body: string;
  } | null;
};
export type WalkUpQuote = {
  totalMinor: number;
  currency: string;
};
export const TABLET_MIN_WIDTH = 700;
export function matchStayPickupLocation(
  stayName: string,
  locations: { name: string }[],
) {
  const needle = stayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!needle) return null;
  const scored = locations
    .map((location) => {
      const hay = location.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!hay) return null;
      if (hay === needle) return { name: location.name, score: 3 };
      if (hay.includes(needle) || needle.includes(hay))
        return { name: location.name, score: 2 };
      return null;
    })
    .filter((row): row is { name: string; score: number } => Boolean(row));
  const exact = scored.find((row) => row.score === 3);
  if (exact) return exact.name;
  const contains = scored.filter((row) => row.score === 2);
  return contains.length === 1 ? contains[0].name : null;
}
export const FALLBACK_CATEGORIES: PartyCategory[] = [
  { slug: "adult", label: "Adult", countsTowardCapacity: true },
];

export function occupancyLabel(item: BoardItem) {
  return `${item.committed}/${item.capacity} seats · ${item.confirmed_guests} guests`;
}

export function operationalLabel(status?: string) {
  if (status === "weather_hold") return "Weather hold";
  if (status === "closed") return "Closed";
  return "Open";
}

export function guestMatchesQuery(guest: Guest, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    guest.lead_name,
    pickupLabel(guest.pickup?.kind),
    guest.pickup?.location,
    guest.pickup?.note,
    stayLabel(guest.stay),
    ...guest.passengers.map((person) => person.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

export function tripRunLeft(state?: string | null) {
  return ["departed", "completed", "cancelled"].includes(state ?? "");
}

export function tripStarted(trip: Trip) {
  return tripRunLeft(trip.trip_run_state);
}

export function assignedToPickups(roles: string[]) {
  return roles.some((role) =>
    /driver|skipper|pickup/i.test(role.replace(/[_/]/g, " ")),
  );
}

export function tripCountdown(startsAt: string, now = Date.now()) {
  const start = new Date(startsAt).getTime();
  if (!Number.isFinite(start)) return { label: "—", overdue: false };
  const diff = start - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1)
    return {
      label: diff >= 0 ? "Starting" : "Just started",
      overdue: diff < 0,
    };
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  const clock = hours > 0 ? `${hours}h ${rest}m` : `${mins}m`;
  return diff >= 0
    ? { label: `${clock} left`, overdue: false }
    : { label: `${clock} ago`, overdue: true };
}

const checkinLabels: Record<string, string> = {
  not_arrived: "Not arrived",
  arrived: "Arrived",
  waiver_pending: "Waiver needed",
  balance_pending: "Balance due",
  cleared_to_board: "Ready to board",
  boarded: "Boarded",
  no_show: "No-show",
};

export function checkinLabel(state?: string | null) {
  const value = state || "not_arrived";
  return checkinLabels[value] ?? value.replace(/_/g, " ");
}

export type PassengerAction =
  | { kind: "waiver"; label: string }
  | { kind: "arrived"; label: string }
  | { kind: "board"; label: string }
  | { kind: "pay"; label: string };

export function nextPassengerAction(
  passenger: Passenger,
  guest: Guest,
): PassengerAction | null {
  const state = passenger.checkin_state ?? "not_arrived";
  if (state === "boarded" || state === "no_show") return null;
  if (passenger.identity_pending)
    return { kind: "waiver", label: "Sign waiver" };
  if (state === "not_arrived") return { kind: "arrived", label: "Arrived" };
  if (guest.boarding_clearance === "due") return { kind: "pay", label: "Pay" };
  if (!passenger.waiver_signed)
    return { kind: "waiver", label: "Sign waiver" };
  return { kind: "board", label: "Board" };
}
