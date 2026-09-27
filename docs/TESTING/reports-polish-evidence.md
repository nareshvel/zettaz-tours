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

## Follow-up 27 September 2026 (finance reports)

- **Partner statement**, **Profit & loss**, **Accounting export** are live (see reporting-minimum.md). Catalog has no remaining "later" items.
- Gateway allowlist extended; `config.accounting` added to the tenant config schema (defaults, fixture updated).
- Test `partner statement, P&L and accounting journal reconcile and stay tenant-scoped`: statement closing = −commission for a tenant-owes-partner link; other tenant gets 404; P&L revenue = total − tax, net = revenue − commission − expenses; every journal balances; expense posts to category code; other tenant sees no journals. Suite: 56 pass / same 8 pre-existing failures.
- Agent visual (Playwright, demo data): P&L, accounting export (mapping + journal), partner statement render correctly; journal/statement column widths tuned.
- Void settlement question resolved 27 Sep — see *Partner settlement and void accuracy* below.

## Follow-up 27 September 2026 (partner settlement and void accuracy)

Owner direction: calculations must be exact; fix voided settlements and voided expense bills.

**Defects found and fixed**

| # | Defect | Effect before | Fix |
| --- | --- | --- | --- |
| 1 | Finance partner ledger treated **void** settlements as cleared | A voided settlement (whose bookings are released back to unsettled) still reduced the balance → debt understated | Only **paid** settlements move money. Voiding a paid settlement posts a reversal on the void date |
| 2 | Ledger running balance **reset to 0** on any cleared settlement | Wrong whenever unsettled bookings existed outside the settlement period | Running balance = cumulative sum of signed entries |
| 3 | Running balance computed **per page** (restarted at 0 on each page) and three lists paginated separately then merged | Page 2+ balances and ordering wrong, rows skipped | One SQL ledger (window function over the whole ledger), then filter + paginate |
| 4 | Partner-collects bookings counted **gross** in ledger/statement but **commission only** in Finance overview/summary; settlement net = gross − commission | Three different "owed" numbers for the same bookings; paid settlement left the commission stranded as balance | Everywhere: partner_owes_tenant link = gross − commission; tenant_owes_partner link = commission. Paid settlement clears to exactly 0 |
| 5 | Direction taken from the partner's **current** setting, not the link snapshot | Changing a partner's terms rewrote history | Link snapshot direction used in ledger, summaries and settlement generation |
| 6 | "Mark paid" ignored the entered **payment date** and **confirmed amount** | paid_at = click time; short payments silently accepted as full | paid_at = entered date (tenant local noon; future dates refused). Confirmed amount must equal net, otherwise 409 |
| 7 | Settlement generation used the **UTC** date of departure start and included **cancelled** bookings | Evening departures fell in the wrong period; commission settled on cancelled trips | Migration `098_partner_settlement_accuracy.sql`: departure local date, cancelled excluded, refuses mixed directions/currencies in one settlement |
| 8 | Aging "as of" used today's status | Settlements paid/voided after the as-of date vanished from historic aging; ones raised after it appeared | Open as of date = raised on/before it and not paid/voided by it |
| 9 | Commission summary "settled" used `settled_at` (set when a **draft** is generated) | Draft settlements looked settled | Settled = inside a **paid** settlement |
| 10 | Accounting export omitted voided expense bills (and voided expense payments) | A bill already imported by the accountant, then voided, was never reversed | Bill posts on its date; the void posts a reversing journal on the void date. Same for expense payments and paid-then-voided partner settlements. A bill voided on/before its own date is omitted entirely |

**Single source of truth:** `apps/api/src/partner-ledger.ts` (`PARTNER_LEDGER_ENTRIES`) now feeds the Finance ledger and the partner statement, so both always agree.

**Evidence:** new test `partner settlements: paid clears, void restores, dates and amounts are exact; voided bills reverse in the journal` — balance = statement = settlement net; draft moves nothing; short payment and future date refused (409); paid date stored as entered; paid clears to 0; void restores the full amount and releases links; statement shows paid + reversal; journal has bill, bill void, remittance (Bank 12,000 / Commission 3,000 / Income 15,000) and its reversal, all balanced; mixed directions refused. Aging test extended with an as-of-before-raised check. Suite: 56 pass / same 8 pre-existing failures.

**Deploy note:** includes migration **098** (function replace, idempotent) — runs via `./deploy.sh`.

**Still a design question (not changed):** accepted partner *collection claims* (`partner_obligations`) are a separate flow and are shown in the ledger for information only, not in the balance, to avoid double-counting bookings that also have a partner-collects link. Confirm whether both flows can apply to the same booking.

## Automated evidence

- `npm run typecheck --workspace=@zettaz/web` after this follow-up (passed).
- API: `report totals use tenant-scoped published commercial and operational facts`; `partner aging and expense summary reports stay tenant-scoped`.

## Owner acceptance still needed

- Switch presets and custom range; confirm totals match expected seed data.
- Phone layout for chips, exceptions, and daily cards.
- Confirm FX notice remains visible when currencies would otherwise need conversion.
