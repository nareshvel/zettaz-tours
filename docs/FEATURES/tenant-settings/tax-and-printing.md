# Tax policy and printable documents

## Current tax policy

Track A supports one tenant-level tax or fee rate, stored as basis points. The rate is applied once to the subtotal for a newly created hold as an **exclusive** add-on (`taxMinor` then `totalMinor = subtotalMinor + taxMinor`). The resulting amount is frozen in the hold quote and then in the confirmed booking price snapshot. Changing the setting never reprices an existing hold or confirmed booking.

Catalogue / seasonal rates are treated as tax-exclusive until a finance-approved tax engine exists. This is not a tax engine: it does not determine registration obligations, jurisdictions, exemptions, inclusive versus exclusive commercial packaging, tax invoices, returns, or remittance. A tenant must obtain finance and legal approval for its rate and treatment before production use.

## Printable documents

**Superseded 15 September 2026.** Printing is now a server-rendered vector PDF in four paper profiles (A4, Letter, 80 mm, 58 mm), delivered either to a paired Zettaz print agent or to the browser, with every job recorded. See [printing-and-print-agent.md](../operations/printing-and-print-agent.md) and [ADR 018](../../DECISIONS/018-print-delivery-and-agent.md).

Two statements in the earlier text no longer hold: the settings page *does* now store printer destinations and per-document paper (per device, in the browser), and the inert document-template publisher has been removed. Tenant-designed templates remain deferred — prebuilt layouts only — so template ownership/versioning, allowed guest data, retention, and whether generated PDFs become retained records are still open requirements.
