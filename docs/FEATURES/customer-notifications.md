# Customer notification requests

## Current boundary

The application stores tenant-scoped, auditable email requests for booking confirmations, payment requests, waiver requests, and cancellations. A request captures the booking recipient, locale, subject, and rendered body at the time it is prepared. This preserves exactly what staff intended to communicate even if the booking or tenant profile later changes.

Requests remain `held_provider` until a transactional email provider, sender-domain policy, retry policy, suppression handling, and delivery webhook contract are approved. The UI must never describe a held request as sent. Provider credentials and delivery state do not belong in browser code.

## Authorization and evidence

- Owners, administrators, and reservation staff may prepare requests.
- Auditors may read communication history but cannot prepare requests.
- Every request writes audit and transactional-outbox evidence in the same database transaction.
- PostgreSQL row-level security and the booking composite foreign key enforce tenant ownership.
- The customer message body is not copied into the generic audit event payload; it remains in the controlled notification record.

## Provider adapter follow-up

The future worker may move a request from `held_provider` to `queued` only when the tenant has an enabled provider configuration. It must use an idempotent provider key, record the provider message identifier, consume delivery/failure webhooks, cap retries, and preserve failure detail. Tenant-editable localized templates should be versioned and snapshotted into each request before automatic sending is enabled.
