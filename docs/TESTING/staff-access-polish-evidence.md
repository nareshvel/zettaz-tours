# Staff & access polish — implementation evidence

**Date:** 11 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Changes

- Staff page titled **Staff & access** with metrics (active / revoked / assignable roles).
- Shared Staff ↔ Roles tab bar; Invite / Create role on the action bar (Catalog pattern).
- Invite staff and create role open in `FormDialog`; revoke access uses `ConfirmDialog` (no `window.confirm`).
- Invitation token panel includes copy + done; shown once after invite.
- Phone: member and role tables swap to cards; icon-first primary actions.
- Roles list shows permission count plus summary; create-role permissions scroll inside the modal.
- Member PATCH / invitation / role create API contracts unchanged.

## Owner acceptance still needed

- Invite a staff member, copy the activation token, activate at `/activate`.
- Revoke and restore a non-owner member with the confirm dialog.
- Create a custom role with grouped permissions on phone and desktop.
- Confirm Staff ↔ Roles tab navigation stays clear with the aside open on tablet.
