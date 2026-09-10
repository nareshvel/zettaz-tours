# ADR 015 — Channel-neutral booking core

**Status:** Accepted for architecture · **Date:** 10 September 2026

## Context

Rock Adventures currently maintains operational bookings in daily spreadsheets. Website-database discovery has not yet established a complete, authoritative booking store, and the available findings mix observed website behavior with unverified plugin and synchronization assumptions. WordPress connectivity is useful but is not a Track A prerequisite. Viator connectivity adds significant value but requires operator eligibility, Viator approval, technical evaluation, contract testing, and product mapping.

## Decision

Zettaz owns one canonical tenant-scoped model for products/options, departures, availability, holds, bookings, passengers, customer contacts, pickup/stay facts, external references, commercial snapshots, payment evidence, partner obligations, cancellation/amendment states, and audit history.

Every source uses an adapter boundary:

1. Store the source account and an immutable, redacted inbound envelope.
2. Deduplicate with `(tenant, connector account, external event/reference)`.
3. Map source product, option, passenger category, pickup, status, partner, currency, and payment semantics to canonical values.
4. Validate and quarantine unknown, incomplete, contradictory, or unsupported records.
5. Apply accepted commands through the ordinary domain workflows. An adapter never writes booking, inventory, payment, or cancellation tables directly.
6. Preserve both the provider reference and Zettaz reference for reconciliation.

Canonical fields remain stable when a provider changes. Provider-only fields stay in versioned adapter payloads or explicitly modeled extension facts; they are not added to core tables merely because one integration sends them. A field graduates into the canonical model only when the business needs it independently of that provider.

## Source authority

Authority is determined per fact, not per system. For example, Viator may be authoritative for its confirmation reference and the payment/commission facts it contractually supplies, while Zettaz remains authoritative for available capacity, operational pickup assignment, waiver, check-in, and later staff changes. Conflicts enter reconciliation rather than silently overwriting either side.

The Rock spreadsheet remains operational evidence. Website tables can be used after schema/provenance inspection. Neither becomes financial truth from comments, display labels, inferred formulas, or matching names.

## Viator path

The current Viator Reservation System API is primarily a certified connectivity relationship in which Viator calls reservation-system endpoints for catalog mapping, calendar/availability, reserve, booking, amendment, cancellation, and redemption workflows; Zettaz also calls designated Viator endpoints for notifications and mapping. It is not an unrestricted API for downloading an operator's entire historical account.

Implementation order:

1. Keep the `viator` adapter disabled and document capability mappings.
2. Confirm Rock's Viator operator account, supplier ID, product IDs, export access, and whether another reservation system is already connected.
3. Use a supplier export or approved source access for one-time reconciliation when available.
4. Apply to Viator as Rock's authorized reservation-system provider.
5. Implement current JSON v2 endpoints behind the canonical command/query ports, pass Viator contract and certification testing, then enable only mapped products in a monitored rollout.

## Consequences

- WordPress, Viator, GetYourGuide, manual entry, CSV, email-assisted entry, and future OCTO support share the same core workflows.
- We can finish and operate Track A without waiting for OTA approval.
- A generic “accept any JSON” endpoint is rejected because syntactic flexibility without semantic mapping creates incorrect bookings.
- The existing connector account implementation must evolve from its initial WP-only constraint to a connector registry before a second live connector is added. This refactor does not justify building a Viator adapter before approval.
