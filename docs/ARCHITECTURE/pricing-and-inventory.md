# Pricing and inventory

**Version 2.0 · 5 September 2026**

Index: [README.md](../README.md) · States: [domain-and-states.md](domain-and-states.md) · Scope: [launch-contract.md](../STRATEGY/launch-contract.md)

## Availability rule

Availability is the minimum of sellable passenger capacity and all required resource pools. That invariant stays even when Track A only models seats plus one exclusive resource.

Temporary reservation holds expire automatically. Confirmation is idempotent. Capacity changes emit outbox events and recalculate affected departures. Manual overbooking requires permission, reason, and an audit event.

Authorized exception seats are stored separately from ordinary `committed` capacity. The database continues to enforce `committed <= capacity`; `overbooked` records the explicit exception total. A privileged user creates an overbook hold only after ordinary availability is exhausted, supplies a reason of at least eight characters, and is recorded as the authorizer. Confirmation, cancellation and same-departure amendments increment or release the matching pool so the exception cannot be hidden inside normal capacity.

## Inventory strategies by product type

Do not implement one unified inventory engine that pretends shared tours, private charters, and transfers are the same primitive.

### Shared tour (Track A)

- A `Departure` has a seat `CapacityPool` (sellable passenger units, by category if configured).
- Optional `RequirementRule`s consume exclusive or shared resources (one vehicle, one guide). Track A implements **at most one exclusive resource type** per departure plus seats.
- A confirmed booking decrements seats. If the exclusive resource is required and unassigned or unserviceable, the departure can still sell seats but operations readiness fails until assigned.
- Holds reserve seats (and the exclusive resource if the rule says the pool is exclusive and exhausted at one booking — typical shared tours do **not** lock the vehicle to one booking).

### Private charter (Track B unless promoted)

- Inventory is an exclusive resource (vessel, vehicle, crew) for a duration window, not a seat count.
- Workflow is request → `Quote` → hold resource → confirm.
- Do not encode a charter as a shared tour with capacity `1` or `0` and a fake departure grid. That will break pricing, pickups, and manifests.

### Transfer (Track B unless promoted)

- Inventory is a vehicle plus a time window and maybe luggage/seat constraints.
- Point-to-point, not a departure with a tour manifest.
- Same rule: do not fake transfers as shared-tour departures.

### Track A vs Track B inventory features

| Feature | Track A | Track B |
| --- | --- | --- |
| Seat pool + holds | Yes | — |
| One exclusive resource type | Yes | Multiple types, shared pools |
| Authorized overbooking | Yes | — |
| Waitlists | No | Yes |
| Allotments and release periods | No | Yes |
| Channel-sync on capacity change | Outbox event; WP/assisted consumers | Certified OTA |

## Worked capacity example (shared tour)

Departure: 09:00 shared coastal tour. Seat capacity 18. Requirement: one 18-seat vehicle (exclusive for that departure, not for one booking).

1. Booking A holds 6 seats. Remaining sellable: 12. Vehicle still available to the departure.
2. Booking B confirms 8 seats. Remaining: 4. Vehicle still unassigned operationally; readiness will flag it.
3. Booking C tries 6 seats. Availability is 4. Reject or offer 4, unless an authorized overbook override is recorded.
4. Dispatcher assigns Vehicle 12. Conflict check: Vehicle 12 has no overlapping assignment. License and insurance are current.
5. Hold for Booking A expires. Seats return to 10 remaining if A never confirmed.

Unauthorized overbooking is confirming 19 seats against capacity 18 with no override. That is a launch-blocking defect. Confirming 19 with an authorized, reasoned audit event is allowed and is not a success-metric failure.

## Nested adult / child occupancy

Shared-tour capacity is **not** two independent adult and child pools.

- `capacity` is maximum occupancy (all counting guests).
- `capacity_adult` is the adult-class ceiling and must be ≤ occupancy.
- `capacity_child` is optional. Null means leftover occupancy may be children (nested / glass-bottom). A number is a partitioned child ceiling (tuk-tuk benches).

A party fits ordinary inventory only if counting guests ≤ remaining occupancy **and** adults ≤ remaining adult places **and** (when set) children ≤ remaining child places. Overbooking, when the tenant policy is `authorized`, still requires permission and a reason; policy `off` rejects overbook holds.

