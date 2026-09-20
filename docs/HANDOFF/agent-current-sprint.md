# Agent current sprint board

**Updated:** 20 September 2026 · **Audience:** any IDE agent (Cursor, Claude, Codex, Devin, ChatGPT)

This is the **single “what next” page**. Read it before inventing a deploy or backlog plan from chat history.

Authority on conflict: [launch-contract.md](../STRATEGY/launch-contract.md) → [implementation-backlog.md](../STRATEGY/implementation-backlog.md) → [ui-waiver-launch-task-list.md](../STRATEGY/ui-waiver-launch-task-list.md) → this file (execution focus only).

Full resume packet: [cross-ide-agent-resume.md](cross-ide-agent-resume.md). Standing decisions: [MEMORY.md](../AI_CONTEXT/MEMORY.md).

---

## Owner priority (20 September 2026 — Assets then Staff & access; Subscription + Zettaz Pay after)

1. **Crew app.** Phases 1–4 on production. **Phase 5.1 guest kiosk** and **Phase 3.5 Share PDF** engineering 19 Sep. GPS, card-present, push, white-label stay gated. Owner still: TestFlight/Unlisted notes, **4.8 airplane-mode**, kiosk PIN + Share PDF on iPad, new EAS.
2. **Operations menu group** remains functionally complete pending testing. Do not open new Ops web feature work unless testing finds a bug.
3. **Assets (was Fleet)** engineering + agent visual 20 Sep: kinds, identity sheet, papers list, add/view document modals, document count on rows, Edit/Remove icons, coverage warn, status filter default Active, nav/header rename, page intro removed. **Owner still clicks through on their machine.** Commit/push requested; production needs owner `./deploy.sh` (migration **093**).
4. **Next after Staff:** **Subscription** (SaaS Billing) and **Zettaz Pay** (client-facing payment-gateway brand for traveler collections; Stripe Connect underneath — not SaaS fees). Do not start money-in-out Phases 2–4 or QBO OAuth until named here.

---

## Git / deploy truth (do not invent)

| Fact | Value |
| --- | --- |
| Branch | `main` |
| Tip last seen on VPS | Owner ran `./deploy.sh` 19 Sep (`tours-api` / `tours-web` restarted; “Full deploy complete”). Confirm SHA on the box; do not assume it includes later local commits. |
| `origin/main` | Confirm with `git status`. Local `main` has been ahead with 19 Sep polish (`a1399cd`, `f40fb94` logo, plus Localization/integrations/stays). |
| Mac ↔ remote | Push not requested. Later local commits stay off VPS until push + `./deploy.sh`. |
| Migrations | Through **`089_crew_captain_roles.sql`** on production. Prod migrate **COMPLETE**, Applied this run: **088**, **089**, Pending: 0 |
| Email verification / trial auth | **Already on `main`** (`060`–`061`); do not invent “never pushed” |

**VPS:** Owner completed a full `./deploy.sh` on 19 September 2026 (`/var/www/zettaz-tours`, PM2 `tours-api` + `tours-web`). SHA on the box must be read from that checkout. Migrations through **`089`**.

If a later pull fails on dirty lockfile again:

```sh
cd /var/www/zettaz-tours
git checkout -- package-lock.json
./deploy.sh
```

Do **not** hand-apply migrations with raw `psql` unless `db:migrate:prod` fails. See [deploy.md](deploy.md).

Server may still show local-only drift (`apps/mobile/package.json`, `ecosystem.config.cjs`) — leave alone unless owner asks.

---

## Crew app — Phases 1–4 engineering complete (17 September 2026)

Phased delivery: [crew-app-delivery.md](../STRATEGY/crew-app-delivery.md).

**On production (`cad0ed8`):** Phases 1–4 including encrypted offline (088) and Crew/Captain roles (089).

