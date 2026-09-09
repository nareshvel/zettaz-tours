# First vertical slice: manual booking to manifest

**Date:** 9 September 2026 · **Status:** Accepted for mock-data implementation; bounded decisions in ADR 009.

Authority: [delivery](../../STRATEGY/delivery.md), [launch contract](../../STRATEGY/launch-contract.md), [domain](../../ARCHITECTURE/domain-and-states.md). This is a cross-epic acceptance specification, not permission to implement E01–E10 in full.

## User outcome

An authorized staff member creates a manual reservation for a configured shared tour, records the permitted manual payment fact, explicitly confirms it, and retrieves the confirmed party on a departure manifest. Every write is tenant-scoped and audited. No web dashboard, Expo app, waiver implementation, external payment request, partner remittance engine or live message delivery belongs in this slice.

## Operations, fields and failures

| ID / operation | Required input / source | Permission and validation | Outcome / recovery |
| --- | --- | --- | --- |
| S01 Provision tenant | Legal/display name, unique slug, timezone, owner identity; currency policy recorded before money use | Platform provisioning permission; valid timezone; secure owner invitation | Tenant and owner membership; duplicate slug conflict, no partial tenant creation |
| S02 Configure shared tour | Product/option identifiers, active state, duration, category/capacity rules, seasonal amounts/currency | catalog.write/rates.write; supported shared-tour kind; valid ranges; no ambiguous applicable rates | Configuration version usable for pricing; invalid overlaps/gaps surfaced |
| S03 Recurring departure | Option, local start, weekdays with explicit convention, date range, seat capacity, blackouts | Catalog/schedule permission; positive capacity and finite generation horizon | Idempotent schedule materialization; no duplicate departure on retry |
| S04 Query availability | Departure and counts by category | Authorized staff; nonnegative integral counts; at least one passenger | Seats available after live holds/commitments; disabled/closed departure unavailable |
| S05 Hold | Departure, party composition, session/actor, idempotency key | bookings.create; valid TTL policy; atomic capacity check | Hold ID and authoritative expiry; insufficient capacity conflict with refresh path |
| S06 Create reservation | Hold, lead contact, party allocations, source, pickup disposition, selected pricing inputs | bookings.create; tenant-owned references; totals derived server-side | Booking draft/held state and quote; stale configuration triggers re-quote, never silent price change |
| S07 Record manual payment | Booking, permitted method, amount/currency, occurred time, reference/reason and actor | payment.record; accepted policy; integer amount; duplicate key protection | Append-only payment fact or explicit pending state; never auto-confirm |
| S08 Confirm | Booking/hold ID, expected version, idempotency key and accepted quote | bookings.confirm; valid hold, current capacity, configured payment/credit policy | Atomic commitment, immutable PriceSnapshot, audit/outbox, canonical booking response |
| S09 Read manifest | Departure ID | manifest.read plus tenant/record scope | Confirmed booking reference, party/category counts and pickup disposition; no other tenant's data |

Pickup disposition must explicitly say selected pickup, no pickup required, or unresolved with an operational task. A missing text value cannot mean all three. Exact unresolved-pickup confirmation policy needs product approval. Party size and seat consumption can differ for configured categories. Individual guest details may be collected later under an explicit completeness rule; lead contact is not automatically every passenger.

## Proposed technical contracts (not code)

Use the accepted layout `apps/api`, later `apps/web` and `apps/mobile`, plus `packages/shared`; create none during requirements work. Separate platform provisioning, tenant admin and staff/ops façades. Generate OpenAPI client types; do not share ORM entities with clients. API errors use the existing problem-details/versioning conventions.

Proposed operations: platform tenant provision; admin catalog/rates/schedules; staff availability/holds/bookings/manual-payments/confirm; ops manifest read. Staff tenant context comes from validated membership, not an arbitrary payload tenant ID. ADR 009 defines development sessions and the production identity gate.

## Schema plan and constraints

- Tenant, staff principal, membership, roles/permissions and support grant: unique tenant slug and scoped memberships; non-escalating grants; audited owner lifecycle. Separate identity partitions per ADR 005.
- Product, option, passenger category, seasonal rate, schedule and departure: composite tenant-owned foreign keys prevent cross-tenant references. Index schedule/departure by tenant, option and time; unique generated occurrence. Define rate-overlap/precedence constraints before E02 implementation.
- CapacityPool and InventoryHold: departure-scoped capacity, quantity, expiry, owner and consumption state; indexes for active/expiring holds. PostgreSQL transactions enforce shared capacity; Redis is not the sole authority.
- Booking, item/allocation, pickup selection and PriceSnapshot: tenant-owned references, version and state; index by tenant/departure/status and tenant/source/reference where uniqueness is applicable. Snapshot version is immutable and includes priced lines/currency and relevant policy/rate provenance.
- Manual Payment/PaymentTransaction: immutable amount/currency, booking, actor, method/reference and outcome; corrections linked, never overwrite. Do not call an unverified manual claim a successful gateway payment.
- AuditEvent, IdempotencyKey and OutboxEvent: business writes and audit/outbox commit together. Unique idempotency namespace includes tenant + actor/connector + operation/key, with request hash and stored result. Event processing needs durable deduplication.

