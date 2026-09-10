import type {
  TenantConfig,
  ProductInput,
  Quote,
} from "../../../packages/shared/src/contracts";
export type { TenantConfig, ProductInput, Quote };
export type Session = {
  actorId: string;
  actorName: string;
  actorEmail: string;
  actorPhone?: string | null;
  role: string;
  permissions: string[];
  supportAccess?: { id:string; purpose:string; permissions:string[]; expires_at:string } | null;
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
};
export type Departure = {
  id: string;
  product_id: string;
  product_name: string;
  option_name: string;
  starts_at: string;
  capacity: number;
  committed: number;
  overbooked?: number;
  available: number;
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
  quote: Quote;
  paidMinor: number;
  payments: {
    id:string; amount_minor:number; currency:string; method:string; status:"settled"|"pending";
    reference:string; reason:string; occurred_at:string; adjustment_id:string|null;
    adjustment_kind:"void"|"reversal"|null; adjustment_reference:string|null;
    adjustment_reason:string|null; adjustment_occurred_at:string|null;
  }[];
  partnerCreditMinor?: number;
  balanceMinor: number;
  expiresAt: string;
  historicalBalanceMinor: number;
  financeReviewRequired: boolean;
  departure: { starts_at: string };
};
export type Partner = { id: string; name: string; email?: string | null; phone?: string | null; status?: string };
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
  kind: "booking_confirmation" | "payment_request" | "waiver_request" | "cancellation";
  channel: "email";
  recipient: string;
  subject: string;
  status: "held_provider" | "queued" | "sent" | "failed" | "cancelled";
  requested_at: string;
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
  role: string;
  active: boolean;
};
export type Audit = {
  id: string;
  actor_id: string;
  action: string;
  aggregate_id: string;
  reason: string | null;
  occurred_at: string;
};
export type Manifest = {
  departure: { id: string; starts_at: string; capacity: number };
  itinerary: { id: string; sequence: number; name: string; address: string; directions: string; latitude: number | null; longitude: number | null; map_url: string; visibility: "internal" | "guest" }[];
  bookings: {
    booking_id: string;
    lead_name: string;
    pickup: Pickup;
    party: Record<string, number>;
    party_size: number;
    checkin_state: string | null;
    checkin_version: number | null;
    passengers: { id: string; name: string; category: string; is_minor: boolean; checkin_state: string | null }[];
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
  pickup_required: number;
  pickup_planned: number;
  pickup_unresolved: number;
  plan_version: number | null;
  plan_notes: string | null;
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
