# Responsive admin layout consistency

**Date:** 10 September 2026 · **Status:** Working rules for tenant admin web  
**Applies to:** Authenticated workspace pages (Catalog, Departures, Reservations, and later surfaces)

Use with the [responsive design baseline](../TESTING/responsive-design-baseline-evidence.md) and the [UI launch task list](../STRATEGY/ui-waiver-launch-task-list.md). This note captures layout lessons from Catalog polish so other pages stay consistent.

## Acceptance widths

| Band | CSS width | Shell | Layout intent |
| --- | --- | --- | --- |
| Phone | ≤850px (stress at 360–440) | Drawer nav, `workspace-main` full width | Single column, icon-first primary actions, cards/lists instead of wide tables |
| Tablet | 851–1366 (stress at iPad Air 1180) | Often still shows aside; content is narrow | Hide sticky side previews; prefer 1–2 columns; do not assume “desktop” just because device width ≥1080 |
| Desktop | ≥1367 with comfortable content width | Fixed aside + `calc(100% - sidebar)` main | Optional sticky preview/aside; multi-column forms and dense toolbars |

DevTools device frames matter: **iPad Air landscape is 1180px**, so any rule capped at `1080px` will still show the desktop two-column editor and sticky panels.

## Shell rules (do not regress)

1. **Contain the main column.** `workspace-main` must use `width/max-width: calc(100% - sidebar)` (or `100%` when the drawer hides the aside). `margin-left` alone can widen the page and clip right-side actions.
2. **Every flex/grid child that may shrink needs `min-width: 0`** (and often `max-width: 100%`). Default `min-width: auto` lets wide inputs, tables, and `white-space: nowrap` buttons blow out the page.
3. **Page scroll is vertical only.** Horizontal scroll belongs inside an explicit scroller (`.table-scroll`, `.price-matrix-wrap`), never on `body` / `.page`. Prefer `overflow-x: clip` on shell and page; put `min-width` only on tables **inside** `.table-scroll`.
4. **Viewport meta** stays device-width (`apps/web/app/layout.tsx`).
5. **Touch targets** stay ≥44×44 CSS px for icon actions.

## Shared page patterns

### Metrics strip (`.catalog-metrics`)

- Desktop/tablet wide: horizontal flex or single row is fine.
- **≤850px: forced 2×2 CSS grid** (`repeat(2, minmax(0, 1fr))`), labels may wrap (`overflow-wrap: anywhere`).
- Do not rely on flex-wrap alone; it looks like a broken single column when the page is overflowing.

### Title vs tab actions

- Keep the page `Heading` for title + description only when the primary create action is tab-scoped.
- Put create/add actions in a **view action bar** (`.view-action-bar` / `.catalog-view-bar`): tabs left, primary action right.
- Show **only the action for the active tab** (e.g. Add product vs Add availability).
- **≤850px:** that primary action is **icon-only** (Plus) with `aria-label`; full label on larger screens.

### Sticky preview / secondary column

- Desktop only (above ~1366px, and not coarse-pointer tablets).
- Below that band: `grid-template-columns: 1fr` and **hide** the sticky preview (`display: none`), with the same facts already mirrored in the header (badges, price pill, inline actions).

### Forms and editors

- Prefer `minmax(0, 1fr)` grids; stack offer fields to one column by ~680px.
- Long helper text and toggle cards must wrap; never set intrinsic min-widths on selects/inputs beyond `min-width: 0`.
- Primary save/cancel in the header: Cancel may be icon-only (`X`); Save may shorten to **Save** + check on phone (not icon-only if the label is needed).

### Lists, tables, cards

- Wide data tables live in `.table-scroll`; phone list views use card rows (see Reservations / Departures list cards).
- On phone, increase row/card vertical padding by ~2px when the list feels tight (Catalog product rows).
- Panel section titles inside cards (e.g. “Upcoming departures”) must share the same horizontal padding as the rows beneath them (avoid `.panel-heading.plain { padding: 0 }` flush to the edge).

### Toolbars and filters

- Dense filter grids collapse to 2 columns around 1050px and to stacked controls on phone.
- Search spans full width on the first collapse step.
- Range presets and reset actions take a full row on phone so they are not clipped.

## Checklist for the next page

When polishing a workspace page, verify all four:

1. **Phone 440:** no document horizontal scroll; metrics 2×2; primary action visible (icon ok); filters usable without sideways drag of the whole page.
2. **Tablet 1180 (iPad Air):** no clipped right-rail actions; sticky preview hidden if content column is cramped; tabs + action bar remain fully on-screen with the aside visible.
3. **Desktop 1440+:** optional preview/aside allowed; full action labels.
4. **Keyboard / touch:** focus visible; 44px targets; `aria-label` on icon-only controls.

## First surfaces following this note

| Surface | Notes |
| --- | --- |
| Catalog list + product editor | Source of these rules (metrics, view-action bar, preview hide, editor containment) |
| Departures list | Metrics + Filter popover + New action; icon-only ≤850 |
| Reservations list | Search left + Filter + New right on one bar; metrics 2×2 ≤850 |
| New reservation | Progressive find → hold → guest accordion; sticky booking strip always; desktop summary rail only ≥1367 |

### Reservations list action bar

Use `.list-action-bar`: search on the left (`minmax(0,1fr)`), Filter + primary create on the right (`.departure-view-actions`). Do not put create in the page `Heading` when this bar is present.
