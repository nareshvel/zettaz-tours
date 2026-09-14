# Departure start and no-shows

**Status:** Implemented 14 September 2026. Day Board **Close** remains sellability (`weather_hold` / `closed`). **Start trip** records trip-run → `departed` via `POST /ops/v1/departures/{id}/start` (`checkin.write`). Crew mobile still posts trip-run events on assigned departures.

## Do not confuse Close with Start

| Control | Owns | Meaning |
| --- | --- | --- |
| **Weather hold / Close** (Manifest **Options**) | Departure **operational status** | Stops new sales; confirmed bookings stay for Recovery |
| **View / Board** | Manifest | Arrive → Pay → Waiver → Board per passenger |
| **Start trip** | **Trip-run** state → `departed` | Vehicle/boat has left; boarding window closed for this run |

Replacing **Close** with **Start** would break weather/ops sellability. Keep **Close** under Manifest Options. Day Board primary actions are **View / Board** and **Start trip** only.

## Recommended Day Board CTA

While passengers still need gate work:

- Primary button: **View / Board** → Manifest

When every confirmed passenger is either `boarded` or `no_show`, and operational status is `open`:

- Primary button: **Start trip** (records trip-run `departed`)
- Secondary: still open Manifest for late corrections if policy allows before start

After `departed`:

- Primary: **Trip started** (disabled) or **Complete trip** later
- Manifest remains readable; new Arrive/Board may be blocked server-side (future guard)

## No-show before leaving (best logic)

Real ops: some guests never arrive. Do **not** require 100% boarded before Start.

1. **Explicit no-show** — staff marks each missing passenger `no_show` on Manifest (already supported) before or during the Start confirm.
2. **Start confirm sheet** — lists anyone still not `boarded` / `no_show` and requires:
   - mark remaining as no-show, or
   - cancel Start and return to Manifest
3. **After Start** — late walk-ups are a separate policy (usually new booking or audited exception); default Track A: no silent auto-board after `departed`.

Booking state stays `confirmed` when some passengers boarded and others no-show ([domain-and-states.md](../../ARCHITECTURE/domain-and-states.md)).

## Start on Manifest too?

**Yes — primary Start belongs on Manifest** (gate staff have the passenger truth). Day Board can mirror the same action when counts say the run is ready, as a dispatcher shortcut.

Manifest header: icon-only Print/PDF, **Options** (weather/close/pickups/recovery), then **Start trip**.

## Implementation notes

- Staff/ops: `POST /ops/v1/departures/{id}/start` with `{ markRemainingNoShow, reason? }` — does not overload `operational-status`.
- Crew assigned path remains `POST /crew/v1/departures/{id}/events` with `state: "departed"`.
- Day Board exposes boarded / no-show / pending counts and trip-run state for CTA labels.
- Confirm dialog: checklist for zero/partial boarded, pending → no-show, pickup plan gaps / follow-ups, and weather hold / closed with boarded guests. Reason required when any warning applies.
- **Blocked:** no confirmed guests; weather hold / closed with nobody boarded (use hold/Close/Recovery — do not Start an empty held run).
- **Undo start:** `POST /ops/v1/departures/{id}/unstart` with reason — only from `departed` → `boarding`. Does not reverse no-shows recorded at start.
- Day Board filter: Pending / Started dropdown beside the date control (trip-run state).
- Passenger roster required before start; bookings without named passengers stay pending on the Day Board until names are recorded.
- Audit + outbox on trip-run event and each no-show check-in.

## Explicit non-goals for this note

- Auto no-show at scheduled `starts_at` without staff action
- Replacing Weather hold / Close
- Merging Manifest into Day Board
