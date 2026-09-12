# New reservation page acceptance evidence

**Date:** 10 September 2026 (updated 11 September 2026)  
**Status:** Mode-aware discovery implemented; scheduled checkout verified; Departures Book lock added; awaiting owner visual acceptance

## Delivered behavior

- Replaced the bounded departure select with a booking-engine style discovery panel.
- Staff choose an exact travel date and optionally search by tour or experience name; the API returns matching departures from persistent inventory.
- Date stepping, Today, morning/afternoon/evening filters, and a sold-out visibility control support common counter and phone-booking workflows without loading an unbounded select.
- Departure results are chronological cards with tenant-formatted date/time, tour, option, configured duration, and live seat availability.
- Sold-out departures are disabled unless the user holds the explicit overbooking permission. Authorized users retain the audited capacity-exception workflow.
- Selection uses an accessible radio group with a clear selected state, then reveals the product's configured passenger categories.
- Once seats are held, the finder collapses into a compact immutable departure summary while the existing hold countdown, frozen quote, guest, purchaser, emergency contact, pickup, stay, partner, and booking creation flow continues.
- The booked party creates exactly one passenger slot per category quantity. The lead traveler can occupy the first slot; every other name is optional during booking and is durably marked as pending rather than discarded.
- A pending passenger name must be completed before waiver evidence or clearance. The connected crew mobile waiver screen collects the name and signature in one server-validated, audited operation.
- A booking that succeeds before its roster request fails is retained and the page retries only the roster, preventing duplicate reservations.
- The finder becomes a single-column touch layout on phones and preserves a two-column, internally scrollable result area on larger screens.
- **11 September 2026 — Departures Book lock:** Departures Book links pass `departure`, `product`, and `date`. New reservation loads that trip only (chip + party steppers) until Change clears the lock. Workspace departures accept optional `departureId` and ignore competing date/product filters when it is set.

## Verification

- Production web build passed.
- Type checks passed for API/shared, web, and Expo mobile.
- Full API suite passed: 42 tests, 42 passed, including pending-name rejection, crew completion during waiver signing, mode-filtered departure search, and hold rejection for non-fixed products.
- Persistent migration `054_pending_passenger_identity.sql` completed: 54 known, 54 applied, 0 pending.
- Live PostgreSQL browser verification confirmed the configured `DD/MM/YYYY` and 12-hour time display, exact-date departure lookup, sold-out treatment, chronological results, seat counts, and RBAC-protected page access.
- `git diff --check` passed.

Discovery is now mode-aware. Staff pick a product (or all scheduled inventory) before the dated finder. `fixed_departure` keeps the existing date, time-window, sold-out, hold, and roster checkout. `on_request`, `opening_hours`, `open_dated`, and `resource_window` show an explicit unsupported notice and cannot create a seat hold. Workspace departure search can filter by `productId`, `availabilityMode`, and `departureId`; holds reject non-fixed products. Seeded demo tenants include a synthetic on-request inquiry product with no generated departures.

See [mode-aware discovery](../FEATURES/reservations/mode-aware-discovery.md).

The page remains in owner review. Implementation sequence next is Subscription polish; owner visual acceptance can continue in parallel.
