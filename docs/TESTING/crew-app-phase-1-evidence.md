# Crew app Phase 1 evidence

**Date:** 17 September 2026  
**Scope:** Connected field 1.1 on Zettaz Crew. Pay, tablet Day Board, offline, and GPS remain later phases.

## Implemented

- `GET /crew/v1/today` (assignment-scoped) now includes trip-run state, operational status, boarding counts, saved pickup sequence + exceptions, stay payload, and boarding clearance (`due` / `settled` / `partner`) with `guest_balance_minor` only as a remainder. Email, paid totals, and collection-mode internals stay off the payload.
- Pickup sequence is **not** exposed via `GET /ops/v1/departures/{id}/pickups` on the phone. Guides lack `manifest.read`; that ops read still 403s. The saved plan is inlined on Today.
- `POST /ops/v1/departures/{id}/start` is allowlisted on `/api/mobile`. Guide/driver start remains assignment-checked (`Crew can start only an assigned departure`).
- Expo trip screen: roster search, pickup stops, stay/pickup labels, balance-due badge, Start trip (reason required when marking remaining no-show), per-guest No-show.
- Web Crew workspace surfaces the same Today facts (counts, pickups, clearance) so the payload is not phone-only.

## Verification this session

- `npm run mobile:typecheck` — passed
- `npm run web:typecheck` — passed
- `node --test --test-name-pattern 'crew today includes pickup|crew mobile façade'` — 2 passed
  - Assigned guide sees due remainder, pickup stop, cannot read ops pickups (403), cannot start an unassigned departure (400), can start assigned with remaining no-show
  - Existing façade isolation still holds (finance 403, other tenant empty Today)

## Not verified here

- Physical iPhone / Android against production (needs VPS deploy of this increment, then a new EAS preview)
- All-aboard clock: cruise-call times were removed with vessels; stay name still shows. Do not invent a time.

## Out of this increment

Pay sheet, tablet Day Board / walk-up, encrypted offline, GPS, card-present.
