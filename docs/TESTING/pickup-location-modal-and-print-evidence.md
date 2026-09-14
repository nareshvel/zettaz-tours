# Pickup location modal, Plan pickups / Print list polish — evidence

**Date:** 14 September 2026  
**Scope:** Settings pickup-location CRUD UX, nested-form fix, Esri map preview, Plan pickups Phase 1 completeness, Print list layout alignment, demo seed for live stops/exceptions.

## Delivered

### Settings → Pickup locations
- Tab and Partners/resellers render outside the tenant-config `<form>` (avoids nested forms with `FormDialog`).
- `FormDialog` / `ConfirmDialog` portal to `document.body`.
- Wider Add/Edit modal (~720px); Identity with name full-width; **Location code + Kind** in one two-column row.
- Address prefills on create from tenant business profile city / parish / country.
- Leaflet preview on **Esri World Street Map** tiles; click to place pin; center via Esri geocode when no pin (no Google/OSM.org/CARTO keys).
- Map link + Open in Maps / fill-from-coordinates helpers retained.

### Plan pickups
- Phase 1 behaviors confirmed complete (metrics, Needs attention, smart Add / Add all, reorder, stop notes, unsaved/print hygiene, Settings link for locations, save footer). Sequencing-only — no location CRUD.

### Print pickup list
- Aligned with Plan pickups header/metrics/Needs attention; sequence cards only (desktop table removed); Plan pickups + Print/PDF actions.

### Demo seed
- Rolling demo day plan: four stops + unresolved + not-in-plan on product 0.
- Seed subscription plan ID corrected to Operations UUID (`f7317df1-…`).
- Dedicated `Demo Pickup · *` / `Sample Pickup · *` guests bound to the plan departure.

## Verification

- `npm run web:typecheck` — pass (after Leaflet/Esri changes).
- `npm run db:seed` — plans seeded with 4 stops, 1 unresolved, 1 not-in-plan on future demo day.
- Manual: Settings → Pickup locations → Add (no nested-form console error; map tiles load; address default from tenant profile).
- Manual: Day Board → tomorrow’s Clear Boat / Coastal → Options → Plan pickups / Pickup list show seeded stops and exceptions.

## Related docs

- [pickup-disposition-and-plans.md](../FEATURES/operations/pickup-disposition-and-plans.md)
- [printable-pickup-list.md](../FEATURES/operations/printable-pickup-list.md)
- [demo-data.md](../CLIENTS/rock-adventures/demo-data.md)
- Earlier API evidence: [operations-pickup-evidence.md](./operations-pickup-evidence.md)
- Earlier Day Board acceptance: [day-board-polish-evidence.md](./day-board-polish-evidence.md)

## Explicitly not claimed

- Google Places / Directions / live GPS / auto route optimization
- Owner visual re-acceptance of every admin width for this Sep 14 polish (implementation complete; short owner pass recommended)
- Go print-agent live routing
