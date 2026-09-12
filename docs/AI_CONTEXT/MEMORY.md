# Session memory

Keep under 200 lines. Update after sessions that change standing decisions.

**Last updated:** 2026-09-11

## Standing decisions

- **External partners/resellers:** means hotels/resellers belonging to a tenant's partner network, not tenant staff. Track A uses staff-managed partner records, evidence, obligations and remittances; no shared tenant-staff login for partners. Partner portal and automated settlement remain Track B.
- **Booking source vs settlement:** source slugs (`phone`, `walk_in`, `website`, `partner_reseller`) are channel attribution. Guest vs partner money follows collection mode and ledger facts. Channel brands (Viator, GetYourGuide) are partner organizations under Partner / reseller, not separate booking sources.
- **Boarding money:** `partner_invoice` and `partner_collects_for_tenant` clear boarding without a new guest payment; other bookings collect remaining guest balance on the web manifest Pay sheet. Pending: complimentary/prepaid flags, boarding exceptions, mixed allocation, crew-mobile Pay. See [../FEATURES/operations/boarding-balance-collection.md](../FEATURES/operations/boarding-balance-collection.md).

- **Requirements package:** [../STRATEGY/requirements-plan.md](../STRATEGY/requirements-plan.md) indexes module/feature map, proposed RBAC, admin/navigation, tenant payments, first-slice specification and acceptance checklist. Owner accepted recommendations for implementation with mock data. Production business inputs remain open.

- **Requirements before scaffolding.** Requirements were reviewed and owner authorized coding with configurable mock data on 9 September 2026. Implement the first slice; production business facts remain unresolved.
- **Separate payment domains.** Zettaz SaaS subscriptions remain separate from tenant booking money. Rock selected Stripe Connect direct charges as its default online collection path, with USD online booking/collection/reporting. XCD is allowed as recorded local/manual tender but cannot settle a USD balance without an approved rate snapshot. Provider eligibility, fees/disputes and card-present evidence remain. See [../DECISIONS/016-rock-launch-operations.md](../DECISIONS/016-rock-launch-operations.md).

- **Docs layout** follows the Zettaz shared tree (STRATEGY, ARCHITECTURE, DECISIONS, AI_CONTEXT, CLIENTS, FEATURES, MODULES, TESTING, HANDOFF, ISSUES_FIXES). New files go in the matching folder, never at `docs/` root.
- **Cross-IDE continuity:** [../HANDOFF/cross-ide-agent-resume.md](../HANDOFF/cross-ide-agent-resume.md) is the portable resume packet for ChatGPT, Cursor, Claude, Devin or another IDE agent. Update it whenever current state, next task or handoff procedure changes.
- **Stack is NestJS + Next.js + Expo + PostgreSQL + Redis + S3 + outbox.** Herd is only a folder location. ADR 001. Do not introduce Laravel as the application runtime.
- **Track A vs Track B.** Spreadsheet cutover first. Reseller portal, certified OTAs, fleet suite, new public checkout, and second-tenant SaaS packaging are Track B. [../STRATEGY/launch-contract.md](../STRATEGY/launch-contract.md) wins on scope.
- **Three state machines.** Booking never means boarded. [../ARCHITECTURE/domain-and-states.md](../ARCHITECTURE/domain-and-states.md) wins on states.
- **Track A pricing** is passenger category + seasonal calendar + one add-on + channel/contract override. Freeze `PriceSnapshot` on confirm.
- **Shared tours first.** Do not fake private charters or transfers as shared-tour departures.
- **Development data may be redesigned/reset.** No production tenants or bookings exist. Schema, migrations, and seeded demo bookings may be transformed or reset when a stronger tenant-neutral model or UX justifies it, provided migrations, seeds, tests, and docs move together. Freeze a non-destructive production baseline before onboarding. See [ADR 017](../DECISIONS/017-development-schema-reset-policy.md).
- **WP Travel Engine stays** the public booking site through Track A.
- **Payments never last-write-wins** on offline sync. Check-in events append. Assignments are server-authoritative.
- **No Rock Adventures hard-coding.** Tenant data lives in CLIENTS and the configuration workbook, not in application defaults.

## Open (do not invent in code)

- Stripe merchant eligibility, responsibility/fee terms, live webhook configuration, refunds/disputes, and card-present path
- Approved XCD-to-USD rate source and rounding rule
- SMTP secrets and sender-domain verification
- Rock printer/station inventory and final document retention
- Rock sign-off for schedules, capacities, waiver wording, operational configuration, and cutover evidence
- Complimentary/prepaid boarding-policy flags, authorized boarding exceptions, mixed collection, crew-mobile Pay UI

## First slice

Tenant → shared tour + departure → availability → hold → manual reservation → manual payment state → confirm → manifest → audit.

See [../STRATEGY/delivery.md](../STRATEGY/delivery.md).

## Implementation started — 9 September 2026

