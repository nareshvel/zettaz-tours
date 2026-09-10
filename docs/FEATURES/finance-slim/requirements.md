# E10 Finance (slim) — requirements

**Status:** Core API and tenant reservation/finance review UI implemented and integration-tested. Persistent sample scenarios remain.  
**Scope authority:** [launch contract](../../STRATEGY/launch-contract.md), [finance and offline](../../ARCHITECTURE/finance-and-offline.md), and [tenant payments](../../ARCHITECTURE/tenant-payments.md).

## Outcome

Tenant staff can attribute a reservation to an external hotel or reseller, record the agreed collection responsibility, and see the resulting guest and partner obligations without treating partner evidence as a second guest payment.

Implementation sequence: [claim and obligation design](implementation-design.md).

## This increment

- Tenant-scoped partner organizations with name, contact details, status, and internal notes.
- Optional partner attribution, external reference, collection mode, and invoice flag on a reservation.
- Immutable commercial snapshot at confirmation: the booking total, currency, selected partner, collection mode, and invoice responsibility.
- Append-only collection claims entered by authorized staff, initially unverified.
- Finance or owner acceptance/rejection of a claim with reason and audit evidence.
- Read-only booking finance summary: guest paid, guest balance, accepted partner credit, and partner obligation.
- Tenant-scoped partner statement lines for accepted partner obligations. Basic list/filter only.
- Persistent Sample seed data for referral, partner-collects, and partner-invoice examples.
- Append-only voids for pending manual entries and external reversals for settled manual payments, restricted to owner/finance through `payment.correct`.

The reservation form offers optional partner attribution and collection terms. Finance review exposes unverified collection claims and requires a reason to accept or reject them. Booking detail shows accepted partner credit separately from guest payments.

## Permissions

- `partner.manage`: owner and admin create or update partner organizations.
- `partner.collection.record`: owner, reservations, and finance record a claim.
- `partner.collection.verify`: owner and finance accept or reject a claim.
- `partner.statement.read`: owner, finance, and auditor read statement lines.

Existing payment permissions remain for guest-to-tenant payment facts. A partner claim cannot call the existing payment endpoint or manufacture a settled payment row.

## Collection modes

- `guest_pays_tenant`: partner is attribution only; no partner obligation.
- `partner_collects_for_tenant`: accepted claim can reduce the guest balance under the explicit claim policy and produces a partner obligation for the same amount.
- `partner_invoice`: confirmation creates a partner obligation for the commercial snapshot; guest collection is not inferred.
- `mixed`: deferred until allocation rules and finance approval are defined.

## Guards and invariants

- Every partner ID is constrained by tenant ID and rejected across tenants.
- Partner claims use integer minor units in the booking currency. FX and cross-currency allocation remain blocked.
- A claim cannot exceed the remaining guest balance or create more than one accepted credit for the same claim.
- Acceptance/rejection is append-only and requires a reason.
- A partner obligation is a separate fact from a guest payment and can never increase booking revenue.
- Cancellation preserves claims and obligations for finance review; it does not automatically reverse or refund money.
- All mutations use idempotency keys, tenant RLS, and audit/outbox records.

## Deferred

- Stripe Connect, regional gateway connection, payment links, terminals, and live payment collection.
- Partner remittance receipts, allocation, partial settlement, credit notes, aging, commission, payouts, and accounting exports.
- Partner/reseller portal accounts, contracts/rates/allotments, vouchers, and self-service statements.
- Complimentary policy, discounts, refunds, and FX.

## Acceptance evidence

1. A partner in one tenant cannot be selected, read, or claimed in another tenant.
2. A referral booking cannot create a partner obligation.
3. An unverified collection claim leaves the guest balance unchanged.
4. An accepted `partner_collects_for_tenant` claim produces exactly one partner obligation and the permitted guest credit.
5. A duplicate request returns its original result; a changed duplicate conflicts.
6. Finance can reject a claim with a reason; reservations staff cannot verify it.
7. Cancellation retains the original partner and claim evidence and flags finance review.
8. Audit and outbox rows exist for each mutation.
