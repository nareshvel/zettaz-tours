# ADR 005 — Identity partitions

**Status:** Accepted · **Date:** 5 September 2026

## Context

Tenant staff, hotel/reseller agents, and guests have different authentication, data exposure, and session lifetimes. A single `users.role` flag invites IDOR bugs and messy password resets.

## Decision

Treat tenant staff, partner users, and customers as separate principal types with separate credentials and membership tables. Shared infrastructure (password hashing, MFA, device records) may live in an identity module; authorization always starts from the principal type.

- Tenant staff: membership + RBAC + record rules.
- Partner users (Track B): organization membership; own organization only.
- Customers: signed magic links and optional accounts; own bookings only.
- Platform admins: Zettaz-scoped, audited support grants, not a tenant admin role.

Crew devices store the minimum passenger fields required for the assignment window.

## Consequences

- More tables at the start; fewer cross-portal leaks later.
- Impersonation is a support grant, not “log in as the customer’s password.”
- Partner portal work in Track B does not rewrite tenant auth.
