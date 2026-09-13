# Customer notification requests

## Current boundary

The application stores tenant-scoped, auditable email requests for booking confirmations, payment requests, waiver requests, and cancellations. A request captures the booking recipient, locale, subject, and rendered body at the time it is prepared. This preserves exactly what staff intended to communicate even if the booking or tenant profile later changes.

Rendered bodies are rich HTML + plain-text snapshots (`{ "v": 1, "text", "html" }` in `notification_messages.body`) that include tour, departure time (tenant timezone), guests, status, pickup/stay when set, totals/paid/balance, and a QR code encoding the full booking UUID with a short reference display.

Delivery uses the platform **SMTP_*** settings from `.env.development` / `.env.production` (same adapter as verification and recovery mail):

| Status | Meaning |
| --- | --- |
| `sent` | SMTP accepted the message |
| `failed` | SMTP error; staff can **Retry** |
| `held_provider` | SMTP_HOST / SMTP_USER / SMTP_PASS not configured; staff can **Retry** after configuring |
| `queued` | Brief intermediate state while sending |

The UI must not describe a held or failed request as sent. Provider credentials and delivery state do not belong in browser code.

## Authorization and evidence

- Owners, administrators, and reservation staff may prepare requests and retry failed/held ones.
- Auditors may read communication history but cannot prepare requests.
- Every request writes audit and transactional-outbox evidence in the same database transaction as the durable row; send/fail/retry also write audit actions (`notification.sent`, `notification.failed`, `notification.retry_queued`).
- PostgreSQL row-level security and the booking composite foreign key enforce tenant ownership.
- The customer message body is not copied into the generic audit event payload; it remains in the controlled notification record.

## Retry

`POST /staff/v1/bookings/:bookingId/notifications/:messageId/retry` re-sends the stored subject/body for `failed` or `held_provider` rows. Already `sent` or `cancelled` rows cannot be retried.

## Follow-up

Tenant-editable localized templates, suppression lists, delivery webhooks, and per-tenant From addresses remain Track A hardening. Runtime SMTP remains the approved launch path per [ADR 016](../DECISIONS/016-rock-launch-operations.md).
