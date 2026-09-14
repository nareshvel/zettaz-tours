# Administration, navigation, and dashboards

**Date:** 9 September 2026 · **Status:** Information architecture accepted as the development direction; frontend implementation follows the backend slice.

Use with [RBAC](rbac-and-access.md), [module map](module-feature-map.md), and [UX principles](ux-security-reporting.md). These are product labels, not API routes or required folder names.

## Tenant setup journey

1. Platform provisions the tenant and invites its initial owner. Verify invitation, identity, timezone, and legal/display name. No tenant-specific catalog defaults.
2. Owner configures branding/contact details, booking/collection/reporting currencies and approved policies. Missing financial policy is visible as a setup requirement, not guessed.
3. Owner invites staff with scoped roles and MFA requirements. Confirm at least one active owner remains.
4. Configure passenger categories, shared-tour options, rates, schedules, capacity, pickup locations and initial staff/resources. Validate recurring times in tenant timezone and identify blackout/rate gaps.
5. Configure partner organizations, external agents, source attribution, contract rates and collection responsibility. No external-partner login in Track A.
6. Configure allowed payment methods; optionally start Connect or regional-provider onboarding. Incomplete provider setup disables that provider only; manual methods require their own approved policy.
7. Validate a representative booking, confirm it, print a manifest, and reconcile its payment. Import future bookings through staging and review exceptions before activating operations.

Proposed tenant lifecycle: setup → active → restricted → archived, with reasoned reinstatement where permitted. This is separate from subscription status and requires detailed E01 approval. Restriction must specify affected actions and treatment of existing trips; no unspecified global kill switch. Archiving retains required financial/audit evidence and is not deletion.

## Tenant navigation and screen inventory

Visible groups are derived from permissions, release availability and tenant features. Denied screens are not discoverable through search, badges or counts. A configured but temporarily unavailable gateway shows actionable status to authorized administrators. Track B products are omitted until enabled; no empty placeholder menus.

The tenant web aside uses four task-oriented groups: **Workspace** for the overview, **Operations** for day board / departures / reservations / catalog, **Insights** for reports and customers (read-oriented), and **Administration** for finance / **Fleet** / **Staff** / settings / **Document library** / audit. A group is omitted when none of its destinations are permitted. Finance accepts its scoped finance permission families, Fleet accepts `resources.write`, Document library accepts `documents.expiry.manage`, Staff accepts `members.write`, and every authenticated staff user can reach their own profile.

| Group / screens | Primary users | Main work and required states | Release |
| --- | --- | --- | --- |
| Home | Owner/admin; role-specific defaults | Setup checklist or today's exceptions; tenant/timezone context | Track A, after first slice |
| Day Board (menu label; route `/operations`) | Dispatcher | One-day pickup readiness, weather/closure, path to board guests (manifest) | Track A |
| Departures / calendar, detail | Reservations, dispatcher | Capacity vs sellable instances across dates; Book; open manifest | Track A |
| Reservations / list, new, detail, change review | Reservations; authorized read roles | Search by reference/name/date/source; draft/hold/confirm; party, pickup, money, timeline; expiry/conflict recovery | Track A |
| Catalog / products, rates, schedules, assignments | Owner/admin; dispatcher | Products and schedules; date-scoped departure crew/asset assignments | Track A |
| Customers / search, detail | Reservations; scoped roles | Contact and history (Insights); protected sensitive data. Create/edit remains later. | Track A |
| Operations pickup/plan/list/rebook (under Day Board) | Dispatcher | Plan pickups (sequence only), Print pickup list, recovery after closure; weather hold/close/reopen via in-app reason dialog. Location library: **Tenant settings → Pickup locations** (Esri map preview, address defaults from tenant city/country) | Track A |
| Partners / organizations, contacts, contracts, booking history | Owner/admin; scoped reservations/finance | External hotels/resellers, attribution, collector terms; finance-only money views | Track A staff-managed |
| Finance / overview, booking payments, refunds, partner statements, remittances | Finance/owner | Guest dues, partner dues, evidence review, receipt matching, unallocated amounts, corrections | Track A slim |
| Fleet / assets | Admin, dispatcher, resource manager | Asset readiness and compliance docs; people under Staff; assignments live under Catalog | Track A minimum |
| Staff / people, roles, personal docs | Owner/admin | Add staff, grant access, roles; crew profile auto-created | Track A |
| Document library / compliance files & storage | Owner/admin; `documents.expiry.manage` | Tenant-scoped file library, usage meter, hard quota; staff and fleet evidence uploads | Track A |
| Documents / waiver versions and evidence | Authorized owner/staff | Publish approved version, scoped signature review, guardian context; immutable signed version (separate from Document library) | Track A |
| Integrations / connections, mappings, inbox, reconciliation | Authorized admin/staff | WP, imports, retries/quarantine and mapping fixes; payment secrets restricted | Track A |
| Reports / operations, collections, partner dues | Scoped owner/finance/auditor | Explicit date basis, population, currency and permitted export | Track A basic |
| Settings / business, currencies/policies, members/roles, notifications, payment providers, audit | Owner/admin by permission | Setup and change audit; finance/provider actions not implied by general settings access | Track A |
| Settings / Zettaz subscription | Tenant owner only (under My profile) | Software plan, invoices, renewal, payment method, cancellation policy | Track A read + Stripe portal when ready |

