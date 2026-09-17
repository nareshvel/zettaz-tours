---
name: Catalog product cards
overview: Redesign the Catalog → Products list from dense rows into a responsive card grid with cover imagery placeholders by product kind, keeping current actions and data. Real photo upload is deferred until a later media epic.
todos:
  - id: markup-cards
    content: Rewrite products list markup to card grid with cover, meta, price, Schedule action
    status: completed
  - id: css-cards
    content: Add product-card grid/cover styles; retire or adapt product-row rules for responsive breakpoints
    status: completed
  - id: smoke-check
    content: Verify empty state, read-only, Schedule link, and mobile stacking
    status: completed
isProject: false
---

# Catalog products card layout

## Current state
- Products tab lives in [`apps/web/components/administration.tsx`](apps/web/components/administration.tsx) (`Catalog` → `view === "products"`).
- Layout is a stacked **row list** (`.product-row` / `.product-list` in [`apps/web/app/globals.css`](apps/web/app/globals.css)): kind chip, status, title, option/duration/mode, next departure, “from” price, optional **Schedule** link.
- [`Product`](apps/web/lib/types.ts) has **no image/cover field**. Catalog API/schema also has no product media today.

## Approach (this pass)
**UI-only card redesign** with a visual cover area:
- Soft gradient + product-kind icon (tour / charter / transfer / etc.) when no photo exists.
- Same data and actions as today — no API/migration work.

Real cover upload (S3, product field, edit form) stays a **follow-up** once this layout ships.

## Card content
Each card becomes the primary click target to `/catalog/{id}`:

```
┌─────────────────────────┐
│  Cover / kind visual    │  ← ~16:10 media plane
│  [kind]      [status]   │  ← overlays on cover
├─────────────────────────┤
│  Title                  │
│  Option · duration · mode│
│  Next departure / model │
│  From $XX               │
│  [Schedule →]           │  ← write + fixed_departure only
└─────────────────────────┘
```

- Keep kind chip, status, next departure / selling model, schedule count, from-price, Schedule shortcut.
- Empty state and “up to 100 products” notice unchanged.
- Metrics bar + Products / Schedules / Assignments tabs unchanged.

## Layout & styling
- Replace `.product-list` rows with a **responsive grid** (e.g. 3 → 2 → 1 columns).
- Cards: rounded cover, light surface, hover lift consistent with landing plan cards / existing teal accents — not a heavy dashboard card farm.
- Cover height ~140–160px; kind-colored muted gradient + Lucide icon (reuse kind mapping).
- Mobile: full-width cards; Schedule as footer control, not a cramped side rail.
- Touch/click: whole card navigates to product; Schedule is a separate control (`stopPropagation` / separate `Link`).

## Files to change
- [`apps/web/components/administration.tsx`](apps/web/components/administration.tsx) — products map markup only.
- [`apps/web/app/globals.css`](apps/web/app/globals.css) — replace/extend `.product-row*` with `.product-card*` grid styles; keep responsive rules.

## Out of scope
- Product image upload, DB columns, S3 wiring
- Product create/edit form media UI
- Schedules / Assignments tabs
- Filtering/search (unless already present — it is not on this list)

## Acceptance
- Products tab reads as a visual catalog of experiences, not a spreadsheet.
- All existing info and Schedule shortcut still work.
- No regressions on empty catalog or read-only (`catalog.write` false).
- Looks correct on desktop and phone.