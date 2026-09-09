# Requirements baseline and implementation gate

**Date:** 9 September 2026 · **Status:** Recommendations accepted for implementation with mock data by the owner on 9 September 2026.

## Purpose and authority

Complete the product concepts, functionality, access model, and delivery plan before creating application folders or writing code. This package elaborates the v2.0 documents; it does not override the [launch contract](launch-contract.md), [domain states](../ARCHITECTURE/domain-and-states.md), or accepted ADRs 001–008.

Confirmed in the owner discussion:

- Tenant/operator workflows are the current design focus.
- Partners/Resellers means external hotel and reseller partners of a tenant, not tenant employees.
- Zettaz SaaS subscription payments use a separate Stripe setup, reported by the owner; account configuration has not been inspected.
- Offer optional Stripe Connect for eligible tenants needing booking collections, and investigate regional gateways.
- Complete requirements before scaffolding. The owner subsequently approved coding with mock data on 9 September 2026.

The owner accepted the recommended design and authorized configurable mock policies for development. No live rates, tax policy, gateway eligibility, credit terms, or release-scope change is implied.

## Read and review in this order

1. [Module and feature map](../ARCHITECTURE/module-feature-map.md): ownership, dependencies, release boundaries, and acceptance outcomes.
2. [RBAC and access rules](../ARCHITECTURE/rbac-and-access.md): principal boundaries, proposed role grants, sensitive actions, and negative tests.
3. [Administration, navigation, and dashboards](../ARCHITECTURE/admin-navigation.md): tenant journey, platform boundary, screen inventory, and actionable metrics.
4. [Tenant payments and partner collections](../ARCHITECTURE/tenant-payments.md): Connect, regional gateways, external partners, remittances, and SaaS billing separation.
5. [First-slice specification](../FEATURES/first-slice/requirements.md): fields, service boundaries, schema constraints, transaction flow, and acceptance tests.
6. [Requirements acceptance checklist](../TESTING/requirements-acceptance.md): evidence required before implementation and before cutover.

## Decisions and evidence register

An open row must have a named person and recorded outcome or explicit deferral with a bounded impact before dependent implementation. Owner labels below are responsibilities, not evidence of sign-off.

| ID | Decision / missing evidence | Current recommendation or state | Responsible party | Needed before |
| --- | --- | --- | --- | --- |
| D01 | Track A/B, three FSMs, bounded pricing, shared tours, offline money rules acknowledged | Accepted by owner on 9 September 2026 | Founder + product | E01, per launch contract |
| D02 | Initial merchant gateway and terminal path | Optional Connect plus regional adapters is direction; tenant-one provider unknown | Tenant owner + bank/provider | Record status before E01; validate before live collections |
| D03 | Booking, collection, reporting currencies and FX policy | Explicit same-currency USD/XCD mock tenants authorized; live FX policy deferred | Tenant finance | Money implementation |
| D04 | Minimum tenant configuration and representative booking samples | Mock fixtures authorized for development; real values and reconciliation evidence still needed for launch | Tenant operations | E01 seed readiness and migration design |
| D05 | Role grants and sensitive-action approval limits | Recommended presets accepted; only implemented actions enabled; overrides remain denied | Tenant owner + finance | E01 authorization implementation |
| D06 | Partner collection arrangements | Referral, collect-on-behalf, and contract-invoice cases specified; actual agreements/evidence thresholds open | Tenant finance + partner relationship owner | Partner finance implementation |
| D07 | Connect funds flow and responsibility | Propose direct charges for independent tenant merchants; fees, losses, disputes, onboarding, eligibility to validate | Zettaz owner + provider | Connect implementation |
| D08 | SaaS commercial policy | Separate Stripe billing confirmed; plans, prices, trial, grace, cancellation and transaction fees undecided | Zettaz owner | E16; no automatic access suspension in Track A |
| D09 | Detailed state transitions | ADR 009 resolves first-slice hold/quote behavior; check-in/trip/rebook details await their epics | Product + engineering | Dependent first-slice / operations features |
| D10 | Technical implementation choices | ADR 009 selects npm, SQL migrations/pg, demo sessions and PostgreSQL outbox; production identity/deployment deferred | Engineering | Scaffolding; record material choices in proposed ADR 009 onward |
| D11 | Operational proof | Baseline re-entry count, workflow interviews, future-booking sample, print trial, named cutover owner | Tenant operations | Scheduling estimate and cutover |
| D12 | Legal/financial production content | Approved waiver, retention, tax/fee treatment, refund policy | Tenant owner + appropriate advisers | Relevant production feature; not all block E01 |

The existing launch contract requires open blockers to be acknowledged before code; this register does not waive that gate. Gateway research and detailed policy work can continue while documenting other requirements.

## Delivery sequence

**Requirements phase (reviewed; mock-data implementation authorized):** review this package against actual reservations, dispatch, finance, and partner examples. Resolve D01–D06 and relevant D09 issues; record scope decisions in the authoritative docs. Complete E01 stories and acceptance criteria, then choose implementation tooling through D10. No additional broad product blueprint is needed.

**First slice:** implement bounded increments in E01 → E02 → E03 → E04 order, with the minimum manual finance record and manifest query required to prove the whole flow. These are thin E10/E06 dependencies, not their full workspaces. Include migrations, audit, outbox, API validation, permissions, and tests from the start.

**Remaining Track A:** reservation changes/cancellation → operations, pickups, weather, print → waivers and connected crew → slim finance and partner reconciliation → WP bridge and assisted imports. Add offline support according to the launch contract. Author each epic's detailed requirements before coding it.

**Cutover:** reconciled future bookings, role training, 7–14 operating days in parallel, weather drill, paper backup, rollback plan, then freeze spreadsheet entry. Suggested durations in the older delivery document are planning assumptions, not a staffing-validated commitment.

**Track B:** reseller portal, richer settlements/commission, public checkout, certified OTAs, expanded fleet, and self-service SaaS billing. Specifying their boundaries now does not authorize building them now.

## Definition of ready for application work

- Decision register has owners and outcomes/explicit deferrals consistent with the launch contract.
- Tenant owner, reservations, operations, and finance have walked through representative scenarios; record actual reviewers and dates rather than marking this complete preemptively.
- Every first-slice operation has fields, validation, permission, state guard, side effects, error behavior, and an acceptance test.
- Tenant isolation, payment ownership, hold expiry, last-seat concurrency, and retry semantics have unambiguous expected outcomes.
- First-slice backlog and technical ADRs are reviewable. Future features remain classified, not silently included.

**Current readiness:** owner authorizes first-slice implementation using explicit mock tenant configuration. Real merchant, finance, legal and operating evidence remains a production-readiness requirement, not a blocker to mock-data development. See ADR 009 for bounded implementation choices.