- First-slice NestJS/PostgreSQL API exists under apps/api, with shared validated contracts under packages/shared. See ADR 009 and HANDOFF/local-development.md.
- `npm run db:seed` maintains two isolated local demo tenants; `sample-river-excursions` is displayed as Rock Adventures Demo with workbook-informed catalog and operational reference data, while all guest and financial records remain synthetic. See [../CLIENTS/rock-adventures/demo-data.md](../CLIENTS/rock-adventures/demo-data.md).
- npm test runs real PostgreSQL/RLS/concurrency tests. Production startup is blocked pending identity/MFA and launch hardening. Next.js tenant operations UI and the connected Expo crew client exist; encrypted offline mobile sync and live payment integration remain policy-dependent.
- Terminology is Partners/Resellers for external hotel/reseller organizations.

## Boarding / partner reservation UX — 11 September 2026

- Partner / reseller booking source inlines organization + collection mode; Viator/GetYourGuide are partners, not sources.
- Confirm without guest payment for partner invoice/collect modes; boarding clearance matches that policy.
- Web manifest: balance amount badge, Pay sheet for guest remainders, Waiver action after partner-settled arrival, returnTo from departures Book → confirm.
- Next UI focus: finish **Subscription** messaging polish (row 17 — responsive plan grid + profile embedding done 11 September 2026). Profile polish + responsive flush follow-up implemented; short owner visual passes remaining for Profile, Subscription remainder, Tenant settings, and other polished surfaces.
- **Nav IA (11 September 2026):** Operations group order is Day Board → Departures → Reservations → Catalog. Customers sits under Insights (read history for now). Guest check-in lives only on the Manifest; Day Board’s primary trip action is Board guests.
- **Day Board polish (11 September 2026):** Weather hold / Close / Reopen and recovery apply use in-app `ConfirmDialog` (reason required for operational status). Day Board labels are Plan pickups vs Print pickup list; locations use FormDialog add/edit and ConfirmDialog delete; print list polished. Owner acceptance recorded in `docs/TESTING/day-board-polish-evidence.md`.
- **Reservation detail polish (11 September 2026):** Always-visible money strip; Amend/Cancel as full buttons; cancel confirm dialog; sticky amend/cancel actions; tablet single-column booking grid; denser change history. Pay/confirm/quote contracts unchanged.
- **Refresh flash fix (11 September 2026):** Hard refresh no longer flashes the public landing page. Pages SSR-bootstrap the session cookie via `loadWorkspaceBootstrap`; while session is unknown the app shows a neutral boot loader instead of Entry/landing.
- **Manifest polish (11 September 2026):** Day Board return link, Board guests hierarchy on tablet/phone, balance-due metric, print/PDF kept on mobile. Boarding money contracts unchanged.
- **Finance polish (11 September 2026):** Partner collections metrics, accept/reject confirm dialog, currency tags, mobile statement cards. Claim decision API unchanged.
- **Reports polish (11 September 2026):** Departure-date presets, currency/timezone basis copy, exception emphasis, mobile daily cards. Report API unchanged.
- **Team & resources polish (11 September 2026):** Tabbed Crew/Resources/Documents/Assignments layout (Catalog view-action-bar pattern); metrics + expiry callout; FormDialog create/edit; ConfirmDialog remove; override only when a document is expired.
- **Staff & access polish (11 September 2026):** Staff↔Roles tabs, metrics, invite/create FormDialogs, revoke ConfirmDialog, mobile member/role cards. Invitation and member PATCH APIs unchanged.
- **Tenant settings polish (11 September 2026):** Aside facts, `?tab=` deep links, short mobile nav labels, sticky saves, support-access ConfirmDialog with reason. Follow-up: shared `COUNTRIES` list + country dropdown, locked Track A currency copy, exclusive tax-rate explanation, denser desktop meta / tighter mobile tab spacing. Config APIs unchanged.
- **Departures Book lock (11 September 2026):** Book deep-links with departure/product/date; New reservation locks to that trip until Change; workspace departures accept `departureId`.
- **Profile polish (11 September 2026):** Account shell with identity rail and Profile / Security / Subscription tabs; Subscription owner-only under profile; ConfirmDialog for sign-out-everywhere; MFA deferred. Responsive follow-up: stacked ≤1366px with flush rail/content (no panel gap), subtitle margin cleared. See `docs/TESTING/profile-polish-evidence.md`.
- **Subscription polish (partial, 11 September 2026):** Embedded under profile for owners; plan grid responsive 4→2→1 columns (inline four-column override removed). Billing-cycle / grace messaging polish still open. See `docs/TESTING/subscription-polish-evidence.md`.
- **Shared countries:** `packages/shared/src/countries.ts` is the single ISO list; web re-exports `@/lib/countries`.
- **Dev log quieting:** Nest route dumps off unless `NEST_LOG=verbose`; Next.js incoming request dumps off unless `NEXT_REQUEST_LOG=verbose`.

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
