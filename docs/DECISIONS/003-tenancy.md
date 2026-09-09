# ADR 003 — Single-database tenancy

**Status:** Accepted · **Date:** 5 September 2026

## Context

Rock Adventures is tenant one. The product must not be a single-tenant fork. Schema-per-tenant and database-per-tenant add migration and reporting cost before a second operator exists.

## Decision

One PostgreSQL database. `tenant_id` on every tenant-owned row. UUID primary keys. Application code always scopes by tenant. Enable RLS as defense in depth. Isolation tests are mandatory and launch-blocking.

Cache keys, object storage paths, queue payloads, logs, and analytics include tenant identifiers.

Platform support uses time-limited `SupportAccessGrant` and a visible impersonation banner. No standing cross-tenant credentials.

## Consequences

- Simple backups and reporting queries with explicit tenant filters.
- A missing `WHERE tenant_id = ?` is a critical bug; tests must catch it.
- Revisit database-per-tenant only for an Enterprise isolation requirement.
