# ADR 001 — Stack: NestJS, Next.js, Expo

**Status:** Accepted · **Date:** 5 September 2026

## Context

The v1.1 blueprint recommended Next.js, NestJS, Expo, PostgreSQL, and Redis. The empty repository sits under Laravel Herd, which is a local PHP environment, not an application framework choice.

## Decision

Use NestJS as the modular monolith API, Next.js for cloud web surfaces, and Expo for the staff mobile app. PostgreSQL is the system of record. Redis is for locks, short holds, and rate limits. Object storage is S3-compatible.

WordPress / WP Travel Engine remains the public booking site through Track A.

Do not introduce Laravel, a second API runtime, or a hybrid PHP/TypeScript domain.

## Consequences

- Shared TypeScript types across API, web, and mobile clients.
- Herd is only a folder location; local API runs via Node (Docker or Nest CLI), not `php artisan`.
- First slice does not include a Next.js marketing/checkout site.