**Now:** owner deploys later local commits, builds a new EAS preview for kiosk + Share PDF, and runs 4.8 airplane-mode plus a kiosk PIN cycle. GPS / Terminal / push stay gated. Simulator/Expo Go is enough for kiosk layout and the share sheet (real AirPrint/camera still need a device).

Evidence: [crew-app-phase-2-evidence.md](../TESTING/crew-app-phase-2-evidence.md), [crew-app-phase-3-evidence.md](../TESTING/crew-app-phase-3-evidence.md), [crew-app-phase-4-evidence.md](../TESTING/crew-app-phase-4-evidence.md).

---

## Operations menu group — closed pending testing

Nav group **Operations** (aside): Day Board, Departures, Reservations, Catalog — plus Day Board child flows (manifest/boarding gate, Plan pickups, Print pickup list, Start trip, weather hold/close/reopen). Pickup location library lives under **Tenant settings → Pickup locations** (not Ops aside).

**Owner directive:** consider this group **complete until further testing identifies issues or gaps.** Agents should not invent new Ops epics, Google routing, GPS, or Plan pickups Phase 2.

Shipped recently (treat as done):

- Day Board IA: View/Board + Start trip; Options hold weather/pickups; status filter
- Plan pickups Phase 1; Print list sequence cards
- Settings → Pickup locations (Esri map, tenant city/country address default, FormDialog portal)
- Demo seed multi-stop pickup day
- Manifest boarding toolbar / start-trip docs

Evidence / feature docs: [pickup-disposition-and-plans.md](../FEATURES/operations/pickup-disposition-and-plans.md), [printable-pickup-list.md](../FEATURES/operations/printable-pickup-list.md), [pickup-location-modal-and-print-evidence.md](../TESTING/pickup-location-modal-and-print-evidence.md), [manifest-boarding-toolbar.md](../FEATURES/operations/manifest-boarding-toolbar.md), [departure-start-and-no-shows.md](../FEATURES/operations/departure-start-and-no-shows.md), [day-board-polish-evidence.md](../TESTING/day-board-polish-evidence.md).

**If testing finds a bug:** fix the bounded defect, add evidence, update this file. Do not expand scope into Track B Ops (live GPS, Google Places/routing).

---

## Administration → Tenant settings — in progress (15 September 2026)

Owner-directed pass over the Administration group. Shipped this session, all typecheck / build / format clean:

| Area | What changed |
| --- | --- |
| **Printers & documents** | Rebuilt. Agent pairing, printer inventory + test strip, per-document printer & paper. Inert template publisher removed (templates deferred). [ADR 018](../DECISIONS/018-print-delivery-and-agent.md) · [feature doc](../FEATURES/operations/printing-and-print-agent.md) |
| **Print pipeline** | `pdf.ts` paper profiles (A4 / Letter / 80 mm / 58 mm) + measured wrapping; `print-agent.ts` client and `printDocument()` orchestration; job lifecycle `requested → rendered → delivered/failed`; manifest / pickup list / receipt call sites rewired |
| **Waiver templates** | Moved Platform → Operations, renamed, rebuilt. Edit publishes a version; delete only for an unsigned superseded version; active never deletable. [feature doc](../FEATURES/tenant-settings/waiver-template-lifecycle.md) |
| **Booking integrations** | Renamed from Integrations; sub-tabs Channels / Mapping / Inbound queue / Import; one row per channel; vendor-specific header button removed |
| **Localization** | Three-column layout, timezone surfaced, live preview strip; `locale` + `numberFormat` actually wired into formatting |
| **Sidebar** | Currency / date-format / hold-window facts replaced with a setup checklist (`GET admin/v1/tenant/readiness`) |
| **Reservations** | Pickup location is a dropdown from the tenant catalog; amend-page party steppers fixed (they used a CSS class that does not exist) |
| **Overview rebuilt** | Shift briefing: `workspace/briefing` endpoint, today strip with countdown, decision queue with per-row actions, 72h readiness timeline, 7-day demand chart, new-tenant state. SQL is unexecuted — no DB reachable from the bridge |
| **Installable app / link preview** | `Zettaz Tours & Charters` title, `Zettaz Tours` home-screen label, real PNG app icons (iOS ignores SVG), web manifest with standalone display, OG/Twitter share card |
| **Payments tab** | Renamed **Payment integrations**; still a placeholder pending finance decisions |

