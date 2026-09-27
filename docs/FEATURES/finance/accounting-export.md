# Accounting export (QuickBooks / Xero / CSV)

**Status:** CSV journal built 27 September 2026 (Insights → Reports → Accounting export). OAuth posting not built.  
**Date:** 19 September 2026; updated 27 September 2026  
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

## Built 27 September 2026

- `GET reports/v1/accounting-journal?from&to` (permission `partner.statement.read`), cash basis, reporting currency only (other-currency facts counted and excluded).
- Journals: guest payment Dr receipts (cash → Cash account, otherwise Guest receipts) / Cr Tour income; payment void/reversal posts the reverse on its own date; expense bill Dr category code (or name, or default) / Cr AP; expense payment Dr AP / Cr Cash or Bank; paid partner settlement — partner collected: Dr Bank net + Dr Commission / Cr Income gross; we collected: Dr Commission / Cr Bank.
- Mapping lives in `config.accounting` (seven account names with defaults), edited on the report page by `config.write`.
- CSV columns: `JournalNo,JournalDate,AccountName,Debits,Credits,Description,Name,Currency,Memo` (QBO Import Data → Journal Entries).
- Voids are append-only corrections: a voided expense bill, expense payment, guest payment, or paid partner settlement keeps its original journal and gets a reversing journal on the void date. A bill voided on or before its own date is omitted.
