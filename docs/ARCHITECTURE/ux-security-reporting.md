# UX, security, and reporting

**Version 2.0 · 5 September 2026**

Index: [README.md](../README.md)

## Surfaces

### Cloud operations dashboard

- Today header: departures, guests, unassigned resources/staff, unsigned waivers, unpaid balances, delays, incidents, weather holds.
- Calendar/list with product, time, capacity, pickup cluster, asset, crew, and cruise-call filters.
- Departure drawer: manifest, assignments, route, documents, money, event timeline.
- Quick actions that respect permissions: add booking, send payment/waiver link, assign, move, cancel, message, weather/close, print.
- Exception-first. Do not reproduce the spreadsheet as a giant editable grid.

### Print / PDF (Track A)

Launch requirement: printable day manifest and pickup list (product, time, guest counts, pickup sequence, ship/hotel, balance/waiver flags, crew, vehicle). Used as a connectivity fallback. Not a native consumer app.

### Reservation workspace

- Single fast flow for phone / WhatsApp / walk-in with availability and price visible together.
- Customer lookup and duplicate warning; lead traveler and passenger separation.
- Structured pickup, accommodation, cruise call, channel, and payment fields plus internal notes.
- Quote summary: retail, discount, tax/fees, paid, balance, contract/net, collector.
- Save draft/hold, send payment link, confirm using credit terms, or collect later according to policy.

### Reseller portal

Track B. Branded login, contract-aware inventory/rates, agent permissions, quotes, vouchers, statements, disputes.

### Staff mobile

- One-tap Today view, large status actions, strong offline indicator.
- Privacy-minimized manifest and route grouped by pickup stop.
- Readiness checklist before Start; QR/manual check-in optimized for sun/glare and wet conditions.
- Incident/emergency action always reachable; accidental completion/cancellation protected.
- Sync queue and clear conflict/retry feedback.
- Check-in checklist: balance, payment responsibility, waiver status for every required guest. Guardian flow for minors.
- Boarding blocked until required balances and waivers are satisfied, unless an authorized exception is recorded.

### Customer booking and portal

- Track A: WP public checkout; payment and waiver links; minimal manage-booking pages.
- Track B: Next.js mobile-first availability and checkout, guest checkout with optional account, accessible low-bandwidth forms.
- Confirmation as a responsive page plus email/WhatsApp link. PDF only when needed.

## Waivers, tickets, check-in

- Versioned waiver templates by product and participant category.
- Guardian flow for minors; consent timestamp, IP/device metadata, signature evidence.
- Pre-arrival link, on-site phone workflow, reminder automation.
- Signature evidence: waiver version, guest or guardian identity, signature image/strokes or accepted method, signed timestamp, staff/device context, consent declaration.
- QR booking/ticket codes with signed, non-sequential tokens.
- Passenger-level requirements: waiver, medical/accessibility note, equipment size, dietary information.
- Retention and access policies configurable by jurisdiction and insurer guidance.

Sample tenant wording: [waiver-content.md](../CLIENTS/rock-adventures/waiver-content.md). That file is not legally approved copy.

## Security, privacy, reliability

- Tenant isolation tests are mandatory. Support access uses time-limited grants and impersonation banners.
- MFA for tenant administrators, finance, and platform users. Secure device and session management.
- Encrypt data in transit and at rest. Field-level protection for high-risk identifiers and incident/medical notes.
- Hosted/tokenized payment components. Raw card data stays outside Zettaz systems.
- Least-privilege cloud identities, secret manager, key rotation, separate production/non-production credentials.
- Signed webhooks, replay protection, allowlists where practical, full integration audit logs.
- Configurable retention/anonymization for customer, waiver, GPS, and incident data. Legal/insurance review by operating country.
- Automated backups, point-in-time restore, tested recovery, tenant export.
- Target 99.9% monthly availability after stabilization. Graceful degradation if OTA, messaging, or payment providers fail.
- Security logs must omit card data, waiver signatures, secrets, and unnecessary passenger/medical information.

| Control | Launch requirement |
| --- | --- |
| RPO / RTO | Target RPO ≤ 15 minutes; RTO ≤ 4 hours, then improve with usage |
| Audit | Immutable trail for privileged, booking, finance, capacity, safety, and integration actions |
| Backups | Automated encrypted backups plus quarterly restore test |
| Incidents | Severity classification, alert routing, evidence preservation |
| Data export | Permissioned tenant export with logged requester and expiry |
| Release | CI checks, migrations, feature flags, rollback, environment separation |

Legal still gates electronic-signature enforceability, child/guardian consent, GPS consent, incident/medical retention, and PCI for card-present. The mobile epic must not invent a signature story the insurer or Antigua courts will not accept.

## Reporting definitions

Finance must approve final accounting definitions, tax treatment, exchange-rate source, and whether recognition is on booking, payment, or completion. The platform displays each basis explicitly rather than one ambiguous Revenue number.

| Metric | Definition |
| --- | --- |
| Gross booking value | Sum of booking item prices, fees, and tax before refunds; report by booking date and travel date |
| Collected | Successful captured transactions less successful refunds in the reporting period |
| Outstanding balance | Booking amount due minus settled/cleared payments and credits |
| Commission expense | Accrued partner commission according to contract trigger, including adjustments (Track B; Track A may show invoice flags only) |
| Net operator revenue | Gross value less discounts, refunds, commission, and taxes/fees excluded by accounting policy |
| Load factor | Confirmed or checked-in passengers divided by sellable passenger capacity. State which passenger population. |
| Resource utilization | Assigned operating duration or trips divided by available duration/capacity |
| No-show rate | No-show passengers or bookings divided by confirmed due-to-travel population. State the grain. |
| Channel sync health | Successful freshness within SLA; errors, backlog age, reconciliation mismatches |

Reports use tenant timezone, currency, and permission-aware fields. Implementation: [008-reporting-in-postgres.md](../DECISIONS/008-reporting-in-postgres.md).
