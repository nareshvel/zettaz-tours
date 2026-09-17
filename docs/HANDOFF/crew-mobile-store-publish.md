# Crew mobile store publish

**Updated:** 17 September 2026  
**Audience:** owner + agent preparing TestFlight / Play Internal, then unlisted production

Zettaz Crew is a **staff-only** connected check-in app. Do not list it as a consumer booking app. Preferred production shape: Apple **Unlisted** (or Custom App) + Google Play **Internal / Closed** testing.

Connected 1.0 is in scope for the store listing. Remaining Crew increments (field pickups, Pay, tablet, then offline) are sequenced in [crew-app-delivery.md](../STRATEGY/crew-app-delivery.md). Encrypted offline, crew-mobile Pay, GPS, and retained waiver PDFs stay deferred until that plan’s later phases.

## What engineering already did

- Production phones call `https://tours.zettaz.com/api/mobile/…`, an allowlisted Next.js proxy to Nest (Bearer token, no cookie CSRF). Deploy the web app before testers open a store build.
- EAS profiles: `preview` (internal APK / device build) and `production`.
- Icons, splash, Play feature graphic, privacy/terms/support links, password reset, pull-to-refresh, and honest offline errors.
- Native IDs: iOS/Android `com.zettaz.crew`, version `1.0.0`.

## Owner accounts (cannot be done in git)

1. [Expo](https://expo.dev) account — **done 17 Sep:** logged in as `zettazglobal`, project `@zettazglobal/zettaz-crew`, id `06c5ee72-752e-4e24-8519-a148f57b84d3` in `app.config.ts` (`eas init` cannot write a dynamic config).
2. Apple Developer Program ($99/year) → App Store Connect app **Zettaz Crew**, bundle `com.zettaz.crew`.
3. Google Play Console ($25 one-time) → app **Zettaz Crew**, package `com.zettaz.crew`.
4. Create a **reviewer demo** staff user on production with `crew.trip.read` / `checkin.write`, assigned to a departure on the review day. Put the email/password only in App Review notes — not in git.

## Build

After a web deploy that includes `/api/mobile`:

```sh
cd apps/mobile
npx eas-cli build --profile preview --platform all
```

Install the preview on a physical iPhone and Android. Then:

```sh
npx eas-cli build --profile production --platform all
npx eas-cli submit --profile production --platform android
npx eas-cli submit --profile production --platform ios
```

iOS submit needs an App Store Connect app record. Android submit uses the `internal` track as a draft until you promote it.

## Listing copy

| Field | Value |
| --- | --- |
| Name | Zettaz Crew |
| Subtitle | Staff check-in for assigned trips |
| Category | Business |
| Age | 4+ |
| Privacy | https://tours.zettaz.com/privacy |
| Terms | https://tours.zettaz.com/terms |
| Support | mailto:support@zettaz.com |
| Marketing URL | https://tours.zettaz.com |

**Short description (Play, 80 chars):**  
Staff check-in, waivers, and trip status for Zettaz Tours operators.

**Full description:**

Zettaz Crew is the field app for tour and charter operators who use Zettaz Tours & Charters.

Assigned crew can sign in with their work account, open today’s trips, scan passenger check-in codes, collect digital waivers, record trip events, and collect remaining guest cash at boarding when allowed. Tablet-width devices can open today’s Day Board and walk-up booking when the staff role allows. After the operator prepares the device for offline use, assigned work can continue without a network and syncs when connected. The app shows only the roster for trips you are assigned to. It is not a public booking app.

A sign-in is required. Ask your operator for a staff account. Guests book through their operator’s existing website or desk.

**Review notes (paste into App Store Connect / Play Console):**

This is a staff-only operations app for tenants of Zettaz Tours & Charters. It is not intended for public App Store browsing. Please use unlisted / internal distribution.

Demo account: \<email\>  
Demo password: \<password\>  
The account is a crew/guide role with an assigned departure on the review date. After sign-in, open the trip, scan is optional, and passenger rows open the waiver screen.

No photos are stored. The camera is used only to read an opaque check-in QR code. Session tokens are stored in the OS keychain / Keystore.

## Data safety / privacy nutrition (connected 1.0)

| Data | Collected | Linked to identity | Purpose |
| --- | --- | --- | --- |
| Email | Yes (sign-in) | Yes | Account |
| Name (guest/signer) | Yes (roster + waiver) | Yes | Operations |
| Signatures (stroke vectors) | Yes | Yes | Waiver evidence |
| Photos / camera roll | No | — | Camera preview only; no image saved |
| Precise location | No | — | — |
| Payment info | Manual cash/method amounts only; no card numbers | Yes | Boarding collection |
| Device PIN / biometrics | Unlock only; not sent to server | No | Offline lock |
| Advertising ID | No | — | — |

Encryption in transit: HTTPS. Encryption at rest: OS secure storage for the session token. `ITSAppUsesNonExemptEncryption` is false (HTTPS + OS keychain only).

## Screenshots still needed

Capture on device after the preview build (do not invent marketing screens):

- iPhone 6.7" and 6.1": sign-in, today list, trip guests, scanner, waiver
- iPad 13" if you keep `supportsTablet`
- Android phone: same five screens
- Play feature graphic is already `apps/mobile/store/feature-graphic.png`

## Not part of this binary

GPS/ETAs, push notifications, card-present / Stripe Terminal, guest kiosk lock, white-label second app. Google Drive waiver copies stay server-side and flagged off.
