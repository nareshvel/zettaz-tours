# ADR 004 — Money

**Status:** Accepted · **Date:** 5 September 2026

## Context

Island operations mix guest prices, cash collection, and bank settlement, often across USD and XCD. Floating-point amounts and live re-pricing of confirmed bookings cause finance defects.

## Decision

- Store currency as integer minor units plus ISO 4217 code.
- Persist booking currency, collection currency, and reporting currency, plus the `ExchangeRate` used.
- On confirm and on each accepted change, write an immutable `PriceSnapshot`.
- Payments, refunds, and adjustments are append-only ledger lines. They never rewrite snapshot totals.
- Never store raw card data. Use hosted or tokenized checkout and approved terminals.
- Gateway access goes through a neutral payments port (session, capture, refund, webhook verify, payment link, reconcile).

Exact launch gateway and which currency fills which role remain open in [launch-contract.md](../STRATEGY/launch-contract.md). The model must not assume Stripe-only or USD-only.

## Consequences

- Refunds and invoices explain themselves from snapshots and ledger lines.
- Check-in shows snapshot balance in the collection currency.
- FX policy (who sets the rate, daily vs per-transaction) is an operations decision, not a schema change.
