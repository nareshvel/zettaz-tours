# UI quality and departure-waiver launch task list

**Updated:** 14 September 2026  
**Scope:** Track A launch quality for web, tablet, and the Expo crew app

**Agent execution focus:** [../HANDOFF/agent-current-sprint.md](../HANDOFF/agent-current-sprint.md) (prefer over chat history).

## Current truth

The web workspace and connected crew client provide broad development functionality, but they have not received a systematic page-by-page responsive and accessibility acceptance pass. Existing responsive CSS and prior fixes are foundations, not proof that every page has production-quality UI/UX.

The API stores versioned waiver templates, append-only passenger/guardian waiver evidence, stay details, pending passenger identity, and passenger clearance states. The web manifest can record waiver/check-in evidence, collect remaining guest balances via an on-manifest Pay sheet, and clear partner invoice/collect bookings by policy. The Expo client lists assigned trips and passengers, scans check-in tokens, captures pending passenger names and cruise/hotel/private/local stay information, renders the active waiver, collects a drawn signature, and records check-in/trip events. Encrypted offline operation, retained waiver PDFs, drive copies, crew-mobile Pay, and physical-device acceptance remain open. See [boarding balance collection](../FEATURES/operations/boarding-balance-collection.md).

**Next owner-directed surface:** verify and improve **non-Operations** menu groups (Workspace, Insights, Administration, Profile). **Operations** (Day Board / Departures / Reservations / Catalog + child flows) is considered functionally complete until further testing finds gaps — do not open new Ops feature work. **Subscription messaging polish (row 17) is held** until other modules are in better shape. Day Board / pickups owner-accepted 11 Sep; Settings pickup modal + Print + Esri map shipped 14 Sep and deployed to VPS (`a18e083`). See [agent-current-sprint.md](../HANDOFF/agent-current-sprint.md) and [claude-handoff-2026-09-14.md](../HANDOFF/claude-handoff-2026-09-14.md).

## Delivery order

### 1. Establish the shared responsive design system — baseline complete

- Inventory and consolidate reusable button, input, select, combobox, date/time picker, textarea, checkbox, radio, toggle, badge, notice, dialog, drawer, table, card, empty/loading/error state, pagination, tabs, breadcrumbs, and confirmation components.
- Define spacing, type, color, focus, disabled, destructive, validation, elevation, radius, and responsive tokens. Remove page-local visual overrides where a shared component should own behavior.
- Define four acceptance widths: 360–440 phone, 768–1024 tablet, 1280 desktop, and 1440+ wide desktop. Test portrait and landscape where the workflow is operational. Concrete admin layout rules (shell containment, metrics 2×2, view-action bars, sticky-preview hide bands) live in [responsive admin layout](../ARCHITECTURE/responsive-admin-layout.md).
- Require keyboard access, visible focus, semantic labels, touch targets of at least 44×44 CSS pixels, readable zoom, no accidental horizontal page scrolling, useful error recovery, and reduced-motion support.
- Add reusable responsive patterns: desktop table to mobile card/list, persistent desktop actions to mobile sticky action bar, modal to mobile bottom sheet/full-screen step, and settings sidebar to compact tab/section navigation.
- Create visual-regression fixtures with stable seeded data and document an acceptance checklist. Browser automation should cover navigation, overflow, focus, destructive confirmation, empty/loading/error states, and permission variants.

The shared token/control baseline and sign-in responsive pass were completed on 10 September 2026. See [responsive design baseline evidence](../TESTING/responsive-design-baseline-evidence.md). Visual-regression automation and every authenticated page remain part of the individual reviews below.

### 2. Review every web surface, one workflow at a time

Each row requires phone, tablet, desktop, keyboard, loading, empty, error, long-content, and permitted/denied-role review.

Catalog and Departures are promoted ahead of further reservation-detail work because their normalized product, option, availability-rule, and dated-instance model determines the reservation experience. The development database may be reset and reseeded under [ADR 017](../DECISIONS/017-development-schema-reset-policy.md).

