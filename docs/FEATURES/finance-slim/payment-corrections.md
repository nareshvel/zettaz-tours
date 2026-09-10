# Manual payment corrections

**Status:** Approved implementation boundary · **Date:** 10 September 2026

Manual payment facts remain immutable. An authorized finance user corrects a mistaken
entry by appending exactly one full adjustment to the original payment:

- `void` applies only to a pending payment that was entered in error.
- `reversal` applies only to a settled payment whose reversal occurred outside this
  application.

An adjustment records its own actor, time, reference, reason, audit event, and outbox
event. It never calls a gateway, issues a refund, deletes a receipt, or rewrites the
original occurrence. Partial refunds, fees, chargebacks, cross-currency corrections,
and gateway reconciliation remain separate workflows.

Only `payment.correct` may append an adjustment. The standard owner and finance roles
receive it; reservations staff retain `payment.write` without correction authority.
Tenant scope, idempotency, a booking/payment match, status-compatible adjustment kind,
and one adjustment per payment are enforced by the API and database.
