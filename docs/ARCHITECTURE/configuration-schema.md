# Configuration schema

**Version 2.0 · 5 September 2026**

Index: [README.md](../README.md) · Migration: [workflows.md](workflows.md)

This is the seed / workbook contract for a tenant. Fill it with operator data; do not put Rock Adventures names, prices, or partner deals in application defaults or fixtures that ship as “the” catalog.

Use UUIDs in the running system. Workbook rows may use stable slugs for human mapping.

## Tenant

| Field | Type | Notes |
| --- | --- | --- |
| slug | string | Unique, URL-safe |
| legal_name | string | |
| display_name | string | Customer-facing |
| timezone | IANA | e.g. America/Antigua |
| default_booking_currency | ISO 4217 | Open decision: USD vs XCD |
| default_collection_currency | ISO 4217 | |
| default_reporting_currency | ISO 4217 | |
| locales | string[] | |
| branding.logo_ref | string | Object key or URL |
| branding.primary_color | string | Tenant config, not code |
| support_email | string | |

## Passenger categories

| Field | Type | Notes |
| --- | --- | --- |
| slug | string | adult, child, infant — examples, not required names |
| label | string | |
| min_age | int? | |
| max_age | int? | |
| counts_toward_capacity | bool | Infants may not |
| requires_guardian_waiver | bool | |

## Products and options

| Field | Type | Notes |
| --- | --- | --- |
| product.slug | string | |
| product.kind | enum | `shared_tour` required for Track A. `private_charter`, `transfer`, `rental_addon` may be listed but are not implemented engines |
| product.name | string | |
| product.active | bool | |
| option.slug | string | |
| option.duration_minutes | int | |
| option.language | string? | |
| option.pickup_policy | enum | none, optional, required |
| option.default_capacity | int | Seat pool for shared tours |

Do not seed live retail amounts as global defaults. Amounts belong on seasonal rates.

## Seasonal rates (Track A pricing)

| Field | Type | Notes |
| --- | --- | --- |
| option_slug | string | |
| category_slug | string | |
| start_date | date | Inclusive, tenant timezone |
| end_date | date | Inclusive |
| amount_minor | int | Integer minor units |
| currency | ISO 4217 | |

## Add-ons (one kind in Track A)

| Field | Type | Notes |
| --- | --- | --- |
| slug | string | |
| name | string | |
| amount_minor | int | |
| currency | ISO 4217 | |
| applies_to_product_slugs | string[] | |

## Schedules, blackouts, weather

| Field | Type | Notes |
| --- | --- | --- |
| option_slug | string | |
| days_of_week | int[] | 0–6 or ISO; document the convention in the workbook |
| start_time | local time | |
| blackout_dates | date[] | |
| weather_hold_allowed | bool | |

## Pickup locations

| Field | Type | Notes |
| --- | --- | --- |
| slug | string | |
| name | string | |
| kind | enum | hotel, port, meeting_point, other |
| geo | lat/lng? | Optional in Track A |
| notes | string? | Operational, not pricing |

## Cruise fields

| Field | Type | Notes |
| --- | --- | --- |
| ship_name | string | Dictionary; calls are dated instances |
| call_date | date | |
| port_pickup_slug | string | |
| arrival_time | local time? | |
| departure_time | local time? | |
| tender | bool | |
| all_aboard_time | local time? | |

## Partners

| Field | Type | Notes |
| --- | --- | --- |
| slug | string | |
| name | string | |
| kind | enum | hotel, cruise_dmc, travel_agency, concierge, affiliate, other |
| default_collection | enum | guest, partner_invoice, prepaid, complimentary |
| contract_rate_mode | enum | retail, net, none |
| notes | string? | Not a commission engine |

Channel/contract override amounts, when known:

| Field | Type | Notes |
| --- | --- | --- |
| partner_slug | string | or channel slug (direct, viator, …) |
| option_slug | string | |
| category_slug | string | |
| amount_minor | int | |
| currency | ISO 4217 | |
| effective_from | date | |
| effective_to | date? | |

## Payment methods

| Field | Type | Notes |
| --- | --- | --- |
| slug | string | cash, payment_link, card_terminal, bank_transfer, voucher, invoice, complimentary |
| enabled | bool | |
| allowed_at_checkin | bool | |

Do not enable a card terminal until the gateway decision is recorded.

## Waiver templates

| Field | Type | Notes |
| --- | --- | --- |
| slug | string | |
| product_slugs | string[] | |
| category_slugs | string[] | |
| version | string | Immutable once signed against |
| body_ref | string | File or CMS key — not hard-coded copy |
| requires_guardian_for_minors | bool | |

Sample body for tenant-one discussion only: [waiver-content.md](../CLIENTS/rock-adventures/waiver-content.md). Legal and insurer must approve before production.

## Staff and resources (minimum for assignment)

| Field | Type | Notes |
| --- | --- | --- |
| staff.slug | string | |
| staff.role | string | driver, captain, guide, … |
| staff.document_type | string | license, permit, … |
| staff.document_expires_on | date | Blocks assignment when past |
| resource.slug | string | |
| resource.type | string | vehicle, vessel, … |
| resource.capacity | int? | |
| resource.document_type | string | insurance, registration, … |
| resource.document_expires_on | date | Blocks assignment when past |

Full maintenance, fuel, and inspection templates are Track B.

## Booking sources

Controlled dictionary for attribution: `direct_web`, `phone`, `whatsapp`, `walk_in`, `wp_travel_engine`, `viator`, `getyourguide`, `island_routes`, `hotel`, `other`. Display labels are tenant-configurable. Slugs in code stay generic.

## What this file is not

- Not a dump of live Rock Adventures rates or contracts.
- Not an accounting chart of accounts.
- Not permission to implement charter or transfer engines because those kinds appear in an enum.