| Order | Surface | Primary review goal |
| --- | --- | --- |
| 1 | Sign in, activation, forgot/reset password | Clear identity flow, password affordances, safe errors, mobile keyboard behavior |
| 2 | **Global shell, aside menu, account/tenant switcher — complete 10 September 2026** | Stable navigation without flicker, correct collapse/drawer behavior, active state and sign-out |
| 3 | **Overview — accepted 10 September 2026** | Role-specific day-of hierarchy, compact metrics, capacity outlook, urgent exceptions and permission-filtered actions |
| 4 | **Reservations list — implementation ready for owner review 10 September 2026** | Server-backed search/filters, mobile booking cards, status/currency legibility and loaded-view summaries |
| 5 | **Catalog/product foundation — polish ready for owner review 10 September 2026** | Openable product detail, identity/status edit, price-from cards, shared mode labels, and Add availability on Catalog |
| 6 | **Fixed availability foundation — polish ready for owner review 10 September 2026** | Openable rule detail, pause/resume without rewriting instances, upcoming departure links; advanced mode editors remain mode-specific increments |
| 7 | **Departures list workspace — polish ready for owner review 10 September 2026; Book deep-link 11 September 2026** | Next-14-day default, date/product filters, clickable agenda rows, week grid, held/sold-out facts, phone list cards; Book opens New reservation locked to that departure |
| 8 | **New reservation — progressive UI redesign 10 September 2026; partner source + returnTo + locked Book departure 11 September 2026** | Progressive find → hold → guest accordion, sticky booking strip, mode-aware discovery, Partner / reseller organization inline, optional named roster, stay/pickup, frozen price; Departures Book preselects one trip |
| 9 | **Reservation detail, amend, cancel — polish implemented 11 September 2026; needs owner visual pass** | Money strip, destructive Cancel + confirm dialog, sticky amend/cancel actions, tablet single-column, denser history |
| 10 | Customers list/detail | Search, duplicate cues, contact and history privacy, responsive timeline |
| 11 | **Manifest boarding — gate toolbar 14 September 2026; needs owner visual pass** | Search + Scan + Crew replace setup cards; Board guests primary; Pay/Waiver/Board contracts unchanged; camera QR when BarcodeDetector available |
| 11a | **Operations (dispatch / pickup) — functionally complete pending further testing (14 Sep 2026)** | Day board weather/close/reopen; Plan pickups Phase 1; Print list; Settings locations + Esri map; VPS tip `a18e083`. Reopen only for found bugs/gaps — no new Ops features |
| 12 | **Finance — polish implemented 11 September 2026; needs owner visual pass** | Metrics, confirm dialog for claim decisions, currency clarity, mobile statement cards |
| 13 | **Reports — polish implemented 11 September 2026; needs owner visual pass** | Date presets, currency/date-basis clarity, exception emphasis, mobile daily cards |
| 14 | **Team & resources — polish implemented 11 September 2026; needs owner visual pass** | Tabbed Crew/Resources/Documents/Assignments, FormDialog CRUD, ConfirmDialog remove |
| 15 | **Staff & access / roles — polish implemented 11 September 2026; needs owner visual pass** | Metrics, Staff↔Roles tabs, invite/create modals, revoke ConfirmDialog, mobile cards |
| 16 | **Tenant settings — module pass in progress 15 September 2026; needs owner visual pass** | Printers & documents rebuilt (agent pairing, per-document printer + paper, job lifecycle); Waiver templates moved to Operations with version-publish edit + guarded delete; Booking integrations sub-tabs; Localization 3-column + formatting actually wired; sidebar setup checklist; Payment integrations rename. See [agent-current-sprint.md](../HANDOFF/agent-current-sprint.md) and [print-and-settings-evidence.md](../TESTING/print-and-settings-evidence.md). Earlier pass (11 Sep): Aside facts, `?tab=` sync, short mobile nav labels, sticky saves, support ConfirmDialog; shared country list dropdown; locked Track A currency copy; exclusive tax-rate explanation; denser desktop meta / tighter mobile tab spacing |
| 17 | **Subscription — held 14 Sep 2026** (plan grid + embedding done 11 Sep; messaging deferred) | Do not start billing-cycle / failed-payment/grace copy until owner reopens; see [agent-current-sprint.md](../HANDOFF/agent-current-sprint.md) |
| 18 | **Profile — polish + responsive follow-up 11 September 2026; needs owner visual pass** | Account shell (identity rail + Profile/Security/Subscription tabs); flush stacked rail/content ≤1366px; MFA deferred honestly |
| 19 | Audit trail | Filterability, actor/action clarity, detail disclosure and mobile event cards |

Review findings become small bounded implementation batches. A page is complete only when its behavior is verified at all acceptance widths; visual appearance alone is insufficient.

Catalog, fixed availability, and the operational departure-list views were verified in [Catalog and departures foundation acceptance evidence](../TESTING/catalog-departures-evidence.md). The remaining specialized availability modes are tracked as explicit increments rather than emulated with fixed departures.

### 3. Deliver the departure passenger waiver vertical slice

The connected API and Expo sub-increment is implemented and integration-verified; see [crew passenger waiver online evidence](../TESTING/crew-waiver-online-evidence.md). Physical-device UI acceptance, encrypted offline behavior, retained PDF, and drive copies remain open and must be verified separately.

#### Crew interaction

