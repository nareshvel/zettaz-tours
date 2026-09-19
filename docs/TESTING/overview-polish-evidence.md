# Overview polish — implementation evidence

**Date:** 19 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Changes

- **My trips** is hidden on the web for anyone who already has Day Board (`manifest.read`), including the demo owner. Field roles (guide / driver / crew / captain) still land on `/crew`. Opening `/crew` as owner redirects to Overview.
- Remaining tenant setup items (pickup locations, waiver, logo, team, catalog) appear on Overview when the signed-in role can write config, and disappear when the checklist is complete.
- Next-departure countdown opens that trip’s manifest. The boarded tile uses attention styling while boarding is still open.

## Automated evidence

- `npm run typecheck --workspace=@zettaz/web` after this pass.

## Owner acceptance still needed

- Confirm My trips is absent for owner, present for a guide web login.
- Confirm Finish setup only lists items that are actually missing.
- Confirm next-departure and boarded tiles behave on phone and desktop.
