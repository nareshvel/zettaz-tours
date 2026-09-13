# Ordered implementation backlog

**Updated:** 11 September 2026  
**Scope authority:** [launch contract](launch-contract.md) · **epic authority:** [delivery](delivery.md)

This is the working execution order. It records actual completion boundaries so a partially built screen is not mistaken for a launch-ready module.

## Current foundations

The persistent local PostgreSQL database is current through migration 056. Tenant settings, the responsive workspace, normalized catalog and availability foundation, operational departure views, ordinary and authorized overbook availability, manual reservations, customer records, manifests (including boarding Pay and partner clearance), pickup planning, waiver templates, subscription read model, tenant RBAC, resources, partner finance, integration inbox, reports, PDF output, and the connected Expo crew client exist. They are tested development foundations, not a completed Track A cutover.

The current email/password entry screen authenticates through the API against the persistent database. The removed local access-file fallback cannot grant access. This is the first completed portion of E01; production lifecycle controls remain below.

## Execution order

1. **Complete E01 — identity and access.** **Core tenant boundary complete:** database-backed sign-in, tenant-scoped sessions, custom-role assignment, profile updates, membership deactivation with tenant-session revocation, one-time database-backed invitations and activation, account-wide session revocation, persistent identity-hash sign-in throttling, non-enumerating single-use account recovery, and tenant-owner-approved time-limited read-only support access are migrated and integration-tested. Provider-backed invitation/recovery delivery, privileged MFA, and a production platform identity entry surface remain release work. Keep server-side permission enforcement for every role.
2. **Finish E06 foundations — resources and operations.** **Implemented foundation:** controlled locations, crew, vehicle/vessel records, assignments, readiness views, expiry-document blocks, authorized audited override, itinerary points, map preview, weather/closure decisions, operational status views, tenant-owned cruise calls/accommodations, controlled reservation stay links, and previewed capacity-safe multi-booking closure recovery are implemented. Automated customer/channel communication and policy-driven bulk cancellation/refunds remain external-policy work.
   **E04 customer foundation implemented:** tenant-scoped reusable customer records, normalized-email duplicate reuse, booking-specific lead/purchaser/emergency-contact snapshots, customer search/detail, and consolidated booking/payment/waiver/message/change timeline. Manual merge/split and retention controls remain policy-dependent.
3. **Finish E06 output — print/PDF.** **Browser/PDF output complete:** browser print and server-produced PDF manifest/pickup-list output, versioned templates, station routing, durable print jobs, tenant isolation, and binary PDF acceptance coverage pass. Implement the Go-agent one-time enrollment and revocable device credentials in [ADR 016](../DECISIONS/016-rock-launch-operations.md); live routing then requires Rock's actual station/printer inventory and retention choice. See [print architecture](../FEATURES/operations/print-architecture.md).
4. **Complete E08/E07 — waivers and crew check-in.** **Connected workflow complete:** assignment-scoped crew trips, passenger rosters and corrections, passenger/guardian waiver evidence, passenger check-in, opaque QR issue/resolve with mobile camera scanning, trip-run events, and a narrow Expo crew client are integration-tested; Android bundling and strict mobile type checks pass. **Web boarding money path added 11 September 2026:** partner invoice/collect clear by policy; guest remainders use on-manifest Pay then Waiver/Board; see [boarding balance collection](../FEATURES/operations/boarding-balance-collection.md). Implement the encrypted SQLite cache, device enrollment, 24-hour authorization lease, resumable waiver evidence and conflict-aware command sync specified by [ADR 016](../DECISIONS/016-rock-launch-operations.md). Crew-mobile Pay UI remains pending.
5. **Complete E10 slim finance.** **Core offline/manual foundation complete:** partner organizations, attribution and immutable terms snapshots, collection claims and decisions, guest credit, partner obligations/statements, cancellation review flags, UI filtering, persistent referral/partner-collects/partner-invoice sample scenarios, and append-only manual-payment void/reversal handling are implemented and integration-tested. A correction never issues a refund or rewrites its original payment. Implement Stripe Connect direct-charge Checkout and webhook reconciliation for Rock in USD behind the existing adapter boundary; retain XCD manual receipts as review-required until the conversion-rate policy is supplied.
6. **Complete E12/E13 integration hub and channel adapters.** **Channel-neutral inbox and import foundation complete:** the connector registry exposes capabilities and approval state for WordPress, Viator, GetYourGuide, CSV, and OCTO without enabling unavailable providers. Signed webhook ingestion, deduplication, quarantine review, account state, external product mapping, canonical CSV staging, duplicate/financial/import validation, row-level quarantine evidence, downloadable dry-run acceptance reports, bounded retry queuing and consumption, and reasoned dead-letter retention are tenant-scoped and integration-tested. See [ADR 015](../DECISIONS/015-channel-neutral-booking-core.md) and [import reconciliation](../FEATURES/integrations/import-reconciliation.md). Provider-specific transformation, certification, and production enablement remain evidence-bound.
7. **Complete customer communications.** **SMTP delivery live:** booking confirmation, payment, waiver, and cancellation emails send via platform `SMTP_*` settings; failed/held rows support Retry. Remaining: tenant-editable localized templates, suppression, delivery webhooks, per-tenant From. See [customer notifications](../FEATURES/customer-notifications.md) and [ADR 016](../DECISIONS/016-rock-launch-operations.md).
   **Track A reporting minimum implemented:** the date-filtered Reports page traces booking value, settled receipts, guest balances, partner obligations, departure volume and operational exceptions to tenant-scoped domain facts. Rich analytics, exports and scheduled reports remain Track B.
