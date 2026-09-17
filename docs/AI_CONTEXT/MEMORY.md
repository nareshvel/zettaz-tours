# Session memory

Keep under 200 lines. Update after sessions that change standing decisions.

**Last updated:** 2026-09-17

## Current focus (agents)

- **Sprint board:** [../HANDOFF/agent-current-sprint.md](../HANDOFF/agent-current-sprint.md) — prefer over chat history.
- **Owner priority (17 Sep):** Crew Phases 2–3 (Pay + tablet) in the working tree, then deploy. Operations menu group = complete until testing finds gaps. **Hold** Subscription messaging. Phase 1 device notes parked for one later field pass.
- **In progress (15 Sep):** Tenant settings pass — printing, waivers, integrations, localization, sidebar. See the 15 September section below.
- **Crew app (17 Sep):** Plan accepted. Phase 1 live on production + EAS preview. Phase 1 UI notes parked until after Phase 2–3. Phase 2 Pay and Phase 3 tablet are in the working tree. Next: commit/push, deploy, new preview. Phase 4 offline waits for the first connected live week.
- **Deploy:** VPS at tip `34047a3` via `./deploy.sh` (migrations through **087**, Pending: 0). Phase 2 Pay and Phase 3 tablet may still be local — check `git status`.
- Claude paste brief: [../HANDOFF/claude-handoff-2026-09-14.md](../HANDOFF/claude-handoff-2026-09-14.md).

## Standing decisions

- **External partners/resellers:** means hotels/resellers belonging to a tenant's partner network, not tenant staff. Track A uses staff-managed partner records, evidence, obligations and remittances; no shared tenant-staff login for partners. Partner portal and automated settlement remain Track B.
- **Booking source vs settlement:** source slugs (`phone`, `walk_in`, `website`, `partner_reseller`) are channel attribution. Guest vs partner money follows collection mode and ledger facts. Channel brands (Viator, GetYourGuide) are partner organizations under Partner / reseller, not separate booking sources.
- **Boarding money:** `partner_invoice` and `partner_collects_for_tenant` clear boarding without a new guest payment; other bookings collect remaining guest balance on the web manifest Pay sheet or the Crew Phase 2 Pay sheet (in working tree). Pending: complimentary/prepaid flags, boarding exceptions, mixed allocation. See [../FEATURES/operations/boarding-balance-collection.md](../FEATURES/operations/boarding-balance-collection.md).

- **One Zettaz Crew binary.** Phone field, tablet dock, and Pay are densities of `apps/mobile`, not separate apps. Empty Today is correct when the actor is unassigned. Phased delivery: [../STRATEGY/crew-app-delivery.md](../STRATEGY/crew-app-delivery.md). GPS, card-present, consumer app, and a white-label second binary remain Track B.
- **Crew mobile production API:** phones call `https://tours.zettaz.com/api/mobile` (allowlisted Next.js proxy, Bearer only). Do not expose the full Nest API on the public hostname. Store runbook: [../HANDOFF/crew-mobile-store-publish.md](../HANDOFF/crew-mobile-store-publish.md).

- **Requirements package:** [../STRATEGY/requirements-plan.md](../STRATEGY/requirements-plan.md) indexes module/feature map, proposed RBAC, admin/navigation, tenant payments, first-slice specification and acceptance checklist. Owner accepted recommendations for implementation with mock data. Production business inputs remain open.

- **Requirements before scaffolding.** Requirements were reviewed and owner authorized coding with configurable mock data on 9 September 2026. Implement the first slice; production business facts remain unresolved.
- **Separate payment domains.** Zettaz SaaS subscriptions remain separate from tenant booking money. Rock selected Stripe Connect direct charges as its default online collection path, with USD online booking/collection/reporting. XCD is allowed as recorded local/manual tender but cannot settle a USD balance without an approved rate snapshot. Provider eligibility, fees/disputes and card-present evidence remain. See [../DECISIONS/016-rock-launch-operations.md](../DECISIONS/016-rock-launch-operations.md).

