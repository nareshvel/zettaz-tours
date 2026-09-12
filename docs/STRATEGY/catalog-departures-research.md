# Catalog, availability, and departures

## Executive decision

Catalog and Departures should not be merged into one undifferentiated page or one domain entity. They should become a connected workspace with three distinct views:

1. **Products** — what the tenant sells.
2. **Availability** — how and when each option can be requested or booked.
3. **Departures** — agenda, calendar, and list views of dated operating instances, including generated and manually added departures.

The main navigation should keep **Catalog** as the familiar configuration destination and **Departures** as the daily operational destination because dispatchers, guides, and reservation staff work from dated instances. Catalog contains Products and Availability views. Both surfaces should share product summaries, filters, and contextual links. Product detail should contain its options, prices, availability rules, and upcoming departures, while departure detail should contain operational readiness, bookings, manifest, assignments, route, and day-of controls.

This structure supports scheduled tours now and gives unscheduled products an honest model. It also preserves the existing launch decision that private charters and transfers need resource-window inventory and must not be represented as shared tours with artificial seat capacity.

## Why the current pages feel outdated

The current Catalog page is a read-only grid of cards followed by a separate create form. Each database product embeds one option, passenger categories, and seasonal prices in a JSON definition. The interface labels every item `SHARED TOUR`, exposes raw rate periods, provides no product status or completeness state, and offers no product detail or edit path. Scheduling is a link to a second form rather than part of understanding the product.

The current Departures page is a basic table with tour, timestamp, committed seats, availability, Manifest, and Book actions. It has no calendar or agenda mode, date range, operational status, readiness, occupancy signal, closure state, assignment state, manual-departure action, or schedule-series context. Its default API query is record-oriented rather than explicitly upcoming and chronological. This is adequate as an early integration surface but not as a professional operator workspace.

The create forms also reveal a modeling limitation: one product equals one option, and a schedule always generates seat-capacity departures. That excludes valid industry scenarios such as open-date tickets, any-date inquiries, activities offered within opening hours, and private charters held against a vessel or vehicle.

## Evidence from current industry models

Current reservation systems separate product configuration from dated availability. Rezdy documents three scheduling methods: fixed dates and times, any-date inquiries, and bookings where a date is not required. Its fixed sessions can have unlimited availability, a fixed session limit, per-price-option limits, or linked inventory. Sessions separately control time, price, resources, and availability.^1 This is strong evidence against a single `scheduled` boolean.

The OCTO industry standard separates Product, Option, Unit, and Availability. Product and option identifiers are used for availability checks and bookings; implementations distinguish start-time availability and open-dated bookings.^2 OCTO's availability calendar is a date-range summary, while availability check returns the actual bookable start-time or day records.^3 This supports separate calendar-summary and bookable-instance endpoints.

Google Things to do also requires at least one Option under each Product and models price options, categories, cancellation policy, language, related locations, and fulfillment separately.^4 Google's guidance treats tours, experiences, admission tickets, and supplementary add-ons differently, and distinguishes a meeting point from a related point of interest.^5 This reinforces the need for product kind and option-level operational metadata rather than tenant-specific labels.

Viator's supplier API likewise maps a supplier product and optional product option to external identifiers. Viator states that suppliers control the inventory exposed to the channel and that option-level mappings can identify variants.^6 For future channel adapters, stable internal Product and Option identifiers are therefore more useful than extracting an option name from a mutable JSON field.

These systems use different terminology, but their common shape is consistent:

`Product → Option → Units/pricing → Availability rule → Availability instance → Booking`

## Product and availability taxonomy

The platform should use an explicit `availability_mode`, not infer behavior from product names or tenant type.

| Availability mode | Customer/staff chooses | Confirmation | Inventory primitive | Examples |
| --- | --- | --- | --- | --- |
| `fixed_departure` | Date and start time | Usually instant | Seat pool plus optional required resources | Shared tour, snorkeling trip, sunset cruise, scheduled shuttle |
| `opening_hours` | Date and optional entry window | Usually instant | Daily capacity, time-window capacity, or free sale | Museum, attraction, beach club, equipment access |
| `open_dated` | No visit date at purchase, or redemption window | Instant issuance; redemption later | Voucher/redemption entitlement | Gift voucher, flexible admission pass |
| `on_request` | Preferred date and optionally preferred time | Manual acceptance or quote | No inventory commitment until accepted | Bespoke tour, group request, special event inquiry |
| `resource_window` | Date, start time, and duration | Instant or quote after resource check | Exclusive vessel, vehicle, guide, room, or equipment | Private charter, transfer, rental |

