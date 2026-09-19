# Finance polish — implementation evidence

**Date:** 11 September 2026; follow-up 19 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Changes (11 September 2026)

- Metrics, confirm dialog for claim decisions, currency clarity, mobile statement cards.

## Follow-up 19 September 2026

- Overview period is a **button menu** (This week / This month / Last month / This year / Last year / Custom), default **This year**, using the tenant timezone.
- **Unpaid expenses** tile sits beside recorded expenses. Vendor payment is not live yet, so unpaid equals recorded non-voided expenses for the selected period. Payment recording stays a later increment.
- Heading copy is honest about Track A: no automatic FX, expense bank rates stay on the line they were entered with, aging/P&L exports stay Track B.
- Work queue and activity use shared Empty/Notice/Loading; activity dates use tenant `dateOnly`.
- Expenses: search and **Add expense** on one row; no-match empty state.
- Aging direction uses chips; empty/error use shared components. Deferred reports are labelled **Not in this launch**, not “coming soon”.
- Partners search/add from the 19 Sep partners pass is unchanged.
- No Stripe Connect toggle, XCD rate table, or placeholder settlement engine.

## Automated evidence

- `npm run typecheck --workspace=@zettaz/web` after this follow-up.

## Owner acceptance still needed

- Switch Overview periods and confirm expense totals follow tenant dates.
- Search expenses; add/void still work.
- Aging chips and partner drill-through.
- Confirm FX copy matches how expenses were entered.
