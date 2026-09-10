# Rock Adventures demo data

The repeatable local seed maintains `sample-river-excursions` as the **Rock Adventures Demo** tenant. The stable slug and tenant ID are retained so existing memberships, login identities, audit history, and URLs continue to work.

## Seeded catalog

- Clear Boat & Offshore Islands Experience — 3 hours — USD 89
- Kayak & Snorkel Eco Adventures — 3 hours — USD 99
- Tuk-Tuk Rainforest & Beach Hopping — 4 hours — USD 109
- Boat Cruise to Pig's Paradise — 3 hours — USD 130
- Tuk-Tuk Historical Harbour, Beach & Beers — 5 hours — USD 139

These names, durations, and provisional adult prices come from the client findings and August 2026 workbook discovery. They are demo configuration, not approved production inventory or tariffs. The workbook does not establish an approved child tariff, so the demo temporarily uses the adult amount for capacity-counting children and zero for infants. Rock must approve category rules, prices, taxes, capacities, departure times, and availability before production.

## Operational reference data

The tenant includes Antigua pickup locations, the accommodation names repeatedly observed in the workbook, one synthetic cruise call using a vessel name observed in the workbook, and Viator, GetYourGuide, and Island Routes demo partner records. Partner names include `(Demo)` and do not represent active integrations or commercial agreements.

Reservations, payments, room and cabin numbers, partner references, and contact details remain synthetic. No guest identity from the workbook is copied into the application. The waiver follows the supplied Rock sample's intent, remains tenant-editable, and explicitly requires legal review before production.

## Refresh and production boundary

Run `npm run db:seed` only in a non-production environment. The command updates the two known local demo tenants and reports product, future-departure, booking, and partner counts. It refuses to run when `NODE_ENV=production`.

Before production deployment, provision a clean non-mock tenant and import only approved source data through the controlled import process. Do not promote the demo tenant or its synthetic financial records into production.
