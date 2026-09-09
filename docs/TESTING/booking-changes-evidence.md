# Booking amendments and cancellation — acceptance evidence

9 September 2026. Mock development increment under ADR 011; not production launch approval.

## Implemented

- Expiring amendment quotes for guest, pickup, departure and party changes; explicit acceptance and visible old/new totals, retained payments and balance/credit.
- Contact/pickup-only changes preserve the commercial quote. Confirmed commercial changes reprice against the current catalog. Held corrections preserve their original hold deadline; held commercial changes require a new reservation.
- Acceptance locks affected departures in UUID order, checks booking version and quote expiry, rechecks availability, and atomically replaces the confirmed allocation. Prior holds and price snapshots remain intact. Each acceptance appends BookingChange, audit and outbox evidence.
- Explicit tenant policy controls whether a confirmed amendment may leave an additional balance. Default false, with synthetic fixtures explicitly opting in.
- Reasoned pre-departure cancellation releases held or committed seats, removes manifest entries, preserves payments, prevents further collection/confirmation and flags finance review when payment records exist.
- UI change history; finance-review/credit messaging; cancellation acknowledgement; tenant- and permission-checked web/API routes.

## Checks executed

- **19 API/PostgreSQL tests passed**, including original first-slice coverage and new amendment/cancellation tests.
- Confirmed movement and party increase update both capacity pools and the manifest while preserving old snapshots and settled payments.
- Competing amendments to the last seat produce one success and one conflict with the losing booking unchanged.
- Stale/expired quotes fail; repeated cancellation does not release seats twice; idempotent retry returns the original response.
- Held pickup correction preserves expiry; cancellation immediately restores availability.
- Cross-tenant access and finance-role mutation requests are denied.
- Disabled amendment-balance policy blocks underpaid acceptance.
- Injected history-write failure rolls back allocation, version and snapshot changes.
- Database triggers reject mutation of change history.
- **Next.js optimized build and frontend TypeScript checks passed.**
- **Web HTTP smoke passed** through the session gateway: booking → payment → confirmation → amendment → cancellation → change history/manifest, plus tenant switching, stale-tab rejection, cookies, origin checks and allowlist checks.

Local PostgreSQL 14.17; remote CI/PostgreSQL 18 has not been observed. Browser clicks, responsive layout and print output were not visually tested. No new external dependency or live payment integration was introduced.

## Deliberate boundaries

No automatic refund, cancellation fee, finance-review completion, notification delivery, mass rebooking or post-departure corrections. Cancellation and overpayment flags identify work for finance; they do not determine refund entitlement. The next finance increment must use append-only payment corrections/refunds and an explicit review trail. Actual tenant financial policies remain required before go-live.
