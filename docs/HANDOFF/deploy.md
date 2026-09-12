# Production deploy (VPS)

**Updated:** 12 September 2026

App root on the server: `/var/www/zettaz-tours`  
PM2 apps: `tours-api`, `tours-web`  
Public site: `https://tours.zettaz.com`

You push to GitHub from your laptop. On the VPS you pull and build with the scripts below (checked into the repo root).

## Scripts (run on the VPS)

```sh
cd /var/www/zettaz-tours
git pull origin main   # optional; scripts also pull
chmod +x deploy.sh deploy-quick.sh   # once after first pull
```

| Script | When to use |
| --- | --- |
| `./deploy.sh` | **Full** — pull, `npm install`, API build, web build, `db:migrate:prod`, restart both with `--update-env` |
| `./deploy-quick.sh` | **Quick** — pull, API + web build, restart both. Skips install and migrations |
| `./deploy-rsync-from-local.sh` | Optional laptop path: rsync pre-built `dist` / `.next` (prefer the two scripts above) |

Optional branch: `./deploy.sh main` or `./deploy-quick.sh feature-branch`.

Override PM2 names if needed: `PM2_API_APP=… PM2_WEB_APP=… ./deploy.sh`.

## Typical workflow

1. Commit and push from your machine.
2. SSH to the VPS.
3. Full (deps or new migrations):

```sh
cd /var/www/zettaz-tours && ./deploy.sh
```

4. Code-only (no lockfile / migration changes):

```sh
cd /var/www/zettaz-tours && ./deploy-quick.sh
```

## Requirements on the server

- `.env.production` present (never commit secrets).
- `git` remote can fetch `origin`.
- Node/npm and PM2 already configured for `tours-api` / `tours-web`.
- Scripts reset a dirty `apps/web/next-env.d.ts` so `git pull --ff-only` is not blocked.

## After deploy

- Confirm `pm2 status` shows both apps online.
- Smoke sign-in at https://tours.zettaz.com/login.
- If login mis-reports email verification, see [../ISSUES_FIXES/signin-email-verified-rls.md](../ISSUES_FIXES/signin-email-verified-rls.md).

Gitignored seed SQL still needs a manual `scp` — see [demo-tenant-export.md](demo-tenant-export.md).
