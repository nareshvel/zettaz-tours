# Operations board and pickup planning — acceptance evidence

Date: 9 September 2026. Mock development increment under ADR 012, not Track A launch approval.

## Implemented

- Date-based operations board for departures, confirmed guests, arranged-pickup readiness, planned-stop count and unresolved pickup count.
- Tenant-controlled pickup locations and replaceable ordered pickup plans with notes and plan versions.
- Plan validation for future departures, confirmed arranged-pickup bookings, active locations, unique booking stops and pickup time before departure start.
- Tenant-scoped routes, RLS, audit/outbox records and idempotent writes.
- Atomic cleanup of pickup stops after cancellation, a departure amendment, or a change to no-pickup/unresolved pickup.
- Dispatcher/admin/owner write permission; read-only operational roles still see the board and manifest.
- Tenant-scoped printable pickup-list read that returns saved stop order plus unresolved and unplanned pickup exceptions. The Next.js view uses the browser print dialog for paper or Save as PDF.

## Validation

- **21 PostgreSQL/API tests passed.** Coverage includes board counts, plan version conflict, printable-list content, role denial, cross-tenant denial, stop cleanup after a pickup amendment, resource assignment isolation, expired-compliance blocking, and payment/waiver check-in gates.
- The complete Next.js optimized build and frontend typecheck passed.
- The web smoke test now exercises booking confirmation, controlled location creation, pickup-plan save, printable-list gateway access, board count, amendment/cancellation cleanup and tenant isolation through the same-origin session gateway.

The plan is manual and does not calculate a route. Browser interaction and paper print-layout acceptance remain outstanding. Crew use, resource assignment, all-aboard warnings and weather closures are not yet implemented.
