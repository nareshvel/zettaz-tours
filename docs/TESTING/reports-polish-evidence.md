# Reports polish — implementation evidence

**Date:** 11 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Changes

- Date presets: Today, Last 7 days, This month, Last month.
- Explicit departure-date basis, timezone, and reporting-currency copy.
- Exception tiles highlight when count &gt; 0.
- Metric cards label currency and clarify guest receipts vs partner obligations.
- Phone: daily activity table swaps to cards; presets/actions are touch-sized.
- Report API query unchanged (`reports/v1/overview`).

## Owner acceptance still needed

- Switch presets and custom range; confirm totals match expected seed data.
- Phone layout for exceptions and daily cards.
- Confirm FX notice remains visible when currencies would otherwise need conversion.
