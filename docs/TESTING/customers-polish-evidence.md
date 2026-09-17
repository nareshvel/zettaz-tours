# Customers polish — implementation evidence

**Date:** 17 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Boundary

Customers remain a read-only Insights surface. Records still materialize from reservation lead travelers and still match by normalized email within a tenant. This pass does **not** add create/edit, merge/split, or phone-inferred duplicates — those stay deferred in [customer-records.md](../FEATURES/reservations/customer-records.md).

## Changes

- Insights eyebrow, metrics (guests / linked bookings / repeat guests / phone), and search in the shared list-action bar.
- Repeat-guest badge when `booking_count > 1` (email reuse). Same name or phone with a different email stays a separate record; empty-state copy says merge is not available.
- Detail contact strip uses the shared guest email/phone only. Purchaser and emergency contacts stay off this page; staff open the reservation for those snapshots.
- Timeline cards use kind labels, payment/waiver/message facts, and a reservation link instead of a raw booking UUID.
- Tablet/desktop: detail grid stacks at 1366px; list rows already collapse to cards at 850px.

API list/detail contracts are unchanged.

## Owner acceptance still needed

- Search by name, email, and phone; confirm repeat-guest badge on a reused email.
- Confirm purchaser/emergency contacts are absent here and still present on reservation detail.
- Phone list cards and tablet stacked detail.
- Timeline links open the matching reservation.

## Agent checks (17 September 2026)

- `npm run web:typecheck` passed.
- Browser walkthrough of list/detail was not completed here (workspace sign-in could not be automated). Owner visual pass remains the acceptance gate.
