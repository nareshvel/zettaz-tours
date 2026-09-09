# Requirements review and acceptance evidence

**Date:** 9 September 2026 · **Status:** Checklist and scenarios, not completed test results.

Start with [requirements plan](../STRATEGY/requirements-plan.md). Record reviewer, date, evidence and disposition for each requirement; all business review items below are currently pending.

## Before scaffolding

- Founder accepts release boundaries and acknowledges launch-contract blockers, with unresolved decisions explicitly bounded.
- Tenant owner reviews [role presets](../ARCHITECTURE/rbac-and-access.md), member delegation and support policy. Finance supplies override/approval limits; absence of limits never means unlimited access.
- Reservations walks through a phone booking, expiry, duplicate confirm, missing pickup and price change using real anonymized examples.
- Operations validates sale availability vs readiness, printed manifest content, weather actions, cruise timing and clearance gates.
- Finance distinguishes guest dues, partner contractual dues, provider settlement and Zettaz subscription invoices; agrees trusted evidence, partial remittance, refunds and FX treatment.
- Minimum tenant data is supplied via configuration schema. Blank business decisions remain visible; fixtures cannot masquerade as approved live configuration.
- Engineering resolves first-slice transition ambiguities, toolchain/session strategy and transaction boundaries, with proposed ADRs as needed. Do not reopen accepted ADRs without evidence.

## Scenario catalogue for later epic acceptance

| ID | Scenario | Expected evidence | Delivery |
| --- | --- | --- | --- |
| R01 | Tenant isolation, expiry, concurrency, retries | A01–A09 in first-slice spec | First slice |
| R02 | External hotel submits booking to staff | Attribution preserved; no partner staff login created | Track A |
| R03 | Hotel claims full guest collection | Unverified evidence remains visible; accepted claim clears only under configured policy; partner due remains | Track A finance |
| R04 | Partner deposit plus tenant balance | Guest responsibility and partner responsibility do not overlap | Track A finance |
| R05 | One remittance covers several bookings partially | Allocation totals cannot exceed receipt; remainder visible; currency guards hold | Track A finance |
| R06 | Duplicate receipt, excess receipt, reversal | No duplicate credit; unapplied excess retained; linked reversal with audit | Track A finance |
| R07 | Contract/net partner booking | Tenant snapshot uses agreed amount; retail markup not inferred as commission | Track A |
| R08 | Partner-collected cancellation/refund | Correct debtor/refund owner, retained evidence, no unrelated gateway debit | Track A finance |
| R09 | Provider timeout or success after hold expires | No automatic second-provider charge; money recorded once; capacity revalidation/reconciliation | Gateway epic |
| R10 | Wrong account/currency, duplicate/reordered webhook | Scoped validation, quarantine/reconcile, no duplicate payment or status regression | Gateway/WP epics |
| R11 | Payment and waiver both pending | UI shows both blockers; clearing one cannot allow boarding | Check-in epic |
| R12 | Document expired, weather closure, cruise conflict | Distinct readiness/closure effects, authorized override audit, paper fallback | Operations |
| R13 | Revoked staff/support access and guessed download ID | Denied access and bounded offline cache exposure | E01/mobile |
| R14 | Subscription failure while guests have trips | Approved software-access policy; no mutation of guest payment/booking facts | E16 |
| R15 | Partner portal attempts another organization's data | Denied by partner identity and record scope, including counts/exports | Track B |

## Before cutover

Use the launch contract's go/no-go list: reconciled future bookings and exceptions, preserved channel references, reviewed paid/balance/invoice ownership, conflict-free assignments or authorized overrides, suppressed dry-run communications, print/PDF trial, weather drill, named decision owner and rollback. Parallel-run 7–14 operating days; freeze spreadsheet writes only after acceptance.

## Documentation verification performed

The requirements package is documentation only. Link integrity and consistency checks can establish navigation and explicit scope labels; they cannot establish operational acceptance, provider eligibility, legal approval, or working software. The owner subsequently authorized mock-data development. Actual application test results are recorded separately in [first-slice-evidence.md](first-slice-evidence.md).
