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

## Recovery workflow

- A held or closed departure exposes a recovery action when it has confirmed bookings.
- The operator selects a future, open departure for the same product and records one reason for the plan.
- Preview creates an expiring amendment quote for every affected booking. It shows eligibility, exclusions, the new total, price difference and expected balance without reserving target inventory.
- Apply moves each eligible booking through the ordinary amendment workflow. Both departures are locked, capacity is checked again, a new price snapshot is written, payment facts remain unchanged, pickup-plan rows are cleared for replanning, and immutable booking/audit history records the reason.
- Results are reported per booking. A capacity race or stale booking leaves that booking on the source departure and identifies it for review; successful bookings are not reported as a silent all-or-nothing batch.
- Customer messages remain at zero and are not sent by recovery. Staff can request reviewed messages from each booking after deciding the wording and audience.

## Explicit deferrals

The recovery action does not decide cancellation fees or refunds, change partner invoice responsibility, automatically notify customers, or send channel updates. Cancellation and financial exceptions remain individual reviewed actions until tenant policy and provider evidence are available.

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
- Recovery requires a non-sellable source, an open future target for the same product and `operations.write` permission.
- Preview and apply preserve price/payment history, enforce target capacity at mutation time, report partial results explicitly and remain tenant-scoped.
