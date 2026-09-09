# Delivery

**Version 2.0 · 5 September 2026**

Index: [README.md](../README.md) · Scope: [launch-contract.md](launch-contract.md)

## Track A epic order

Implement in this order. Do not start Track B epics to “save a later refactor” unless the launch contract is updated.

| Order | Epic | Deliverable | Cutover role |
| --- | --- | --- | --- |
| 1 | E01 Tenant and identity | Provisioning, memberships, RBAC, audit, support access | Required |
| 2 | E02 Catalog | Products, options, passenger categories, schedules, policies, **bounded** pricing | Required |
| 3 | E03 Availability | Seat pools, holds, concurrency, one exclusive resource type | Required |
| 4 | E04 Reservations | Customer/passenger, manual booking, changes, cancellation, timeline | Required — replaces the daily sheet |
| 5 | E06 Operations | Board, manifest, assignments, pickup route, readiness, **print/PDF** | Required |
| 6 | E08 / E07 Waivers and crew check-in | Templates, signatures, QR, check-in gate; mobile connected first | Required for day-of; offline store may follow the first connected week |
| 7 | E10 Finance (slim) | Ledger, balances, cash/link collection, partner invoice flag | Enough to stop reconstructing notes |
| 8 | E12 Integration hub + E13 WP bridge | Webhooks, mappings, assisted import, WP inbox | Stops retyping website and voucher bookings |

Foundation (workflow interviews, asset/route/product inventory, gateway decision, data cleanup, design system) is 2–3 weeks before or overlapping E01. Suggested Track A cutover: 12–16 weeks after foundation plus a 7–14 day parallel run — not the v1.1 sequential 32-week plan.

### After cutover (Track B)

| Epic | Deliverable |
| --- | --- |
| E05 Direct checkout | Next.js booking UI, payment session, customer portal |
| E07 Offline hardening | Encrypted SQLite, conflict UI, media resume (if not already done) |
| E09 Reseller | Contracts, rates, allotments, agent portal, vouchers |
| E10 Finance (full) | Commission engine, statements, settlements, accounting export |
| E11 Fleet/safety | Inspections, maintenance, fuel, incidents, utilization |
| E14 OCTO / OTA | Façade and approved connectors |
| E15 Reporting | Richer operational and finance views |
| E16 SaaS productization | Plans, onboarding, white-label, second tenant |

Tenant staff enter bookings received from external hotels and resellers in the reservation workspace with contract rates as data until E09. External partners do not receive tenant-staff credentials.

## First vertical slice

Detailed proposed specification: [FEATURES/first-slice/requirements.md](../FEATURES/first-slice/requirements.md). Complete the [requirements readiness gate](requirements-plan.md) before creating application scaffolding; maintain the epic order and scope boundaries below.

Do not write application code until [launch-contract.md](launch-contract.md) blockers are acknowledged. Then implement **only** this slice.

Create tenant → configure a shared tour product and recurring departure → query availability → create a short inventory hold → create a manual reservation → record an offline/manual payment state → confirm booking → show it on the departure manifest → audit every mutation.

It must include migrations, API validation, permissions, concurrency tests, tenant-isolation tests, and developer documentation.

### Acceptance

- Two tenants cannot read each other’s bookings, holds, or manifests.
- A hold expires and releases seats. Confirm after expiry fails cleanly.
- Two concurrent confirms cannot both take the last seat.
- Duplicate confirm with the same Idempotency-Key returns the same booking.
- Manual payment state does not mark the booking confirmed until the confirm action runs (or confirm is explicitly allowed with that payment state per policy).
- Manifest lists the confirmed booking with party size and pickup disposition.
- Every mutation has an audit event with actor, time, tenant, before/after, and reason where required.
- Currency stored as integer minor units. `PriceSnapshot` exists after confirm.

### Out of this slice

Dashboards, Next.js checkout, Expo app, waivers, OTA adapters, commission math, charter/transfer engines, offline sync.

## Test layers

- Unit tests for pricing, policy, commission (when built), capacity, and the three status machines.
- Database integration tests for tenant isolation, locking, and financial invariants.
- Contract tests for every connector and webhook signature/retry behavior.
- End-to-end tests for direct, manual, assisted-reseller, and (later) channel journeys.
- Offline/mobile tests for airplane mode, stale records, duplicate sync, interrupted media.
- Load tests for simultaneous availability/holds and peak channel updates.
- Security tests for IDOR, privilege escalation, tenant leakage, webhook replay, export access.
- Migration reconciliation tests using anonymized workbook samples.

## Launch-blocking acceptance (Track A)

