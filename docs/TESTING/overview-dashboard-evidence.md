# Overview dashboard acceptance evidence

**Date:** 10 September 2026  
**Status:** Accepted by owner

## Delivered behavior

The Overview is now an operational landing page whose content follows the signed-in user's effective permissions and role context. It uses persistent tenant data and never exposes a metric by requesting an API the user cannot access.

- Owner and finance users see received revenue, confirmed guest balances, partner obligations, and confirmed booking volume.
- Reservations and operational users see upcoming departures, confirmed bookings, confirmed guests, and active inventory holds.
- Resource managers see active resources, active crew, expired compliance documents, and documents expiring within 30 days.
- Crew-only guide and driver users continue into the focused Today workspace instead of an irrelevant management dashboard.
- Custom roles with no dashboard-domain permissions receive a safe, useful limited-access state.
- Capacity outlook presents the next seven departures in chronological order with compact committed-seat bars.
- The priority centre combines permission-filtered actions with operational exception context.
- The reservation snapshot is omitted when the user lacks booking read permission.
- Loading and individual data-source failures are isolated so one unavailable metric does not collapse the page.

## Verification

- `npm run web:build` passed.
- The full automated suite passed: 41 tests, 41 passed.
- Persistent API and web processes were restarted from the current build before live verification.
- Live browser checks passed for Owner, Finance, Reservations Lead, and Resource Manager permission variants.
- Responsive browser checks passed at 360×800, 768×1024, 1280×800, and 1440×900 with no horizontal page overflow.
- The live capacity list was verified in chronological order after the API query update.
- `git diff --check` passed.

The owner accepted the page on 10 September 2026. The next page in the sequence is Reservations list.
