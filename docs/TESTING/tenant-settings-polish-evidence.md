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

## Owner acceptance still needed

- Jump between tabs on phone; confirm short labels, sticky saves, and reduced tab-to-content gap.
- Confirm country dropdown and locked currency / tax copy read correctly.
- Open `/settings?tab=waivers` and `/settings?tab=security` directly.
- Approve or revoke a support grant with a reason when a request exists.
- Save general profile and commercial settings without losing other tabs’ draft values unexpectedly.
- Confirm an existing logo can be replaced by clicking the image (helper text under the dropzone).
