# Zettaz Crew — delivery plan

**Updated:** 19 September 2026  
**Status:** Owner-accepted 17 September 2026. Phases 1–4 on production (`cad0ed8`). Store binaries 19 Sep: iOS App Store Connect `6813693098` 1.0.1 (2); Play Internal 1.0.1/2. **Phase 5 reopened 19 Sep for guest kiosk lock only.** GPS, card-present, push, white-label, and a consumer app stay gated.  
**Audience:** owner + any IDE agent  
**Scope authority:** [launch-contract.md](launch-contract.md) · **epic:** E08/E07 in [delivery.md](delivery.md) · **facade:** [crew-mobile-facade.md](../FEATURES/operations/crew-mobile-facade.md)

This is the single plan for **staff field software**. It does not replace the web workspace, and it does not start Track B work to “save a later refactor.”

---

## Product shape (locked)

| Decision | Rule |
| --- | --- |
| How many apps | **One** Expo app: **Zettaz Crew** (`apps/mobile`, `com.zettaz.crew`) |
| Phone vs tablet | Same binary. Phone = assigned field work. Tablet = same work plus wider Day Board / walk-up when the **role** allows |
| Pay | A sheet **inside** Crew, same boarding rules as the web manifest — not a second app |
| Web | Catalog, partners, finance, settings, audit stay on `tours.zettaz.com` |
| Guest booking | WordPress / WP Travel Engine through Track A. No native consumer app |
| Authorization | Server predicates + existing RBAC. Navigation is never permission |

Densities of the same install:

1. **Field (phone)** — my trips, scan, waiver, check-in, pickups, Pay, later offline  
2. **Dock (tablet staff)** — Field + Day Board + walk-up book + print/share PDF  
3. **Kiosk (tablet guest)** — waiver/QR only, staff PIN to exit (after Field+Pay are stable)

---

## What is already shipped (do not rebuild)

Connected 1.0 in `apps/mobile`:

- Staff sign-in / sign-out, SecureStore session, password-reset request  
- Today = **assigned** trips only (`GET /crew/v1/today`)  
- Guest check-in, QR resolve (no image saved), waiver + signature, trip events  
- Production path `https://tours.zettaz.com/api/mobile` (allowlisted Bearer proxy)  
- EAS preview/production, store assets, Expo project `@zettazglobal/zettaz-crew`

Web already has the APIs Crew will reuse: pickup plans, start/no-show, boarding Pay, print jobs, weather/closure, assignments, New reservation / holds.

**In repo, not on all devices yet:** Pay, tablet Day Board, encrypted offline, retained waiver PDF download. Needs this tree on VPS, **new EAS preview**, sign-out/in.

---

## Track map (app-related leftovers)

Launch contract wins. Delivery.md lists E07 offline under “after cutover”; the contract puts **offline after the first connected live week** in Track A. This plan follows the **contract**.

### Track A — in the Crew app

| Leftover | Notes |
| --- | --- |
| Connected field completeness | Pickups for the assigned trip, roster search, start trip / no-show, balance-due badge, all-aboard/stay on the trip header |
| Crew-mobile Pay | Same as web manifest Pay: cash/manual first; partner invoice/collect skip Pay; no last-write-win |
| Tablet Day Board | Today’s tenant trips for dispatcher/ops/owner — not the full admin menu |
| Tablet walk-up reservation | Locked to one departure; `bookings.write`; staff-assisted phone/WhatsApp/walk-in |
| Print/share pickup list + receipt PDF | `expo-print` / share against existing `ops/v1/print-jobs` |
| Encrypted offline | After first connected operating week if needed. ADR 007 + ADR 016. Cutover must exercise one offline cycle |
| Store listing | Unlisted/internal; screenshots; reviewer demo **guide** with a same-day assignment |
| Retained waiver PDF / drive copy | Server generates an immutable PDF after accepted evidence. Manifest **Download PDF**. Drive/OneDrive/Dropbox adapters stay flagged off. |
| Device revoke | Session revoke already exists; offline lease/wipe lands with the offline phase |

### Track A — **not** in the Crew app (web / policy)

Stripe Connect live checkout, XCD→USD rate, MFA/TOTP, WP payload apply, printer **agent** on LAN, subscription messaging, catalog/finance/settings polish. Crew may **call** Pay/print once those policies exist; it must not implement Connect onboarding or partner aging.

### Track B — app-related, do not start now

| Item | Why later |
| --- | --- |
| Offline **hardening** beyond the 24h lease (conflict UI polish, media resume at scale) | Delivery E07 after cutover |
| GPS breadcrumbs / live ETAs | Privacy, battery, legal open |
| Card-present / Stripe Terminal | Merchant eligibility evidence |
| Guest-facing kiosk polish / consumer app | Non-goal / Track B |
| White-label second binary | E16 |
| WhatsApp bot | Staff-assisted capture only in Track A |
| Charter quote / transfer windows / waitlists | Different inventory primitives |
| Multi-product shared van **run** object | Plan pickups Phase 2; not a phone epic |
| Native OTA / OCTO in the app | Channels stay on web |
| Push notifications | Not specified for Track A field |

