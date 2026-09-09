# ADR 006 — Idempotency and outbox

**Status:** Accepted · **Date:** 5 September 2026

## Context

Payment webhooks, channel notifications, and mobile retries deliver the same event more than once. Side effects (email, OTA sync, PDF) must not run inside the request that holds the inventory lock without a recovery path.

## Decision

- `IdempotencyKey` table for booking, payment, refund, and connector mutations. Key is unique per tenant + actor/connector + key material.
- Webhook inbox: verify signature, persist raw payload (redacted), unique provider event id, process once, quarantine after repeated failure.
- Transactional outbox: business write and `OutboxEvent` commit together; a worker publishes with backoff and dead-letter review.

Confirm, cancel, refund, and capacity commit are idempotent at the service boundary.

## Consequences

- Duplicate webhooks cannot create duplicate bookings, refunds, or commissions.
- Operators get a reconciliation queue instead of silent double-sends.
- First slice must include the keys and outbox tables, not a “we’ll add it later” comment.
