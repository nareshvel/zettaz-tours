# ADR 002 — Modular monolith

**Status:** Accepted · **Date:** 5 September 2026

## Context

The product has many domains (catalog, booking, finance, operations, integrations). Microservices would add network failure modes and operational load a first product cannot staff.

## Decision

Ship one NestJS deployable with strict modules. Modules talk through application services and domain events. A transactional outbox carries cross-module and external side effects.

Extract a service later only when a module has an independent scale, security, or team reason.

## Consequences

- Faster transactions for hold → pay → confirm.
- Requires discipline: no drive-by joins across module write models.
- Deployment and migrations stay one pipeline.
