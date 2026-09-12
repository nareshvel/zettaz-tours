# Day Board polish — implementation evidence

**Date:** 11 September 2026  
**Status:** Built — owner acceptance recorded 11 September 2026

## Changes

- Weather hold, Close, and Reopen use the shared in-app `ConfirmDialog` with a required internal reason (no `window.prompt`).
- Departure recovery apply uses the same dialog for confirmation (no `window.confirm`).
- Day Board actions labeled **Plan pickups** and **Print pickup list**; Board guests remains primary.
- Plan pickups page: stops first; locations managed via FormDialog (add/edit) and ConfirmDialog (delete).
- Print pickup list page: print-first heading, departure masthead, numbered stop sequence on phone/print, table on desktop.
- Departures / Reservations page subtitles clarified (calendar+Book vs find/manage bookings).

## Acceptance (owner, 11 September 2026)

- Day Board + Plan pickups + Print pickup list reviewed across phone / tablet / desktop widths.
- Weather hold / reopen reason flow and pickup plan vs print list labeling accepted.
- Evidence file and backlog item 1 marked built.