**Migrations for production.** Everything the Overview / briefing work added is read-only on existing tables, so it needs **no** migration. Three files must still reach production, in order, all idempotent and safe to re-run:

| File | What it does | Notes |
| --- | --- | --- |
| `078_antigua_properties_seed.sql` | Seeds Antigua properties as shared rows and folds tenant duplicates into them | Repoints bookings before deleting the tenant copy |
| `079_print_job_media_size.sql` | `print_jobs.media_size` + CHECK | `ADD COLUMN IF NOT EXISTS`; existing rows default to `a4` |
| `080_print_permissions_for_desk_roles.sql` | Grants `print.jobs.create` / `print.jobs.read` to the `reservations` and `finance` system roles | Also recomputes `memberships.permissions`; **affected staff need a fresh session** before print buttons appear |

Deploy runs them through `./deploy.sh` → `npm run db:migrate`; do not hand-apply with `psql` unless that fails.

Evidence: [print-and-settings-evidence.md](../TESTING/print-and-settings-evidence.md). **Not verified:** live agent pairing / physical print (no agent reachable from the dev environment) and owner visual passes.

Remaining in this group: owner visual on General & branding, Taxes & commercial, Guest stays, Partners. Logo dropzone now says to click the image to replace when a logo is already on file. Security non-owner empty state shipped 17 Sep. Document library, Audit, and Profile have polish passes (owner visual outstanding).

---

## Held — do not start unless owner reopens

- **Finance money in/out later** — Phase 1 expense payments shipped 19 Sep. Guest strip, partner remittance tile, bank registers still held: [finance-money-in-out-later.md](../STRATEGY/finance-money-in-out-later.md).
- **Crew GPS later** — Connecteam-informed stamps / fences / trails: [crew-gps-later.md](../STRATEGY/crew-gps-later.md). Do not start until the owner reopens that file.
- Dependency-blocked Track A: Stripe eligibility, XCD→USD rate, Rock printers, Rock waiver legal text, WP payload / import ID reconciliation
- Track B: public checkout, reseller portal, GPS/ETAs, OTA cert, rich analytics — [launch-contract.md](../STRATEGY/launch-contract.md). GPS possible expansion (held): [crew-gps-later.md](../STRATEGY/crew-gps-later.md).

---

## Sprint now — non-Operations verification & improvement

Work **outside** the Operations aside group. Suggested order (adjust with owner):

### 1. Workspace
- **Home / overview — My trips hidden for Day Board roles; setup checklist on Overview 19 Sep.** Evidence: [overview-polish-evidence.md](../TESTING/overview-polish-evidence.md). Owner visual still outstanding.

### 2. Insights
- **Reports — hub complete 19 Sep (catalog, period overview default, aging + expense summary, CSV/print). Owner visual still outstanding.** Evidence: [reports-polish-evidence.md](../TESTING/reports-polish-evidence.md). P&L, commission PDF, accounting export, and sales-by-product stay labelled later — do not build them here.
- **Customers — polish implemented 17 Sep; owner visual still outstanding.** Evidence: [customers-polish-evidence.md](../TESTING/customers-polish-evidence.md).

**Next non-Ops surface (owner 20 Sep):** **Staff & access** remaining polish. After that **Subscription** (profile billing) then **Zettaz Pay** (payment-gateway brand; Stripe Connect underneath).

