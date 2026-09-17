# Crew app Phase 3 evidence

**Date:** 17 September 2026  
**Scope:** Tablet dock on the same Zettaz Crew binary. Phone width stays assigned trips. Offline, GPS, and card-present remain later phases.

## Implemented

- `GET /crew/v1/board` (`manifest.read`) returns today's occupancy, assigned crew, operational status, and capability flags. Guides/drivers lack this permission and receive 403.
- `GET /crew/v1/board/{id}` opens that departure's boarding roster without requiring a crew assignment (desk boarding gate).
- `POST /crew/v1/walk-ups` (`bookings.write`) creates a walk-in hold, guest, pending roster, optional cash/manual payment, and confirm. If the tenant requires a deposit, the first call returns `needsPayment` and the second call records payment then confirms.
- `POST /crew/v1/departures/{id}/operational-status` (`operations.write`) weather-holds, closes, or reopens with a reason.
- Pickup-list share plus `POST /crew/v1/print-jobs` and `GET /crew/v1/print-jobs/{id}/pdf` for pickup-list and receipt PDFs only.
- `/api/mobile` allowlists only those crew tablet paths. Catalog, partner, and settings stay closed.
- Expo: width ≥ 700 and `manifest.read` adds **My trips / Day Board**. Walk-up and weather sheets are hidden when the role lacks the matching permission.

## Verification this session

- `npx tsc -p tsconfig.json --noEmit` — passed
- `npm run mobile:typecheck` — passed
- `npm run web:typecheck` — passed
- Crew tests (façade, today, Pay, tablet board/walk-up, walk-up deposit) — 5 passed
  - Guide 403 on board, walk-up, weather, PDF
  - Reservations can walk-up; weather capability false
  - Owner weather-hold and pickup-list PDF
  - 100% deposit walk-up holds then confirms after cash

## Not verified here

- Physical iPad against production (needs commit, VPS deploy, new EAS preview)
- Phone-width owner (Day Board is hidden by design)

## Out of this increment

Encrypted offline (Phase 4, after first connected live week), kiosk lock, card-present, GPS, catalog editor, partner statements.
