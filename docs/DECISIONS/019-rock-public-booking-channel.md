# ADR 019 — Rock public booking channel: JungleBee until Zettaz checkout

**Status:** Accepted · **Date:** 19 September 2026

## Context

Launch-contract Track A assumed WordPress / WP Travel Engine (WTE) as Rock Adventures’ public booking site, with a WTE webhook/API inbox so website bookings are not retyped. Live checkout on `rockadventuresantigua.com` presents JungleBee terms: the reservation is owned and managed by JungleBee, and the card statement shows “Junglebee.” The site embeds JungleBee’s widget (`app.junglebee.com`); WordPress is the marketing host. WTE (and related plugins) may still appear in wp-admin but are not treated as the live web booking engine without contrary evidence.

Building a JungleBee-like public checkout or WordPress reservations plugin is Track B ([launch-contract.md](../STRATEGY/launch-contract.md)): new public customer checkout after Zettaz is the operational system of record.

## Decision

1. **JungleBee is Rock’s live public web booking channel** until a Zettaz-owned public checkout ships and Rock cuts over.
2. **WP Travel Engine is assumed retired for live web bookings.** Do not implement or prioritize a WTE-specific production connector for Rock unless evidence shows WTE still creates guest reservations.
3. **Track A does not replace JungleBee.** Staff-assisted reservations, CSV/assisted import, and ops (manifest, crew, waivers) remain the cutover path. Website → Zettaz sync, if built before Track B checkout, is a **JungleBee adapter** (Zapier, export, or provider API/webhook) behind the channel-neutral inbox ([ADR 015](015-channel-neutral-booking-core.md)).
4. **Track B public checkout** is the JungleBee replacement: embeddable Zettaz Book Now (any host, including WordPress), writing holds/bookings into canonical Zettaz with tenant-owned payments — not a WTE clone and not required for spreadsheet cutover.

## Consequences

- Docs and backlog that say “WP Travel Engine remains the public booking site” for Rock are superseded by this ADR for that tenant’s live channel; the generic Track B “new public checkout” deferral stands.
- Connector registry may keep a disabled `wp_travel_engine` shell; Rock enablement targets JungleBee (or assisted import) first.
- Product/option mapping for website bookings uses JungleBee tour/widget IDs, not WTE trip post IDs, until proven otherwise.
- Evidence still required: JungleBee operator access, sample booking payload/export, and whether Zapier or a native webhook/API is available.

## Links

- [Launch contract](../STRATEGY/launch-contract.md) — Track A vs B; deferred public checkout
- [ADR 015](015-channel-neutral-booking-core.md) — channel-neutral adapters
- [Integrations overview](../ARCHITECTURE/integrations.md)
