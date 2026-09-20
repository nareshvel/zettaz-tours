# Tenant settings polish — implementation evidence

**Date:** 11 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Changes

- Heading eyebrow and clearer policy copy; aside shows timezone / reporting currency / locale plus booking currency, date format, and hold window facts.
- Settings section nav syncs to `?tab=` (deep-link / refresh safe); active chip scrolls into view on phone.
- Phone/tablet nav uses short labels; horizontal chip strip retained.
- Save actions for profile, commercial/localization, and document storage use sticky mobile `FormActions`.
- Security support grants: approve / reject / revoke use in-app `ConfirmDialog` with required reason (no `window.prompt`); phone grant cards.
- **Follow-up 11 September 2026:**
  - Shared ISO country list in `packages/shared/src/countries.ts` (web: `@/lib/countries`); General & branding Country is a dropdown.
  - Localization explains why booking / collection / reporting currencies are read-only (Track A same-currency; FX out of scope).
  - Taxes & commercial explains the rate is applied exclusively on new-hold subtotals; inclusive pricing is not modeled.
  - Desktop aside meta/facts type slightly smaller; mobile/tablet tab-to-content spacing tightened.
- **Follow-up 19 September 2026 (3):** Pickup locations search and **Add location** share one toolbar row.
  - Payment integrations is an honest Track A status (cash/partner live, Connect not a toggle, Terminal deferred) with a link to Finance → Partners.
  - Taxes: collection methods / booking sources use the same card heading.
  - Printers: document storage heading matches other settings cards.
  - Finance Partners: empty state uses `Empty`; list rows no longer use inline layout styles.
- **Follow-up 19 September 2026 (4):** Localization **Currency roles** use the shared ISO list (`CURRENCIES`) with labels from `Intl.DisplayNames`. Copy states guest balances are not auto-converted and expense FX is only the rate on that line.
  - Booking integrations: channel search, `Empty` states for mapping / inbox / import, tab buttons use `view-tab-link`, inbound and import timestamps use tenant `dateTime` when Settings passes `session`.
- **Follow-up 19 September 2026 (5):** Guest stays Search and **Add vessel / Add property** share one toolbar row (same pattern as pickup locations / staff).
  - Taxes: hold duration is edited in minutes (30–1800 seconds stored).
  - Security: support-grant expiry uses tenant `dateTime`.
  - Typecheck: `apps/web` `tsc --noEmit` clean. Authenticated click-through was not available (unsigned marketing home).

## Owner acceptance still needed

- Jump between tabs on phone; confirm short labels, sticky saves, and reduced tab-to-content gap.
- Confirm country dropdown and locked currency / tax copy read correctly.
- Open `/settings?tab=waivers` and `/settings?tab=security` directly.
- Approve or revoke a support grant with a reason when a request exists.
- Save general profile and commercial settings without losing other tabs’ draft values unexpectedly.
- Confirm an existing logo can be replaced by clicking the image (helper text under the dropzone).

## Follow-up 20 September 2026 — Payment integrations

- Settings → Payment integrations is a stacked layout: Zettaz Pay as the primary card (status pill, fee / Subscription / card-checkout facts), then two live method cards (manual/cash, partner).
- Stripe Terminal is a footnote, not a banner above the methods.
- While the Zettaz Pay Stripe **platform** account is not activated, the page shows **Waiting on Stripe** and does not offer **Set up Zettaz Pay** (API `platformReady`). Stripe Dashboard activation URLs are not shown as errors.
- Collect-balance on a booking still stays hidden until `readyForCheckout`.

## Follow-up 20 September 2026 — Partners in Operations

- Settings nav **Partners** sits under **Operations** (after Waiver templates), not Platform.
- The Partners tab renders outside the tenant-config `<form>` so Add/Edit `FormDialog` is not nested (same pattern as Stays / Pickups / Channels).
