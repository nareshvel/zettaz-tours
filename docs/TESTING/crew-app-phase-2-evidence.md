# Crew app Phase 2 evidence

**Date:** 17 September 2026  
**Scope:** Connected Crew Pay on assigned trips. Card-present, XCD conversion, tablet Day Board, and offline remain later phases.

## Implemented

- `POST /crew/v1/bookings/{id}/payments` (`checkin.write`) records a **settled** manual payment through the same `FinanceService.record` path as the web manifest. Idempotent command key. Never last-write-wins.
- Assignment is required for every role on this crew endpoint. Guide/driver still lack `payment.write`, so `POST /staff/v1/bookings/{id}/payments` stays 403.
- Partner invoice / partner-collects bookings are rejected (`skip Pay`). Pay is hidden when Today clearance is `partner` or `settled`.
- `/api/mobile` allowlists only the crew payment path. Finance/admin remain closed.
- Expo Pay sheet: amount, tenant manual methods (not `reseller_payment`), optional passenger attribution / equal-share default, receipt reference. If booking currency ≠ collection currency, the sheet explains conversion is not enabled and does not invent a rate.

## Verification this session

- `npm run mobile:typecheck` — passed
- `npm run web:typecheck` — passed
- Crew tests (`crew mobile façade`, `crew today includes pickup`, `crew can collect remaining guest balance`) — 3 passed
  - Guide records cash remainder on assigned booking → clearance `settled`
  - Unassigned booking 400; partner-invoice 400; staff payments 403

## Not verified here

- Physical device against production (needs deploy + new EAS preview)
- Live XCD cash against a USD balance (blocked on rate policy, as specified)

## Out of this increment

Card-present / Terminal, complimentary/prepaid flags, mixed allocation, true per-passenger owed, tablet Day Board, encrypted offline.