8. **Cutover readiness.** Run import reconciliation with tenant-one data and the required 7–14 day parallel operation, exercise closure/rebook and print/PDF paths, then freeze spreadsheet entry only after launch acceptance passes.
9. **Track B, in contract order.** Direct checkout, offline hardening, reseller portal, full finance, fleet/safety, OTA/OCTO, reporting and SaaS productization.

## Verification baseline

- Persistent database: migrations 001–055 applied; `Pending: 0`.
- API/PostgreSQL suite: 43 of 43 tests pass, including normalized catalog storage, availability rules, product/rule read-and-update, migration rerun, tenant isolation, support access, account recovery, authenticated crew sessions, payment correction, import reconciliation and retry consumption, PDF, reports, finance, integrations, and connected crew workflows.
- TypeScript application build: passes.
- Migration output now identifies the sanitized target, each script state, rollback, completed count, and pending count.

## Next executable work

1. **Subscription polish (partial — finish messaging).** Responsive plan grid (4→2→1) and owner-only profile embedding done 11 September 2026. Remaining: billing-cycle and failed-payment/grace messaging across phone/tablet/desktop. Tracked as row 17 in [ui-waiver-launch-task-list.md](ui-waiver-launch-task-list.md); evidence in `docs/TESTING/subscription-polish-evidence.md`.
2. **Profile polish + responsive follow-up implemented 11 September 2026.** Identity rail, sticky saves, ConfirmDialog for sign-out-everywhere; MFA/recovery deferred honestly; stacked ≤1366px flush rail/content. Owner visual acceptance outstanding; see `docs/TESTING/profile-polish-evidence.md`.
3. **Owner visual acceptance backlog (no new build required until feedback).** Surfaces already polished and waiting a pass: Reservation detail (9), Manifest (11), Finance (12), Reports (13), Team & resources (14), Staff & access (15), Tenant settings (16), Profile (18), plus earlier Catalog / Departures / New reservation / Reservations list rows still marked for review. Subscription (17) needs a pass after messaging polish lands.
3. **Hard-refresh landing flash fixed 11 September 2026.** Workspace SSR-bootstraps session; unknown session shows a neutral loader instead of public landing. Spot-check with hard refresh on `/operations` while signed in.
4. **Day Board / pickups — built and owner-accepted 11 September 2026.** Evidence: `docs/TESTING/day-board-polish-evidence.md`. Includes location modal CRUD and print-list polish.
5. **Tenant settings follow-up 11 September 2026.** Shared ISO country list (`packages/shared/src/countries.ts` / `@/lib/countries`), General & branding country dropdown, locked Track A currency explanation, exclusive tax-rate copy, denser desktop meta type, tighter mobile/tablet tab-to-content spacing. Evidence: `docs/TESTING/tenant-settings-polish-evidence.md`.
6. **Departures Book → locked New reservation 11 September 2026.** Book deep-links with departure/product/date; New reservation shows only that trip until Change. Workspace departures accept `departureId`.
7. Complete the departure passenger waiver vertical slice: encrypted offline command/media sync, authoritative retained PDF, and optional drive-copy adapters. The connected name/stay/signature workflow and web boarding Pay path are already implemented.
8. Complete privileged-action TOTP MFA, encrypted seed storage, one-time recovery codes and production platform identity entry using the standard policy accepted in [ADR 016](../DECISIONS/016-rock-launch-operations.md).
9. **Tenant-one import held for source reconciliation.** The August 2026 internal workbook has been profiled and its provisional mappings documented. Obtain a representative WordPress export/API payload, then reconcile stable booking IDs and financial facts before validating rows or implementing the separately permissioned apply workflow. See [workbook discovery](../CLIENTS/rock-adventures-august-2026-workbook-discovery.md).

WordPress event mapping can remain paused. Live Stripe enablement, SMTP credentials/DNS verification, printer inventory, offline mobile implementation, and cutover execution are the active dependency-bound items in [ADR 016](../DECISIONS/016-rock-launch-operations.md).

Boarding money **pending** (do not treat as done): complimentary/prepaid policy flags, authorized boarding exceptions, mixed collection allocation, crew-mobile Pay UI, import/WTE collection-mode mapping discipline — [boarding-balance-collection.md](../FEATURES/operations/boarding-balance-collection.md).

## Roles to add with assignment-aware record rules

- **Guide / crew:** assigned manifest, waiver/check-in status and trip events only.
- **Driver / skipper:** assigned departure, pickup sequence, minimum passenger data and safety checks only.
- **Resource manager:** crew qualifications, asset records and expiry documents.
- **Partner manager:** partner organization, contract and reservation attribution workflows.
- **Operations manager:** broad operations and assignments without tenant administration or finance access.

Do not grant these roles broad booking, payment, tenant-setting or customer-history access merely because they need a mobile view. Assignment-aware access requires server predicates; client navigation is never authorization.

## Geolocation decision

Location improves the departure detail, dispatch planning, guide briefing and guest pickup coordination. Track A therefore includes tenant-controlled, non-live map views for tour/charter itinerary points, controlled pickup locations, meeting points and relevant port/marina locations.

Each location must have a name, address or directions, latitude/longitude when supplied, optional map link, visibility policy, and tenant ownership. A map is an aid, not proof of route completion. Live staff/vehicle GPS, breadcrumbs and ETAs remain Track B pending privacy, consent, battery, retention and local legal decisions, as required by the launch contract.

## Outstanding product decisions

- Stripe merchant eligibility, responsibility/fee terms, webhook setup, refunds/disputes, and card-present eligibility.
- Rock's approved XCD-to-USD rate source and rounding rule for applying local tender to USD balances.
- Tenant-one configuration workbook: products, locations, resources, routes and partners.
- Privacy, retention and consent policy before live GPS is enabled.
- Final legal waiver wording and accounting chart mapping.
