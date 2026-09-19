import type {
  TenantConfig,
  ProductInput,
  Quote,
} from "../../../packages/shared/src/contracts";
export type { TenantConfig, ProductInput, Quote };
export {
  EMERGENCY_RELATIONSHIP_OPTIONS,
  EMERGENCY_RELATIONSHIP_OTHER,
} from "../../../packages/shared/src/contracts";
export type Session = {
  actorId: string;
  actorName: string;
  actorEmail: string;
  actorPhone?: string | null;
  role: string;
  permissions: string[];
  supportAccess?: {
    id: string;
    purpose: string;
    permissions: string[];
    expires_at: string;
  } | null;
  tenant: {
    id: string;
    name: string;
    timezone: string;
    version: number;
    config: TenantConfig;
    is_mock: boolean;
    logo_path?: string | null;
    business_profile?: {
      displayName: string;
      streetAddress: string;
      suite: string;
      city: string;
      stateParish: string;
      postalCode: string;
      country: string;
      email: string;
      phone: string;
    };
    authorized_contact?: { name: string; email: string; phone: string };
  };
};
export type DemoTenant = { tenantId: string; name: string; email: string };
export type Product = {
  id: string;
  name: string;
  definition: ProductInput;
  version: number;
  internal_name?: string;
  customer_title?: string;
  description?: string;
  product_kind?: string;
  availability_mode?: string;
  status?: string;
  cover_path?: string | null;
  option_count?: number;
  price_from_minor?: number | null;
  next_departure_at?: string | null;
  availability_rule_count?: number;
};
export type AvailabilityRule = {
  id: string;
  name?: string;
  version?: number;
  mode: string;
  status: string;
  start_date: string;
  end_date: string;
  weekdays: number[];
  capacity: number | null;
  timezone: string;
  minimum_notice_minutes: number;
  cutoff_minutes: number;
  product_id?: string;
  product_name: string;
  product_availability_mode?: string;
  option_name: string;
  times: string[];
  blackouts?: string[];
  upcoming_departures: number;
  departures?: {
    id: string;
    starts_at: string;
    capacity: number;
    committed: number;
    available: number;
    status: string;
  }[];
};
export const availabilityModes = {
  fixed_departure: {
    label: "Scheduled departures",
    bookable: true,
    summary:
      "Choose a date and start time. Seats are held from live departure inventory.",
  },
  opening_hours: {
    label: "Opening hours",
    bookable: false,
    summary:
      "Timed entry or daily capacity. This flow will not pretend those products are shared departures.",
  },
  open_dated: {
    label: "Open dated",
    bookable: false,
    summary:
      "Issued as a voucher or redemption window. Dated seat holds are not the inventory primitive.",
  },
  on_request: {
    label: "On request",
    bookable: false,
    summary:
      "Quote or accept later. No seat is reserved until the request is accepted.",
  },
  resource_window: {
    label: "Resource window",
    bookable: false,
    summary:
      "Holds an exclusive vessel, vehicle, or crew for a duration. Not a shared-tour seat pool.",
  },
} as const;
export type AvailabilityMode = keyof typeof availabilityModes;
export function modeLabel(mode?: string) {
  return (
    availabilityModes[mode as AvailabilityMode]?.label ??
    (mode ? mode.replaceAll("_", " ") : availabilityModes.fixed_departure.label)
  );
}
export const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export type Departure = {
  id: string;
  product_id: string;
  product_name: string;
  availability_mode?: string;
  product_kind?: string;
  option_name: string;
  duration_minutes: number | null;
  starts_at: string;
  capacity: number;
  committed: number;
  overbooked?: number;
  held?: number;
  available: number;
  status?: string;
  categories: ProductInput["categories"];
};
export type Reservation = {
  id: string;
  departure_id: string;
  lead_name: string;
  source: string;
  state: string;
  version: number;
  starts_at: string;
  created_at?: string;
  product_name: string;
  party: Record<string, number>;
  currency: string;
  total_minor: number;
  paid_minor: number;
  pickup: Pickup;
};
export type Pickup =
  | { kind: "none" }
  | { kind: "unresolved"; note: string }
  | { kind: "selected"; location: string; instructions: string };