Choose concrete names/types/ORM in the implementation ADRs. Store currency amounts as bounded integers with overflow-safe arithmetic; timestamps in UTC with tenant timezone retained for recurring schedules. Test RLS using the actual non-bypass application role as well as application filters.

## Confirm transaction and retries

1. Validate principal, tenant, permission, request hash and expected booking version. Claim/read idempotency record under concurrency control.
2. Lock the booking/hold and relevant capacity rows in a defined order. Check server time against expiry and reconcile the active allocation, excluding this hold from double subtraction.
3. Validate accepted price and manual payment/credit policy. In the same transaction consume the hold, commit booking capacity, set confirmed state, write PriceSnapshot, audit and outbox, and persist the idempotent result.
4. Commit, then allow the worker to handle permitted side effects. No network calls while holding capacity locks. For this slice, validate outbox behavior without real customer sends.

Reusing a key with identical payload returns the original result; changed payload yields a conflict. Different confirm keys for an already confirmed booking must not create a second capacity commitment. Database rollback must leave no partial booking/payment-state/audit/outbox transition. A payment already recorded in a prior transaction remains recorded if confirmation fails, with an explicit unresolved outcome.

Proposed events: `tenant.created`, `catalog.configured`, `departure.created`, `booking.held`, `inventory.hold_expired`, `payment.manual_recorded`, `booking.confirmed`, `departure.capacity_changed`. Version event payloads with tenant, aggregate ID/version, event ID, actor/correlation, occurred time; exclude unnecessary passenger data. Consumers deduplicate per event and handler; outbox delivery is at-least-once, not a claim of exactly-once transport.

## Business decisions still needed

- Hold TTL, generation horizon, price validity, required contact/passenger fields and unresolved pickup policy.
- `pending_payment` does not specify whether/for how long inventory remains held. Proposed rule: a live hold retains seats only until its expiry; confirmation without a live hold must obtain capacity again. Accept this explicitly in the authoritative state/inventory docs before code.
- Confirm after hold expiry fails cleanly as required by delivery; the same booking's later recovery/re-hold behavior needs an explicit transition rather than an invented FSM edge.
- Financial confirmation eligibility and FX/tax policy remain open. No unlimited credit or zero-tax business default is inferred from missing input.
- Rate precedence when both channel and partner overrides apply; seasonal overlaps; schedule daylight-saving ambiguity policy.
- Capacity sale vs resource readiness follows pricing-and-inventory: an unassigned required vehicle can make operations unready without automatically closing seat sales. Specify sell-blocking closures separately.

## Acceptance evidence

- **A01:** provision two synthetic tenants; cross-tenant booking, hold, manifest, membership and foreign-key references fail without leaking records.
- **A02:** create an expiring hold; before expiry availability subtracts it once, after expiry seats return even if cleanup worker is delayed; expired confirm fails.
- **A03:** concurrent holds/confirms for the last seat cannot both succeed; rollback/retry leaves correct totals. No overbook exception in this slice unless explicitly promoted.
- **A04:** duplicate confirm with the same key returns the same booking/snapshot; changed payload conflicts; a different key cannot recommit capacity.
- **A05:** manual payment does not auto-confirm; disallowed/pending payment cannot satisfy a required settled-payment policy. Allowed credit/manual policy is explicit in test setup.
- **A06:** confirmation freezes price; later catalog edits do not change booking/manifest money facts. Integer amount/currency and recorded conversion rules are tested.
- **A07:** manifest contains confirmed booking, party counts and pickup disposition only for authorized scope; drafts/expired holds are not confirmed manifest entries.
- **A08:** each mutation carries tenant, actor, timestamp, before/after and required reason. Outbox and audit roll back with failed writes; delivery retries do not repeat logical side effects.
- **A09:** schema migration, validation failures, RBAC denials, recurrence retries and optimistic-version conflicts have documented evidence.

Use database integration tests for locking/RLS, service tests for policy/pricing, and an API end-to-end journey for the whole slice. No frontend tests before a frontend exists. Synthetic fixtures demonstrate two tenants without shipping launch-tenant business defaults.

## Implementation evidence

See [ADR 009](../../DECISIONS/009-first-slice-foundation.md), [local development](../../HANDOFF/local-development.md) and [test evidence](../../TESTING/first-slice-evidence.md). Earlier proposed details are requirements context; the implementation evidence distinguishes shipped behavior and remaining scope.