- No known path can double-confirm the same constrained capacity.
- Duplicate webhooks cannot create duplicate bookings, refunds, or commissions.
- Crew can open the assigned manifest and record check-ins (offline when that epic is in).
- At check-in, staff see the exact balance due, collect or record an allowed payment, and get confirmation the balance is settled.
- Every required guest can sign the correct digital waiver on a customer or staff device, including a guardian workflow for minors.
- The system cannot mark a passenger cleared to board with an unpaid required balance or unsigned required waiver unless a specifically authorized, reasoned, audited exception is recorded.
- Offline check-in queues passenger status and waiver evidence without duplicating signatures or payments on retry.
- Finance can explain each booking amount, collected amount, balance, and invoice flag from snapshots and ledger lines.
- A cancelled or amended booking updates inventory and creates appropriate channel/reconciliation actions.
- A resource with an expired required document or open critical defect cannot be assigned without authorized override.
- Every privileged or financial change identifies actor, time, tenant, before/after, and reason.
- Print/PDF manifest can be produced for a departure day.
- Weather/closure action can rebook or cancel affected bookings without silently leaving partner invoice flags wrong.

## Coding-agent master prompt

Use this after the agent has read [README.md](../README.md).

```text
You are the lead product engineer for “Zettaz Tours & Charters,” a multi-tenant SaaS platform for tour, charter, excursion and transport operators. Rock Adventures Antigua is the launch tenant, but no domain rule, label, product, channel, price, route, payment method or partner agreement may be hard-coded for that tenant.

Read docs/README.md and the v2.0 docs completely before proposing code. Treat them as the source of truth. The archived v1.1 blueprint is historical only. First inspect the existing repository, AGENTS.md and established architecture. Do not replace working conventions without evidence.

On conflict: docs/STRATEGY/launch-contract.md wins for scope; docs/ARCHITECTURE/domain-and-states.md wins for states; docs/ARCHITECTURE/overview.md and docs/DECISIONS/ win for stack.

Primary product surfaces (Track A):
1. Cloud admin and operations dashboard (Next.js).
2. Staff mobile app (Expo) — connected first; encrypted offline data and conflict-aware sync as specified.
3. Reservation workspace for manual and assisted partner/channel entry.
4. Integration hub for WP Travel Engine, assisted import, payment and communication adapters.
5. Reseller portal, new public checkout, certified OTAs, and OCTO are Track B.

Non-negotiable engineering rules:
- NestJS modular monolith, Next.js web, Expo mobile, PostgreSQL, Redis, S3-compatible storage, transactional outbox.
- Multi-tenant isolation in database queries, storage, queues, caches, logs and tests. Single database, tenant_id, RLS as defense in depth.
- Three state machines: booking, passenger/check-in, trip-run. Booking status never means boarded.
- Track A pricing: passenger category, seasonal calendar, one add-on, channel/contract override. Freeze PriceSnapshot on confirm.
- Shared-tour inventory first (seats + optional one exclusive resource). Do not fake charters or transfers as shared tours.
- Booking/payment/refund/channel writes are idempotent. Webhooks are signed, deduplicated, retried and quarantined.
- Financial events, signed waivers, incidents and audit history are append-only or versioned; corrections use reversals/superseding records.
- Check-in shows the authoritative balance and waiver status, supports allowed balance collection, captures required guest/guardian signatures, and prevents boarding clearance until both requirements are satisfied or an authorized audited exception exists.
- Payments never last-write-wins when syncing offline. Check-in events append. Assignments are server-authoritative.
- Never store raw card data. Minimize passenger data exposed to crew and cached on devices.
- Direct Viator/GetYourGuide integration is approval dependent. Build adapter interfaces without pretending credentials exist.
- Do not couple the internal domain to OCTO schemas.

For the first response, do not write application code. Produce:
A. Repository assessment and gaps.
B. Proposed module/package structure.
C. Architecture Decision Records needed (do not reopen accepted ADRs 001–008 without evidence).
D. Database schema plan with key constraints and indexes.
E. Event catalog and idempotency strategy.
F. API surface and authentication model (split façades).
G. Offline sync strategy.
H. Security/threat-model checklist.
I. Phased backlog of epics and vertical slices aligned to Track A.
J. Exact first vertical slice, acceptance criteria and test plan.

The preferred first vertical slice is: create tenant -> configure a shared tour product and recurring departure -> query availability -> create a short inventory hold -> create a manual reservation -> record an offline/manual payment state -> confirm booking -> show it on the departure manifest -> audit every mutation. It must include migrations, API validation, permissions, concurrency tests, tenant-isolation tests and developer documentation.

Before implementing any slice, state assumptions and unresolved decisions from the launch contract. Use feature flags for unfinished external integrations. Keep generated code production-oriented, typed, tested, observable and migration-safe. Do not create placeholder business logic that silently becomes authoritative.
```
