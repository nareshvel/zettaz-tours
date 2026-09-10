# Rock Adventures August 2026 workbook discovery

**Source reviewed:** `AUGUST 2026.xlsx` supplied 10 September 2026  
**Purpose:** discovery and provisional mapping only; the source was not imported or modified.

## Structure observed

- 32 worksheets: one `BLANK` template and 31 daily August sheets.
- Approximately 181 populated operational rows. Template rows and formula-only blank rows are excluded from that count.
- The common columns are tour, ship/hotel, guest name, room, pickup information, adults, kids, calculated total, minimum, maximum, start/return time, payment type, booked by, and comments.
- Four header layouts occur. One adds `INFANT`, two change the stay/name headings, and the added column shifts later values and formulas.
- Ten daily sheets do not contain a date value in the expected date cell; their sheet names can suggest a date but cannot silently become authoritative dates.
- Party totals are formulas in most populated rows. Formula position and expression vary between layouts.

## Controlled mappings required

| Workbook evidence | Platform destination | Treatment |
| --- | --- | --- |
| TOUR | Product and departure | Map spelling variants to a tenant product; do not create products from free text. |
| Sheet date + START TIME | Departure time | Require an explicit approved date/time mapping in `America/Antigua`; quarantine missing dates. |
| ADULTS, KIDS, INFANT | Passenger categories and party size | Preserve category counts. Recalculate the party total; compare it with the workbook formula result. |
| SHIP/HOTEL/OTHER | Cruise call, accommodation, partner, closure note, or other stay | Classify through controlled dictionaries. This column currently mixes several entity types. |
| ROOM # | Room or cabin number | Optional evidence after stay type is identified. |
| PICK UP INFO | Pickup disposition and internal instructions | Parse only approved patterns. `CANCELLED` is a booking state candidate, not a pickup location. |
| PAYMENT TYPE | Payment/collection responsibility | Map `PAID IN FULL`, `COLLECT BALANCE`, `INVOICE`, and collection/commission phrases through an approved finance dictionary. |
| BOOKED BY | Booking source, partner/reseller, or staff user | Separate channels, partner organizations, and staff identities. |
| COMMENTS | Review evidence | Never parse directly into settled payment, invoice, commission, or booking truth. |

## Material data-quality findings

- Tour names contain spacing and naming variants that may refer to the same product.
- The stay column also contains closures, partner/channel suffixes, local-group text, and hotel spelling variants.
- At least 21 populated rows contain cancellation wording, sometimes outside a dedicated status field.
- Payment and booking-source columns contain shifted time/payment values on the alternate header layout.
- Free-text comments include balances, commissions, invoice instructions, currency markers, and payment claims. These need WordPress or finance evidence before acceptance.
- The workbook has no stable required external booking reference, email, authoritative booking total, or authoritative paid amount for every row.

## Decision

Hold live import. The workbook is valuable operational evidence and supports building tenant dictionaries for products, accommodations, cruise vessels, partners, staff sources, pickup rules, and payment-state mappings. It is insufficient by itself for safe booking or financial creation.

The separate website findings document does not yet change this conclusion. It describes likely customer fields and channel behavior, but its plugin identification and synchronization claims are not accompanied by database table, plugin-version, API, or event evidence. Treat those statements as hypotheses until the hosted database schema, active WordPress plugins, and actual booking records are inspected.

Resume the import task after receiving a representative WordPress export/API payload. Reconcile WordPress booking IDs and financial facts with workbook date, party, pickup, stay, and operational notes. Any unmatched or contradictory row remains quarantined with a documented decision. Retain the original workbook unchanged as cutover evidence.
