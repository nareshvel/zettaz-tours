# Subscription polish — implementation evidence

**Date:** 11 September 2026 · **Updated:** 14 September 2026  
**Status:** Partial — responsive plan grid + profile embedding done; billing-cycle / grace messaging polish still open; owner visual acceptance outstanding  
**Next:** [../HANDOFF/agent-current-sprint.md](../HANDOFF/agent-current-sprint.md) Sprint 1 item 2 — finish messaging in `apps/web/components/subscription.tsx`.

## Changes completed

- Subscription UI lives under **My profile → Subscription** for `role === owner` only (`/profile/subscription`; legacy `/subscription` redirects). Embedded in the account shell (`subscription-embedded`), not the main Administration aside.
- Plan comparison grid uses CSS class `.subscription-plan-grid` (inline `repeat(4, …)` removed so responsive rules apply).
- Breakpoints: **4 columns** desktop → **2** ≤1100px → **1** ≤640px (full-width cards on phone).
- Existing plan comparison, current-plan bar, monthly/yearly toggle, Stripe portal / checkout entry points, and status banners remain; APIs unchanged in this slice.

## Still open for row 17

- Deeper polish of billing-cycle copy and failed-payment / grace messaging across phone/tablet/desktop.
- Owner visual pass of plan cards, current-plan bar, and manage-billing affordances inside the profile shell.

## Owner acceptance still needed

- Phone: plans stack as readable full-width cards; toggle and current-plan bar wrap without horizontal scroll.
- Tablet: two-column plan grid remains usable inside the stacked profile shell.
- Desktop: four-column comparison beside the identity rail.
- Confirm non-owners cannot reach Subscription via aside or profile nav.
