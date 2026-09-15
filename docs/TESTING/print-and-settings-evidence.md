# Print system and tenant-settings pass — evidence

**Date:** 15 September 2026 · **Scope:** print delivery, Printers & documents, waiver templates, booking integrations, localization, settings sidebar.

## Verified

### PDF geometry and wrapping
- Page boxes measured from rendered output: A4 210.0 × 297.0 mm, Letter 215.9 × 279.4 mm, rolls exactly 58.0 / 80.0 mm wide with content-measured height.
- All four profiles wrap to 98–100% of content width with **zero overflow**, including a pathological all-`M` line and a 70-character unbroken token.
- Eight sample PDFs rendered and inspected: the 80 mm receipt is single-column with money flush right, rules, a bold total and a clean footer wrap; the Letter manifest paginates at 41 rows with correct margins.
- Regression found and fixed en route: character-count wrapping overflowed 58 mm by 27% and 80 mm by 40%. A4's ~35% slack had hidden it.

### Printer naming and kind guess
`guessPrinterKind` / `printerLabel` exercised against representative queue names:

| Queue | Shown as | Guess |
| --- | --- | --- |
| `_192_168_1_100` | Network printer 192.168.1.100 | sheet |
| `EPSON TM-T88VI Receipt` | EPSON TM-T88VI Receipt | roll |
| `Star TSP100 Cutter` | Star TSP100 Cutter | roll |
| `HP LaserJet M404` | HP LaserJet M404 | sheet |
| `POS-80 Printer` | POS-80 Printer | roll |

A network printer named after its IP carries no model name, so it guesses *sheet* — which is why the guess is labelled and overridable, and why the agent's test strip is offered.

### Number formatting
`comma_decimal → $1,234.56` / `EC$1,234.56`; `decimal_comma → 1.234,56 $` / `1.234,56 EC$`. Symbol placement follows the convention, as expected for `de-DE`.

### Build / typecheck / format
`npm run typecheck`, `npm run web:typecheck`, `npm run web:build` and `npm run format:check` all clean after each change.

## Not verified

- **Live agent pairing and a physical print.** No agent or printer was reachable from this environment. Pairing UI, printer listing, test strip and job submission are code-complete and typed against Cloud's contract, but need a real agent on a real desk.
- **Owner visual pass** on the rebuilt Printers & documents, Waiver templates, Booking integrations and Localization tabs.
- **API test suite** could not run here — `initdb` is absent, so every test fails at fixture setup. Unrelated to these changes; must be run where PostgreSQL exists.
- Migrations 078–080 applied by the owner; 080's permission grant needs a fresh session before reservations/finance staff see print buttons.
