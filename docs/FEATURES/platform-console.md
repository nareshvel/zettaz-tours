# Platform console

**Status:** Track A engineering in tree; **paused 22 September 2026** until the owner reopens (visual + production migrate **095**–**097**). Do not add Track B billing admin while paused.  
**Surface:** Dedicated shell after platform sign-in (`apps/web/components/platform.tsx`)  
**Identity:** Fourth principal — `platform_users` / `platform_sessions`, not tenant staff. See [identity-access.md](identity-access.md) and [ADR 005](../DECISIONS/005-identity-partitions.md).

## Who it is for

Zettaz operators who provision tenant workspaces, watch SaaS subscription health, and diagnose service exceptions. It is not the operator (tenant) workspace. Guest names, waiver evidence, booking payloads, and booking-level money are not listed. Time-limited **support access** is the only path into a tenant’s operational records.

## Sign-in

Same email/password page as staff. Staff lookup runs first. Seeded account: `systemadmin@zettaz.com`. Password from `PLATFORM_ADMIN_PASSWORD` or local `LOCAL_DEFAULT_PASSWORD`. Production: migrate **095** then `npm run platform:admin:prod`.

## What each page is for

The layout reuses the tenant workspace language: `Heading`, briefing tiles, decision queue, `panel` + table/cards, `Status` pills, staff toolbar (search + filter), and the account profile panel.

| Route | Job | Then do |
| --- | --- | --- |
| `/` Overview | Same idea as the tenant shift briefing: what is running, what breaks if nobody acts. Counts workspaces, trials, paid, past due, support waiting, and **connector inbox** exceptions. The transactional outbox is not an incident. | Provision a tenant, open Support, open a tenant, or open Health |
| `/tenants` | Operator directory. Search, filter by plan status, provision. | Open a record |
| `/tenants/:id` | One workspace: plan, included features/limits, usage, owner contact, setup completeness, grants. Local trial: extend 7/14/30 days, suspend, resume. Stripe-billed tenants stay on the tenant Subscription page. | Open Support to request a grant, or use an approved grant |
| `/support` | Request and list grants. Tenant detail can deep-link `?tenant=` to pre-select. Using an approved grant parks this console | Owner approves in Tenant settings → Security & support access |
| `/health` | Connector inbox only (quarantined / retry pending / dead letter). No payloads, no outbox queue | Open the tenant, then use a grant to read the inbox |
| `/activity` | Who provisioned or decided support access | Open the tenant |
| `/account` | This principal (name, email, fixed permissions). Sign out | MFA / extra users later |

Using an approved grant parks the platform cookie as `zettaz_platform_session` and replaces `zettaz_session` with the support token. **Return to platform** on the tenant support banner POSTs `{ resumePlatform: true }`. Sign-out revokes both cookies.

## Subscription (honest Track A)

The console **shows** trial / paid / past due / cancelled / suspended, plus the plan feature list and limits. For workspaces **without** a Stripe Billing subscription id, platform can extend a local trial (7/14/30 days), suspend, or resume. Paid Stripe Billing tenants are refused so Zettaz Billing and Zettaz Pay stay unmixed; those operators change plan on the tenant Subscription page. Platform billing administration (take a card, change Stripe plan from this console) is Track B.

## APIs

All require a platform session. Staff tokens receive 403.

- `GET /platform/v1/overview`
- `GET /platform/v1/tenants` · `GET /platform/v1/tenants/{id}` · `POST /platform/v1/tenants`
- `POST /platform/v1/tenants/{id}/subscription` (`extend_trial` | `suspend` | `resume`)
- `GET /platform/v1/support-access` · `POST /platform/v1/support-access/requests` · `POST /platform/v1/support-access/{id}/use`
- `GET /platform/v1/health`
- `GET /platform/v1/activity`

Cross-tenant reads use SECURITY DEFINER functions in migrations **096** and **097** and check `app.platform`. Health no longer counts undelivered `outbox_events`.

## Out of scope (Track B / later)

Plans & subscriptions administration, SaaS revenue reports, self-service onboarding controls, Zettaz Pay merchant operations, platform MFA, extra platform users, mixing Stripe Billing with Connect.

## Evidence

[platform-console-evidence.md](../TESTING/platform-console-evidence.md)
