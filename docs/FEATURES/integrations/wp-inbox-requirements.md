# E12/E13 integration inbox — requirements

**Status:** Approved bounded foundation. WP Travel Engine credentials, webhook event schema, and production enablement remain decisions outside this increment.

## Outcome

Tenant administrators can create a disabled connector account, rotate its one-time inbound secret, and inspect a tenant-scoped inbox. A public webhook endpoint accepts only correctly signed payloads for an enabled account, retains redacted raw evidence, deduplicates logical deliveries, and quarantines unsupported or malformed events. It never creates a booking directly.

## Scope

- Generic `wp_travel_engine` connector account with an opaque public inbound ID and one-time HMAC secret.
- Exact raw-body HMAC-SHA256 verification using `x-zettaz-signature` (`sha256=<hex>` accepted).
- Immutable inbound evidence and hash; `(connector account, external event ID)` logical deduplication.
- Inbox status: `received`, `quarantined`, `processed`. This increment only writes `received` or `quarantined`.
- Tenant review list and a reasoned, audited retry/quarantine transition for later adapter processing.
- Tenant-managed external product/option ID mappings to canonical catalog products. A missing mapping is a quarantine condition, never a fallback to a similarly named product.
- Connector feature flag is disabled until the tenant explicitly enables its account.

## Guards

- No tenant ID supplied by a webhook caller is trusted. The opaque account ID selects the tenant, then the account secret verifies the caller.
- Invalid signatures and unknown/disabled accounts return an indistinguishable `401`; payload contents are not retained.
- Duplicate valid events return the original receipt and cannot create a second inbox fact.
- Raw payload is capped at 64 KiB. Logs/audit contain only hash, event ID, connector account ID, and state; secrets are never persisted in plaintext.
- A webhook is an integration fact, never authority to bypass holds, pricing, payments, confirmation, or RBAC.

## Deferred

- Actual WP Travel Engine booking and cancellation event mapping.
- Booking creation, cancellation propagation, retry worker, external API polling, CSV parser, reconciliation screen, and every certified OTA connector.
- Production secret manager integration and final payload-retention policy.

## Acceptance evidence

1. Valid signed event creates one inbox record; repeat delivery returns the original receipt.
2. Bad signatures, unknown accounts, disabled accounts, and oversized bodies do not create inbox facts.
3. One tenant cannot read another tenant's accounts or inbox rows.
4. Inbox mutation emits audit and outbox evidence.
5. No inbound request creates or confirms a booking.
