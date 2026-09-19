# Launch contract

**Version 2.0 · 5 September 2026**

This document wins on scope, tracks, deferrals, and go-live. Index: [README.md](../README.md).

## Dual track

The v1.1 blueprint treated “full platform including reseller portal” as the release. That is the product destination, not the first cutover.

| Track | Goal | Suggested window |
| --- | --- | --- |
| **A — Spreadsheet cutover** | Rock Adventures stops creating new daily sheets. The platform is the operational source of truth. | 12–16 weeks after a short foundation, including a 7–14 day parallel run |
| **B — Productization** | Reseller portal, certified OTA connectors, fleet suite, new public checkout, white-label, second tenant. | After Track A is stable |

Do not wait for Viator or GetYourGuide certification to replace the spreadsheet. Launch canonical reservations and operations first, with assisted channel import. Run a short parallel period, then freeze spreadsheet entry.

## Track A — in scope

- Tenant, identity, RBAC, audit, support access grants
- Catalog: shared tours, options, passenger categories, recurring departures, blackouts, weather/closure holds
- Availability: seat pools, short holds, one exclusive resource type per departure, authorized overbooking with reason
- Manual and staff-assisted reservations (phone, WhatsApp, walk-in, email, CSV/assisted OTA)
- Customers, passengers, pickup, accommodation stay, cruise-call link
- WP Travel Engine webhook/API inbox so website bookings are not retyped
- Operations board, assignments, pickup routes, readiness, print/PDF day manifest
- Check-in: balance due, allowed collection, digital waiver, cleared-to-board gate
- Crew mobile: assigned trips, check-in, trip events; offline after the first connected week if needed. One Expo binary (phone, tablet, Pay sheet) — [crew-app-delivery.md](crew-app-delivery.md)
- Payments: deposits, balances, cash/link/manual states, booking/collection/reporting currencies
- Partner organization + agent attribution + “invoice this partner” flag and statement lines
- Assignment blocked when a required license or insurance document is expired, with override + audit
- Notifications for confirmation, payment request, waiver, cancellation (email first; SMS/WhatsApp templates later)
- Import of future bookings with reconciliation against sheet totals

## Track A — must-haves the v1.1 spec under-specified

| Must-have | Why it appears in week one |
| --- | --- |
| Weather/closure + mass rebook | Caribbean tours cancel by morning conditions. Closed attractions today live in spreadsheet cells. |
| CruiseCall entity | Ship/Hotel is a primary workbook column. Guests have all-aboard times, not only hotel lobbies. |
| Print/PDF day manifest and pickup list | Crew need a paper backup when data dies. Not a consumer app — a sheet of paper. |
| License/insurance expiry blocks assignment | A captain or vehicle can be legally unassignable before the Phase 4 fleet suite exists. |
| USD and XCD roles | Guest price, cash collection, and bank settlement often disagree. |

## Explicitly deferred (Track B or later)

| Item | Defer as |
| --- | --- |
| Reseller / agent portal | Tenant staff enter external partner bookings in the reservation workspace with contract rates stored as data. External partners do not receive tenant-staff access. |
| Full commission engine, aging, credit notes | Track A stores collection responsibility and an invoice flag. Accrual triggers and statements deepen in Track B. |
| New public customer checkout | WordPress / WP Travel Engine remains the public booking site until the operations core is the system of record. |
| Native Viator / GetYourGuide connectors | Adapter interfaces and reconciliation yes; credentials and certification when approved. Do not promise dates. |
| OCTO façade as a production channel | Design the internal domain so an OCTO façade can be added; do not couple to OCTO schemas now. |
| Fleet maintenance, fuel logs, work orders, incidents suite | Minimum Track A: expiry documents that block assignment. Full lifecycle is Track B. |
| Waitlists, allotments, release periods | Holds + authorized overbooking cover the first season. |
| Group, promotional, and dynamic pricing engines | See [pricing-and-inventory.md](../ARCHITECTURE/pricing-and-inventory.md). |
| Private charter quote workflow | Charters are request → quote → hold a resource → confirm. Do not fake them as zero-capacity shared tours. Out of Track A unless promoted in writing. |
| Transfer time-window engine | Same: different inventory primitive. Out of Track A unless promoted. |
| WhatsApp Business bot | Staff-assisted capture with conversation/reference. Not an automated channel at launch. |
| GPS breadcrumbs / live ETAs | Privacy, battery, and legal review are open. Optional later model (stamps / fences / trails; do not start): [crew-gps-later.md](crew-gps-later.md). |
| Self-serve tenant billing, white-label, second-tenant onboarding | Second operator, not Rock Adventures go-live. |
| Full general ledger, payroll, public marketplace, automatic route optimization, native consumer app | Unchanged non-goals from v1.1. |

## Surfaces by track

