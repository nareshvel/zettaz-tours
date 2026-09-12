# Responsive design baseline evidence

**Date:** 10 September 2026  
**Scope:** Shared web controls, sign-in, and global authenticated shell

## Implemented

- Added shared visual tokens for surfaces, focus, danger, soft backgrounds, page gutter, content width, and a 44px control height.
- Standardized button and icon-button touch targets, control focus treatment, field required/error presentation, responsive form actions, section headings, mobile sticky actions, action wrapping, and reduced-motion scroll behavior.
- Added reusable `SectionHeading` and `FormActions` components and extended `Field` with required/error states.
- Corrected sign-in grid intrinsic sizing and added explicit compact-screen gutters.
- Made the aside navigation independently scrollable while keeping account controls pinned, added role-filtered crew navigation, 44px menu/account targets, current-page semantics, Escape dismissal, and mobile page-scroll locking.

## Verification

- `npm run web:typecheck`: passed.
- `npm run web:build`: passed with all Next.js routes compiled and TypeScript checked.
- `git diff --check`: passed for the changed implementation and planning files.
- Authenticated desktop DOM inspection at 1280×720: navigation, main landmark, headings, actions, tables, and links were present; document horizontal overflow was false.
- Visual captures reviewed at compact, tablet, and desktop dimensions. The compact sign-in view has 16px page gutters, readable labels/help text, full-width 44px controls, and no application overflow. Chrome on macOS enforces a roughly 500px minimum headless layout viewport even when a 440px screenshot crop is requested; the 500px capture was used to distinguish that harness crop from application overflow. The CSS compact rule uses `calc(100vw - 32px)` and applies through 550px.
- Authenticated shell checks passed for Owner and Guide permission variants. At 1280×720 the navigation region overflowed independently and the account footer remained fully visible. At 440×956 the drawer opened, locked page scrolling, had no horizontal overflow, exposed 44×44 account controls, and closed with Escape. Guide sign-in redirected to `/crew` and displayed only **My trips** plus account actions.

Captured local evidence is under `.local/ui-baseline/` and intentionally excluded from source control.

## Boundary

This closes the shared baseline, sign-in, and global shell review. It does not certify the remaining workspace pages. Each later surface in [the UI launch task list](../STRATEGY/ui-waiver-launch-task-list.md) still requires its own phone, tablet, desktop, keyboard, loading, empty, error, long-content, and role-permission review.