Manifest detail is one consistent boarding view (arrive → pay if needed → waiver → board), reachable from Day Board (Board guests) and Departures. Partner statements are linked from a partner record but remain finance-owned. Provider configuration is a Settings permission; daily receipt reconciliation is a Finance permission.

Crew mobile uses **Today → Assigned trip → Guests/check-in → Trip events**, plus Sync status and Profile. It does not inherit the whole admin menu. Guest waiver/payment links open one bounded task with expiry and recovery messaging, not tenant navigation. The reseller portal has its own future navigation and identity partition.

## Screen behavior contract

Every list defines search, filters, sort, pagination, tenant timezone and allowed actions. Every detail shows record state, version/conflict handling and readable history. Forms specify required fields, recoverable validation, unsaved changes, loading and retry behavior. Empty setup explains the next permitted step. Permission failures reveal no protected record data. Financial failures show pending/failed status; a browser return alone cannot display payment success.

Bulk actions preview affected records, exclusions, totals by currency and outbound messages. Result pages show per-record success/failure and safe retry. No silent partial rebooking or bulk refund. Destructive or financial policy exceptions require a reason.

## Role-based dashboards

**Owner:** today's departures/guests, unresolved operational exceptions, guest dues by currency, partner dues by currency, recent collection totals, setup/provider issues. Links lead to filtered source lists. Zettaz subscription health is separate from operator financial results and arrives with E16.

**Reservations:** upcoming bookings missing required details, expiring holds, outstanding collection tasks, cancellation/change requests, import exceptions. A hold countdown is informational; server expiry is authoritative.

**Dispatcher:** departures without assignments, expired documents, missing pickup dispositions, cruise return warnings, weather-held trips, passengers awaiting clearance. Show sellable capacity and readiness independently.

**Finance:** successful tenant receipts and refunds by currency, guest balances, partner receivables, unverified collection claims, unapplied remittances, provider reconciliation exceptions. A partner collection claim is not cash in the tenant's bank.

**Crew:** assigned trips, pickup sequence, guest count, permitted balance/waiver flags and sync state; no revenue or partner-margin dashboard.

**Resource manager:** expiring required documents and affected assignments; full maintenance dashboard deferred. **Auditor:** scoped reports/history with no action shortcuts.

Metric contract: each widget states date basis (booking/travel/payment/receipt), timezone, currency, population, refresh time and source. Never sum currencies without an approved recorded conversion. Guest balances come from accepted commercial/payment facts; partner dues come from obligations and accepted remittance allocations. Provisional/unverified amounts are displayed separately. See [reporting definitions](ux-security-reporting.md).

## Platform console boundary

Track A minimum: **Tenants** (provisioning/setup status), **Support access** (request/use/revoke), **Integration health** (redacted operational failures), **Platform audit**. Platform dashboard shows tenant setup and service/reconciliation issues without guest names, waiver evidence or booking-level financial drill-down absent a grant.

Track B: **Plans & subscriptions**, billing failures and entitlement administration, self-service onboarding controls and SaaS reports. Platform subscription revenue never mixes with gross tenant booking value.

Design tenant settings and platform metadata together to avoid conflicting lifecycle controls, while keeping current specification effort centered on tenant workflows. Operator access during billing delinquency, suspension, and offboarding needs explicit business policy before E16 automation.