- **Docs layout** follows the Zettaz shared tree (STRATEGY, ARCHITECTURE, DECISIONS, AI_CONTEXT, CLIENTS, FEATURES, MODULES, TESTING, HANDOFF, ISSUES_FIXES). New files go in the matching folder, never at `docs/` root.
- **Cross-IDE continuity:** [../HANDOFF/agent-current-sprint.md](../HANDOFF/agent-current-sprint.md) is the single “what next” board; [../HANDOFF/cross-ide-agent-resume.md](../HANDOFF/cross-ide-agent-resume.md) is the fuller resume packet. Update both when next task or git/deploy truth changes; prefer the sprint board over chat history.
- **Stack is NestJS + Next.js + Expo + PostgreSQL + Redis + S3 + outbox.** Herd is only a folder location. ADR 001. Do not introduce Laravel as the application runtime.
- **Track A vs Track B.** Spreadsheet cutover first. Reseller portal, certified OTAs, fleet suite, new public checkout, and second-tenant SaaS packaging are Track B. [../STRATEGY/launch-contract.md](../STRATEGY/launch-contract.md) wins on scope.
- **Three state machines.** Booking never means boarded. [../ARCHITECTURE/domain-and-states.md](../ARCHITECTURE/domain-and-states.md) wins on states.
- **Track A pricing** is passenger category + seasonal calendar + one add-on + channel/contract override. Freeze `PriceSnapshot` on confirm.
- **Shared tours first.** Do not fake private charters or transfers as shared-tour departures.
- **Seat capacity ≠ fleet size.** Schedule capacity is the sellable seat pool for multiple bookings; tuk-tuks/boats live under Team & resources for assignment. See [../MODULES/Catalog/shared-capacity-vs-fleet.md](../MODULES/Catalog/shared-capacity-vs-fleet.md). Revisit only for exclusive-per-vehicle or sell-blocking multi-vehicle pools.
- **Schedule edit regenerates upcoming departures** with booking/hold guards. See [../MODULES/Catalog/schedule-regenerate-on-edit.md](../MODULES/Catalog/schedule-regenerate-on-edit.md).
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
- Complimentary/prepaid boarding-policy flags, authorized boarding exceptions, mixed collection

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
- **Nav IA (11 September 2026):** Operations group order is Day Board → Departures → Reservations → Catalog. Customers sits under Insights (read history for now). Guest check-in lives only on the Manifest; Day Board trip actions are **View / Board** + **Start trip** (weather/close/pickups moved to Manifest Options, 14 September 2026).
- **Day Board polish (11 September 2026):** Weather hold / Close / Reopen and recovery apply use in-app `ConfirmDialog` (reason required for operational status). Plan pickups vs Print pickup list labels; locations use FormDialog add/edit and ConfirmDialog delete; print list polished. Owner acceptance recorded in `docs/TESTING/day-board-polish-evidence.md`.
- **Reservation detail polish (11 September 2026):** Always-visible money strip; Amend/Cancel as full buttons; cancel confirm dialog; sticky amend/cancel actions; tablet single-column booking grid; denser change history. Pay/confirm/quote contracts unchanged.
- **Refresh flash fix (11 September 2026):** Hard refresh no longer flashes the public landing page. Pages SSR-bootstrap the session cookie via `loadWorkspaceBootstrap`; while session is unknown the app shows a neutral boot loader instead of Entry/landing.
- **Manifest polish (11 September 2026):** Day Board return link, Board guests hierarchy on tablet/phone, balance-due metric, print/PDF kept on mobile. Boarding money contracts unchanged.
- **Manifest gate toolbar (14 September 2026):** Three setup cards replaced with Search + Scan + Crew. Camera QR via `BarcodeDetector` when available; paste/search always work. Crew readiness is read-only. Pickup locations and itinerary edit stay off Manifest. See [../FEATURES/operations/manifest-boarding-toolbar.md](../FEATURES/operations/manifest-boarding-toolbar.md).
- **Day Board copy (14 September 2026):** Removed the Plan pickups / Print / Manifest explainer notice on Day Board. **Close** stays sellability (weather/closed); do not replace with Start. Trip **Start** / no-show rules: [../FEATURES/operations/departure-start-and-no-shows.md](../FEATURES/operations/departure-start-and-no-shows.md).
- **Start trip (14 September 2026):** `POST /ops/v1/departures/{id}/start` records trip-run `departed`, optionally marks remaining passengers no-show. Day Board CTA switches View / Board ↔ Start trip from boarding counts; Manifest header also offers Start. Evidence: [../TESTING/departure-start-evidence.md](../TESTING/departure-start-evidence.md).
- **Day Board / Manifest IA (14 September 2026):** Status filter is one dropdown beside the date control. Trip card keeps **View / Board** + **Start trip** only. Manifest **Options** holds Weather hold / Close / Reopen, Pickup list, Plan pickups, and Recovery. Print/Download are icon-only across doc toolbars.
- **Plan pickups Phase 1 (14 September 2026):** Header shows product + departure time + readiness metrics; Needs attention strip for unresolved / not-in-plan; smart Add (match selected location, seed times); Add all; reorder; per-stop notes; unsaved badge + print confirm. GET pickups now returns `departure` + `exceptions`.
- **Pickup IA (14 September 2026):** Location CRUD moved to Settings → Pickup locations; Plan pickups is sequencing-only. Day Board drops redundant eyebrow; no Pickup Plans card button. Mental model: [../FEATURES/operations/pickup-disposition-and-plans.md](../FEATURES/operations/pickup-disposition-and-plans.md). Shared multi-product van runs deferred.
- **Pickup location modal (14 September 2026):** Settings pickups/resellers tabs render outside the tenant-config `<form>`; FormDialog/ConfirmDialog portal to `document.body` (fixes nested-form hydration). Modal sections Identity / Location / Operations; hyphenated codes; address defaults from tenant city/country; Leaflet pin preview on **Esri World Street Map** + Esri geocode center (no API key; click to place). Open in Maps + fill map URL from coords. Places/routing deferred (ADR 012). Evidence: [../TESTING/pickup-location-modal-and-print-evidence.md](../TESTING/pickup-location-modal-and-print-evidence.md).
- **Print pickup list (14 September 2026):** Matches Plan pickups header/metrics/Needs attention; driver sequence cards (no duplicate desktop table). Seed creates four planned stops plus unresolved + not-in-plan guests on the rolling demo day.
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