---

## Role × device (what to enable)

| Role | Phone | Tablet |
| --- | --- | --- |
| Guide / driver / skipper | Assigned trips, scan, waiver, check-in, pickups, events, later Pay + offline | Same, larger roster |
| Dispatcher / operations manager | Assigned trips if they are crew; otherwise empty Today is correct | Day Board, weather hold, start/no-show, assignments if permitted |
| Reservations | Do not dump the booking workspace on a small phone | Walk-up: find departure → hold → guest → pay/confirm |
| Owner / admin | Profile + assigned-crew flow if assigned | Day Board read + walk-up if they book at the dock |
| Finance | Pay sheet only when collecting at boarding | Same; no statements |
| Auditor / partner manager / resource manager | Profile only unless also assigned as crew | Expiry warning on **today’s** assigned asset later; CRUD stays web |

Server assignment checks stay in force for guide/driver check-in even if the owner has `crew.trip.read`.

---

## Phases and tasks

Calendar is **from owner acceptance of this file**, not from chat history. Indicative durations assume one focused engineering stream and no Stripe/GPS invention. Cutover parallel-run (7–14 operating days) is **tenant operations**, not an app phase.

### Phase 0 — Close connected 1.0 (this week)

**Goal:** The preview binary you already installed works as designed; store path unblocked.

| # | Task | Owner |
| --- | --- | --- |
| 0.1 | Commit/push remaining Crew + `086` + `/api/mobile` session GET + profile UI | Engineering |
| 0.2 | VPS `./deploy.sh` (discard dirty `package-lock.json` / `apps/mobile/package.json` if pull blocks) | Owner / ops |
| 0.3 | Sign out/in after `086` so owner sessions include `crew.trip.read` | Owner |
| 0.4 | Assign a **guide** (or the owner’s crew profile) to a **today** departure; verify roster | Owner |
| 0.5 | New EAS **preview** (profile menu is not in the 17 Sep binary) | Engineering |
| 0.6 | App Review demo account + screenshots; Apple Unlisted / Play Internal when ready | Owner |
| 0.7 | Do **not** treat empty Today as a bug when the actor is unassigned | — |

**Exit:** Guide on an assigned trip can check in and sign a waiver on phone + Android emulator against production.

### Phase 1 — Crew phone 1.1 (connected field) · ~1.5–2 weeks

**Goal:** The phone is usable for a real pickup morning without a laptop. Still online-only.

| # | Task | Reuse |
| --- | --- | --- |
| 1.1 | Roster search / filter on the open trip | Client |
| 1.2 | Assigned-trip **pickup sequence** (read saved plan + exceptions) | Inlined on `GET /crew/v1/today` from the same pickup-plan tables. Ops `GET …/pickups` stays `manifest.read` (guides 403). |
| 1.3 | Start trip / no-show actions (same rules as Day Board) | `POST /ops/v1/departures/{id}/start` allowlisted; assignment check for guide/driver. Passenger no-show via existing check-in. |
| 1.4 | Balance-due / partner-settled **badge** (no Pay sheet yet) | Manifest clearance facts — extend crew Today payload if missing |
| 1.5 | Stay / all-aboard / pickup kind on trip + guest rows | Already on guests; surface it |
| 1.6 | Allowlist only new crew-needed paths on `/api/mobile` | `apps/web/lib/mobile-api.ts` |
| 1.7 | Evidence: typecheck, API isolation tests, device pass | `docs/TESTING/` |

**Exit:** Assigned driver can follow stops, find a guest, start the trip, see who still owes — still no cash entry on the phone. Engineering complete 17 Sep; production device pass is owner/ops after deploy.

**Do not:** Day Board of all tenant trips on the phone; walk-up booking; GPS.

### Phase 2 — Crew Pay (connected) · ~1–2 weeks · dependency: boarding policy

**Goal:** Collect remaining guest balance at boarding on the device. Same invariants as [boarding-balance-collection.md](../FEATURES/operations/boarding-balance-collection.md).

| # | Task | Blocked on |
| --- | --- | --- |
| 2.1 | Pay sheet: allowed methods, amount, passenger attribution optional | Web Pay behaviour |
| 2.2 | Skip Pay when `partner_invoice` / `partner_collects_for_tenant` | Already on web |
| 2.3 | Idempotent payment commands; never overwrite cash | ADR 007 |
| 2.4 | XCD cash against USD balance: display review-required until rate policy exists | Owner + finance |
| 2.5 | Card-present / Terminal | **Out of this phase** — Stripe evidence |

