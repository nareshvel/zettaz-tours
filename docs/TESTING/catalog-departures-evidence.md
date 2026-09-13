# Catalog and departures foundation acceptance evidence

**Verified:** 10 September 2026  
**Database:** persistent local PostgreSQL (`zettaz_tours`)

## Accepted scope

- Migration 055 adds tenant-scoped products, options, passenger units, rate plans, availability rules, rule times, exceptions, and departure links/status without changing existing booking or departure identifiers.
- Existing JSON product and schedule records are backfilled. Their columns remain as an explicit compatibility boundary while booking and connector adapters migrate incrementally.
- Product creation writes both the compatibility record and normalized records in one transaction.
- Fixed recurring availability writes a rule, local time, blackout exceptions, and linked dated departures in one transaction.
- Catalog separates Products from Availability and exposes product lifecycle, kind, mode, option/rule counts, prices, and next departure.
- Departures provides Agenda, Calendar, and List views. Agenda is chronological and shows localized time, duration, capacity, manifest, and booking actions.
- The initial editor now captures product type, availability model, description, pricing model, private-party behavior, confirmation mode, passenger units, and initial dated rates.

## Verification

- Persistent migration: `055_catalog_availability_model.sql` applied; 55 known, 55 applied, 0 pending.
- API/PostgreSQL: 43/43 tests passed. Catalog tests verify normalized writes, availability-rule output, product/rule read-and-update, optimistic versions, and cross-tenant isolation.
- TypeScript application build: passed.
- Next.js production build: passed.
- Expo/mobile strict type check: passed.
- `git diff --check`: passed.
- Live browser: Products and Availability loaded from persistent data; rule times are not duplicated and dates remain calendar dates.
- Responsive browser checks: 390×844 and 768×1024 showed no page-level horizontal overflow. Agenda rows, metrics, tabs, and actions reflowed at both widths.
- 10 September polish: API/web typecheck verified; product/rule open-and-update covered by the new suite test. A live click-through of the redesigned Catalog/Departures screens still needs a restarted `workspace:dev` so the new GET/PATCH routes are loaded.

## Usability polish — 10 September 2026

- Product cards open a detail page. Identity and lifecycle status can be edited with an optimistic version. Availability mode, categories, and rates stay read-only on this increment.
- Availability rows open the rule, its blackouts, and upcoming generated departures. Pause/resume does not cancel or rewrite those instances.
- Add availability lives in Catalog (`/catalog/availability/new`). `/departures/new` remains an alias. The action is hidden for products that are not `fixed_departure`.
- Departures defaults to the next 14 local days and exposes the existing date/product filters. Agenda rows open the manifest. Week view is a Monday–Sunday grid for the selected range, not a horizontal dump of occupied days. Phone list uses cards.
- Catalog and Departures summaries show real zeros after load. Product cards show price-from and a shared mode label. Archived products are hidden from New reservation discovery.

## Add schedule page redesign — 12 September 2026

- `/catalog/availability/new` retitled **Add schedule** with plain-language sections (Tour → Dates & time → Days → Seats → Closed dates).
- Desktop (≥1367): two-column form + sticky live preview with mirrored Create CTA. Narrower widths: summary strip under the heading; sticky Cancel/Create on phone.
- Weekday presets are a segmented control; blackouts remain optional with an empty-state line.
- Local browser checks: empty tour, filled form, closed dates (90→89), Create disabled at 0 days, `?product=` preselect, no horizontal overflow at 390 and 1440.

## Catalog Schedules IA — 12 September 2026

- Locked decisions: [catalog-schedules-ia.md](../FEATURES/catalog-schedules-ia.md).
- Catalog tabs renamed to Products | Schedules; product Schedule action opens `/catalog?tab=schedules&product=:id`.
- Product editor: passenger categories and seasonal rates use table + FormDialog; seasonal delete checks rate-window usage.
- Schedule create uses FormDialog (name, multi start times, hybrid calendar). Full-page `/catalog/availability/new` redirects into the Schedules tab modal.
- Migration 062 adds `availability_rules.name`; create accepts `localTimes[]`.
- Schedules tab list polish: [schedules-tab.md](../MODULES/Catalog/schedules-tab.md) — search/product/status filters, desktop table + phone cards, pause/resume.

## Deliberate next increments

The normalized model recognizes `opening_hours`, `open_dated`, `on_request`, and `resource_window`. Their booking engines and specialized availability editors remain separate bounded increments; the application does not silently treat them as fixed departures. Versioned rate/option editing, one-off departures, and resource-conflict enforcement remain subsequent Catalog increments.