| Surface | Track A | Track B |
| --- | --- | --- |
| Cloud admin + operations dashboard | Yes | — |
| Reservation workspace | Yes | — |
| Staff mobile (Expo) | Yes (connected first; offline next) | Offline hardening, GPS policy |
| Print/PDF manifest | Yes | — |
| Customer portal (manage existing booking) | Minimal: waiver and payment links | Full self-service |
| New Next.js public checkout | No — WP stays | Yes |
| Reseller portal | No | Yes |
| Integration reconciliation workbench | Assisted import + WP inbox | Certified OTA + OCTO |

## Decisions that block E01

Requirements elaboration and decision register: [requirements-plan.md](requirements-plan.md). The September 9 owner clarification adds optional tenant Stripe Connect and regional-gateway research, separate from existing Zettaz subscription billing, and defines partners/resellers as external hotel/reseller partners. This does not select tenant one's launch gateway or promote self-service billing, partner portals, or automated settlements into Track A.

Stack is locked: NestJS + Next.js + Expo. See [001-stack-nestjs.md](../DECISIONS/001-stack-nestjs.md). The remaining rows must be written down before application code. Empty evidence is acceptable; silent invention in code is not.

| Decision | Why it matters | Owner / evidence | Status |
| --- | --- | --- | --- |
| Track A vs B accepted as written | Prevents building the portal before the spreadsheet dies | Founder | Accepted — owner authorization, 9 September 2026 |
| Three FSMs accepted | Prevents booking-status contradictions in E04–E07 | Product + engineering | Specified in [domain-and-states.md](../ARCHITECTURE/domain-and-states.md); accepted by owner, 9 September 2026 |
| Phase 1 pricing bound | Stops a six-month pricing engine inside reservations | Product | Specified in [pricing-and-inventory.md](../ARCHITECTURE/pricing-and-inventory.md); accepted by owner, 9 September 2026 |
| Inventory strategy: shared tours first | Stops a unified engine for charters and transfers | Product | Specified in [pricing-and-inventory.md](../ARCHITECTURE/pricing-and-inventory.md); accepted by owner, 9 September 2026 |
| Launch payment gateway and card-present path | Checkout, refunds, field collection | Owner + bank/gateway | Stripe Connect direct charges accepted as Rock's default online path; merchant eligibility, live capabilities, fees/disputes and card-present require provider evidence. See [ADR 016](../DECISIONS/016-rock-launch-operations.md). |
| USD vs XCD: booking, collection, reporting roles | Ledger and check-in UI | Owner + finance | USD accepted for Rock online booking, Stripe collection and launch reporting; XCD remains local/manual tender and requires an approved conversion-rate source before settling a USD balance. See [ADR 016](../DECISIONS/016-rock-launch-operations.md). |
| Offline payment conflict rule | Cash recorded twice must not last-write-win | Engineering | Specified in [finance-and-offline.md](../ARCHITECTURE/finance-and-offline.md); accepted by owner, 9 September 2026 |
| Configuration workbook filled enough to seed tenant one | Products, pickups, partners | Rock Adventures + Zettaz | Schema in [configuration-schema.md](../ARCHITECTURE/configuration-schema.md); data open |

Related discovery that does **not** block E01: exact live rates, Viator/GYG approval, GPS policy, full waiver legal wording, accounting chart mapping, complete asset register. Those can proceed in parallel.

## Go / no-go for Track A cutover

Named owner required. Parallel-run 7–14 operating days with rollback.

- Every future booking has date/time, product, party size, source, status, and pickup disposition.
- Daily totals reconcile or have documented exceptions.
- Paid / balance / invoice ownership reviewed for every future booking.
- Partner and channel references preserved.
- No asset/staff assignment conflicts for the launch window, except authorized overrides.
- Customer communications are not sent during dry-run imports.
- Print/PDF manifest used at least once in the parallel run.
- Weather/closure action exercised in a dry run.
- Spreadsheet entry freezes after cutover; the file is retained as evidence.

## Packaging (Track B commercial, not Track A engineering)

Working name: Zettaz Tours & Charters, pending trademark screening. Branding is tenant configuration.

| Edition | Best for | Modules |
| --- | --- | --- |
| Essentials | Small tour operators | Direct/manual booking, calendar, payments, manifest, basic reports |
| Operations | Vehicles, vessels, crews | Essentials plus dispatch, routes, staff mobile, waivers, resources |
| Growth | Multi-channel / reseller | Operations plus portal, commissions, invoicing, connectors |
| Enterprise | Multi-location / high volume | Advanced permissions, SLA, SSO, custom integrations, warehouse, premium support |

Prefer value-based subscription pricing over revenue share. Charge separately for high-cost messaging, premium connectors, extra locations, or heavy support. Validate Caribbean willingness-to-pay before publishing prices.

Plan-tier flags (what a tenant paid for) are not the same as engineering flags (unfinished connectors). See [domain-and-states.md](../ARCHITECTURE/domain-and-states.md).

## Implementation authorization — 9 September 2026

Owner accepted the recommended requirements and authorized application development using clearly labeled mock data. Unknown tenant settings remain configurable. Live gateways, FX collection, financial overrides and production onboarding require their outstanding evidence before enabling. First-slice delivery boundaries remain unchanged. See [ADR 009](../DECISIONS/009-first-slice-foundation.md).
