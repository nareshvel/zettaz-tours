# Finance polish — implementation evidence

**Date:** 11 September 2026; follow-up 19 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Changes (11 September 2026)

- Metrics, confirm dialog for claim decisions, currency clarity, mobile statement cards.

## Follow-up 19 September 2026

- Overview period is a **button menu** (This week / This month / Last month / This year / Last year / Custom), default **This year**, using the tenant timezone.
- **Unpaid expenses** uses outstanding (recorded − vendor payments). **Paid to vendors** uses `paid_on` in the period. Migration `092_expense_payments.sql`.
- Partner aging gateway allowlists `finance-aging`. Finance role can `GET /finance/v1/partners` via `partner.statement.read`.
- Partner account: record / accept / reject collection claims. Settings → Partners holds commission terms.
- Expense category manager (config.write). Expense Summary is a live report.
- Expense rows show Paid / Partial / Unpaid. Partial shows amount still due. Click Paid/Partial to view payments and void (payment.correct).
- `paid_on` accepts a calendar day or an ISO timestamp (stored as the date). Voided payments restore outstanding.

## Follow-up 19 September 2026 (close-out)
- Heading copy is honest about Track A: no automatic FX, expense bank rates stay on the line they were entered with, aging/P&L exports stay Track B.
- Work queue and activity use shared Empty/Notice/Loading; activity dates use tenant `dateOnly`.
- Expenses: search and **Add expense** on one row; no-match empty state.
- Aging direction uses chips; empty/error use shared components. Deferred reports are labelled **Not in this launch**, not “coming soon”.
- Partners search/add from the 19 Sep partners pass is unchanged.
- No Stripe Connect toggle, XCD rate table, or placeholder settlement engine.

## Automated evidence

- `npm run typecheck --workspace=@zettaz/web` after this follow-up.
- API: `partner organizations are tenant-scoped and require partner management permission` (finance role `GET /finance/v1/partners` = 200).
- API: `expense payments are append-only and cannot exceed the bill` (overpay 409, void restores outstanding, voided bill rejects pay).

## Owner acceptance still needed

- Switch Overview periods and confirm expense totals follow tenant dates.
- Search expenses; add/void still work.
- Aging chips and partner drill-through.
- Confirm FX copy matches how expenses were entered.