export type Booking = {
  id: string;
  customer_id: string;
  departure_id: string;
  lead_name: string;
  lead_email: string;
  purchaser: { name: string; email: string; phone: string };
  emergency_contact: { name?: string; phone?: string; relationship?: string };
  source: string;
  state: string;
  version: number;
  party: Record<string, number>;
  pickup: Pickup;
  stay?:
    | { kind: "none" }
    | {
        kind: "cruise";
        vesselName?: string;
        cabinNumber?: string;
        vesselId?: string;
      }
    | {
        kind: "hotel";
        hotelName: string;
        roomNumber?: string;
        accommodationId?: string;
      }
    | {
        kind: "private_accommodation";
        propertyName: string;
        address: string;
      }
    | { kind: "local"; address?: string };
  quote: Quote;
  paidMinor: number;
  payments: {
    id: string;
    amount_minor: number;
    currency: string;
    method: string;
    status: "settled" | "pending";
    reference: string;
    reason: string;
    occurred_at: string;
    passenger_id?: string | null;
    passenger_name?: string | null;
    adjustment_id: string | null;
    adjustment_kind: "void" | "reversal" | null;
    adjustment_reference: string | null;
    adjustment_reason: string | null;
    adjustment_occurred_at: string | null;
  }[];
  partnerCreditMinor?: number;
  hasPartnerSnapshot?: boolean;
  partner?: {
    partnerId: string;
    partnerName: string;
    externalReference: string;
    collectionMode:
      "guest_pays_tenant" | "partner_collects_for_tenant" | "partner_invoice";
    invoiceRequired: boolean;
  } | null;
  balanceMinor: number;
  expiresAt: string;
  historicalBalanceMinor: number;
  financeReviewRequired: boolean;
  departure: { starts_at: string; product_name?: string };
};
export type Partner = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  status?: string;
};
export type BookingFinanceSummary = {
  bookingId: string;
  partnerId: string;
  collectionMode: string;
  currency: string;
  totalMinor: number;
  guestPaidMinor: number;
  partnerCreditMinor: number;
  guestBalanceMinor: number;
  partnerObligationMinor: number;
};
export type NotificationMessage = {
  id: string;
  kind:
    | "booking_confirmation"
    | "payment_request"
    | "waiver_request"
    | "cancellation";
  channel: "email";
  recipient: string;
  subject: string;
  status: "held_provider" | "queued" | "sent" | "failed" | "cancelled";
  failure_detail?: string | null;
  requested_at: string;
  sent_at?: string | null;
};
export type PartnerClaim = {
  id: string;
  booking_id: string;
  partner_id: string;
  partner_name: string;
  amount_minor: string | number;
  currency: string;
  reference: string;
  notes: string;
  recorded_at: string;
  decision: "accepted" | "rejected" | null;
  decision_reason: string | null;
};
export type Member = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  address?: {
    street?: string;
    suite?: string;
    city?: string;
    stateParish?: string;
    postalCode?: string;
    country?: string;
  };
  role: string;
  active: boolean;
  access_status?: "active" | "invited" | "revoked" | "pending";
  last_login_at?: string | null;
  document_count?: number;
  invite_pending?: boolean;
  has_password?: boolean;
};
export type Audit = {
  id: string;
  actor_id: string;
  action: string;
  aggregate_id: string;
  reason: string | null;
  occurred_at: string;
  actor_name?: string | null;
  actor_role?: string | null;
};
export type Manifest = {
  departure: {
    id: string;
    starts_at: string;
    capacity: number;
    product_name?: string;
    trip_run_state?: string | null;
    operational_status?: "open" | "weather_hold" | "closed";
    operational_reason?: string;
    operational_version?: number;
    plan_version?: number | null;
  };
  itinerary: {
    id: string;
    sequence: number;
    name: string;
    address: string;
    directions: string;
    latitude: number | null;
    longitude: number | null;
    map_url: string;
    visibility: "internal" | "guest";
  }[];
  bookings: {
    booking_id: string;
    lead_name: string;
    pickup: Pickup;
    stay?: Booking["stay"];
    party: Record<string, number>;
    party_size: number;
    checkin_state: string | null;
    checkin_version: number | null;
    currency?: string;
    total_minor?: number;
    paid_minor?: number;
    partner_credit_minor?: number;
    guest_balance_minor?: number;
    collection_mode?: string | null;
    passengers: {
      id: string;
      name: string;
      category: string;
      is_minor: boolean;
      identity_pending?: boolean;
      checkin_state: string | null;
      waiver_signed?: boolean;
    }[];
  }[];
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type DispatchRow = {
  id: string;
  starts_at: string;
  capacity: number;
  committed: number;
  product_name: string;
  confirmed_bookings: number;
  confirmed_guests: number;
  boarded_guests: number;
  no_show_guests: number;
  boarding_pending: number;
  pickup_required: number;
  pickup_planned: number;
  pickup_unresolved: number;
  plan_version: number | null;
  plan_notes: string | null;
  trip_run_state: string | null;
  operational_status: "open" | "weather_hold" | "closed";
  operational_reason: string;
  operational_version: number;
};
export type RebookingOption = {
  id: string;
  starts_at: string;
  capacity: number;
  committed: number;
  available: number;
  product_name: string;
};
export type RebookingPreview = {
  sourceDepartureId: string;
  targetDepartureId: string;
  affected: number;
  eligible: number;
  excluded: number;
  messagesQueued: number;
  items: Array<{
    bookingId: string;
    leadName: string;
    eligible: boolean;
    reason?: string;
    quoteId?: string;
    version?: number;
    previousTotalMinor?: number;
    differenceMinor?: number;
    balanceMinor?: number;
    quote?: { currency: string; totalMinor: number };
  }>;
};
export type PickupLocation = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  notes: string;
  address: string;
  latitude: string | number | null;
  longitude: string | number | null;
  map_url: string;
  visibility: "internal" | "guest";
  active: boolean;
};
export type PickupPlan = {
  departure: { id: string; starts_at: string; product_name: string };
  plan: { version: number; notes: string; updated_at: string } | null;
  stops: {
    booking_id: string;
    location_id: string;
    sequence: number;
    pickup_at: string;
    notes: string;
    location_name: string;
    lead_name: string;
    party_size: number;
  }[];
  eligible: {
    booking_id: string;
    lead_name: string;
    pickup: Pickup;
    party_size: number;
  }[];
  exceptions: {
    booking_id: string;
    lead_name: string;
    pickup_kind: "selected" | "unresolved";
    party_size: number;
  }[];
};
export type PrintablePickupList = {
  departure: { id: string; starts_at: string; product_name: string };
  plan: { version: number; notes: string; updated_at: string } | null;
  stops: {
    sequence: number;
    pickup_at: string;
    notes: string;
    location_name: string;
    lead_name: string;
    party_size: number;
  }[];
  exceptions: {
    booking_id: string;
    lead_name: string;
    pickup_kind: "selected" | "unresolved";
    party_size: number;
  }[];
};
