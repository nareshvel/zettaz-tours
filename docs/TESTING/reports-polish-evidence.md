# Reports polish — implementation evidence

**Date:** 11 September 2026; follow-up 19 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Changes (11 September 2026)

- Date presets: Today, Last 7 days, This month, Last month.
- Explicit departure-date basis, timezone, and reporting-currency copy.
- Exception tiles highlight when count &gt; 0.
- Metric cards label currency and clarify guest receipts vs partner obligations.
- Phone: daily activity table swaps to cards; presets/actions are touch-sized.
- Report API query unchanged (`reports/v1/overview`).

## Follow-up 19 September 2026

- Date range is a chip bar (Today, Last 7 days, This week, This month, Last month, Custom) instead of a filter popover.
- Custom From/To date fields appear only when Custom is selected.
- Range copy uses tenant medium dates; daily rows use tenant `dateOnly` formatting.
- Guest-balance metric uses the same attention treatment as exception tiles when the balance is greater than zero.
- FX / exports notice unchanged (Track A: no conversion; Track B: exports).

## Follow-up 19 September 2026 (reports hub)

- Insights → Reports is a grouped catalog (Operations, Money, Partners, Later). `/reports` loads Period overview by default. Live reports use a period menu plus icon-only Export and Print.
- Period overview, partner aging, and expense summary are registered. `/finance/reports` redirects to `/reports`. Finance Overview links to aging and expense summary.
- Later items (P&L, commission summary, partner PDF, accounting export) stay labelled, not clickable.
- Toolbar: one period/filter button (aging filters collapse to one menu on phone), icon-only Export/Print, equal-height controls.
- Catalog copy is short; Period overview has no FX subtitle. `/finance/reports` still redirects to `/reports`.

## Follow-up 27 September 2026 (correctness + new reports)

**Correctness fixes — Period overview (`reports/v1/overview`)**

- Received now counts settled payments on **confirmed** bookings only. Money taken on held/cancelled bookings is reported separately (`receivedUnconfirmedMinor`) with a "review for confirmation or refund" notice. Before this, received included held/cancelled payments while booked/balance did not, so the tiles did not reconcile.
- State breakdown: confirmed / **held** / cancelled (previously ~half the bookings were unexplained "total").
- Currency: `reporting_currency` (fallback `base_currency`, then XCD). Bookings whose price-snapshot currency differs are **excluded** from money totals and counted in `otherCurrency` with a notice (no silent mixed-currency sums).
- Reconciliation line on screen: booked − received − partner credit = guest balance (per booking, floored at zero).
- Daily table uses `generate_series`, so zero-activity days appear for ranges ≤ 31 days; longer ranges list active days only.
- Date basis option: departure date (default) or booking date (`created_at` in tenant timezone). Exceptions and daily volume always use departure date.
- Previous-period comparison (equal length) on confirmed bookings and booked value.
- Range capped at 400 days (400 error beyond).
- Note: payment adjustments are whole-payment void/reversal (UNIQUE per payment), so excluding adjusted payments is correct — not a bug.

**New live reports**

| Report | Route | Permission | Basis |
| --- | --- | --- | --- |
| Sales by product | `reports/v1/sales-by-product` | `bookings.read` | Guests, occupancy vs open-departure seats, cancelled %, booked, received, avg per guest |
| Booking sources | `reports/v1/booking-sources` | `bookings.read` | Bookings / confirmed / cancelled / guests / value by `bookings.source` |
| Commission summary | `reports/v1/commission-summary` | `partner.statement.read` | From `partner_booking_links` snapshot (never recalculated); commission, settled, outstanding by partner + direction |

Web gateway allowlist (`app/api/gateway/[...path]/route.ts`) extended to the three new routes.

**UX**

- Shared `useReportPeriod` hook (`reports-shell.tsx`) + `lib/report-period.ts`: one period menu, optional date-basis toggle, filters persisted in the URL (`?range=&from=&to=&basis=`) so views can be bookmarked/shared.
- CSV exports start with a header block (report, tenant, range, basis, timezone, currency, generated at); amounts in major units.
- KPI cards link to Reservations / Departures; exception tiles link to Day Board / Departures.
- Daily guests bar chart (desktop, ranges 2–62 days).
- Catalog: new "People & compliance" group (links to Customers, Audit log); "Coming later" collapsed.

**Evidence 27 Sep:** API typecheck + web typecheck clean. Full API suite: 55 pass / 8 fail — the same 8 fail on the untouched original code (invitations, recovery, sign-in, webhook, crew session, receipt PDF, migrations rerun; environment-related, not reports). New test `report arithmetic reconciles and product, source and commission reports stay tenant-scoped` passes, and fails against the old reports code. Agent visual via Playwright on demo data: overview, sales by product, booking sources, commission summary render correctly.

## Automated evidence

- `npm run typecheck --workspace=@zettaz/web` after this follow-up (passed).
- API: `report totals use tenant-scoped published commercial and operational facts`; `partner aging and expense summary reports stay tenant-scoped`.

## Owner acceptance still needed

- Switch presets and custom range; confirm totals match expected seed data.
- Phone layout for chips, exceptions, and daily cards.
- Confirm FX notice remains visible when currencies would otherwise need conversion.
