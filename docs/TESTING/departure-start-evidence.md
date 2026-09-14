# Departure start evidence

## Scope

Staff/ops **Start trip** on Day Board and Manifest (`POST /ops/v1/departures/{id}/start`), including optional mark-remaining-no-show.

## Automated

- `apps/api/test/first-slice.test.ts` — `ops start trip marks remaining guests no-show and records departed`
- Board payload includes `boarded_guests`, `no_show_guests`, `boarding_pending`, `trip_run_state`

## Manual

1. Day Board trip card: while guests pending → **Board guests** primary, **Start trip** secondary; Close/Weather hold unchanged.
2. Start with pending guests → confirm lists count, requires reason, marks no-show, sets trip started.
3. Manifest header → **Start trip** next to Print/PDF; after start shows **Trip started**.
4. Second Start → rejected.
