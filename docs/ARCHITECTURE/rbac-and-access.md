# RBAC and record access

**Date:** 9 September 2026 · **Status:** Recommended role presets accepted for development on 9 September 2026; live financial limits remain configurable and unapproved.

Sources: [identity ADR](../DECISIONS/005-identity-partitions.md), [tenancy ADR](../DECISIONS/003-tenancy.md), [domain](domain-and-states.md).

## Authorization model

Access requires an authenticated principal, active membership or scoped grant, permission for the action, correct tenant/record scope, applicable entitlement/connector readiness, and valid business-state conditions. Deny by default. Menu visibility is not authorization; enforce every rule on the server including exports, search, counts, bulk operations, and signed downloads.

- Tenant staff have tenant memberships and role presets. A person working for two tenants must explicitly switch context; caches and pending forms must reset to that context.
- External hotels/resellers are `PartnerOrganization` and `PartnerAgent` records in Track A. They have no tenant-staff login. Track B partner principals can see only their organization and approved contract scope.
- Customers use narrowly scoped signed links for their own booking/payment/waiver purpose. A waiver link is not permission to list bookings or view financial reports.
- Platform principals have a separate console. Cross-tenant business records require a time-limited, purpose-scoped `SupportAccessGrant`; platform admin status alone is insufficient.

## Proposed tenant permission matrix

Legend: **Y** = proposed preset grant within tenant scope; **L** = constrained as described below; **R** = request action, not approve/execute; **—** = deny. Unlisted actions remain denied. Owner accepted these presets for development; production financial limits and elevated-action policy still require tenant evidence.

| Permission / resource action | Owner | Admin | Reservations | Dispatcher | Finance | Crew | Resource manager | Auditor |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tenant.settings.manage | Y | Y | — | — | — | — | — | — |
| identity.members.manage | Y | L | — | — | — | — | — | — |
| catalog.read | Y | Y | Y | Y | Y | L | Y | Y |
| catalog.write / rates.write | Y | Y | — | — | — | — | — | — |
| bookings.read | Y | Y | Y | Y | L | L | — | L |
| bookings.create / hold / confirm | Y | Y | Y | — | — | — | — | — |
| bookings.amend / cancel | Y | Y | L | R | — | — | — | — |
| bookings.discount.override | L | — | R | — | — | — | — | — |
| inventory.overbook | L | — | R | R | — | — | — | — |
| operations.board / manifest.read | Y | Y | Y | Y | L | L | L | L |
| operations.assign / pickup.manage | Y | Y | — | Y | — | — | — | — |
| operations.weather.review | Y | Y | R | Y | — | — | — | — |
| operations.weather.apply | L | L | — | L | — | — | — | — |
| documents.expiry.manage | Y | Y | — | — | — | — | Y | — |
| safety.assignment.override | L | — | — | R | — | — | R | — |
| checkin.record / trip.event | Y | Y | — | L | — | L | — | — |
| boarding.exception.approve | L | — | — | R | R | R | — | — |
| waiver.template.publish | L | — | — | — | — | — | — | — |
| payment.record / link.create | Y | L | L | — | Y | L | — | — |
| payment.refund.request | Y | Y | Y | — | Y | — | — | — |
| payment.refund.approve / execute | L | — | — | — | L | — | — | — |
| finance.adjustment.post | L | — | — | — | L | — | — | — |
| partner.records / contracts.manage | Y | Y | — | — | L | — | — | — |
| partner.collection.record | Y | — | L | — | Y | — | — | — |
| partner.remittance.record / allocate | Y | — | — | — | Y | — | — | — |
| partner.evidence.verify / adjustment.approve | L | — | — | — | L | — | — | — |
| finance.report.read | Y | — | — | — | Y | — | — | L |
| integrations.configure | Y | L | — | — | — | — | — | — |
| integrations.reconcile | Y | L | L | — | L | — | — | L |
| payment.provider.manage | L | — | — | — | — | — | — | — |
| subscription.manage (Track B) | Y | — | — | — | — | — | — | — |
| audit.read | Y | L | — | — | L | — | — | L |
| data.export | L | — | — | — | L | — | — | L |

## Limits and approval rules

- Admin can invite staff only into roles within an explicit delegation ceiling. Cannot grant owner status, financial overrides, support privileges, or permissions it lacks. Ownership transfer requires a separate verified workflow; the last active owner cannot be removed.
- Crew sees only assigned trips within the approved time window, necessary passenger/contact details, and collection/waiver flags. No partner contract margins, subscription invoices, bank configuration, or bulk exports. Collection is limited to tenant-enabled methods and assigned bookings.
- Finance sees booking facts needed to reconcile money, not unrestricted medical/waiver evidence. Auditor access is read-only and narrowed by explicit data scope; exports are separate grants.
- Reservations may make ordinary amendments/cancellations within policy. Refund approval, discounts outside bounds, capacity overrides, and evidence verification require separate permissions.
- Reservations and Dispatcher presets do not receive `inventory.overbook`. They may identify or escalate a capacity exception, while Owner or the explicitly scoped Operations manager records the reasoned authorization. Tenant-created custom roles can include the permission only when an authorized role administrator deliberately selects it.
- Dispatcher weather actions may hold/close departures and apply pre-approved rebook/cancel policy. Financial exceptions route to finance/owner; bulk messaging requires a reviewed send action.
- All **L** overrides require configured limits, reason, audit and applicable state guard. Missing policy means deny, not unlimited authority. Distinguish balance exceptions, waiver exceptions, document expiry overrides, and capacity overrides; one does not imply another.
- Propose a second authorized reviewer for refunds above the agreed limit, financial adjustments, disputed partner evidence, and settlement-destination changes. Thresholds and any small-operator self-approval exception must be recorded by the owner; do not invent amounts or require impossible staffing silently.
- Provider setup requires recent authentication/MFA and a provider-hosted or approved onboarding flow. Do not display stored secrets. Record who initiated a change and its verified completion.
- Revoking membership invalidates sessions/device authorization. Cached offline data follows the existing encryption/expiry policy; remote revocation takes effect when the device reconnects, with local expiry bounding offline exposure.

## Platform permissions (separate façade)

- `platform.tenant.provision/read/status.manage`: tenant metadata and controlled lifecycle, not routine access to guest records.
- `platform.support.grant/use/revoke`: explicit target tenant, purpose, expiry, allowed actions, requester/approver and full audit. Proposed default is read-only with separately approved elevated actions.
- `platform.connector.release`: engineering rollout controls; cannot certify an unavailable provider or override merchant capability checks.
- `platform.billing.read/manage` (E16): Zettaz subscription facts; cannot refund guest bookings.
- `platform.audit.read`: platform events; sensitive tenant evidence still requires a scoped grant.

The policy for who approves support grants and emergency access is an E01 decision. Do not seed standing cross-tenant support access.

## Required negative tests

For every permission family: allowed role succeeds; role without permission fails; another tenant's object ID fails; stale membership/grant fails; direct API access fails even if a menu was hidden. Additionally test cross-tenant exports/attachments, role-escalation attempts, partner IDs supplied as tenant IDs, support expiry mid-session, cross-tenant batch payloads, and crew requests outside assignment scope. Financial state guards must still reject an authorized actor's invalid action.
