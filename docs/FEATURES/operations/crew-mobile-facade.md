# Connected crew mobile façade

## Purpose

Provide a deliberately narrow server contract for the Expo crew application. The mobile client is a consumer of the same tenant session and API; it does not receive the administrative workspace or broadened booking search.

Phased delivery (one binary; phone field → Pay → tablet dock → offline): [crew-app-delivery.md](../../STRATEGY/crew-app-delivery.md). Do not start the next feature phase until that plan is owner-accepted.

## Current contract

`GET /crew/v1/today?date=YYYY-MM-DD` requires `crew.trip.read` and returns only departures where the current actor has an active crew assignment on that local date. Each trip includes assignment roles, trip-run state, boarding counts, the saved pickup sequence and exceptions, and a minimum roster: booking identifier, lead name, party count, pickup and stay, boarding clearance (`due` / `settled` / `partner`) with remaining guest balance when due, current booking-level check-in state, and each current passenger's name, pending-identity state, category, minor flag, and latest passenger check-in state. It excludes email, paid totals, partner identifiers, waiver contents, and tenant-wide booking history.

Guide and driver/skipper roles have `crew.trip.read` and `checkin.write`. For these roles, `POST /ops/v1/bookings/{id}/checkin`, `POST /staff/v1/passengers/{id}/checkin`, and `POST /ops/v1/departures/{id}/start` additionally verify that the departure is actively assigned to the current crew member. Holding a permission alone is therefore insufficient to check in or start another crew member's departure. Guides do not have `manifest.read`; pickup plans for assigned trips are inlined on Today rather than via the ops pickup editor.

## Connected Expo client

`apps/mobile` now provides Today → assigned trip (roster search, pickup sequence, stay/clearance badges, start/no-show, connected Pay sheet) → guest check-in → trip-event flow for iOS and Android, plus a tablet-width Day Board (walk-up, weather, share/print) for desk roles. It signs in through the database-backed identity API, stores only the opaque session token in Expo SecureStore, and consumes the assignment-scoped crew endpoints. The camera scans opaque expiring passenger tokens without saving an image; the server still checks that the crew member is assigned to the departure. The client offers no tenant administration, unrestricted booking search, partner finance, or full customer history. Boarding cash/manual collection uses `POST /crew/v1/bookings/{id}/payments`; partner-settled bookings skip Pay. Tablet walk-ups use `POST /crew/v1/walk-ups`.

Set `EXPO_PUBLIC_API_BASE_URL` for local devices (`http://<lan-ip>:3190`). Store and preview builds use `https://tours.zettaz.com/api/mobile`, the allowlisted Next.js crew proxy. See [crew mobile store publish](../../HANDOFF/crew-mobile-store-publish.md).

Reservation capture now materializes one passenger slot for every booked seat. Names may remain pending at booking time. The waiver screen collects a pending passenger's full name before consent, and the server completes identity and records waiver evidence atomically. Direct waiver and clearance calls reject unresolved identities.

## Deliberate boundary

This is connected-first. `POST /crew/v1/departures/{id}/events` records an idempotent, append-only trip-run state event for an assigned crew member and never changes booking or passenger state. Completed and cancelled runs are final. Phase 1 allowlists `POST /ops/v1/departures/{id}/start`. Phase 2 allowlists `POST /crew/v1/bookings/{id}/payments` (assignment-scoped for guide/driver; desk roles may collect without assignment). Phase 3 allowlists board, walk-up, weather, pickup-list, and pickup/receipt print jobs. An encrypted offline data cache and mutation queue and push notification are not implemented. Remaining Crew increment (offline) is sequenced in [crew-app-delivery.md](../../STRATEGY/crew-app-delivery.md). Live GPS remains Track B.

## Evidence

The integration test proves that an assigned guide sees one assigned departure and a minimized passenger roster, can record arrival and trip-run events for that departure, cannot check in an unassigned departure, and cannot use the crew endpoint through an unrelated role. Phase 1 adds pickup sequence, balance-due clearance, and assigned start. Phase 2 adds assigned cash/manual Pay, partner skip, and denial of the broad staff payment route. Phase 3 adds the tablet Day Board, walk-up, weather, and print paths, hidden from guide/driver. Evidence: [crew-app-phase-1-evidence.md](../../TESTING/crew-app-phase-1-evidence.md), [crew-app-phase-2-evidence.md](../../TESTING/crew-app-phase-2-evidence.md), [crew-app-phase-3-evidence.md](../../TESTING/crew-app-phase-3-evidence.md).
