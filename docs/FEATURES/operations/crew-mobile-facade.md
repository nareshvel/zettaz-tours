# Connected crew mobile façade

## Purpose

Provide a deliberately narrow server contract for a future Expo crew application. The mobile client is a consumer of the same tenant session and API; it does not receive the administrative workspace or broadened booking search.

## Current contract

`GET /crew/v1/today?date=YYYY-MM-DD` requires `crew.trip.read` and returns only departures where the current actor has an active crew assignment on that local date. Each trip includes the assignment roles and a minimum roster: booking identifier, lead name, party count, pickup data, current booking-level check-in state, and each current passenger's name, pending-identity state, category, minor flag, and latest passenger check-in state. It excludes email, payment values, partner data, waiver contents, and tenant-wide booking history.

Guide and driver/skipper roles have `crew.trip.read` and `checkin.write`. For these roles, `POST /ops/v1/bookings/{id}/checkin` and `POST /staff/v1/passengers/{id}/checkin` additionally verify that the departure is actively assigned to the current crew member. Holding a permission alone is therefore insufficient to check in another crew member's departure.

## Connected Expo client

`apps/mobile` now provides the bounded Today → assigned trip → guest check-in → trip-event flow for iOS and Android. It signs in through the database-backed identity API, stores only the opaque session token in Expo SecureStore, and consumes the assignment-scoped crew endpoints. The camera scans opaque expiring passenger tokens without saving an image; the server still checks that the crew member is assigned to the departure. The client offers no tenant administration, unrestricted booking search, payment values, partner finance, or full customer history.

Set `EXPO_PUBLIC_API_BASE_URL` to an API URL reachable from the device; loopback works only for a simulator sharing the development host. A production build, app-store signing, device QA and release configuration remain deployment work.

Reservation capture now materializes one passenger slot for every booked seat. Names may remain pending at booking time. The waiver screen collects a pending passenger's full name before consent, and the server completes identity and records waiver evidence atomically. Direct waiver and clearance calls reject unresolved identities.

## Deliberate boundary

This is connected-first. `POST /crew/v1/departures/{id}/events` records an idempotent, append-only trip-run state event for an assigned crew member and never changes booking or passenger state. Completed and cancelled runs are final. An encrypted offline data cache and mutation queue, payment collection, waiver capture, and push notification are not implemented. The next waiver slice adds a passenger detail view, cruise/hotel/private-accommodation/local stay capture, touch signature, offline command/media sync and server-generated retained PDF as specified in [the launch task list](../../STRATEGY/ui-waiver-launch-task-list.md). Live GPS remains separate. These additions must retain server-side assignment predicates and follow the offline conflict policy before release.

## Evidence

The integration test proves that an assigned guide sees one assigned departure and a minimized passenger roster, can record arrival and trip-run events for that departure, cannot check in an unassigned departure, and cannot use the crew endpoint through an unrelated role.
