# Subscription polish — implementation evidence

**Date:** 11 September 2026 · **Updated:** 19 September 2026  
**Status:** Messaging implemented 19 Sep; owner visual acceptance outstanding  
**Surface:** My profile → Subscription (`apps/web/components/subscription.tsx`)

## Changes completed

- Subscription UI lives under **My profile → Subscription** for `role === owner` only (`/profile/subscription`; legacy `/subscription` redirects). Embedded in the account shell (`subscription-embedded`), not the main Administration aside.
- Plan comparison grid uses CSS class `.subscription-plan-grid` (inline `repeat(4, …)` removed so responsive rules apply).
- Breakpoints: **4 columns** desktop → **2** ≤1100px → **1** ≤640px (full-width cards on phone).
- **19 September 2026 — messaging:** Status banners use `.subscription-status-banner` (info / warning / danger) and match stored tenant statuses (`trial` / `trialing`, `past_due`, `cancelled` / `canceled`, `unpaid`, `incomplete`).
  - Trial: charged only after the trial date; owner emails at 7 days and 1 day (existing jobs).
  - Failed invoice: workspace stays up for about **three days**, then the job cancels the row and the tenant is treated as suspended.
  - Cancelled with remaining period: access until `period_ends_at`, then suspended.
  - Cancel-at-period-end: will not renew; Open billing when a Stripe subscription exists.
  - Current-plan bar states monthly vs yearly billing; footer restates grace / suspension.
  - Checkout returns to `/profile/subscription`. Trial-reminder emails use the same path.
  - Billing portal failures use `Notice` instead of `alert()`.
- APIs unchanged. Grace length is the existing job (`past_due` for 3+ days → `canceled`), not a new policy.

## Owner acceptance still needed

- Phone: plans stack as readable full-width cards; toggle and current-plan bar wrap without horizontal scroll. Read trial / past_due / cancelled banners.
- Tablet: two-column plan grid remains usable inside the stacked profile shell.
- Desktop: four-column comparison beside the identity rail.
- Confirm non-owners cannot reach Subscription via aside or profile nav.
- Confirm “Open billing” / Manage billing only when a Stripe subscription id exists.
