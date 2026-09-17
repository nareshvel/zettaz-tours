# Profile polish — implementation evidence

**Date:** 11 September 2026 · **Follow-up:** 17 September 2026  
**Status:** Implemented (including responsive flush follow-up and 17 Sep UX pass); owner visual acceptance still outstanding

## Changes

- Account shell matches the profile reference layout: left identity card (hero, avatar, role badge) + sub-nav; right content pane.
- Tabs: **Profile**, **Security**, and **Subscription** (tenant owner only). Business / Stores / Notifications from the reference are excluded as out of scope.
- Profile tab: personal information + current workspace link in one panel with a thin divider.
- Security tab: change password, deferred MFA, and active sessions in one panel with thin dividers; Sign out everywhere uses `ConfirmDialog`.
- Subscription removed from the main Administration aside and account-menu path for non-owners; owners open `/profile/subscription` (legacy `/subscription` redirects there).
- Shared shell: slightly tighter left gap between aside and page content.
- Auth/profile APIs unchanged.

## Responsive follow-up (11 September 2026)

- Stacked account layout through ≤1366px (hero + horizontal chips + content); two-column sticky rail only ≥1367px.
- On the stacked layout, rail and content join flush: grid `gap: 0`, zeroed `.panel` `margin-bottom` on the rail, shared corners / removed double top border.
- Page heading description (`.subtitle`) no longer leaves a browser-default gap under “My profile”.

## UX follow-up (17 September 2026)

- Heading no longer promises “preferences” (none exist). Copy names name, sign-in email, and password.
- Metrics strip: role, workspace, sign-in email, phone on file / not set.
- Saving the profile reloads the workspace session so the identity rail and avatar letter update without a full refresh.
- Mismatched new passwords use an error `Notice`, not the success style.
- MFA pill reads **Not available yet** (not “Disabled”). Copy says this is deferred, not a broken switch.
- Phone field placeholder **Optional**. Password copy: this browser stays signed in after a change.

## Owner acceptance still needed

- Walk Profile / Security tabs on phone (horizontal chip nav) and desktop (sticky rail).
- Confirm Subscription appears only for `role === owner` and is absent from the main aside.
- Edit name/email/phone and confirm the rail and metrics update after save.
- Enter mismatched new passwords and confirm the notice is an error.
- Change password, cancel/confirm Sign out everywhere.
- Confirm MFA reads as deferred, not broken.
- Confirm no whitespace between identity/tabs strip and content panel on tablet/phone.

## Agent checks (17 September 2026)

- `npm run web:typecheck` passed.
- Browser walkthrough of Profile/Security was not completed here (workspace sign-in could not be automated). Owner visual pass remains the acceptance gate.
