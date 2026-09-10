# Track A reporting minimum

## Purpose

Give tenant staff a traceable operating summary without introducing a warehouse, generalized report builder, or accounting ledger.

## Current report

The Reports page accepts a departure-date range and reads tenant-scoped published facts:

- confirmed and cancelled booking counts;
- confirmed booked value from the latest immutable price snapshot;
- settled guest payments, remaining guest balance after accepted partner credit, and partner obligations;
- departures, weather holds, closures, departures without active assignments, and unresolved pickups;
- daily departure, confirmed-booking, and guest counts.

All commercial totals use the tenant reporting currency. Cross-currency conversion remains disabled, so the current tenant configuration requires booking, collection, and reporting currencies to match. The API requires `bookings.read`, applies the tenant database context, and never accepts a tenant identifier from the report request.

## Boundary

This report is an operational read model. It does not create accounting entries, infer provider settlement, calculate tax filings, age receivables, schedule emails, or export personal data. Rich reporting, exports, configurable definitions, and a warehouse remain Track B.

## Acceptance

- A tenant sees only its own facts for the selected departure dates.
- Booked value traces to immutable price snapshots; received value includes settled payments only.
- Accepted partner collections reduce guest balance and remain visible as partner obligations.
- Operational exception counts are derived from current authoritative departure, assignment, and pickup state.