1. From **Today → Departure → Guests**, tapping a passenger opens a full-screen phone view or tablet side sheet.
2. Show passenger identity/category/minor status, booking reference, financial clearance summary, current waiver status, pickup, and stay summary without exposing unnecessary customer history.
3. When a booking contains an explicitly pending passenger identity, collect the passenger's full name before consent and complete it atomically with the waiver. A pending identity cannot be cleared to board.
4. Select stay type: **Cruise vessel**, **Hotel/resort**, **Airbnb/private accommodation**, or **Local/no visitor accommodation**.
5. For cruise, select or record the controlled vessel/cruise call and optional cabin number. For hotel, select or record the property and optional room number. For Airbnb/private accommodation, record property label and address. For local, record an optional locality/address or leave accommodation details blank.
6. Render the active waiver version and explicit consent statement. The signer confirms identity/capacity. A guardian selects the minor(s) covered.
7. Capture signature strokes in a touch canvas, provide clear/retry, then show a review screen before submission. Never treat a typed name alone as a drawn signature.
8. Save online immediately or enqueue the same command offline. Show `saved on device`, `syncing`, `synced`, `conflict`, or `action required`; never imply server receipt while offline.
9. After server acceptance, refresh waiver/clearance state. Boarding remains server-authoritative and requires the configured balance and waiver rules.

#### Domain and API work

- Extend stay types from the current cruise/hotel model to `cruise`, `hotel`, `private_accommodation`, and `local`, preserving old records and controlled tenant references.
- Keep stay data booking-level by default and allow an explicit passenger override only when party members differ. Preserve a snapshot on waiver evidence so later accommodation edits do not rewrite signed evidence.
- Add a mobile passenger-detail endpoint and an idempotent waiver command containing template/version, passenger/guardian relationships, stay snapshot, consent version, signature vector/image reference, device command ID, captured time, and device metadata.
- Validate tenant, active crew assignment, departure window, passenger membership, template status, guardian eligibility, and duplicate command ID on the server.
- Keep signatures and PDFs out of logs and general API payloads. Audit metadata and hashes, not signature pixels.

#### Offline implementation

- Register and revoke devices; issue a bounded offline authorization lease.
- Store assigned manifests, active waiver text, required controlled stay options, pending commands, and signature media in encrypted SQLite/file storage with keys held by Keychain/Keystore.
- Use append-only, device-generated idempotency IDs. Sync metadata first and signature media with resumable upload. Retain unsynced evidence until acknowledged or explicitly resolved.
- Provide a visible sync centre with pending count, last successful sync, per-item failures, retry, and safe sign-out rules. Test airplane mode, app restart, duplicate upload, expired assignment, template supersession, lost authorization, partial media upload, and clock skew.

#### Authoritative PDF and optional destinations

- Store the accepted signature evidence and generated immutable waiver PDF in tenant-scoped S3-compatible object storage on the production server, using encryption, content hash, template/version, signer, signed time, and retention metadata.
- Generate the PDF server-side only after the evidence command is accepted. A later correction creates superseding evidence/PDF; it never overwrites the original.
- Provide permissioned view/download from the booking/passenger timeline and departure manifest.
- Treat Google Drive, OneDrive, and Dropbox as optional outbound document adapters. An outbox job copies the authoritative PDF to a configured tenant folder, records provider file ID/checksum/status, retries safely, and surfaces failures. Provider deletion or outage must not remove the authoritative Zettaz record.
- Define tenant retention, legal hold, export, and deletion/anonymization behavior before production waiver collection.

### 4. Complete launch integrations and controls

1. Privileged-action TOTP MFA and recovery codes.
2. SMTP delivery adapter, sender configuration, DNS verification, retries/bounces/suppression, and localized versioned templates.
3. Stripe Connect Accounts v2 onboarding, USD Checkout, signed webhook reconciliation, refunds/disputes, and tenant account-health UI.
4. Go printer-agent: **pairing, job delivery and status shipped 15 September 2026** ([ADR 018](../DECISIONS/018-print-delivery-and-agent.md)). Left: revocation policy, tenant-shared routing (needs agent-side polling), and real printer acceptance on hardware.
5. WordPress mapping when representative payload evidence is available; keep manual/CSV operation usable meanwhile.

### 5. Tenant data validation and launch acceptance

- Confirm online prices against the seeded Rock catalogue; obtain schedules, capacities, pickups, resources, waiver legal approval, refund/tax rules, and the XCD conversion source/rounding rule.
- Run security, tenant-isolation, accessibility, performance, mobile-device, backup/restore, and failure-recovery acceptance.
- Run the 7–14 day parallel operation and daily reconciliation defined in ADR 016, train each role, resolve material differences, obtain operations/finance sign-off, and freeze spreadsheet entry at cutover.

## Recommended starting point

**Next polish implementation:** verify/improve **non-Operations** menu groups (Workspace, Insights, Administration, Profile). Operations (11a) closed pending testing. Subscription (17) messaging **held**. Profile (18) / Tenant settings (16) await owner visual passes. Parallel owner passes remain for Finance, Reports, Staff, Fleet, etc. Offline waiver sync, retained PDFs, and launch integrations remain later slices. Authority: [agent-current-sprint.md](../HANDOFF/agent-current-sprint.md).
