# ADR 007 — Offline sync

**Status:** Accepted · **Date:** 5 September 2026

## Context

Caribbean field connectivity is unreliable. Crew must open a manifest and record check-in. Naive last-write-wins on money and signatures duplicates cash and waivers.

## Decision

- Sync is a command queue: device-generated IDs, monotonic client timestamps.
- Server is source of truth for assignments, catalog, and booking balances.
- Check-in and trip-run events append. Two offline check-ins of the same passenger converge to one boarded/no-show fact without duplicating signatures.
- Payments append. Two cash recordings are two ledger lines or a detected duplicate by client id — never a silent overwrite.
- Media is eventually consistent; the event may persist before the photo finishes.
- Cached manifests are encrypted, time-bounded, and remotely revocable.

Track A may ship a connected crew app first and add the encrypted offline store immediately after the first live week. The conflict rules do not change.

Full matrix: [finance-and-offline.md](../ARCHITECTURE/finance-and-offline.md).

## Consequences

- More append-only rows; simpler conflict resolution.
- Device trust and staff identity must be known before the device goes offline.
