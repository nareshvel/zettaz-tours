# Zettaz Crew — default roles and permissions

**Updated:** 17 September 2026  
**Audience:** owner (this is the matrix to edit if a default grant should change)  
**Source of truth in code:** `packages/shared/src/contracts.ts` `grants` plus system-role migrations (`052`, `080`, `086`, `089`). Custom tenant roles stay tenant-controlled and are not listed here.

Zettaz Crew is **one** binary. Navigation never grants access. The server still requires an **active crew assignment** on that departure for field roles (guide, driver, crew, captain) before check-in, waiver, start-trip, trip events, or boarding Pay.

Empty **Today** is correct when the signed-in person is not assigned as crew. Desk tools (Day Board, walk-up, weather) appear on a **tablet** (≥700 pt) when the role has `manifest.read`.

---

## How to change a default

1. Edit `grants` in `packages/shared/src/contracts.ts`.
2. Add a **new** numbered SQL migration that `INSERT`s into `role_permissions` for `is_system` roles and recomputes `memberships.permissions`. Never rewrite an applied migration.
3. Staff must **sign out and in** so the session picks up the new grant.
4. Update the tables below in the same change.

Do not hard-code Rock Adventures products, prices, or partner rules into these presets.

---

## System roles vs Crew app

| Role | Phone Today | Scan / waiver / check-in | Boarding Pay | Trip status / start | Tablet Day Board | Walk-up | Weather hold | Print/share pickup | Offline snapshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Guide** | Assigned trips only | Yes, assigned | Assigned | Assigned | No (`manifest.read` absent) | No | No | No | Yes |
| **Driver / skipper** | Assigned trips only | Yes, assigned | Assigned | Assigned | No | No | No | No | Yes |
| **Crew** | Assigned trips only | Yes, assigned | Assigned | Assigned | No | No | No | No | Yes |
| **Captain** | Assigned trips only | Yes, assigned | Assigned | Assigned | No | No | No | No | Yes |
| **Dispatcher** | Assigned trips if also crew | Yes if assigned | If assigned | If assigned | Yes | No | Yes | Yes | If `crew.trip.read` (yes) |
| **Operations manager** | Assigned trips if also crew | Yes if assigned | If assigned | If assigned | Yes | No | Yes | Yes | Yes |
| **Owner** | Assigned trips if also crew | Yes if assigned | If assigned | If assigned | Yes | Yes (`bookings.write`) | Yes | Yes | Yes |
| **Administrator** | Assigned trips if also crew | Yes if assigned | If assigned | If assigned | Yes | Yes | Yes | Yes | Yes |
| **Reservations** | Empty unless also assigned **and** given `crew.trip.read` (not in the default) | No by default | No (has `payment.write` on web, not crew.trip.read) | No | No | Walk-up is tablet + `bookings.write` but **Today 403** without `crew.trip.read` | No | Print on web; Crew print needs `print.jobs.*` **and** a board session | No |
| **Finance** | Empty (no `crew.trip.read`) | No | Web payments; Crew Pay needs `checkin.write` or `payment.write` **and** a loaded trip | No | No | No | No | Print on web | No |
| **Auditor** | Empty | No | No | No | Profile / read-only web | No | No | No | No |
| **Resource manager** | Empty | No | No | No | No | No | No | No | No |
| **Partner manager** | Empty | No | No | No | No | No | No | No | No |

If Reservations or Finance should use Crew at the dock, grant `crew.trip.read` (and assignment for field actions) in a new migration — do not special-case a tenant in the app.

---

## Permission catalogue (Crew-relevant)

| Permission | What it unlocks in Crew |
| --- | --- |
| `crew.trip.read` | Sign-in to Today, device enroll, offline snapshot, trip-run events, scan-token resolve |
| `checkin.write` | Passenger arrived / board / no-show, start trip (with assignment for field roles), boarding Pay |
| `manifest.read` | Tablet Day Board of **all** tenant departures that day |
| `bookings.write` | Tablet walk-up hold + confirm |
| `operations.write` | Weather hold / close / reopen |
| `print.jobs.create` + `print.jobs.read` | Record a pickup-list print job when sharing |
| `payment.write` | Alternate Pay gate (desk finance collecting at boarding) |
| `members.write` | Revoke another person’s enrolled device |

---

## Default grants (system roles)

Copied from `grants` in `packages/shared/src/contracts.ts`. Owner/admin also received `crew.trip.read` in migration `086` so they can open the app; the payload is still assignment-scoped.

| Role | Permissions |
| --- | --- |
| owner | `config.write`, `members.write`, `catalog.write`, `catalog.read`, `bookings.write`, `bookings.read`, `inventory.overbook`, `payment.write`, `payment.correct`, `manifest.read`, `operations.write`, `waiver.template.publish`, `resources.write`, `documents.expiry.manage`, `assignments.write`, `safety.assignment.override`, `crew.trip.read`, `checkin.write`, `print.templates.manage`, `print.jobs.create`, `print.jobs.read`, `partner.manage`, `partner.collection.record`, `partner.collection.verify`, `partner.statement.read`, `integration.manage`, `integration.inbox.read`, `notifications.request`, `notifications.read`, `audit.read` |
| admin | `config.write`, `catalog.write`, `catalog.read`, `bookings.write`, `bookings.read`, `manifest.read`, `operations.write`, `resources.write`, `documents.expiry.manage`, `assignments.write`, `crew.trip.read`, `checkin.write`, `print.templates.manage`, `print.jobs.create`, `print.jobs.read`, `partner.manage`, `integration.manage`, `integration.inbox.read`, `notifications.request`, `notifications.read` |
| reservations | `catalog.read`, `bookings.write`, `bookings.read`, `payment.write`, `manifest.read`, `print.jobs.create`, `print.jobs.read`, `partner.collection.record`, `notifications.request`, `notifications.read` |
| dispatcher | `catalog.read`, `bookings.read`, `manifest.read`, `operations.write`, `assignments.write`, `crew.trip.read`, `checkin.write`, `print.jobs.create`, `print.jobs.read` |
| finance | `catalog.read`, `bookings.read`, `payment.write`, `payment.correct`, `audit.read`, `print.jobs.create`, `print.jobs.read`, `partner.collection.record`, `partner.collection.verify`, `partner.statement.read` |
| auditor | `catalog.read`, `bookings.read`, `manifest.read`, `audit.read`, `partner.statement.read`, `integration.inbox.read`, `notifications.read` |
| guide / driver / crew / captain | `crew.trip.read`, `checkin.write` |
| resource_manager | `catalog.read`, `manifest.read`, `resources.write`, `documents.expiry.manage` |
| operations_manager | `catalog.read`, `bookings.read`, `inventory.overbook`, `manifest.read`, `operations.write`, `resources.write`, `documents.expiry.manage`, `assignments.write`, `crew.trip.read`, `checkin.write`, `print.jobs.create`, `print.jobs.read` |
| partner_manager | `catalog.read`, `bookings.read`, `partner.manage` |

---

## Assignment roles (on a departure)

These are **job labels** on `departure_assignments.assignment_role` (guide, driver, skipper, …). They are not the Staff role. A person with Staff role **Driver** who is assigned as skipper still only sees that trip on Today.

---

## Open decisions (owner)

- Whether Reservations should get `crew.trip.read` by default so dock walk-up works on phone as well as tablet.
- Whether Finance should open Crew Pay without a crew assignment.
- Custom roles created under Staff → Roles are not in this table; copy a system role and add/remove grants there.
