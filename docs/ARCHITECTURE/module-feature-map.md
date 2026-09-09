# Module ownership and feature map

**Date:** 9 September 2026 · **Status:** Decomposition accepted for implementation with mock data on 9 September 2026.

Sources: [overview](overview.md), [launch contract](../STRATEGY/launch-contract.md), [delivery](../STRATEGY/delivery.md). A module owns rules and writes; a menu groups user work and need not match module boundaries. No new microservices or separate reporting store.

## Module contracts

| Module / epic | Owns and provides | First slice | Remaining Track A | Deferred |
| --- | --- | --- | --- | --- |
| Tenant + identity / E01 | Provisioning, settings, staff memberships, RBAC, sessions, support grants | Tenant creation, staff authorization, two-tenant isolation | MFA, device/session management, audited support UI | Self-service onboarding, SSO |
| Governance / E01 foundation | Immutable audit and durable outbox infrastructure | Every mutation, retryable event delivery | Permissioned exports, retention, recovery evidence | Advanced compliance tooling |
| Catalog + pricing / E02 | Product/option/category, schedule rules, rates, policies; price calculation | Shared tour, recurring departures, category/season pricing | One add-on, channel/contract override, blackouts | Promotions, dynamic/group pricing, charter quotes |
| Availability / E03 | Capacity pools, holds, commit/release operations | Expiry and concurrent hold/confirm safety | One exclusive resource type, reasoned overbooking | Allotments, waitlists, multiple resource types |
| Reservations + customers / E04 | Commercial booking, contact, allocations, pickup disposition, snapshots and change history | Draft/hold/manual record/confirm | Amend, cancel, no-show, duplicate review, accommodation/cruise linkage | New public checkout; full guest self-service |
| Partner records / E09 data dependency | External organization/agent attribution and effective contract rates | Optional source reference only | Staff-managed partners, collector/responsibility terms | Partner login, portal, commission/allotment engine |
| Finance / E10 | Guest balance, payment/refund records, partner receivables, receipts and reconciliation | Manual payment fact, currency, confirmation eligibility | Deposits/balances, approved gateway, partner statement lines and manual remittance allocation | Automated settlements, commission accrual, aging, rich accounting |
| Operations / E06 | Trip runs, manifests, assignments, pickups, cruise constraints, weather actions | Confirmed-booking manifest query | Board, routes, paper/PDF, readiness, mass rebook/cancel review | Automatic route optimization, GPS |
| Resources + staff / E11 minimum | Resource/staff availability and expiry documents | Only data needed by the selected slice | Assignment conflicts and expired-document guards | Maintenance, inspections, fuel/work orders suite |
| Documents + check-in / E08/E07 | Versioned waivers, evidence, per-passenger clearance and boarding | None | Guardian signatures, signed links/QR, balance and waiver gates | Expanded document workflows |
| Crew delivery / E07 | Assigned-trip mobile façade and command sync | None | Connected first, minimum offline window under agreed sequencing | Broader offline hardening and GPS policy |
| Notifications / Track A dependency | Templates, delivery state, consent and outbound messages | Outbox infrastructure only; no real sends | Confirmation, cancellation, payment/waiver email | Uncontracted SMS, WhatsApp bot |
| Integrations / E12/E13 | Provider adapters, verified inbox, mappings, reconciliation | Idempotency/outbox foundations only | WP bridge, assisted imports, selected payment connector | Certified OTA/OCTO production channels |
| Reporting / E15 minimum | Permission-aware SQL views over published domain facts | Manifest read model only | Booking amounts, cash received, guest balances, partner dues, operational exceptions | Rich analytics, warehouse |
| Platform billing / E16 | Zettaz subscription invoices, entitlement policy and billing lifecycle | None | Outside the cutover product; existing Stripe setup stays separate | Tenant billing self-service, plans and lifecycle automation |

Partner records are Track A dependencies despite the E09 portal being deferred. Resource safety, basic reporting, and notifications are likewise launch dependencies rather than permission to implement their entire later epics.

## Dependency rules

- Catalog supplies a price calculation; Reservations owns the accepted immutable snapshot. Finance reads that snapshot and cannot rewrite it.
- Availability is the only capacity writer. Reservations calls its hold/confirm/release services inside an explicit transaction boundary.
- Operations reads confirmed commercial commitments; boarding does not change a booking to completed.
- Finance supplies financial clearance; Documents supplies waiver clearance. Check-in evaluates both plus a scoped authorized exception.
- Partner records identify external organizations and agreements. Finance owns amounts due and settlement evidence. A partner-agent record does not grant login access.
- Integrations normalize external input and invoke domain services. Webhook handlers do not bypass permissions, inventory, or financial invariants.
- Platform billing controls software entitlements under an approved policy; it does not post booking revenue or partner remittances.
- Read models may combine facts for screens. Module write paths use published services, not direct edits to another module's tables.

## Functional acceptance outcomes

- **Reservations:** an agent can finish a phone booking without free-text financial interpretation; a failed/expired hold has a recoverable outcome.
- **Catalog:** changing a live price affects new quotes only; unsupported product engines cannot be sold accidentally.
- **Operations:** dispatcher can identify unassigned trips, missing pickups and weather exceptions, produce a paper manifest, and explain every override.
- **Finance:** staff can distinguish guest dues, partner dues, received cash, and gateway settlement; every displayed amount traces to source records.
- **Partner records:** tenant staff can enter a hotel booking with contract and collector attribution without granting the hotel tenant access.
- **Administration:** an owner can finish setup, invite appropriate staff, and delegate work without exposing subscription or bank configuration unnecessarily.
- **Integrations:** retries cannot duplicate a reservation or receipt; mapping failures appear in a review queue.

## Feature-spec completion rule

Before implementing any feature, attach: actor and need; required/optional fields; defaults and configuration source; read/write permissions; valid transitions; price/capacity effects; audit and outbound effects; validation and failure recovery; acceptance scenarios. Draft specs are not proof of business approval. The [first slice](../FEATURES/first-slice/requirements.md) applies this template now; later epics require their own elaboration before coding.
