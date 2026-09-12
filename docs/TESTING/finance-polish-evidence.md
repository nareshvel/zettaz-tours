# Finance polish — implementation evidence

**Date:** 11 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Changes

- Finance page structured with metrics (unverified / accepted / statement lines).
- Claim accept/reject use full buttons and in-app `ConfirmDialog` (reason still required).
- Booking id + currency shown on each claim; statement lines show currency tags.
- Phone: statement table swaps to cards; decision actions stack full-width.
- API decision payload unchanged (`decision` + `reason`).

## Owner acceptance still needed

- Accept and reject an unverified claim with reason.
- Phone/tablet filter + statement card layout.
- Confirm accepted claim never appears as a guest payment on the reservation.
