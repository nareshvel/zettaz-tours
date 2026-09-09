# Product vision

**Version 2.0 · 5 September 2026**

Index: [README.md](../README.md) · Next: [launch-contract.md](launch-contract.md)

## Purpose

Zettaz Tours & Charters is a multi-tenant booking, reseller, dispatch, fleet, and field-operations platform. Rock Adventures Antigua is tenant one: tours, tuk-tuks, kayaks, boats, transfers, and private charters.

Build one modular SaaS core with tenant-specific branding and configuration. Do not build a Rock Adventures-only database or hard-code its tour names, payment rules, pickup locations, or commission agreements.

The product sits between a booking platform and an operational command center. Established tools are strong at checkout, calendars, OTA distribution, and manifests. Island operators also need contracted-reseller invoicing, hotel and cruise pickups, mixed vehicles and vessels, offline field execution, maintenance, and incident records. That combination is what Zettaz can sell to other island tour, charter, excursion, and transport operators.

## Product thesis

- One source of truth for every booking, passenger, departure, resource, payment, and reseller obligation.
- Real-time availability derived from seats plus constrained resources: vehicle, vessel, guide, captain, driver, equipment, and pickup capacity.
- A field-first mobile workflow that remains usable with unreliable mobile data and synchronizes safely.
- A channel-neutral commercial layer: direct, OTA, hotel, cruise, DMC, travel agent, concierge, phone, WhatsApp, and walk-in.
- A configurable finance ledger for deposits, balances, refunds, commissions, invoices, and partner settlements in multiple currencies.
- Open integration architecture based on adapters and an OCTO-compatible external API.

## Competitive position

Category: operations and distribution OS for island tours, charters, and excursions — not merely an online booking widget.

- Caribbean-first: multi-currency, invoice-based resellers, manual/card/bank/cash collection, flexible gateway adapters, and unreliable-connectivity support.
- Mixed resource types in one departure: tuk-tuks, vans, boats, kayaks, equipment, drivers, captains, and guides.
- Partner-first selling: hotel, concierge, cruise, DMC, agent, and affiliate networks with contract rates, allocations, and settlement.
- Day-of-operations superiority: pickup clusters, dispatch board, readiness checks, QR/manual check-in, live status, and incident escalation.
- Commercially reusable: configuration instead of custom forks; white-label surfaces; plan-tier feature flags.

Learn from FareHarbor (booking maturity), Bókun (reseller networks), Rezdy (inventory and manifests), Peek Pro (mobile and waivers), Checkfront (check-in and invoices), Ventrata (resource allocation), and Zaui (fleet and routes). Competitor marketing is not API access. Revalidate claims during implementation.

## Success definition

| Outcome | Target after stabilization | Measurement note |
| --- | --- | --- |
| Manual re-entry | At least 80% reduction | Requires a measured baseline: count bookings retyped from email/WhatsApp/OTA/WP into the daily sheet for a typical operating week before cutover. |
| Unauthorized overbooking | Zero | Unauthorized means confirmed capacity exceeds configured capacity without an authorized, reasoned, audited override. Authorized overbooking is allowed and is not a failure. |
| Daily manifest preparation | Under 5 minutes | Includes print/PDF of the day board. |
| Passenger check-in | Under 30 seconds per booking | QR or manual find, plus balance and waiver status visible. |
| Balance visibility | Real time by booking | Track A: booking balance. Partner commission detail can be Track B. |
| Crew access | Current assignments and passenger needs available offline | After the first connected operating week if needed; see launch contract. |
| Month-end partner invoicing | Generated from completed trips | Track A: invoice flag and statement lines. Full settlement engine is Track B. |

## Evidence from the existing operation

The August 2026 workbook uses one worksheet per calendar day. Columns: Tour, Ship/Hotel, Last Name, Room Number, Pickup Info, Adults, Kids, Total, Min, Max, Start Time, Return Time, Payment Type, Booked By, Comments.

Observed patterns:

- Bookings arrive from Viator, GetYourGuide, Island Routes, direct staff, hotels, and local partners.
- Payment states (paid in full, collect balance, collect in full, invoice) are mixed with collection instructions.
- Partner settlements are implied in notes.
- Pickup instructions combine hotel, cruise ship, meeting time, transport count, and route directions.
- Exceptions (no-show, moved date, closed attraction, cancellation) live in ordinary cells.
- Adults, children, and infants are not modeled consistently.
- Dates, names, rooms, phones, and exchange-rate calculations are inconsistently typed.
- Daily sheets hide cross-day resource conflicts, customer history, revenue reporting, and audit trails.

| Spreadsheet field | Future record | Automation |
| --- | --- | --- |
| Daily worksheet | Departure calendar and manifest | Search, filters, cross-day planning |
| Tour text | Product + option + departure | Capacity and pricing rules |
| Ship/Hotel | Accommodation, cruise call, or pickup zone | Route grouping and arrival context |
| Last name / room | Customer, booking contact, accommodation stay | Reusable CRM |
| Pickup info | Pickup stop + scheduled pickup + notes | Route board and driver workflow |
| Adults/Kids/Infants | Passenger categories and individual guests | Capacity, waivers, requirements |
| Payment type/comments | Payment ledger, balance, collection task | Reminders and reconciliation |
| Booked by | Sales channel + reseller + agent | Attribution |
| Comments | Notes, tasks, exceptions, audit events | Ownership and alerts |

Migration rules: [workflows.md](../ARCHITECTURE/workflows.md). Seed format: [configuration-schema.md](../ARCHITECTURE/configuration-schema.md).

## Users, roles, and permissions

Authorization is tenant-scoped RBAC plus record-level rules. Every mutation of bookings, inventory, money, permissions, integration mappings, and safety records creates an immutable audit event.

| Role | Primary responsibilities | Sensitive permissions |
| --- | --- | --- |
| Zettaz platform admin | Tenant provisioning, subscriptions, support, plan-tier flags | Cross-tenant access only through audited support mode |
| Tenant owner/admin | Business configuration, users, products, pricing, integrations | Financial settings, exports, void/refund policies |
| Reservations agent | Create/change bookings, customer service, collect payments | Discount and override limits |
| Operations/dispatcher | Departures, assignments, pickups, readiness, live status | Operational overrides and resource substitution |
| Finance | Payments, refunds, invoices, commissions, settlements | Financial exports and adjustments |
| Fleet/maintenance manager | Assets, inspections, service schedules, fuel, incidents | Return-to-service approval |
| Driver/captain/guide | Assigned trips, manifest, navigation, check-in, trip events | Only necessary passenger/contact information |
| Reseller admin | Own contract, agents, bookings, invoices, reports | Own organization only |
| Reseller agent | Quote/book/manage permitted products | Rate and discount rules per contract |
| Customer/lead traveler | Own booking, payments, passengers, waiver, changes | Own booking only |
| Auditor/read-only | Reports, history, compliance evidence | No operational mutation |

Reseller portal roles are Track B. Track A still stores partner organization and agent attribution on bookings entered by tenant staff.

Identity partitions (tenant staff vs partner users vs customers): [overview.md](../ARCHITECTURE/overview.md) and [005-identity-partitions.md](../DECISIONS/005-identity-partitions.md).
