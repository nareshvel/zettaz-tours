# ADR 012 — Operations board and pickup planning

**Status:** Accepted for mock development · **Date:** 9 September 2026

This bounded E06 increment gives staff a day board and a controlled pickup plan without claiming resource assignment, route optimization, crew execution, or a live customer communication workflow.

- A board is selected by a tenant-local operating date and reports confirmed guests, arranged-pickup bookings, planned stops, unresolved pickup work and the current plan version.
- Pickup locations are tenant-scoped controlled records with a code, name, kind and operational notes. A plan uses only active controlled locations; guest-entered pickup instructions remain on the booking.
- Each departure has one replaceable ordered pickup plan. Saving requires an optimistic plan version, checks each selected booking still belongs to the future departure and has arranged pickup, and validates pickup times are not later than departure start. It deliberately does not optimize travel order or make feasibility claims.
- Dispatcher, admin and owner receive `operations.write`; reservations users can read the board/manifest but cannot change pickup locations or plans. The API authorizes every request.
- Cancellation, a departure move, or changing pickup away from `selected` removes the relevant stop atomically. The booking, commercial history and pickup plan audit records stay intact.
- A plan is staff planning data. It does not assign vehicle, vessel, crew, resource documents, readiness completion, cruise constraints, GPS state, check-in, or send a message. Those require later operational evidence and separate state models.

Follow [workflows](../ARCHITECTURE/workflows.md) and [RBAC](../ARCHITECTURE/rbac-and-access.md). Actual locations, route rules, crew/resource records, cruise calls and safety documents must arrive through the tenant configuration work before pilot use.
