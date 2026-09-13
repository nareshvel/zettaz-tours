# Catalog Schedules tab

**Status:** Implementation slice · **Date:** 12 September 2026  
**Parent:** [catalog-schedules-ia.md](../../FEATURES/catalog-schedules-ia.md)  
**Discarded inspiration:** [schedules-view-gemini-suggestion.md](schedules-view-gemini-suggestion.md) (ops board / drafts / fleet — not this surface)

## Purpose

Catalog → **Schedules** is the configuration list of **recurring schedule rules** (availability rules), not the operational Departures calendar.

Operators need to:

- See all rules (or filter to one product via `?product=`)
- Search by name / tour / time and filter by status via a **Filter** popover (Departures pattern)
- Open a rule for detail with upcoming departures in a month calendar
- Pause / resume without leaving the list
- Create via the existing **Add schedule** FormDialog

## In scope

- Action bar: **Filter** + **Add schedule** (icon-only ≤850; icon + label otherwise), matching Departures
- Filter popover: search, tour, status, operating period (any / this week / this month / custom), reset
- Responsive **table** (desktop/tablet) and **cards** (phone ≤850)
- Columns: name, tour, period (`Sep 01, 2026 - Sep 30, 2026`), times, days, seats, status, upcoming, actions
- **Edit:** same Add schedule modal — name, seats, dates, times, operating days; regenerates upcoming empty departures with booking/hold guards ([schedule-regenerate-on-edit.md](schedule-regenerate-on-edit.md))
- Row open → `/catalog/availability/:id` (Back → `/catalog?tab=schedules`)
- Rule detail: summary metrics, calendar of upcoming departures with day labels in cells (`1 Mon`) and no weekday header row, Filter + Pause/Resume + Add schedule
- Pause blocked when upcoming departures still have active bookings (`held` / `pending_payment` / `confirmed` / `disputed`)
- Product row **Schedule** → `/catalog?tab=schedules&product=:id` (query synced via `useSearchParams`)

## Out of scope

- Draft / publish workflow, templates, fleet/timeline calendars
- Pickup / guide / asset filters
- One-off “Create departure” as primary CTA
- Tenant-hardcoded tour colors or mock Rock data
- Tailwind / alternate design system
- Full schedule regenerate-on-edit

## Acceptance

- Phone: no horizontal page scroll; cards with ≥44px targets; Filter/Add are icon-only
- Tablet/desktop: scannable table; Filter popover usable
- Period column and detail operating period use medium date range
- `?product=` still filters; Add schedule modal still works
- Pause/resume updates status without full navigation
- Detail calendar shows filtered upcoming departures by month