**Still web/policy (not Crew):** complimentary/prepaid flags, mixed allocation, true per-passenger owed, boarding exception “board with reason.” Crew must not invent those.

**Exit:** Guide can take a recorded cash/manual remainder and then waiver/board; partner-invoice guests skip Pay. Engineering complete 17 Sep; production device pass follows deploy.

**Do not:** Card-present; invent an XCD→USD rate.

### Phase 3 — Tablet dock · ~2 weeks

**Goal:** A laptop-free booth can run **today** and take a walk-up.

| # | Task | Permission |
| --- | --- | --- |
| 3.1 | Responsive shell: phone stays “my trips”; tablet width adds **Today’s board** | `manifest.read` / ops read |
| 3.2 | Board: occupancy, assigned crew, weather/close/reopen with reason | Existing ops endpoints |
| 3.3 | Open boarding gate from a board row | Already web |
| 3.4 | Walk-up: one departure → hold → guest → confirm (optional Pay from Phase 2) | `bookings.write` |
| 3.5 | Share/print pickup list + receipt PDF | `print.jobs.*` |
| 3.6 | Hide board/walk-up from guide/driver | RBAC |

**Exit:** Reservations or owner on an iPad can sell a walk-up on a selected departure and hand the same device to a guide for boarding. Engineering complete 17 Sep; production device pass follows deploy.

**Do not:** Catalog editor, partner statements, settings, OTA inbox.

### Phase 4 — Offline (Track A, after first connected live week) · ~2–3 weeks

**Goal:** Airplane-mode morning that does not duplicate cash or waivers. Specified in ADR 016.

| # | Task |
| --- | --- |
| 4.1 | Device enrollment + local PIN/biometric unlock |
| 4.2 | Encrypted SQLite; key in Keychain/Keystore |
| 4.3 | Download assigned window only (default 24h lease) |
| 4.4 | Command queue: check-in, trip events, waiver strokes, payments |
| 4.5 | Conflict: append / duplicate-by-client-id; server authoritative for assignment and money |
| 4.6 | Quarantine unsynced evidence; never silent purge |
| 4.7 | Revoke → wipe on next connect |
| 4.8 | Cutover drill: one offline cycle in the 7–14 day parallel run |

**Exit:** Documented airplane-mode test + sync. GPS still off. Engineering for 4.1–4.7 is on production (`cad0ed8`). Task 4.8 is the owner’s EAS + airplane-mode pass.

### Phase 5 — Track B / evidence-gated (kiosk reopened 19 Sep)

| Item | Gate | Status |
| --- | --- | --- |
| Kiosk lock (guest-facing tablet) | Phase 2–3 stable | Engineering 19 Sep — PIN exit, scan/waiver only. Evidence: [crew-app-phase-5-evidence.md](../TESTING/crew-app-phase-5-evidence.md). Device pass + EAS still owner. |
| Card-present | Stripe Terminal eligibility | Do not start |
| GPS / ETAs | Privacy + legal write-up | Do not start |
| Push | Product decision | Do not start |
| Offline hardening / media resume at scale | After first season | Do not start |
| White-label Crew binary | E16 | Do not start |
| Native consumer app | Explicit non-goal until Track B checkout | Do not start |

---

## Suggested calendar (if accepted 17–18 Sep 2026)

| Window | Phase |
| --- | --- |
| 17–21 Sep | Phase 0 close-out (deploy, assign, rebuild preview) |
| 22 Sep – 3 Oct | Phase 1 |
| 6–17 Oct | Phase 2 (slip if XCD/Stripe policy is missing — ship cash-only Pay) |
| 20 Oct – 31 Oct | Phase 3 tablet |
| After first live connected week (brought forward 17 Sep) | Phase 4 offline |
| After spreadsheet cutover | Phase 5 only with a written Track B reopen |

These dates move if web Administration work stays the sprint priority. **This file does not silently override** [agent-current-sprint.md](../HANDOFF/agent-current-sprint.md). Owner chooses whether Phase 0/1 starts now or after the current web pass.

---

## Acceptance per phase

- Typecheck: `npm run mobile:typecheck` and `npm run web:typecheck`  
- New Nest paths: tenant isolation + assignment denial tests  
- `/api/mobile` allowlist updated; no open proxy to finance/admin  
- Device evidence on **one iPhone and one Android** (tablet extra for Phase 3)  
- `docs/TESTING/crew-app-phase-N-evidence.md`  
- No Rock-hard-coded products, prices, or partners  

---

## Out of this plan

Google Places/routing, Plan pickups Phase 2 (multi-product van), live GPS, consumer App Store listing, WhatsApp automation, charter/transfer engines, second native app.

---

## Start gate

Owner accepted 17 September 2026. Phases 1–4 are on production (`cad0ed8`). Phase 5 kiosk lock reopened 19 Sep; GPS / Terminal / push / white-label remain gated.
