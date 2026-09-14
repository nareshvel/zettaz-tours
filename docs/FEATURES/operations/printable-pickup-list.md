# Printable pickup list

## Purpose

Provide a paper-safe, day-of view of a tenant's saved pickup plan. It supports crew operations and a print-to-PDF fallback; it is not an offline mobile implementation.

## Scope

- A tenant staff member with `manifest.read` can open a departure pickup list.
- The list is read from the server at request time and contains the departure, saved plan version and dispatcher notes, ordered stops, and active exceptions.
- Each stop contains its sequence, pickup time, controlled location, operational stop note, lead name, and party size.
- Exceptions identify confirmed bookings whose pickup is unresolved or whose selected pickup has not been included in the saved plan.
- The browser's native print dialog provides paper output. An auditable print job can also stream a deterministic server-produced PDF. No generated document is stored.
- The web Print pickup list surface shows a departure masthead, numbered stop sequence on phone/print, and a denser table on desktop, with Plan pickups as the edit path.
- Plan pickups (Phase 1 polish): trip header + readiness metrics, Needs attention for unresolved / not-in-plan, smart Add (match selected location + seeded times), Add all, reorder, per-stop notes, unsaved/print hygiene. GET `/ops/v1/departures/{id}/pickups` returns `departure` and `exceptions`.

Operational locations may include a tenant-supplied address, coordinate pair and map reference. Coordinates support dispatch context; they do not activate live GPS or route optimization. Staff manage controlled pickup locations from **Tenant settings → Pickup locations** (not on Plan pickups). Plan pickups only sequences stops from that library.

Mental model (booking disposition vs per-departure plan vs print list): [pickup-disposition-and-plans.md](./pickup-disposition-and-plans.md).

## Data minimization

The list excludes email addresses, payment status, and customer-facing pickup instructions. The actual pickup location remains controlled tenant data; stop notes and dispatcher notes are internal operational content.

## Assumptions and unresolved decisions

- This uses the current tenant timezone only for display; the stored timestamp remains authoritative.
- Crew paper format, required guest identifiers, phone exposure, ship/hotel and all-aboard details, and retention policy remain tenant decisions. They are not invented in this slice.
- Printing does not certify route readiness or calculate a route. A saved plan is a staff-entered sequence.
- No retained PDF delivery, customer notification, offline cache, check-in, waiver, closure, financial collection, or crew assignment behavior is introduced here.

## Acceptance evidence

- The API returns a tenant-scoped pickup list with ordered stops and exceptions.
- A tenant cannot retrieve another tenant's list.
- The Next.js route renders the list and provides browser print.
- Automated API and HTTP smoke coverage exercise the endpoint.
