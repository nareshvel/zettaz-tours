# Platform console — Track A evidence

**Date:** 20 September 2026  
**Status:** Engineering complete; owner visual outstanding  
**Surface:** Dedicated platform shell (`apps/web/components/platform.tsx`)

## What shipped

- Migration `095_platform_admin_credentials.sql`: email/password on `platform_users`, login/session functions, `platform.tenant.read` on `resolve_session`.
- Migration `096_platform_console_reads.sql`: `platform_overview()`, `platform_tenant_record()`, `list_platform_health()`, `list_platform_activity()` (no payloads / guest names).
- Migration `097_platform_health_and_subscription.sql`: health is connector inbox only (outbox is a drain queue); tenant record includes features/limits; local trial extend / suspend / resume.
- Seed / `npm run platform:admin` upserts `systemadmin@zettaz.com`. Local password: `LOCAL_DEFAULT_PASSWORD` (default `ZettazLocal!2026`). Production: `PLATFORM_ADMIN_PASSWORD` then `npm run platform:admin:prod`.
- Shell matches tenant workspace: grouped nav, greeting briefing, decision queue, staff-style tables/cards, profile account panel. Tenant record shows plan features/limits. Support requests are created on Support (tenant detail deep-links `?tenant=`).
- Gateway allowlists `platform/v1/overview|health|activity|tenants/:id|tenants/:id/subscription|support-access`. Support “Open workspace” POSTs `/api/session` with `{ grantId }` and parks `zettaz_platform_session`. Tenant banner **Return to platform** POSTs `{ resumePlatform: true }`.

## Checks

- Checks: API: platform sign-in; staff 403 on tenants and overview; tenant list/detail omit traveler email; health items are `inbox` only; activity includes `tenant.created` without `before_data`; local trial extend/suspend/resume.
- Owner: sign in as `systemadmin@zettaz.com`, walk Overview → Tenants (search) → tenant record (plan features, extend/suspend if not Stripe) → Support (filter; request lives here) → Health → Activity → Account. After an approved grant, open the tenant workspace and use **Return to platform**. Restart `workspace:dev` if the web bundle is stale. Local migrate **097**.

## Not in this slice

Platform MFA, extra platform users, SaaS plan administration, Zettaz Pay merchant ops, mixing Stripe products.
