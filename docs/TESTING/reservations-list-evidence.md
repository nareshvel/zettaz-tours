# Reservations list acceptance evidence

**Date:** 10 September 2026  
**Status:** Implementation and engineering verification complete; awaiting owner visual acceptance

## Delivered behavior

- Added server-backed search across guest name, booking reference, and tour name.
- Added validated status, booking source, departure-from, and departure-to filters.
- Date controls show the tenant's configured date format, and reservation departure times follow the configured date format, clock format, locale, and timezone.
- Rock's pre-existing synthetic hold quotes were corrected at the persistent-data source from the obsolete XCD demo unit to the approved USD policy; immutable confirmed price/payment history was not rewritten.
- Source choices come from tenant configuration; booking states remain domain-controlled.
- Added loaded-view summaries for reservations, guests, confirmed reservations, and outstanding balance. Money uses the tenant locale, and mixed-currency results are never added into a misleading single value.
- Added an explicit active-filter count and one-step filter clearing.
- Added a recovery-focused empty state that clears both search and filters.
- Desktop and tablet retain the compact operational table. Phones use touch-safe reservation cards containing reference, source, tour, departure, guest count, status, and balance.
- The New reservation action remains permission-controlled. Read-only finance users can inspect reservations without receiving a create action.

## Verification

- Production web build passed.
- Full API suite passed: 41 tests, 41 passed.
- Added API coverage for combined status/source filtering, empty filtered results, and invalid date rejection.
- Live PostgreSQL-backed browser verification passed for unfiltered results, confirmed-status filtering, summary recalculation, and no-result recovery.
- `git diff --check` passed.

The page remains in owner review until its visual hierarchy and responsive interaction are accepted. The next page in the sequence is New reservation.
