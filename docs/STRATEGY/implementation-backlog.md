# Ordered implementation backlog

**Updated:** 10 September 2026  
**Scope authority:** [launch contract](launch-contract.md) · **epic authority:** [delivery](delivery.md)

This is the working execution order. It records actual completion boundaries so a partially built screen is not mistaken for a launch-ready module.

## Current foundations

The persistent local PostgreSQL database is current through migration 051. Tenant settings, the responsive workspace, catalog, ordinary and authorized overbook availability, manual reservations, customer records, manifests, pickup planning, waiver templates, subscription read model, tenant RBAC, resources, partner finance, integration inbox, reports, PDF output, and the connected Expo crew client exist. They are tested development foundations, not a completed Track A cutover.

The current email/password entry screen authenticates through the API against the persistent database. The removed local access-file fallback cannot grant access. This is the first completed portion of E01; production lifecycle controls remain below.

## Execution order

1. **Complete E01 — identity and access.** **Core tenant boundary complete:** database-backed sign-in, tenant-scoped sessions, custom-role assignment, profile updates, membership deactivation with tenant-session revocation, one-time database-backed invitations and activation, account-wide session revocation, persistent identity-hash sign-in throttling, non-enumerating single-use account recovery, and tenant-owner-approved time-limited read-only support access are migrated and integration-tested. Provider-backed invitation/recovery delivery, privileged MFA, and a production platform identity entry surface remain release work. Keep server-side permission enforcement for every role.
2. **Finish E06 foundations — resources and operations.** **Implemented foundation:** controlled locations, crew, vehicle/vessel records, assignments, readiness views, expiry-document blocks, authorized audited override, itinerary points, map preview, weather/closure decisions, operational status views, tenant-owned cruise calls/accommodations, controlled reservation stay links, and previewed capacity-safe multi-booking closure recovery are implemented. Automated customer/channel communication and policy-driven bulk cancellation/refunds remain external-policy work.
   **E04 customer foundation implemented:** tenant-scoped reusable customer records, normalized-email duplicate reuse, booking-specific lead/purchaser/emergency-contact snapshots, customer search/detail, and consolidated booking/payment/waiver/message/change timeline. Manual merge/split and retention controls remain policy-dependent.
3. **Finish E06 output — print/PDF.** **Browser/PDF output complete:** browser print and server-produced PDF manifest/pickup-list output, versioned templates, station routing, durable print jobs, tenant isolation, and binary PDF acceptance coverage pass. Physical local-printer delivery through the documented Go agent remains blocked by device enrollment, privacy, and retention decisions. See [print architecture](../FEATURES/operations/print-architecture.md).
4. **Complete E08/E07 — waivers and crew check-in.** **Connected workflow complete:** assignment-scoped crew trips, passenger rosters and corrections, passenger/guardian waiver evidence, passenger check-in, opaque QR issue/resolve with mobile camera scanning, trip-run events, and a narrow Expo crew client are integration-tested; Android bundling and strict mobile type checks pass. Encrypted offline sync remains blocked on the privacy, device-storage, retention, and conflict policies in the launch contract.
5. **Complete E10 slim finance.** **Core offline/manual foundation complete:** partner organizations, attribution and immutable terms snapshots, collection claims and decisions, guest credit, partner obligations/statements, cancellation review flags, UI filtering, persistent referral/partner-collects/partner-invoice sample scenarios, and append-only manual-payment void/reversal handling are implemented and integration-tested. A correction never issues a refund or rewrites its original payment. Stripe and regional gateways remain behind disabled adapter boundaries pending the launch gateway and currency decisions.
6. **Complete E12/E13 integration hub and channel adapters.** **Channel-neutral inbox and import foundation complete:** the connector registry exposes capabilities and approval state for WordPress, Viator, GetYourGuide, CSV, and OCTO without enabling unavailable providers. Signed webhook ingestion, deduplication, quarantine review, account state, external product mapping, canonical CSV staging, duplicate/financial/import validation, row-level quarantine evidence, downloadable dry-run acceptance reports, bounded retry queuing and consumption, and reasoned dead-letter retention are tenant-scoped and integration-tested. See [ADR 015](../DECISIONS/015-channel-neutral-booking-core.md) and [import reconciliation](../FEATURES/integrations/import-reconciliation.md). Provider-specific transformation, certification, and production enablement remain evidence-bound.
7. **Complete customer communications.** **Implemented foundation:** booking confirmation, payment, waiver, and cancellation email requests are tenant-scoped, immutable, auditable, and explicitly held without a provider. Provider delivery, tenant sender setup, template versioning/localization, suppression handling, retries, and delivery webhooks remain pending the transactional email provider decision. See [customer notifications](../FEATURES/customer-notifications.md).
   **Track A reporting minimum implemented:** the date-filtered Reports page traces booking value, settled receipts, guest balances, partner obligations, departure volume and operational exceptions to tenant-scoped domain facts. Rich analytics, exports and scheduled reports remain Track B.
8. **Cutover readiness.** Run import reconciliation with tenant-one data and the required 7–14 day parallel operation, exercise closure/rebook and print/PDF paths, then freeze spreadsheet entry only after launch acceptance passes.
9. **Track B, in contract order.** Direct checkout, offline hardening, reseller portal, full finance, fleet/safety, OTA/OCTO, reporting and SaaS productization.

## Verification baseline

- Persistent database: migrations 001–051 applied; `Pending: 0`.
- API/PostgreSQL suite: 40 of 40 tests pass, including migration rerun, tenant isolation, support access, account recovery, payment correction, import reconciliation and retry consumption, PDF, reports, finance, integrations, and connected crew workflows.
- TypeScript application build: passes.
- Migration output now identifies the sanitized target, each script state, rollback, completed count, and pending count.

## Next executable work

1. Complete privileged-action MFA and production platform identity entry after the encryption/key-management and recovery-code policies are approved.
2. **Tenant-one import held for source reconciliation.** The August 2026 internal workbook has been profiled and its provisional mappings documented. Obtain a representative WordPress export/API payload, then reconcile stable booking IDs and financial facts before validating rows or implementing the separately permissioned apply workflow. See [workbook discovery](../CLIENTS/rock-adventures-august-2026-workbook-discovery.md).

Live gateway collection, provider delivery, WordPress event mapping/certification, printer-agent deployment, offline mobile storage, and cutover execution remain dependency-bound items listed below.

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

- Launch payment gateway and card-present collection path.
- Booking, collection and reporting currency policy, including USD/XCD roles.
- Tenant-one configuration workbook: products, locations, resources, routes and partners.
- Privacy, retention and consent policy before live GPS is enabled.
- Final legal waiver wording and accounting chart mapping.
