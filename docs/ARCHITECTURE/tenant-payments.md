# Tenant payments, external partners, and SaaS billing

**Date:** 9 September 2026 · **Status:** Confirmed direction plus proposed workflows; financial policies and provider selection open.

## Confirmed scope

Zettaz uses a separate Stripe setup for tenant SaaS subscription payments, as reported by the owner. Tenants may optionally use Stripe Connect for traveler collections, or a regional gateway suited to their business. Partners/Resellers are external hotel/reseller partners of the tenant. Current design focuses on the tenant managing those relationships; external portal access is Track B.

No account credentials, merchant capabilities, regional eligibility or current live setup have been inspected. This document is not a gateway selection or an approved accounting policy. [ADR 004](../DECISIONS/004-money.md) and the [launch contract](../STRATEGY/launch-contract.md) continue to apply.

## Three money relationships

1. **Tenant → Zettaz:** software subscription fees. Platform billing records and permissions.
2. **Guest → tenant or authorized external partner:** booking payment/collection. Tenant booking ledger and clearance policy.
3. **External partner → tenant:** payment of its contractual obligation or remittance of money collected for the tenant. Partner receivable and receipt allocation; not a second guest payment.

A partner is not automatically a connected account. Initial Connect onboarding targets tenant merchants. Do not create a hotel payout account merely because that hotel supplied a booking. Staff recording a claim must capture both the external collector and the internal actor entering it.

## Proposed tenant collection modes

- **Guest pays tenant:** partner is referral/source only; guest pays through the tenant's approved gateway, link, cash or other method. Partner attribution does not imply it owes money.
- **Partner collects on behalf of tenant:** retain evidence of the guest collection and a corresponding partner obligation. Accepted evidence can satisfy the guest's obligation under configured policy, while the partner still owes remittance.
- **Partner buys at a contract/net amount:** the tenant's commercial snapshot and partner obligation reflect the agreed contract price. Partner retail resale and margin are not invented as tenant booking revenue. Guest collection status can be unknown; boarding financial clearance derives from approved partner-invoice policy.
- **Mixed collection:** allocate responsibility explicitly—for example, an accepted partner-collected deposit plus a guest balance due to the tenant. Do not charge the same amount to both parties.

Complimentary status requires its own permission/policy and is not a payment method that fabricates a successful cash transaction. A voucher reference alone is not proof of settled money.

## Track A partner workflow

1. Staff selects partner organization and optional external agent, booking source/reference, effective contract and collection responsibility. The system snapshots the agreed commercial amount and responsibilities at confirmation.
2. Staff records a collection claim: booking, external collector, amount/currency, occurred time, method, reference and evidence, plus internal recording actor. The claim is initially unverified unless a documented trusted-evidence policy applies.
3. Authorized finance verifies/rejects the claim with reason. Verification creates the appropriate append-only fact and obligation once; a retry cannot create another payment. An unverified claim does not silently clear a guest balance; explicit partner-credit policy or audited exception may independently permit boarding.
4. Finance reviews partner statement lines from accepted obligations and reversals, grouped by partner/currency and stated date basis. Track A uses invoice flags and basic statements, not automated commission accrual or aging.
5. Finance records money actually received from the partner, its bank/cash reference, amount/currency and receipt date. Allocate it to one or more outstanding lines. Partial allocation remains open; excess stays unapplied until reviewed. Do not auto-spread unidentified deposits across bookings.
6. Reconcile receipt evidence and allocations. Preserve original claims, receipts and allocations; correct through linked reversals/superseding facts.

Suggested separate projections: collection claim `unverified/accepted/rejected/superseded`; partner line `open/partially_settled/settled/disputed`; receipt `unallocated/partially_allocated/allocated/reversed`. These are proposed finance projections, not replacements for the three canonical state machines. Final event and accounting definitions require finance approval.

## Worked acceptance examples

All amounts below are illustrative in one currency, with no fees/FX/commission; they are not tenant seed prices.

- Booking 100; hotel collects 100 on behalf of tenant. Before verification, show claim 100 pending review. After accepted evidence, guest due 0, partner due 100, tenant cash received 0. Hotel remits 60: partner due 40, tenant cash received 60; booking collection is not increased to 160.
- Booking 100; accepted hotel deposit 30, guest pays tenant 70. Guest due 0, partner due 30, tenant received 70. A later 30 remittance produces tenant received 100 without another guest charge.
- Contract booking 80; hotel resells at 100. Tenant snapshot/partner obligation 80, not 100. Do not infer a 20 commission payable by Zettaz or tenant. Guest clearance follows the approved contract policy.
- Partner sends 150 for two obligations of 100 each. Allocate 100 and 50; second remains due 50. Duplicate receipt import must not allocate another 150.
- Partner sends 120 against 100 due. Allocate 100 and retain 20 unapplied. Do not treat it as booking revenue or automatically issue a refund.
- A partner-collected booking is cancelled before remittance. Apply approved cancellation policy to the original snapshot and partner obligation; determine who refunds the guest. Do not initiate a refund from a gateway that never received the payment. Preserve the unresolved refund task until evidence closes it.

