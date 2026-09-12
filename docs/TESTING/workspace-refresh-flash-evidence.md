# Workspace refresh flash fix — evidence

**Date:** 11 September 2026  
**Status:** Implemented; owner hard-refresh verification recommended

## Cause

On hard refresh, client `Workspace` started with `session = null` and rendered the public Entry/landing page until `/api/session` returned. Signed-in routes briefly flashed the marketing landing.

## Fix

- Server pages (`app/page.tsx`, `app/[...section]/page.tsx`) call `loadWorkspaceBootstrap()` and pass `initialSession` / `initialTenants`.
- While session is unknown (`loading && !session`), render neutral `workspace-boot` loader — never Entry/landing.
- Tenant switch no longer clears session before the new session arrives.
- Silent revalidation after SSR; `401` clears the retained session.

## Verify

1. Sign in and open `/operations` (or any signed-in route).
2. Hard refresh (Cmd+Shift+R). Expect Day Board (or that route), not a flash of the public landing.
3. Sign out and open `/` — landing/sign-in still appears once boot completes.