### 3. Administration
- Finance (overview, payments, partner statements — slim Track A) — leftover close-out 19 Sep (claims UI, expense payments, expense summary, Settings Partners). Owner visual outstanding. Evidence: [finance-polish-evidence.md](../TESTING/finance-polish-evidence.md). Accounting export: [accounting-export.md](../FEATURES/finance/accounting-export.md) (not built).
- Fleet (assets / readiness) — kinds + one asset sheet 20 Sep: nav/header **Assets**; jet ski/kayak/van/etc., make/model/registration, papers list + add/view document modals, document count on rows, Edit/Remove icons, Active/Inactive/All filter (default Active). Evidence: [team-resources-polish-evidence.md](../TESTING/team-resources-polish-evidence.md). Agent visual 20 Sep; owner click-through still needed.
- Staff & access — polish 11 Sep; search + Add staff 19 Sep; icon row actions + no intro copy 20 Sep. Evidence: [staff-access-polish-evidence.md](../TESTING/staff-access-polish-evidence.md). Owner click-through outstanding.
- **Document library — polish implemented 17 Sep.** Evidence: [document-library-polish-evidence.md](../TESTING/document-library-polish-evidence.md)
- Tenant settings — Localization currency roles + Booking integrations + Guest stays search/add row + hold minutes + support-grant tenant dates 19 Sep. Remaining: **owner visual**.
- **Audit — polish implemented 17 Sep.** Evidence: [audit-polish-evidence.md](../TESTING/audit-polish-evidence.md)

### 4. Profile (account shell)
- **Profile polish follow-up implemented 17 Sep.** Evidence: [profile-polish-evidence.md](../TESTING/profile-polish-evidence.md). Owner visual still outstanding. MFA still deferred honestly.
- Subscription tab: **messaging implemented 19 Sep**; owner visual outstanding. Evidence: [subscription-polish-evidence.md](../TESTING/subscription-polish-evidence.md). **Zettaz Pay** is the client-facing payment gateway (Stripe Connect underneath), not this tab.

For each surface: verify against [ui-waiver-launch-task-list.md](../STRATEGY/ui-waiver-launch-task-list.md), fix clear UX/functional gaps in one bounded pass, write/extend `docs/TESTING/*-evidence.md`, update row status.

Owner visual acceptance still outstanding on many polished pages — when verifying, note “needs owner pass” vs “agent found defect.”

---

## Later Track A engineering (after menu-group quality)

Not the current focus. When owner returns to platform/track work:

| # | Epic | What’s left |
| --- | --- | --- |
| 1 | E01 Identity | Privileged MFA/TOTP + recovery codes |
| 2 | E10 Finance | Live Stripe Connect Checkout (USD) + webhooks; XCD rate policy. **Held cashbook plan:** [finance-money-in-out-later.md](../STRATEGY/finance-money-in-out-later.md) |
| 3 | E06 Ops print | **Agent client + paper profiles shipped 15 Sep (ADR 018).** Left: live agent acceptance on real hardware; tenant-shared printer routing (needs agent-side job polling — `printer_routes` dormant); tenant-designed templates |
| 4 | Comms | Tenant-editable templates, suppression, delivery webhooks |
| 5 | Boarding money | Complimentary/prepaid flags, mixed allocation, per-passenger owed; crew-mobile Pay is Phase 2 of [crew-app-delivery.md](../STRATEGY/crew-app-delivery.md) |
| 6 | E07/E08 Crew | See [crew-app-delivery.md](../STRATEGY/crew-app-delivery.md). Offline + retained waiver PDFs are Phase 4 / server, not the next epic |
| 7 | E12/E13 | WP/OTA transforms (blocked on payload evidence) |
| 8 | Cutover | Parallel run + Rock workbook sign-off |

---

## Agent checklist when ending a session

1. Update this file if **next task**, **owner priority**, or **git/deploy truth** changed.  
2. Update [MEMORY.md](../AI_CONTEXT/MEMORY.md) only for durable decisions.  
3. Add/extend `docs/TESTING/*-evidence.md` for the epic.  
4. Update [ui-waiver-launch-task-list.md](../STRATEGY/ui-waiver-launch-task-list.md) row status.  
5. Commit and push so the next IDE and VPS share the same docs.
