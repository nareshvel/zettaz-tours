# ADR 016 — Rock launch payments and operating controls

**Status:** Accepted in part · **Date:** 10 September 2026

## Context

Rock Adventures is the launch tenant. The owner confirmed that its currently published online prices are the approved starting prices, online orders are denominated in USD, Stripe Connect is the default tenant payment gateway, and Rock can supply SMTP credentials for `rockadventuresantigua.com`. The platform must preserve tenant-neutral gateway, currency, communications, security, print, and offline boundaries.

## Decisions

### Tenant booking payments

- Stripe Connect is the default adapter for Rock traveler payments, subject to successful connected-account onboarding and active merchant capabilities in Rock's jurisdiction.
- Rock operates its own customer relationship. Use an Accounts v2 merchant configuration, full Stripe Dashboard access, and direct charges on Rock's connected account. Zettaz subscription billing remains a separate platform-billing connection and never changes a booking balance.
- Use Stripe-hosted Checkout Sessions for online payment and verified, deduplicated webhooks as payment truth. Do not infer payment success from a browser redirect.
- Rock online catalogue prices, Checkout Sessions, and online booking balances use USD. Rock's reporting currency is USD for launch reconciliation.
- XCD remains an allowed local/manual tender currency. Each XCD receipt records its actual currency and amount. Applying it to a USD balance requires a displayed, approved exchange rate with source, effective time, converted USD amount, and rounding snapshot. Until Rock approves that rate policy, XCD can be recorded but cross-currency settlement remains review-required.
- Card-present hardware and in-field card collection remain a separate decision. Stripe Connect as the online default does not prove that Stripe Terminal hardware is eligible or operational in Antigua.

### Transactional email

- Use a provider-neutral SMTP adapter configured through runtime secrets. Required settings are host, port, TLS mode, username, password, From name/address, Reply-To address, and an optional bounce/return-path address.
- SMTP secrets stay out of Git, logs, browser payloads, and tenant-readable settings. Production uses the deployment platform's secret manager; local development may use an uncommitted `.env`.
- Before enabling sends, verify SPF, DKIM, and DMARC for the sender domain and test delivery, bounce, retry, suppression, and duplicate-event behavior. Tenant templates remain versioned data.

### Privileged MFA and recovery

- Require TOTP MFA for tenant owners/admins, finance roles, platform administrators, gateway changes, ownership transfer, data export/deletion, and other critical actions.
- Encrypt TOTP seeds with authenticated encryption under a versioned application key held in the deployment secret manager. Never store plaintext seeds.
- Issue ten single-use recovery codes. Store only slow password hashes of recovery codes, show them once, audit their use/regeneration, and revoke the old set when regenerated.
- Require recent password authentication plus MFA for critical actions. Recovery uses verified email, rate limits, short-lived single-use tokens, session revocation, and an audit trail. SMS is not the default recovery factor.

### Printer-agent enrollment

- A tenant owner/admin enrolls a named station and printer using a one-time, ten-minute enrollment code. The agent exchanges it over TLS for a revocable device credential; only its hash is stored server-side.
- Record station name/location, printer make/model, connection type, supported paper/output formats, document routes, last seen, agent version, and credential status. The agent receives only authorized jobs for its tenant and station.
- Rotation, revocation, retry limits, job history, and browser/PDF fallback are mandatory. Final printer models, station names, network access, and document-retention period are Rock operating inputs, not architecture blockers.

### Mobile offline operation

- The crew app downloads only assigned departures and the minimum guest, pickup, balance-status, and waiver-status data needed for the selected offline window.
- Cache data in encrypted SQLite; keep the database key in iOS Keychain/Android Keystore. Require device registration and local biometric/device-PIN unlock. Do not cache tenant-wide customer history, SMTP/payment secrets, or raw card data.
- Default the offline authorization lease and manifest window to 24 hours, tenant-configurable within a bounded range. Purge synced operational data 24 hours after its departure and no later than seven days after download. Never silently purge unsynced events or waiver evidence; quarantine and visibly escalate them until sync or an authorized discard.
- Offline check-ins, trip events, and waiver signatures use device-generated idempotency IDs and append-only commands. The server remains authoritative for assignment and money. Waiver evidence is encrypted locally, uploads resumably, records consent/template/version/time/signer/guardian context, and is removed locally after acknowledged sync and the purge window.
- Revoked access takes effect on reconnection; the short offline lease bounds exposure before reconnection. Lost devices can be revoked and their next connection must wipe tenant data.

### Parallel operation and cutover

- Run the existing spreadsheet/process and Zettaz in parallel for 7–14 real operating days. The same bookings and operational changes are represented in both during this controlled period.
- Reconcile daily booking counts, guest counts, departures, cancellations/amendments, USD sales, XCD/manual receipts, balances, partner obligations, waiver completion, and manifest/pickup exceptions. Every difference receives an owner and resolution.
- Exercise at least one print/PDF manifest, offline device cycle, waiver sync, closure/rebook scenario, failed-email retry, and restore/rollback drill.
- Cut over only after Rock's named operational and finance owners sign off, unresolved material differences are zero, backups and rollback are verified, and staff are trained. Then stop new spreadsheet entry while retaining the workbook as read-only evidence.

## Evidence still required

- Stripe connected-account country/merchant capability, live webhook endpoint, responsibility/fee terms, refund/dispute ownership, and card-present eligibility.
- Rock's approved XCD-to-USD rate source and rounding rule.
- SMTP values and DNS/delivery verification.
- Actual printer/station inventory and desired document retention.
- Rock sign-off on schedules, capacities, waiver wording, pickup/location configuration, and the parallel-run results.
- A representative WordPress payload only when the WordPress adapter is resumed; it does not block manual/CSV Track A operation.

## Consequences

These decisions unblock implementation of the provider adapters, MFA storage/recovery, printer enrollment foundation, and encrypted offline crew workflow. Live enablement remains gated by credentials, provider eligibility, DNS checks, device evidence, and tenant acceptance rather than placeholder configuration.
