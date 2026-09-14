# Manifest boarding toolbar

**Status:** Web Manifest gate chrome implemented 14 September 2026. Camera QR uses the browser `BarcodeDetector` API when available; paste/search always remain. Ticket/QR on reservation email/PDF remains a later increment.

## Outcome

The departure Manifest is a **boarding gate** surface only: find a guest, clear money/waiver, board. Setup work (crew/asset assignment, pickup location CRUD, itinerary editing, pickup sequencing) lives elsewhere.

## Locked information architecture

| Surface | Job |
| --- | --- |
| Manifest | Search / Scan → Arrive → Pay if needed → Waiver → Board; header Options for weather/close/pickups; Start trip |
| Day Board | Today’s trips filter + date; **View / Board** and **Start trip** → Manifest |
| Departures | Capacity, Book into trip, open Manifest |
| Catalog → Assignments / Fleet / Staff | Assign crew and assets (readiness source) |
| Plan pickups | Ordered stops + controlled pickup locations |

Do **not** merge Manifest into Departures. Do **not** edit pickup locations or itinerary points on the Manifest.

## Gate chrome (replaces three setup cards)

One compact no-print toolbar above **Board guests**:

1. **Search** — filters the on-page guest list by lead name, passenger name, or booking reference (client-side).
2. **Scan** — opens a sheet: device camera when `BarcodeDetector` + `getUserMedia` are available; otherwise paste token. Resolves via `POST staff/v1/crew/checkin-token/resolve`, then **Arrived** uses the existing passenger check-in path.
3. **Crew** — icon/sheet shows assignment readiness (`unassigned` / `ready` / `blocked`), assigned roles, and expired-document blockers. Read-only; fix assignments under Catalog / Fleet / Staff.

On small screens, Scan and Crew are icon-only. Print/Download are icon-only at all widths (`.icon-only-action`).

## Explicit non-goals on Manifest

- Pickup location create/edit (Plan pickups / location library).
- Itinerary point create/edit (deferred to a Departures/trip setup surface if needed later).
- Selling seats or amending bookings (Departures / Reservations).

## Deferred

- Native ticket/QR on confirmation email and reservation PDF (Manifest already consumes the token).
- Continuous camera decode polyfill for browsers without `BarcodeDetector` (crew Expo app remains the primary field scanner).
- Route/itinerary read-only sheet on Manifest (optional later).
