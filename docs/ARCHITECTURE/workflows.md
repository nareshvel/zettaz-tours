# Workflows

**Version 2.0 · 5 September 2026**

Index: [README.md](../README.md) · States: [domain-and-states.md](domain-and-states.md) · Scope: [launch-contract.md](../STRATEGY/launch-contract.md)

Booking, passenger/check-in, and trip-run states are separate. Do not set a booking to “checked in” or “in progress.”

## Direct / staff-assisted booking

Used for phone, WhatsApp, walk-in, and (when built) the public checkout. Track A implements this in the reservation workspace; WP Travel Engine remains the public site.

1. Agent or customer selects product, date/time, and party composition.
2. System returns price, pickup options, and real-time availability.
3. A short inventory hold is created.
4. Traveler and passenger data are supplied; policies accepted; required amount paid or a manual/credit payment state recorded.
5. Payment confirmation (gateway webhook or recorded manual state) is idempotent.
6. Capacity is committed; a `PriceSnapshot` is written; outbound updates are queued on the outbox.
7. Confirmation, receipt, ticket/QR, waiver, and pickup instructions are sent (suppressed during dry-run import).
8. Booking appears on the operations board and future manifest.

## OTA / channel booking (assisted in Track A)

Track A: store raw payload when available, map to canonical product/departure, or enter from voucher/CSV. Certified connectors are Track B.

1. Connector receives a booking or staff import a channel voucher.
2. Raw payload is stored securely and deduplicated by channel reference / idempotency key.
3. Channel product/option is mapped to the canonical product and departure.
4. Booking is created with channel financial ownership and voucher/payment status.
5. Passenger/pickup questions are normalized; missing required data creates an exception task.
6. Inventory commit triggers sync events (no-op consumers until a channel is live).
7. Cancellation/amendment events update the same booking and preserve history.

Do not promise Viator or GetYourGuide go-live dates. See [integrations.md](integrations.md).

## Hotel / reseller booking (assisted in Track A)

No partner portal in Track A. Tenant staff (or a later portal) create the booking against a partner contract.

1. Agent sees only contract-eligible products, rates, and (later) allotments.
2. Agent creates a quote/hold or confirmed booking and identifies hotel room/guest or cruise cabin.
3. System calculates retail, net or contract amount, and collection responsibility.
4. Voucher and confirmation are issued; booking enters the manifest.
5. After completion, Track A can raise invoice lines / an invoice flag. Track B accrues commission per contract trigger.
6. Finance approves, sends, records settlement, and resolves disputes (deep workflow Track B).

## Day-of operation

1. Dispatcher reviews the readiness board and unresolved exceptions.
2. Resources and staff are assigned; expired required documents block assignment unless overridden.
3. Crew complete readiness steps and open the manifest (download offline window when that epic ships).
4. Driver follows pickup sequence. If the booking links a `CruiseCall`, pickup time respects all-aboard constraints shown on the stop.
5. Crew scan the booking QR or find the booking manually and confirm arriving passengers.
6. Check-in shows balance due, currency, payment responsibility, and accepted methods. Staff collect or record when required.
7. Every required adult signs the current digital waiver. A configured parent/guardian signs for minors.
8. Each passenger is `cleared_to_board` only when payment and waiver conditions are satisfied, or an authorized exception is recorded.
9. Crew record `boarded` and `no_show`. Offline events synchronize later without duplicating signatures or payments.
10. Trip-run moves through preparing → pickup → boarding → departed → completed (or delayed / emergency / cancelled).
11. Completion records final passenger/resource/usage data and emits finance and notification outbox events.

## Weather / closure and mass rebook

Track A requirement.

1. Authorized dispatcher or owner marks a departure (or an attraction-dependent option) as weather hold, closed, or cancelled, with reason.
2. Affected confirmed bookings stay `confirmed` until a policy action is applied; the trip-run becomes `cancelled` or stays `preparing` on hold.
3. System lists affected bookings and partners. Communications are queued but not sent until the user confirms the send.
4. Per booking, apply policy: rebook to a target departure (quote-difference, new snapshot), cancel with refund/fee rules, or leave pending with a task.
5. Inventory on the closed departure is released or blocked for sale. Channel sync events are emitted.
6. Partner invoice flags remain consistent: a cancelled unused trip does not silently stay billable.

Dry-run this flow before cutover.

## Cruise pickup

1. Tenant maintains `CruiseCall` records: ship name, call date, port, scheduled arrival/departure, tender flag, all-aboard time.
2. A booking’s Ship/Hotel field maps to a `CruiseCall`, an `AccommodationStay`, or a generic pickup zone — never a free-text-only commercial fact.
3. Pickup stops for that call can share a sequence (port cluster). Manifest printout shows ship and all-aboard.
4. If all-aboard is before the scheduled return, readiness and the trip-run show a constraint warning. Track A warns; it does not auto-optimize the route.

## Cancellation and refund

1. User or channel requests cancellation.
2. Policy engine calculates eligible refund, fee, partner liability, and capacity release against the `PriceSnapshot`.
3. Authorized user confirms or overrides with reason.
4. Refund is requested through the original gateway where possible; manual refunds are ledger lines.
5. Booking, capacity, and channel state change only through an idempotent workflow.
6. Customer/partner communication and accounting entries are produced.

## Private charter quoting

Deferred unless [launch-contract.md](../STRATEGY/launch-contract.md) is updated to promote it. If someone asks to “just add a charter product,” refuse the shared-tour shortcut and implement quote → resource hold → confirm, or keep it out of scope.

## Migration (M1–M8)

v1.1 reused step numbers 35–42. Use this sequence.

| Step | Action |
| --- | --- |
| M1 | Create controlled dictionaries for products, hotels/ships, pickup points, booking sources, payment states, and partners. Use [configuration-schema.md](configuration-schema.md). |
| M2 | Parse historical sheets into staging. Never import spreadsheet comments directly into financial truth. |
| M3 | Flag ambiguous amounts, room numbers, phone numbers, duplicate guests, and inconsistent passenger formulas for review. |
| M4 | Import useful future bookings first. Historical data can follow as read-only archive records. |
| M5 | Reconcile each imported future day against original manifest totals and channel vouchers. |
| M6 | Train reservations, dispatch, finance, crew, and partners with role-specific scenarios. |
| M7 | Parallel-run 7–14 operating days with a named go/no-go owner and rollback plan. |
| M8 | Freeze spreadsheet entry after cutover. Retain the file as evidence and import reference. |

### Migration acceptance

- Every future booking has a date/time, product, party size, source, status, and pickup disposition.
- Daily totals reconcile or have documented exceptions.
- Paid / balance / invoice ownership is reviewed manually for every future booking.
- Partner/channel references are preserved.
- No asset/staff assignment conflicts exist for the launch window, except authorized overrides.
- Customer communications are not sent during dry-run imports.
