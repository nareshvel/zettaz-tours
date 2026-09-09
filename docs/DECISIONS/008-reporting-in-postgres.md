# ADR 008 — Reporting in PostgreSQL

**Status:** Accepted · **Date:** 5 September 2026

## Context

v1.1 mentioned reporting read models. A separate reporting database or warehouse is unjustified for one tenant and one operating season.

## Decision

Serve operational and finance reports from PostgreSQL views or materialized views in the same database. Metric definitions live in [ux-security-reporting.md](../ARCHITECTURE/ux-security-reporting.md). Display recognition basis explicitly (booking date vs travel date vs cash).

Add a warehouse or dedicated read replica when Enterprise packaging or a second high-volume tenant makes it necessary.

## Consequences

- Reports share transactions and tenant isolation tests with the write model.
- Heavy analytics must be scheduled (materialized refresh) rather than run ad hoc on the primary during boarding.
- No CQRS framework in Track A.
