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

## Automated evidence

- `npm run typecheck --workspace=@zettaz/web` after this follow-up (passed).
- Browser `/reports` without a session still lands on the public marketing home, so chip interaction was not exercised here.

## Owner acceptance still needed

- Switch presets and custom range; confirm totals match expected seed data.
- Phone layout for chips, exceptions, and daily cards.
- Confirm FX notice remains visible when currencies would otherwise need conversion.
