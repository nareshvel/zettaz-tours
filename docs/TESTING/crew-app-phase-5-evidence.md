# Crew app Phase 5.1 — guest kiosk lock

**Date:** 19 September 2026  
**Status:** Engineering for **kiosk lock** only. GPS, card-present, push, white-label, and a consumer app stay gated.  
**Owner reopen:** 19 September 2026 (“commit and proceed to phase 5”). Launch contract still defers GPS, Terminal, white-label, and a native consumer app until their evidence exists.

## What shipped

- Tablet (≥700px) dock staff with `checkin.write` plus Day Board or walk-up booking (or owner) can open **Guest kiosk** from **My profile** or **Day Board**.
- iPhone shows why kiosk is hidden (iPad dock mode). Kiosk copy mentions iOS Guided Access on a real iPad.
- Requires the existing device **unlock PIN** first. Kiosk is scan + waiver only: no Day Board, walk-up, Pay, roster, or sign-out.
- Requires the existing device **unlock PIN** first. Kiosk is scan + waiver only: no Day Board, walk-up, Pay, roster, or sign-out.
- Staff exit is **PIN only** (not biometrics). Android back stays inside kiosk until PIN.
- Flag persisted in SecureStore so a guest cannot leave by backgrounding the app.
- `npm run mobile:typecheck` clean.

## Still gated (do not implement without the listed evidence)

| Item | Gate |
| --- | --- |
| GPS / live ETAs | Privacy + legal write-up |
| Card-present / Stripe Terminal | Merchant eligibility |
| Push notifications | Product decision |
| Offline hardening at scale | After first season |
| White-label second binary | E16 |
| Native consumer app | Track B checkout |

## Owner device pass

- iPad (or wide Android): set PIN, Guest kiosk, scan a check-in code, sign a waiver, Staff exit with PIN.
- Confirm a phone cannot start kiosk.
- Confirm a guide without Day Board / bookings.write cannot start kiosk.
- New EAS preview after this tree is on a device.
