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

export function tripStarted(trip: Trip) {
  return ["departed", "completed", "cancelled"].includes(
    trip.trip_run_state ?? "",
  );
}