## Tenant gateway strategy

Use the existing neutral payment port. Each tenant has scoped provider connections with country/currency/method/capability configuration, readiness state and secure credential references. The proposed initial routing rule is explicit tenant-configured method/provider selection, not automatic optimization.

For Stripe Connect, **direct charges are the proposed starting point** because tenants operate their own businesses. Stripe documents direct charges as charges on the connected account and a fit for SaaS platforms, with full Dashboard access recommended. Provider object reads and webhooks must retain connected-account context. This is a design recommendation, not an accepted funds-flow ADR. [Stripe direct charges](https://docs.stripe.com/connect/direct-charges.md?platform=web&ui=stripe-hosted).

Before implementing Connect: validate platform and tenant countries, merchant onboarding and required capabilities, currencies/settlement bank, who pays processing fees, liability for losses/refunds/disputes, payout control, and any Zettaz transaction fee. Prefer provider-hosted/embedded onboarding and account-health remediation to collecting identity documents ourselves. Exact account configuration/API choice follows that decision and current provider docs.

Regional eligibility must be researched for the exact collection model. Cross-border payout availability is not proof a tenant can acquire traveler card payments; Stripe documents restrictions on self-service cross-border payout regions. Do not promise Antigua merchant support based on an existing Zettaz Stripe account. [Stripe cross-border payouts](https://docs.stripe.com/connect/cross-border-payouts).

Gateway research deliverable for each target jurisdiction: evidence URL/date; merchant eligibility and bank requirements; booking/collection/settlement currencies; hosted checkout/payment links; terminal options; partial refunds/disputes; signed webhooks and retry semantics; reconciliation exports; onboarding/support; contractual costs. Country/bank evidence and actual provider terms are required before ranking suitability. Regional research remains unperformed; no preferred regional provider is claimed here.

## Payment execution requirements

- Scope every provider payment/reference by tenant, connection/account, environment and purpose. Never route an event solely using untrusted tenant metadata.
- Verify webhook signatures, deduplicate, preserve redacted evidence and process asynchronously with reconciliation. Match account, booking, currency and expected amount; quarantine mismatches.
- Browser redirects, pending payment states and uploaded screenshots are not automatic proof of settled gateway payments. Delayed payment methods require definitive success before marking a balance settled.
- If payment succeeds after hold expiry, record the money once and create a reconciliation task; do not bypass capacity checks or silently confirm. A provider timeout must not trigger a second charge at another gateway; establish the original outcome first.
- Refund through the original receiving provider where possible, constrained by captured/refundable amounts and existing refunds. Manual/partner refunds require evidence and responsibility assignment. Gateway fees and bank settlement timing remain separate from guest balance.
- Store integer minor units and currency; record FX rate, source and conversion/rounding policy. Cross-currency remittance allocation is blocked until that policy is defined; never net unlike currencies silently.
- Disable new requests to an unavailable provider but continue receiving events/reconciling existing transactions. Connector release flag, merchant capability and tenant entitlement are different gates.

## Zettaz subscriptions (design now, E16 implementation)

Reuse the reported existing Stripe setup after inspection; do not create duplicate subscriptions as part of tenant Connect onboarding. A tenant can subscribe without connecting booking payments. Separate platform billing references and lifecycle processing from tenant booking records even if identity links are reusable.

Stripe Billing handles recurring invoices and subscription lifecycle events; Zettaz must define how that status affects software access. [Stripe subscription lifecycle](https://docs.stripe.com/billing/subscriptions/overview).

Define before implementation: plan/price catalogue, billing contact and currency, monthly/annual terms, tax treatment, trial, proration, renewal failure/grace, cancellation timing, retention/export and entitlement changes. Propose explicit grace/restriction policy protecting access to existing operational records; no automatic tenant suspension or booking cancellation on one failed subscription invoice. Durations and final policy remain open. Platform fees on traveler payments are a separate commercial decision; no revenue share is assumed.

## Acceptance and release boundaries

Prove platform invoices cannot change booking balances; one tenant's gateway event cannot post to another; partner evidence is not bank receipt; remittances do not double-count guest payments; permission limits apply to retries and bulk allocation; refunds and FX corrections preserve history. Full partner portal, automated payouts, commission engine and aging remain Track B. Track A needs only the staff-managed evidence/obligation/receipt workflow required to reconcile its actual partner arrangements.
