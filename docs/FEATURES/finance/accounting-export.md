# Accounting export (QuickBooks / Xero / CSV)

**Status:** Specified, not built  
**Date:** 19 September 2026  
**Reads with:** [PLAN.md](PLAN.md) · [finance-money-in-out-later.md](../../STRATEGY/finance-money-in-out-later.md) · [finance-and-offline.md](../../ARCHITECTURE/finance-and-offline.md) · ADR [004](../../DECISIONS/004-money.md)

Zettaz is the operational ledger (bookings, partner claims, expense bills, vendor payments). The tenant’s accountant still owns the books. We export **facts that already exist**, mapped to the tenant’s chart of accounts. We do not invent FX, mix SaaS subscription with tenant books, or post open guest balances as cash.

## Sequence

1. Cash facts in Zettaz (guest payments, partner receipts, expense bills **and** expense payments).
2. Tenant mapping: Zettaz category / partner type / payment method → accountant account code (and later QBO `AccountRef`).
3. Balanced journal **CSV** (QuickBooks Online Import Data → Journal Entries, plus a generic column set).
4. Later: Intuit or Xero OAuth per tenant posting the same journals.

IIF is QuickBooks **Desktop** only. QBO does not import IIF. Do not build Desktop IIF.

## What can post once mapping exists

| Source | Typical journal |
| --- | --- |
| Settled guest `payments` | Debit Undeposited Funds / Bank; Credit tour income |
| Open guest balance | Do not export as cash |
| Partner obligation / settlement paid | AR or AP from `commission_direction` |
| Expense bill | Debit expense account; Credit AP (vendor) |
| Expense payment | Debit AP; Credit Bank/Cash (`method` until bank registers exist) |
| Zettaz SaaS invoice | Never in tenant export |

## Invariants

- Integer minor units + ISO currency.
- Four domains stay separate: guest collection, partner remittance, vendor payment, SaaS.
- Corrections are append-only voids, same as booking payments.
- Unlike currencies do not settle without a recorded rate on that fact.
- No Rock-hard-coded account names.

## Owner decisions before a live QBO app

Which product (QBO vs Xero vs CSV-only), home currency of the file, and whether sales post as Sales Receipt vs Journal. Default: **QBO + reporting-currency CSV journals**.
