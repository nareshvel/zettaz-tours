# Tax policy and printable documents

## Current tax policy

Track A supports one tenant-level tax or fee rate, stored as basis points. The rate is applied once to the subtotal for a newly created hold as an **exclusive** add-on (`taxMinor` then `totalMinor = subtotalMinor + taxMinor`). The resulting amount is frozen in the hold quote and then in the confirmed booking price snapshot. Changing the setting never reprices an existing hold or confirmed booking.

Catalogue / seasonal rates are treated as tax-exclusive until a finance-approved tax engine exists. This is not a tax engine: it does not determine registration obligations, jurisdictions, exemptions, inclusive versus exclusive commercial packaging, tax invoices, returns, or remittance. A tenant must obtain finance and legal approval for its rate and treatment before production use.

## Printable documents

The supported day-of document flow is browser print or Save as PDF from the live operational view:

- A departure manifest shows confirmed parties for a selected departure.
- A pickup list shows the saved pickup-plan version, ordered stops, and active exceptions.

The settings page links staff to those source views. It does not store printer destinations or document-template settings because neither is currently applied by the document renderer. Future requirements must specify template ownership/versioning, allowed guest data, receipt and waiver layouts, paper size, routing, retention, and whether generated PDFs become retained records.