## Tenant settings + printing — 15 September 2026

- **Printing is implemented.** Server-rendered vector PDF in four paper profiles (A4 / Letter / 80 mm / 58 mm), delivered to the shared Zettaz Go print agent when paired, otherwise to the browser. Contract is Cloud's verbatim except `clientId`. Do not "improve" the job field names on one side. [ADR 018](../DECISIONS/018-print-delivery-and-agent.md), [printing-and-print-agent.md](../FEATURES/operations/printing-and-print-agent.md).
- **Paper travels with the job.** `print_jobs.media_size` (migration 079) is sent to the agent; CUPS anchors to the queue's media box and silently clips a mismatch. Wrapping is by measured Helvetica width — character counts overflowed 58 mm by 27%.
- **Printer routing is per document type, per browser.** The agent reports identical hardcoded capabilities for every queue, so a roll-vs-sheet guess comes from the queue name, is labelled as a guess, and is overridden by assignment. Never claim the agent detects printer type.
- **Every print is recorded.** Job row created first and unconditionally; `requested → rendered → delivered | failed`. Migration **080** grants `print.jobs.create/read` to `reservations` and `finance` — they had `bookings.write`/`payment.write` but no print permission, so the web app had been calling `window.print()` with no audit row. That bypass is gone.
- **A phone or tablet cannot reach an agent** (loopback). It gets the identical PDF via the OS print sheet. Server-pushed jobs to a remote agent needs agent-side polling — Track B; `printer_routes` stays dormant.
- **Waiver templates moved to Operations** and renamed. Content is immutable (migration 012 trigger) and signatures FK the template row, so **edit = publish next version**. The active version can never be deleted; a signed version can never be deleted. `GET waiver-templates` stays active-only; `?history=1` is for settings alone. [waiver-template-lifecycle.md](../FEATURES/tenant-settings/waiver-template-lifecycle.md).
- **Localization is now honoured.** `config.locale` and `config.numberFormat` were dead config — `money()` defaulted to `"en"`. `setFormatContext()` is set beside the tenant context; `money`/`dateOnly`/`dateTime`/`formatMediumDate`/`friendlyDateTime` follow it. `numberFormat` maps to a number-only locale (`comma_decimal → en-US`, `decimal_comma → de-DE`) via `numberLocaleFor()`; month names keep the display language.
- **Do not expose config that nothing reads.** `supportedLocales` stays hidden until guest-facing output is translated; a default guest country waits for a field that uses it. A control that changes nothing is worse than a missing one.
- **Settings sidebar** shows outstanding setup steps (`GET admin/v1/tenant/readiness`: product, departure, pickup locations, waiver, logo, team) instead of restating currency/date format/hold window. It hides itself once nothing is outstanding.
- **Booking integrations** (renamed from Integrations): sub-tabs Channels / Product mapping / Inbound queue / Import; one row per channel instead of a catalog row plus a duplicate account card.
- **Pickup location on new/amend reservation is a dropdown** from the tenant catalog. The stored value is still the location *name*, so the booking contract and dispatch matching are unchanged; an unknown existing value stays selectable as "(not in settings)" so amending another field cannot silently move a guest's pickup.
- **Overview is a briefing, not a report (15 Sep):** one endpoint `GET staff/v1/workspace/briefing` (today, decision queue, 72h timeline, 7-day demand), all bounded by the tenant's **local date**. Lifetime totals, sidebar-duplicate quick links and the recent-reservations table are gone. The exception count became a queue where every row names its subject and carries the link that resolves it. [overview-briefing.md](../FEATURES/workspace/overview-briefing.md).
- **Chart rules (15 Sep):** ratios are meters, number+trend is a sparkline, two-part shares are stacked bars, never dual-axis, never a pie of booking sources. Data colours are validated and system-owned — `--teal #176c63` FAILS as a data colour (chroma 0.078 reads grey at mark size); use `--viz-teal #00897c`, `--viz-teal-soft #6cc2b5`, `--viz-warning #c9860b`, `--viz-critical #b3342a`. Tenant branding must never repaint chart marks.
- **Top bar (15 Sep):** connection dot + date + notification bell replaced the Overview "Live operational view" strip. The dot is real — `api()` marks offline only on transport failure (a 4xx/5xx means the server answered). The bell says alerting is not switched on yet rather than opening an empty list.
- **Installable web app / link previews (15 Sep):** `app/layout.tsx` carries the full metadata set and `app/manifest.ts` serves `/manifest.webmanifest`. Product name is **Zettaz Tours & Charters**; the home-screen label is **Zettaz Tours** (`apple-mobile-web-app-title`, truncated after ~12 chars). iOS ignores SVG for `apple-touch-icon`, which is why Add to Home Screen produced a blank tile — PNGs now live in `apps/web/public` (180 / 192 / 512 / 32 plus `og-image.png` 1200×630), generated from `public/brand/app-icon.svg`. `metadataBase` comes from `WEB_ORIGIN`. Workspace stays `noindex`; OG/Twitter tags exist so a pasted link previews in chat apps, not for search.
- **`InfoTip`** (`components/common.tsx`) parks long guidance behind a `?` next to a heading. Click-toggled, not hover — the counter runs on tablets.