**Glass-bottom:** 10 adults · 12 occupancy. Ten adults plus two children fit; an eleventh adult does not.

**Tuk-tuk run:** operator math at schedule time, not fleet auto-count. Eighteen vehicles × 4 adults + 2 children → 72 adults · 36 children · 108 occupancy.

## Fleet size vs seat capacity (open revisit)

Operators often confuse **how many vehicles they own** with **how many seats a departure can sell**.

Example: Tuk-Tuk Rainforest & Beach Hopping with **18 tuk-tuks** in the yard and **one shared product**.

| Concept | Where it lives | What it controls |
| --- | --- | --- |
| Seat / party capacity on the schedule | Catalog → Schedules (`Departure.capacity`) | How many guest units multiple bookings can buy on that departure |
| Fleet of tuk-tuks / boats / vans | Team & resources | Which assets can be assigned so the trip can run |

**Track A rule of thumb**

- One shared product + one departure time is enough for **many bookings**. Capacity is the seat pool; bookings decrement seats until the pool is exhausted.
- The 18 vehicles are **resources**, not 18 products. Assign them on the departure for readiness.
- Set schedule capacity to **total sellable guest units** for that departure (e.g. seats per tuk-tuk × tuk-tuks you will run), not automatically “18” just because there are 18 vehicles—unless the sellable unit is literally one vehicle-slot.
- **One booking = one exclusive tuk-tuk** is a different inventory primitive (private / resource-window). Do not fake it as a shared tour with capacity `1`. That path stays Track B unless promoted.

**Revisit when**

- A real tenant needs multi-vehicle seat pools that sell-block when vehicles are exhausted (not only readiness).
- A product must sell exclusive vehicles rather than shared seats.
- Capacity must auto-derive from assigned resource capacities.

Standing pointer: [../MODULES/Catalog/shared-capacity-vs-fleet.md](../MODULES/Catalog/shared-capacity-vs-fleet.md).

## Phase 1 pricing (Track A)

v1.1 listed retail, child, infant, group, private, seasonal, channel, contract/net, promotion, add-on, pickup, and fee in the same breath. That is a multi-quarter engine. Track A implements only:

| Dimension | Behavior |
| --- | --- |
| Passenger category | Adult / child / infant (or tenant-configured categories) with age rules and per-category amounts |
| Seasonal calendar | Date-bounded rate on the product option |
| One add-on | Optional extra (pickup, photo, equipment) with a single amount |
| Channel or contract override | A named channel or partner contract can replace the retail amount with a net or contract amount |

No group-size breaks, no promo codes engine, no dynamic yield, no pickup-distance matrix. Fees and tax: a single configurable tax/fee line if finance supplies a rate; otherwise store tax as a snapshot field of zero and revisit. Finance must approve recognition and tax treatment — see [ux-security-reporting.md](ux-security-reporting.md).

Currencies are integer minor units plus ISO code. See [finance-and-offline.md](finance-and-offline.md) and [004-money.md](../DECISIONS/004-money.md).

## PriceSnapshot

On confirm (and on each accepted amendment):

- Persist priced lines, discounts, tax/fee, currency, and the `ExchangeRate` used.
- Display and refunds read the snapshot, not live catalog prices.
- Catalog price changes never rewrite confirmed bookings.
- A change-quote computes a difference against the current snapshot, then writes a new snapshot if accepted.

Do not re-price a confirmed booking from the live catalog when rendering a manifest or invoice.

## Catalog structure (Track A)

- Product kinds in data: `shared_tour` required; `private_charter`, `transfer`, `rental_addon` may exist as records but their inventory engines are not implemented until promoted.
- Options: route, duration, language, pickup policy, private/shared mode.
- Passenger categories: age rules, min/max, accessibility and safety constraints.
- Recurring schedules, seasonal calendars, blackout dates, closures, weather holds, manual departures.
- Resource requirements as rules, not hard-coded asset IDs.

## Holds

- Device- or session-generated hold with TTL.
- Idempotent confirm consumes the hold or fails cleanly if expired.
- Redis may cache hold locks; PostgreSQL is the system of record for committed capacity.
