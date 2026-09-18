# Crew field-pass UI — 17 September 2026

**Status:** Implemented; needs new EAS preview and owner device pass  
**Does not start Phase 5.**

## Owner findings (preview binary)

1. Role × permission matrix was not documented for the owner to edit.
2. Today list had no product cover and little role-specific framing.
3. Scan lived only in the header; no persistent tabs.
4. Preparing / Boarding / Departed / Completed plus Start trip stacked on the trip card. Arrived looked like a no-op because unsigned waivers are stored as `waiver_pending`, and the Arrived control sat inside the same press target as “open waiver.”
5. Stay type was five chips; the signature pad lived inside a ScrollView so the page moved while signing.
6. Prepare offline / Sync now were manual primary actions even though devices are usually online.

## Changes

- Master matrix: [crew-roles-and-permissions.md](../FEATURES/operations/crew-roles-and-permissions.md). Guide/driver/crew/captain assignment gates now share `isFieldCrewRole`.
- `GET /crew/v1/today` and Day Board include `cover_path`. Today cards show the catalog cover (or a monogram) plus a trips/guests/to-board/balance strip and role-specific hint copy.
- Footer tabs: **Today**, **Scan** (if `checkin.write`), **Board** (tablet + `manifest.read`), **Profile**.
- Trip status is one control that opens a sheet. Start trip remains the leave/no-show confirmation.
- Guest name opens the waiver. The primary action is **Sign waiver** until evidence exists, then Mark arrived / Clear to board / Board. No-show is a sibling control, not nested inside the name press target. Check-in states use human labels (`Waiver needed`, not `waiver_pending`).
- Signature pad is docked below the scroll region and draws a continuous stroke (not a dotted trail). Cover images load without a workspace cookie (`/uploads/product-covers/…` is public for allowlisted files).
- While online, a successful Today load enrolls the device if needed and refreshes the 24h snapshot. Returning to the foreground reloads. Profile shows last-synced status; PIN is optional lock, not a download button.

## Agent checks

- `npm run mobile:typecheck`
- `npx tsc -p tsconfig.json --noEmit` (after API cover_path / field-role edits)

## Owner after deploy

1. VPS `./deploy.sh` (no new numbered migration).
2. New EAS **preview**.
3. Sign out/in. Confirm covers, tabs, status sheet, Sign waiver → signature without scroll, Arrived after waiver, and Profile last-synced without tapping Sync now.
4. Airplane-mode cycle (4.8) still outstanding.