`fixed_departure` is the current Track A engine. `on_request` can be introduced as a request workflow without pretending that inventory is confirmed. `resource_window` remains the correct future model for private charters and transfers. `opening_hours` and `open_dated` should be added only when a tenant needs them and their redemption/capacity rules are specified.

Product kind and availability mode should be related but separate. A boat tour may be a shared fixed departure or a private resource-window charter. An attraction may be opening-hours or fixed-entry sessions. A transfer is normally resource-window or on-request. This prevents a rigid list of tour types from determining inventory behavior.

Recommended product kinds are tenant-neutral:

- Tour or guided experience
- Boat trip or cruise
- Private charter
- Transfer or transport
- Attraction or admission
- Rental
- Package or multi-day experience
- Add-on

Tenants may configure display labels and tags, while the stable underlying kind drives validation and integrations.

## Recommended domain boundaries

### Product

A reusable commercial offering. It owns internal name, customer-facing title and description, kind, status, imagery, locations, accessibility/safety information, cancellation policy, fulfillment settings, channel visibility, and tags. Product status should include at least `draft`, `active`, `paused`, and `archived`. Archiving must preserve historical bookings.

### Product option

A bookable variant with its own stable identifier. It owns option name, duration, language, pickup/meeting behavior, private/shared mode, minimum and maximum party size, passenger categories or units, waiver requirement, and default confirmation mode. Examples are “Morning shared tour,” “Sunset departure,” and “Private half-day charter.” A product may have one or many options.

### Rate plan

Versioned, date-bounded pricing for an option and its units. Channel or partner overrides remain separate. Published rates are not silently rewritten after bookings exist; confirmed reservations continue to read frozen price snapshots.

### Availability rule

The reusable rule that describes when an option can be sold: date range, weekdays, local start times or opening hours, cutoff, minimum notice, capacity strategy, blackout policy, and required resource rules. Multiple start times belong to the rule or related rules rather than duplicated products.

### Departure or availability instance

A concrete dated operating instance generated from a rule or created manually. It owns local date/time, capacity snapshot, committed and held inventory, operational status, closure/weather state, assignments, itinerary, manifest, and run state. Changes to future schedule rules should not rewrite departed or booking-bearing instances without an explicit impact workflow.

### Request

An inquiry for an `on_request` or future `resource_window` option. It records preferred date/time, flexibility, party, customer needs, and status. It becomes a quote and then an inventory hold only after staff selects a valid offer/resource. It is not a confirmed departure booking.

## Recommended information architecture

### Catalog

This configuration workspace should be available to users with catalog permissions and contain:

- **Products** — searchable list/grid with status, kind, options, price-from, availability mode, next availability, channel state, and attention flags.
- **Availability** — rule list grouped by product/option, with active date range, operating days/times, capacity strategy, exceptions, and future instances affected.
- **Upcoming departures preview** — a contextual read-only view that links to the operational Departures calendar without creating a second calendar authority.

The Product detail page should use tabs or clearly separated routes:

- Overview
- Options
- Pricing
- Availability
- Content & locations
- Policies & requirements
- Channels
- Change history

The create flow should be a resumable guided setup with a draft state:

1. Product type and selling model
2. Core details and content
3. Options and duration
4. Guest categories and constraints
5. Pricing
6. Availability method
7. Pickup, meeting, and locations
8. Policies and fulfillment
9. Review and activate

The flow should reveal relevant fields based on availability mode. A fixed-departure tour asks for schedules and capacity. An on-request experience asks for request windows and response expectations. A future private charter asks for duration and resource class, not passenger seat capacity.

### Departures

This remains the operational workspace and should default to Today/Upcoming in tenant time. It should offer:

- Agenda, calendar, and compact list views.
- Today, date range, product, status, capacity, assignment/readiness, and attention filters.
- Summary metrics for today's departures, booked guests, occupancy, unassigned departures, unpaid/waiver exceptions, and weather/closure issues.
- Each row/card should show local time, product/option, occupancy, held seats, status, readiness, assigned resource/lead crew, pickup progress, and exception badges.
- Contextual actions: open departure, manifest, add reservation, assignments, pickup list, close/hold, and print.
- A clear **Add one-off departure** action separate from **Create recurring availability**.

The departure detail should become the authoritative operational page. The current manifest can become one tab alongside Overview, Guests, Pickups, Team & resources, Itinerary/map, Communications, Documents, and Activity. Day-of actions should be prominent; configuration editing should link back to its originating availability rule.

## Should the pages be merged?

**Domain merge: no.** Product definitions, availability rules, and operating instances have different lifecycles, permissions, state transitions, and audit risks.

