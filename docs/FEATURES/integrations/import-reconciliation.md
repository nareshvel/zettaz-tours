# Booking import reconciliation

The tenant Settings → Integrations page provides a controlled dry-run path for future-booking cutover data. Staff download the canonical CSV template, map source columns into it, upload the file, review normalized JSON, and run validation. A dry run writes only to import staging tables. It creates no booking, consumes no capacity, and sends no customer communication.

Each row must preserve the external booking and product references, offset-aware departure time, party size, lead contact, source status, pickup disposition, ISO currency, total and paid minor units, invoice owner, and any partner reference. Validation quarantines missing product mappings, duplicate references, overpayments, mixed-currency files, and partner-owned invoices without partner references. Product mappings remain tenant-owned.

Every run stores row counts, duplicate counts, financial totals, balance, currency state, and row-level failure reasons. The downloadable JSON acceptance report is tenant-scoped and identifies itself as a dry run. It is evidence for review; it is not authorization to create bookings.

Retry requests are consumed by the tenant-scoped `npm run integrations:drain` worker. It locks due records with `SKIP LOCKED`, revalidates the immutable neutral event envelope, and returns valid envelopes to `received`. Invalid envelopes return to quarantine until the five-attempt limit, when they are retained as dead letters. Every consumption is audited. This worker deliberately does not translate provider payloads or create bookings; those steps require an approved provider contract and mapping.

Before a live import can exist, tenant one must supply representative source files and approve source-column and status mappings. The implementation must then add a separately permissioned, idempotent apply workflow that uses the ordinary hold/reservation/payment workflows, reconciles daily totals, preserves channel evidence, and supports rollback before spreadsheet freeze. The required 7–14 day parallel run remains unchanged.
