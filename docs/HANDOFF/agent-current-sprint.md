# Agent current sprint board

**Updated:** 19 September 2026 · **Audience:** any IDE agent (Cursor, Claude, Codex, Devin, ChatGPT)

This is the **single “what next” page**. Read it before inventing a deploy or backlog plan from chat history.

Authority on conflict: [launch-contract.md](../STRATEGY/launch-contract.md) → [implementation-backlog.md](../STRATEGY/implementation-backlog.md) → [ui-waiver-launch-task-list.md](../STRATEGY/ui-waiver-launch-task-list.md) → this file (execution focus only).

Full resume packet: [cross-ide-agent-resume.md](cross-ide-agent-resume.md). Standing decisions: [MEMORY.md](../AI_CONTEXT/MEMORY.md).

---

## Owner priority (19 September 2026 — stores shipped, non-Ops polish)

1. **Crew app.** Phases 1–4 on production `cad0ed8`. EAS **preview** + **production** binaries exist. iOS **1.0.1 (2)** is on App Store Connect (`6813693098`). Android **Internal testing 2 (1.0.1)** is live. Owner still: TestFlight/Unlisted review notes, screenshots, reviewer demo user, **4.8 airplane-mode**. **Do not start Phase 5.**
2. **Operations menu group** remains functionally complete pending testing. Do not open new Ops web feature work unless testing finds a bug.
3. **Non-Ops:** Customers, Audit, and Document library polish are on production (`cad0ed8`; owner visual still outstanding). **Profile polish follow-up** is local (uncommitted). **Crew field-pass UI** is local — needs commit + VPS + new EAS to match store binaries. **19 Sep settings:** General, Taxes, Guest stays, Payment integrations (honest deferred), document storage heading, Finance Partners list. Remaining owner visual: those tabs + Reports/Finance/Staff/Fleet.
4. **Hold Subscription messaging.**

---

## Git / deploy truth (do not invent)

| Fact | Value |
| --- | --- |
| Branch | `main` |
| Tip deployed | `cad0ed8` (Crew Phases 1–4 + Customers / Audit / Document library polish) |
| `origin/main` | `0acc028` (retained waiver PDF + Crew sync-centre sign-out). Owner may have deployed. **Local:** Profile polish + Crew field-pass UI (uncommitted). |
| Mac ↔ `origin/main` | Ahead locally with Profile polish; VPS still `cad0ed8` until `./deploy.sh` |
| Migrations | Through **`089_crew_captain_roles.sql`** on production. Prod migrate **COMPLETE**, Applied this run: **088**, **089**, Pending: 0 |
| Email verification / trial auth | **Already on `main`** (`060`–`061`); do not invent “never pushed” |

**VPS deploy completed 17 September 2026** (`/var/www/zettaz-tours`):

- Fast-forward `25ab896..cad0ed8`. Migrations **088** and **089** applied, Pending: 0, PM2 restarted.
- Rebuild EAS **preview** now so phones pick up Pay, Day Board, field-pass UI, and Phase 4 offline.
- Task 4.8 (airplane-mode cycle) is the owner’s device pass after that EAS install.

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

**Now:** owner deploys `0acc028` (and later the Profile polish commit), builds a new EAS preview, and runs the full device test including one airplane-mode cycle. **Do not start Phase 5.**

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

- **Subscription messaging polish** (row 17) — billing-cycle / failed payment / grace / post-suspension copy in `apps/web/components/subscription.tsx`
- Dependency-blocked Track A: Stripe eligibility, XCD→USD rate, Rock printers, Rock waiver legal text, WP payload / import ID reconciliation
- Track B: public checkout, reseller portal, GPS/ETAs, OTA cert, rich analytics — [launch-contract.md](../STRATEGY/launch-contract.md)

---

## Sprint now — non-Operations verification & improvement

Work **outside** the Operations aside group. Suggested order (adjust with owner):

### 1. Workspace
- Home / overview — exceptions, setup checklist, role-appropriate dashboard

### 2. Insights
- Reports — polish implemented 11 Sep; owner visual still outstanding
- **Customers — polish implemented 17 Sep; owner visual still outstanding.** Evidence: [customers-polish-evidence.md](../TESTING/customers-polish-evidence.md). Next Insights item after owner pass is none; continue Administration remaining tabs.

### 3. Administration
- Finance (overview, payments, partner statements — slim Track A) — polish 11 Sep; owner visual outstanding
- Fleet (assets / readiness) — polish 11 Sep; owner visual outstanding
- Staff & access — polish 11 Sep; owner visual outstanding
- **Document library — polish implemented 17 Sep.** Evidence: [document-library-polish-evidence.md](../TESTING/document-library-polish-evidence.md)
- Tenant settings — earlier module pass; Security non-owner empty state 17 Sep
- **Audit — polish implemented 17 Sep.** Evidence: [audit-polish-evidence.md](../TESTING/audit-polish-evidence.md)

### 4. Profile (account shell)
- **Profile polish follow-up implemented 17 Sep.** Evidence: [profile-polish-evidence.md](../TESTING/profile-polish-evidence.md). Owner visual still outstanding. MFA still deferred honestly.
- Subscription tab: **hold messaging polish**; only fix blockers if broken

For each surface: verify against [ui-waiver-launch-task-list.md](../STRATEGY/ui-waiver-launch-task-list.md), fix clear UX/functional gaps in one bounded pass, write/extend `docs/TESTING/*-evidence.md`, update row status.

Owner visual acceptance still outstanding on many polished pages — when verifying, note “needs owner pass” vs “agent found defect.”

---

## Later Track A engineering (after menu-group quality)

Not the current focus. When owner returns to platform/track work:

| # | Epic | What’s left |
| --- | --- | --- |
| 1 | E01 Identity | Privileged MFA/TOTP + recovery codes |
| 2 | E10 Finance | Live Stripe Connect Checkout (USD) + webhooks; XCD rate policy |
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
