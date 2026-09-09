# Weather and closure controls

## Purpose

Allow a tenant to stop a specific departure from accepting new inventory because of weather or an operational closure, while preserving confirmed bookings for deliberate follow-up.

## Bounded first action

- `open` is the normal sellable state.
- An authorized dispatcher, admin, or owner may apply `weather_hold` or `closed` to a future departure with a reason.
- Both states block new holds and confirmation of existing unconsumed holds. Availability reports zero.
- Existing confirmed bookings, payment facts, price snapshots, and pickup plans remain unchanged.
- The departure view lists the affected confirmed bookings and pickup disposition to support manual policy review.
- Reopening requires the same authorization, an explicit reason, optimistic version, audit event, and outbox event.

## Explicit deferrals

This slice does not cancel or rebook bookings, release confirmed capacity, decide refunds or fees, change partner invoice responsibility, notify customers, or send channel updates. Those actions require finance, partner, messaging, and connector evidence that does not yet exist in the application.

## Assumptions and open decisions

- A hold or closure applies to one materialized departure. Product-wide and attraction-wide closures await catalog dependency modeling.
- A weather hold is operationally non-sellable, like a closure, until a user reopens it or a later policy action is implemented.
- The operational reason is internal and limited to 500 characters. Tenant-defined reason codes, communications, weather feeds, and a trip-run record are future work.
- `operations.write` is the least privilege currently available for this action; role presets already grant it to dispatcher, admin, and owner.

## Acceptance evidence

- Tenant-scoped status changes are versioned, idempotent, audited, and placed in the outbox.
- Holds and confirmations fail while a departure is non-sellable; confirmed bookings remain visible.
- Another tenant cannot read or mutate the departure closure state.
- The Operations board exposes the status and affected-booking count.
