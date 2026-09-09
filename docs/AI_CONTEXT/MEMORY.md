# Session memory

Keep under 200 lines. Update after sessions that change standing decisions.

**Last updated:** 2026-09-09

## Standing decisions

- **External partners/resellers:** means hotels/resellers belonging to a tenant's partner network, not tenant staff. Track A uses staff-managed partner records, evidence, obligations and remittances; no shared tenant-staff login for partners. Partner portal and automated settlement remain Track B.
- **Requirements package:** [../STRATEGY/requirements-plan.md](../STRATEGY/requirements-plan.md) indexes module/feature map, proposed RBAC, admin/navigation, tenant payments, first-slice specification and acceptance checklist. Owner accepted recommendations for implementation with mock data. Production business inputs remain open.

- **Requirements before scaffolding.** Requirements were reviewed and owner authorized coding with configurable mock data on 9 September 2026. Implement the first slice; production business facts remain unresolved.
- **Separate payment domains.** Owner reports an existing Stripe setup for Zettaz SaaS subscriptions. Offer optional Stripe Connect for tenant booking collections and research regional gateways. Tenant/operator perspective is the current focus; launch gateway, Connect funds flow, fees, and responsibilities remain open. See [../ARCHITECTURE/integrations.md](../ARCHITECTURE/integrations.md). Guest payment and collector remittance must remain distinct; subscription billing must not affect booking balances. Track B billing/settlement deferrals remain unchanged.

- **Docs layout** follows the Zettaz shared tree (STRATEGY, ARCHITECTURE, DECISIONS, AI_CONTEXT, CLIENTS, FEATURES, MODULES, TESTING, HANDOFF, ISSUES_FIXES). New files go in the matching folder, never at `docs/` root.
- **Stack is NestJS + Next.js + Expo + PostgreSQL + Redis + S3 + outbox.** Herd is only a folder location. ADR 001. Do not introduce Laravel as the application runtime.
- **Track A vs Track B.** Spreadsheet cutover first. Reseller portal, certified OTAs, fleet suite, new public checkout, and second-tenant SaaS packaging are Track B. [../STRATEGY/launch-contract.md](../STRATEGY/launch-contract.md) wins on scope.
- **Three state machines.** Booking never means boarded. [../ARCHITECTURE/domain-and-states.md](../ARCHITECTURE/domain-and-states.md) wins on states.
- **Track A pricing** is passenger category + seasonal calendar + one add-on + channel/contract override. Freeze `PriceSnapshot` on confirm.
- **Shared tours first.** Do not fake private charters or transfers as shared-tour departures.
- **WP Travel Engine stays** the public booking site through Track A.
- **Payments never last-write-wins** on offline sync. Check-in events append. Assignments are server-authoritative.
- **No Rock Adventures hard-coding.** Tenant data lives in CLIENTS and the configuration workbook, not in application defaults.

## Open (do not invent in code)

- Launch payment gateway and card-present path
- USD vs XCD roles (booking / collection / reporting)
- Configuration workbook data for tenant one (schema exists; values do not)

## First slice

Tenant → shared tour + departure → availability → hold → manual reservation → manual payment state → confirm → manifest → audit.

See [../STRATEGY/delivery.md](../STRATEGY/delivery.md).

## Implementation started — 9 September 2026

- First-slice NestJS/PostgreSQL API exists under apps/api, with shared validated contracts under packages/shared. See ADR 009 and HANDOFF/local-development.md.
- npm run demo provisions two isolated mock tenants; npm test runs real PostgreSQL/RLS/concurrency tests. Production startup is blocked pending identity/MFA and launch hardening. Next.js tenant operations UI now exists under apps/web (ADR 010); Expo and live payment integration remain unimplemented.
- Terminology is Partners/Resellers for external hotel/reseller organizations.

## Tenant workspace — 9 September 2026

- `npm run demo:web` starts the loopback Next.js UI and API with two mock tenant-owner sessions. API port can be overridden with PORT; UI uses 3000.
- Web routes proxy allowed tenant façades with HttpOnly session cookies and same-origin mutation checks. No browser-visible tokens, platform provisioning proxy or production authentication.
- Added paginated workspace reads, tenant-scoped staff-directory policy migration, and hold expiry in booking detail. API tests: 15 passing; Next.js optimized build and web HTTP smoke pass. Browser interactions/visuals not yet tested.
- See TESTING/tenant-workspace-evidence.md and HANDOFF/local-development.md for implemented UI scope and remaining gaps. The application is mock-only; do not claim full Track A or SaaS launch readiness.

## Reservation changes — 9 September 2026

- ADR 011: confirmed bookings support quoted departure/party and guest/pickup amendments, with ordered capacity locks, immutable snapshots/history and original allocation preservation. Quotes do not hold seats. Held bookings support guest/pickup corrections without extending expiry.
- Live held and future confirmed bookings can cancel atomically; payments remain unchanged. No auto-refund or fee entitlement. Credit/cancellation payments expose finance-review flags. Cancelled bookings cannot collect or confirm.
- New tenant flag allowAmendmentBalance defaults false; synthetic fixtures explicitly enable it. Actual commercial policies are still open. A future finance increment must address review/payment corrections before claiming complete cancellation finance. Continue the delivery order with the operations board and pickup planning.

- Reservation-change verification: 19 API/PostgreSQL tests, optimized Next.js build and full web HTTP amendment/cancellation smoke passed. Browser visual acceptance remains outstanding. Evidence: TESTING/booking-changes-evidence.md.
- ADR 012 operations increment: day dispatch board, controlled pickup locations and explicit ordered pickup plans are implemented. No automatic routing, resource/crew assignment, readiness, cruise constraints, weather, check-in or messages. `operations.write` is granted to owner/admin/dispatcher. Stop cleanup follows cancellation and pickup/departure amendments. Evidence: TESTING/operations-pickup-evidence.md.
- Printable pickup lists are implemented as a tenant-scoped server read with ordered stops and exception flags for unplanned or unresolved pickups. Browser print/Save as PDF is the paper fallback; no stored PDF, offline cache, route calculation or readiness certification. Requirements: FEATURES/operations/printable-pickup-list.md.
