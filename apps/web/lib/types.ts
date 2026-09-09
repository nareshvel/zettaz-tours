import type {
  TenantConfig,
  ProductInput,
  Quote,
} from "../../../packages/shared/src/contracts";
export type { TenantConfig, ProductInput, Quote };
export type Session = {
  actorId: string;
  role: string;
  permissions: string[];
  tenant: {
    id: string;
    name: string;
    timezone: string;
    version: number;
    config: TenantConfig;
    is_mock: boolean;
  };
};
export type DemoTenant = { tenantId: string; name: string };
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
  departure_id: string;
  lead_name: string;
  lead_email: string;
  source: string;
  state: string;
  version: number;
  party: Record<string, number>;
  pickup: Pickup;
  quote: Quote;
  paidMinor: number;
  balanceMinor: number;
  expiresAt: string;
  historicalBalanceMinor: number;
  financeReviewRequired: boolean;
  departure: { starts_at: string };
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
  bookings: {
    booking_id: string;
    lead_name: string;
    pickup: Pickup;
    party: Record<string, number>;
    party_size: number;
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
export type PickupLocation = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  notes: string;
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
