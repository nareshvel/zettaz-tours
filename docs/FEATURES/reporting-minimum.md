# Track A reporting minimum

## Purpose

Give tenant staff a traceable operating summary without introducing a warehouse, generalized report builder, or accounting ledger.

## Hub

Insights → **Reports** (`/reports`) is a catalog grouped by Operations, Money, Partners, and Later. `/reports` opens **Period overview** by default. Opening a report from the catalog uses `/reports/:slug` with a shared toolbar: a period menu, icon-only CSV export, and icon-only browser print (not the operations print agent). `/finance/reports` redirects here. Manifests and pickup lists still print from Operations.

## Live reports

- **Period overview** (`reports/v1/overview`, `bookings.read`): departure-date range; confirmed/cancelled counts; booked value from the immutable price snapshot; settled guest payments, remaining guest balance after accepted partner credit, partner obligations; weather holds, closures, unassigned departures, unresolved pickups; daily volume.
- **Partner aging** (`finance/v1/finance-aging`, `partner.statement.read`): as-of date, payable/receivable, optional partner; drill to the partner ledger.
- **Expense summary** (`finance/v1/expenses`, `partner.statement.read`): expense-date period; recorded / paid / outstanding in reporting currency; totals by category.
- **Sales by product** (`reports/v1/sales-by-product`, `bookings.read`): per product guests, occupancy against open-departure seats, cancellations, booked and received value.
- **Booking sources** (`reports/v1/booking-sources`, `bookings.read`): bookings and value by booking source.
- **Commission summary** (`reports/v1/commission-summary`, `partner.statement.read`): commission from the snapshot on `partner_booking_links`; commission, settled, outstanding by partner and direction.
- **Partner statement** (`reports/v1/partner-statement`, `partner.statement.read`): opening balance, booking and settlement lines with running balance, closing balance for one partner. Positive = partner owes the tenant. Same entries as the Finance ledger (`partner-ledger.ts`). Only **paid** settlements move the balance; voiding a paid settlement reverses it on the void date. Browser print → Save as PDF (no print agent).
- **Profit & loss** (`reports/v1/profit-and-loss`, `partner.statement.read`): management view. Revenue = confirmed price snapshots net of tax on departure date; less partner commission (link snapshots); less expenses by category (`amount_reporting_minor`, the per-bill recorded rate). Tax collected shown as a memo. Not a tax filing.
- **Accounting export** (`reports/v1/accounting-journal`, `partner.statement.read`): cash-basis balanced journals (guest payments, expense bills, expense payments, paid partner settlements — each void posts a reversing journal on its void date) exported as QuickBooks Online Journal Entries CSV. Account names come from `config.accounting` (editable on the report by `config.write`); expense bills post to the category code, else its name.

Period overview counts **received** on confirmed bookings only; money on held/cancelled bookings is shown separately. Bookings priced in a currency other than the reporting currency are excluded from money totals and counted. Reports accept `basis=departure|booked` and a range of at most 400 days.

All commercial totals use the tenant reporting currency. Cross-currency conversion remains disabled unless an approved FX policy exists. Each request uses the tenant database context and never accepts a tenant identifier from the client.

CSV is generated from the rows on screen. There are no "later" items left in the catalog; QBO/Xero OAuth posting remains Track B and have no fake numbers.

Tenant isolation and arithmetic for all live reports are covered in `apps/api/test/first-slice.test.ts`.

## Boundary

Reports are operational read models. They do not create accounting entries, infer provider settlement, calculate tax filings, or schedule emails. Rich analytics, a warehouse, QBO live sync, and print-agent report PDFs remain Track B.

## Acceptance

- A tenant sees only its own facts for the selected dates.
- Booked value traces to immutable price snapshots; received value includes settled payments only.
- Accepted partner collections reduce guest balance and remain visible as partner obligations.
- Operational exception counts are derived from current authoritative departure, assignment, and pickup state.
- Finance Overview links to aging and expense summary; Finance has no Reports tab.
