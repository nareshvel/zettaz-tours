# Reservation detail polish — implementation evidence

**Date:** 11 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Changes

- Always-visible **money strip** on booking detail (total / paid / balance / status).
- Amend and Cancel are full buttons (≥44px on phone); Cancel uses destructive styling.
- Cancel requires reason + acknowledgement, then an in-app **ConfirmDialog** before API call.
- Amend Accept/Revise and Cancel actions use sticky mobile form actions.
- Booking grid stays single-column under 1366 / tablet (fixed the 1100px rule that restored two columns).
- Change history cards show kind, time, money delta, and finance-review chip.
- Mobile FAB amount prefers balance due (or confirm affordance) over total-only.

## Explicitly unchanged

- Pay / confirm / quote / cancel API contracts and payloads.
- Partner settlement confirmation rules.
- Payment void/reversal and concession application logic.

## Owner acceptance still needed

- Phone / tablet / desktop: held confirm path, confirmed amend quote accept, cancel dialog.
- Long payment history and finance-review banner cases.

When accepted, update this file status and [ui-waiver-launch-task-list.md](../STRATEGY/ui-waiver-launch-task-list.md) row 9.
