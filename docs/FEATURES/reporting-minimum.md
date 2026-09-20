# Track A reporting minimum

## Purpose

Give tenant staff a traceable operating summary without introducing a warehouse, generalized report builder, or accounting ledger.

## Hub

Insights → **Reports** (`/reports`) is a catalog grouped by Operations, Money, Partners, and Later. `/reports` opens **Period overview** by default. Opening a report from the catalog uses `/reports/:slug` with a shared toolbar: a period menu, icon-only CSV export, and icon-only browser print (not the operations print agent). `/finance/reports` redirects here. Manifests and pickup lists still print from Operations.

## Live reports

- **Period overview** (`reports/v1/overview`, `bookings.read`): departure-date range; confirmed/cancelled counts; booked value from the immutable price snapshot; settled guest payments, remaining guest balance after accepted partner credit, partner obligations; weather holds, closures, unassigned departures, unresolved pickups; daily volume.
- **Partner aging** (`finance/v1/finance-aging`, `partner.statement.read`): as-of date, payable/receivable, optional partner; drill to the partner ledger.
- **Expense summary** (`finance/v1/expenses`, `partner.statement.read`): expense-date period; recorded / paid / outstanding in reporting currency; totals by category.

All commercial totals use the tenant reporting currency. Cross-currency conversion remains disabled unless an approved FX policy exists. Each request uses the tenant database context and never accepts a tenant identifier from the client.

CSV is generated from the rows on screen. Later catalog items (P&amp;L, commission summary, partner PDF, accounting export, sales by product) are labelled not in this launch and have no fake numbers.

## Boundary

Reports are operational read models. They do not create accounting entries, infer provider settlement, calculate tax filings, or schedule emails. Rich analytics, a warehouse, QBO live sync, and print-agent report PDFs remain Track B.

## Acceptance

- A tenant sees only its own facts for the selected dates.
- Booked value traces to immutable price snapshots; received value includes settled payments only.
- Accepted partner collections reduce guest balance and remain visible as partner obligations.
- Operational exception counts are derived from current authoritative departure, assignment, and pickup state.
- Finance Overview links to aging and expense summary; Finance has no Reports tab.
