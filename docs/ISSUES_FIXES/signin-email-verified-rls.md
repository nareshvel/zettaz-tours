# Sign-in blocked: “verify your email” despite verified account

**Date:** 12 September 2026  
**Status:** Fixed (migration `061_staff_login_email_verified.sql` + `AuthController.signIn`)  
**Environment:** Production `tours.zettaz.com` (also affects any deploy using RLS runtime role)

## Symptom

- `POST /api/session` returned **401**.
- UI message: *Please verify your email address before signing in…*
- Database showed `staff_users.email_verified_at` **IS NOT NULL** for the same email.
- Password reset and `TRUNCATE auth_rate_limits` alone did not clear that message.

Related console noise (separate):

- React **#418** hydration mismatch after `/?welcome=1` (welcome banner used `typeof window` during render). Fixed by client-only welcome state.
- Session cookie now sets `Secure` when `WEB_ORIGIN` is `https://…`.

## Root cause

Public `POST /auth/v1/sign-in` runs as `zettaz_runtime` **without** `app.actor` / `app.tenant`.

After `staff_login_identity` (SECURITY DEFINER) returned a valid password match, sign-in did:

```sql
SELECT email_verified_at FROM staff_users WHERE id = $1
```

`staff_users` RLS only allows the row when `app.actor` matches (or platform). That SELECT returned **zero rows**, so the API treated verification as missing and always threw the verify-email 401 — even for verified owners.

Password could be correct the whole time; the verify gate was wrong.

## Resolution

1. Migration **061** recreates `staff_login_identity(text)` to return  
   `(actor_id, password_hash, email_verified_at)`.
2. `apps/api/src/auth.ts` uses `identity.email_verified_at` from that function; it no longer SELECTs `staff_users` during public sign-in.
3. Deploy: `git pull` → `npm run build` → `npm run db:migrate:prod` → `pm2 restart tours-api --update-env`.

## Will it repeat?

- **This exact bug:** No, once migration 061 is applied and the API binary includes the auth change. Reverting 061 or reintroducing a direct `staff_users` read on the public sign-in path would bring it back.
- **Real verify-email blocks:** Still expected when `email_verified_at` is null (signup before link click / SMTP failure). That is correct behavior.
- **Wrong password / lockout:** Still 401 “Email or password is incorrect.” Five failures lock the identity hash for 15 minutes (`auth_rate_limits`).
- **Into-tenant demo seed:** Keeps the existing owner email/password; it does not create `demo.owner@…`. Use the tenant owner account (e.g. production owner `cloudadmin@zettaz.com`).

## Ops notes

- Inspect users with **postgres** or `ADMIN_DATABASE_URL` (owner). `DATABASE_URL` (runtime) cannot list `staff_users` without actor context.
- Force-verify only when appropriate:  
  `UPDATE staff_users SET email_verified_at = NOW() WHERE email = '…' AND email_verified_at IS NULL;`
- Reset password via `upsert_user_credentials` + `hashPassword` from `dist/apps/api/scripts/sessions.js` using **ADMIN_DATABASE_URL**.
- Do not paste SMTP or DB passwords into shared terminal logs.

## Related

- Identity model: [../FEATURES/identity-access.md](../FEATURES/identity-access.md)
- Demo seed into existing tenant: [../HANDOFF/demo-tenant-export.md](../HANDOFF/demo-tenant-export.md)
- Web session proxy / origin: [../DECISIONS/010-tenant-web-workspace.md](../DECISIONS/010-tenant-web-workspace.md)
