# Partner claim and obligation implementation design

## Confirmation boundary

Partner attribution is editable only while a booking is held. Confirmation writes a separate immutable commercial snapshot containing the booking total/currency, selected partner, collection mode, external reference, and invoice responsibility. Subsequent booking amendments or cancellation must retain that snapshot and flag finance review; they must not rewrite partner evidence.

## Facts

- `booking_partner_attributions` holds the pre-confirmation selection and is tenant-scoped.
- `booking_partner_snapshots` is append-only per confirmed booking version.
- `partner_collection_claims` records staff-entered, unverified amount/currency/reference evidence. It is not a `payments` row.
- `partner_claim_decisions` records the accepting or rejecting finance/owner decision with reason; it is append-only.
- `partner_obligations` records the accepted partner-collected amount or the configured invoice obligation. It is never revenue and has no foreign key to a guest payment.

## State and money guards

Only an accepted claim for `partner_collects_for_tenant` may create a partner obligation and reduce the permitted guest balance. The decision transaction locks the booking/snapshot and rejects claims above the remaining eligible amount. A referral (`guest_pays_tenant`) creates neither a credit nor an obligation. `partner_invoice` creates an obligation at confirmation but never implies a settled guest payment.

All amounts are integer minor units in the frozen booking currency. Mixed allocation, FX, commission, remittance and payout are deferred.