**Navigation consolidation: partial.** Keep **Catalog** as the top-level name and give it Products and Availability views. Keep **Departures** as a separate operations menu item with Agenda, Calendar, and List views because it serves a different daily job and a broader set of roles. Avoid two competing calendars: availability rules own reusable configuration, while the Departures calendar owns dated instances.

**Component and visual merge: yes.** Both should use the same product identity, status vocabulary, filters, calendar primitives, capacity display, and contextual linking. A manager moving from a product to its schedule or next departure should remain oriented. This removes the current feeling of two unrelated early-stage pages without mixing their responsibilities.

RBAC should enforce the distinction:

- Reservations staff: read products and departures, create bookings.
- Dispatcher/operations: read products, manage departures and day-of operations.
- Catalog manager/operations administrator: create and publish products, pricing, and availability rules.
- Guide/driver: only assigned departure and minimized guest information.
- Finance reviewer: published price and booking financial facts, without catalog mutation.

## Recommended implementation sequence

### Phase 1 — product model and UX foundation

1. Add stable product kind, lifecycle status, availability mode, internal/customer-facing names, description, and option identity.
2. Replace the current one-option JSON structure with normalized relational tables. Because there are no production tenants, the local development database and synthetic bookings may be migrated or reset and reseeded when that produces a cleaner result. Do not carry a permanent compatibility layer solely to preserve disposable demo identifiers.
3. Add product detail/edit APIs with optimistic versions and auditable status changes.
4. Redesign Products list and guided product editor using reusable form components.

### Phase 2 — availability rules

1. Make current schedules listable and editable as versioned availability rules.
2. Support multiple local start times, effective date ranges, weekdays, blackouts, cutoff/minimum notice, capacity, and manual one-off departures.
3. Preview generated instances and booking impact before publishing a rule change.
4. Add on-request products as requests, not bookings; leave resource-window confirmation behind its Track B feature flag.

### Phase 3 — operational departures

1. Replace the current table with agenda/calendar/list views and server-side date/status/readiness filters.
2. Add operational summaries and exception-first presentation.
3. Consolidate departure detail, manifest, assignments, pickups, itinerary, waiver readiness, and print actions.
4. Verify desktop, tablet, phone, keyboard, empty/loading/error states, and role variants.

### Phase 4 — reservation finder refinement

Once Product, Option, AvailabilityRule, and Departure are explicit, revise New Reservation to select the correct mode:

- Fixed departure: product → date → available start time → party.
- Opening hours: product → visit date/window → party.
- Open dated: product → validity/redemption terms → party.
- On request: product → preferred dates/times → party/contact → request.
- Private/resource window: product → date/time/duration → resource availability → quote/hold.

This sequence avoids designing the booking finder around fields that the catalog cannot yet author reliably.

## Acceptance criteria for the decision

- No Rock Adventures product name, capacity, schedule, or label becomes a platform rule.
- Product, option, availability rule, departure, and request have separate identifiers and audit histories.
- Existing shared-tour behavior remains covered by tests after migration. Development records may be transformed or reseeded; the resulting model must preserve immutable price snapshots and audit history once real tenant data exists.
- Unscheduled does not mean unlimited or automatically confirmed.
- Private charter and transfer reservations cannot use the shared seat engine.
- Local time and DST validation remain server-authoritative.
- Product archives and schedule changes cannot rewrite historical booking evidence.
- UI and API expose only the modes implemented for that tenant and feature set.

## Sources

1. Rezdy. “[Product: Scheduling tab](https://support.rezdy.com/hc/en-us/articles/19867759470108-Product-Scheduling-tab).” Updated 15 April 2026.
2. OCTO. “[Welcome | OCTO Developer Hub](https://docs.octo.travel/).” Accessed 10 September 2026; Zaui. “[Products](https://docs.zaui.com/octo/basic-workflow/products).” Accessed 10 September 2026.
3. Zaui. “[Availability](https://docs.zaui.com/octo/basic-workflow/availability).” Accessed 10 September 2026.
4. Google Actions Center. “[Product feed](https://developers.google.com/actions-center/verticals/things-to-do/reference/feed-spec/product-feed).” Updated 1 April 2026; “[Required and recommended fields](https://developers.google.com/actions-center/verticals/things-to-do/guides/partner-integration/required-fields).” Updated 1 April 2026.
5. Google Actions Center. “[Location and point of interest](https://developers.google.com/actions-center/verticals/things-to-do/guides/partner-integration/location).” Updated 1 April 2026.
6. Viator. “[Reservation System API](https://docs.viator.com/supplier-api/technical/).” Version 2.0, accessed 10 September 2026; “[Supplier API FAQ](https://docs.viator.com/supplier-api/technical/faq/).” Accessed 10 September 2026.