## Production demo + sign-in — 12 September 2026

- Into-tenant Rock seed applied to production tenant `f6e566ce-…`; owner login unchanged (not demo.owner). See `docs/HANDOFF/demo-tenant-export.md`.
- Public sign-in must not SELECT `staff_users` without `app.actor` — RLS made verified accounts look unverified. Fixed in migration 061 + `staff_login_identity.email_verified_at`. Write-up: `docs/ISSUES_FIXES/signin-email-verified-rls.md`.
- Web: Nest problem+json messages surfaced on `/api/session`; session cookie `Secure` when `WEB_ORIGIN` is https; welcome banner hydration fixed.

## Tenant workspace — 9 September 2026

- `npm run demo:web` starts the loopback Next.js UI and API with two mock tenant-owner sessions. API port can be overridden with PORT; UI uses 3000.
- Web routes proxy allowed tenant façades with HttpOnly session cookies and same-origin mutation checks. No browser-visible tokens, platform provisioning proxy or production authentication.
- Added paginated workspace reads, tenant-scoped staff-directory policy migration, and hold expiry in booking detail. API tests: 15 passing; Next.js optimized build and web HTTP smoke pass. Browser interactions/visuals not yet tested.
- See TESTING/tenant-workspace-evidence.md and HANDOFF/local-development.md for implemented UI scope and remaining gaps. The application is mock-only; do not claim full Track A or SaaS launch readiness.

## Reservation changes — 9 September 2026

- ADR 011: confirmed bookings support quoted departure/party and guest/pickup/stay/contact amendments, with ordered capacity locks, immutable snapshots/history and original allocation preservation. Quotes do not hold seats. Held bookings support guest/stay/contact/pickup corrections without extending expiry. Amend UI reuses Make reservation (quote → accept).
- Live held and future confirmed bookings can cancel atomically; payments remain unchanged. No auto-refund or fee entitlement. Credit/cancellation payments expose finance-review flags. Cancelled bookings cannot collect or confirm.
- New tenant flag allowAmendmentBalance defaults false; synthetic fixtures explicitly enable it. Actual commercial policies are still open. A future finance increment must address review/payment corrections before claiming complete cancellation finance. Continue the delivery order with the operations board and pickup planning.

- Reservation-change verification: 19 API/PostgreSQL tests, optimized Next.js build and full web HTTP amendment/cancellation smoke passed. Browser visual acceptance remains outstanding. Evidence: TESTING/booking-changes-evidence.md.
- ADR 012 operations increment: day dispatch board, controlled pickup locations and explicit ordered pickup plans are implemented. No automatic routing, resource/crew assignment, readiness, cruise constraints, weather, check-in or messages. `operations.write` is granted to owner/admin/dispatcher. Stop cleanup follows cancellation and pickup/departure amendments. Evidence: TESTING/operations-pickup-evidence.md.
- Printable pickup lists are implemented as a tenant-scoped server read with ordered stops and exception flags for unplanned or unresolved pickups. Browser print/Save as PDF is the paper fallback; no stored PDF, offline cache, route calculation or readiness certification. Requirements: FEATURES/operations/printable-pickup-list.md.
