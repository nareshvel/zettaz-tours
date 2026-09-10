# Integrations

**Version 2.0 · 5 September 2026**

Index: [README.md](../README.md) · Scope: [launch-contract.md](../STRATEGY/launch-contract.md)

## Hub pattern

Architecture decision: [ADR 015 — channel-neutral booking core](../DECISIONS/015-channel-neutral-booking-core.md).

- Canonical internal schemas for Product, Availability, Booking, Cancellation, Customer Question, and Payment Ownership.
- One adapter per external system. Raw payload retention with redaction and a retention policy.
- Inbound webhook inbox: signature verification, deduplication, retry, quarantine.
- Outbound outbox: exponential backoff, rate-limit handling, dead-letter review.
- Mapping UI for external product / option / rate / pickup IDs.
- Reconciliation dashboard comparing channel bookings, cancellations, and capacity with internal records.

Do not couple the internal domain to OCTO or any OTA schema. An OCTO façade is a later adapter.

## Channel priorities

| Priority | Connector | Approach |
| --- | --- | --- |
| P0 | Rock Adventures website / WP Travel Engine | Webhooks and API add-on for transition. Platform becomes system of record. New Next.js checkout is Track B. |
| P0 | Manual assisted channels | Fast reservation entry for WhatsApp, phone, and walk-in. Source attribution and payment link. |
| P0 | Hotel / agent / Island Routes | Staff enter against partner records. CSV/email-assisted import during onboarding. Portal is Track B. |
| P1 | Viator | Apply as reservation-system provider. Implement only after formal approval and contract testing. |
| P1 | GetYourGuide | Partner access required. Build connector shell and mapping/reconciliation before credentials. |
| P1 | OCTO | Publish/consume standard product, availability, booking, and pickup interfaces — façade only, Track B. |
| P2 | Other OTAs / channel managers | Add by commercial demand through the adapter framework. |

### Do not promise direct OTA dates

Viator access is restricted to registered operators and authorized reservation-system providers and requires technical evaluation. GetYourGuide requires a partner account. Track A must support reliable manual/CSV/email reconciliation while approval is pursued.

Build adapter interfaces, mapping, and reconciliation without pretending credentials or certification exist. Use feature flags (`ConnectorFeatureFlag`) for unfinished connectors.

## Payments

### Payment scope clarification — 9 September 2026

Confirmed product direction: design payments from the tenant/operator perspective, with two separate responsibilities.

The owner clarified that partners/resellers are external hotel/reseller partners of the tenant. Track A tenant staff record their bookings and financial evidence; external partners do not receive tenant-staff credentials. Detailed proposed collections and remittance flows: [tenant-payments.md](tenant-payments.md).

- **Zettaz subscription billing:** tenants pay Zettaz for the software through a separate Stripe SaaS billing setup. The owner reports this Stripe setup already exists; its technical configuration has not been inspected. Subscription invoices, payments, and entitlements belong to platform billing, not tenant booking balances.
- **Tenant booking collections:** offer optional Stripe Connect onboarding for tenants that need a payment solution, subject to regional eligibility and provider approval. Also research and support regional gateways through the neutral payments port. Stripe Connect is not a mandatory dependency for every tenant, and selecting Stripe for SaaS billing does not select a launch gateway for Rock Adventures.

These are separate business domains even if a provider account relationship can support both. Keep financial records, authorization, webhook routing, reconciliation, and reporting explicitly scoped to platform billing or a tenant's booking collections.

Working recommendation, pending detailed requirements: the tenant owns its traveler payment relationship and settlement destination. Staff and partners/resellers act as authorized collectors or booking sources within that tenant's workflow. Do not assume Zettaz receives and redistributes all booking funds. Connect charge model, fee payer, refund/dispute responsibility, and any platform transaction fee remain decisions to validate before implementation.

For staff or partners/resellers collecting money, distinguish booking attribution, collection responsibility, guest payment evidence, and remittance to the tenant. Recording a guest payment must not imply the collector has remitted it. Remittance must not count as a second guest payment. Specify collector identity, amount/currency, method/reference, evidence, reconciliation status, and who may approve or correct a record. These are requirements to detail within slim Track A finance; automated partner/reseller payouts and a full settlement engine remain deferred.

Tenant requirements must cover payment-provider setup and readiness, allowed collection methods, payment/refund permissions, reconciliation, and visibility of outstanding guest balances versus money awaiting remittance. Regional gateway research must consider merchant country, settlement bank and currency, payment methods, refunds, disputes, card-present support, webhook reliability, and costs. No regional gateway has been selected by this clarification.

This records product direction without promoting self-service SaaS billing or a full partner settlement engine into Track A. Complete requirements before creating application scaffolding or implementing payment integrations.

Neutral payments port:

- Create payment session
- Authorize / capture
- Refund
- Retrieve
- Verify webhook
- Create payment link
- Reconcile settlement

Choose the Rock Adventures launch gateway only after merchant jurisdiction, settlement bank, currencies, fees, 3-D Secure, card-present needs, and API/webhook support are confirmed.

## Communications

Provider adapters for email, SMS, WhatsApp Business, and push.

Track A: email templates for confirmation, payment request, waiver, cancellation. SMS optional if a provider is contracted.

WhatsApp-assisted reservation entry is a **staff workflow** with conversation/reference capture. A bot is added only after templates, consent, handoff, and operational ownership are defined. WhatsApp is not equivalent to email: template approval, 24-hour windows, opt-in, and per-message cost apply.

Event-driven templates also cover pickup change, delay, review, and partner invoice (as those epics land). Consent, quiet hours, delivery status, and localization are required once a channel is enabled.

Inbound conversation linking where the provider supports it; otherwise log manual contact.

Task queues: call-back, payment collection, cancellation, invoice review, exception resolution.

## Sources to revalidate

Official pages consulted in v1.1 (September 2026) remain starting points, not contracts:

- WP Travel Engine webhooks and API: https://docs.wptravelengine.com/article/webhooks-and-api/
- Viator supplier API: https://docs.viator.com/supplier-api/technical/
- GetYourGuide API: https://api.getyourguide.com/
- OCTO specification: https://octo.travel/specification
