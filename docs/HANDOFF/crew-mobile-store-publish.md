# Crew mobile store publish

**Updated:** 19 September 2026  
**Audience:** owner + agent preparing TestFlight / Play Internal, then unlisted production

Zettaz Crew is a **staff-only** connected check-in app. Do not list it as a consumer booking app. Preferred production shape: Apple **Unlisted** (or Custom App) + Google Play **Internal / Closed** testing.

## Status (19 Sep 2026)

| Track | Status |
| --- | --- |
| Expo | `@zettazglobal/zettaz-crew` · `06c5ee72-752e-4e24-8519-a148f57b84d3` |
| iOS | **Uploaded** 1.0.1 (2) to App Store Connect **6813693098**. Fill listing / Unlisted / review as needed. |
| Android | **Internal testing live** — release **2 (1.0.1)** on `com.zettaz.crew`. Manual AAB (no Play service-account JSON). |
| Preview | Internal APK/IPA: Android `6b84a7dc-…` · iOS `b1a161d9-…` |

Production AAB (versionCode **2**):  
https://expo.dev/accounts/zettazglobal/projects/zettaz-crew/builds/0f243799-d490-47db-9eb0-622e03f8c6dc

Android keystore: EAS **`CJ7CrFnFQD`**. Never generate a new one for `com.zettaz.crew`.

## Org constants (same Zettaz accounts as iRestrack)

| Item | Value |
| --- | --- |
| App name | Zettaz Crew |
| Bundle / package | `com.zettaz.crew` |
| Apple Team | `7688G2MP45` |
| Apple ID | `nareshvelusamy@msn.com` |
| ASC app ID | `6813693098` |
| ASC API key | `5MZ797VJ2A` |
| Play org | **Zettaz** (login often `nareshvelusamy1@gmail.com`) |
| Expo | `zettazglobal` |

## Android — skip `eas submit` (Play JSON missing)

iRestrack never configured Play API upload either. `eas submit --platform android` will keep asking for a Google Service Account file. **Ctrl+C** and upload the AAB by hand.

1. Play Console → org **Zettaz** → **Create app** if **Zettaz Crew** / `com.zettaz.crew` does not exist yet (new package; do not upload into iRestrack).
2. Finish the first-app dashboard items Google blocks on: privacy policy `https://tours.zettaz.com/privacy`, Data safety (table below), content rating, target audience, store listing (copy below + `apps/mobile/store/feature-graphic.png`).
3. **Test and release → Internal testing → Create new release** → upload the AAB from the production build link above (or Expo → download `.aab`).
4. Add testers (your Gmail). Install from the Play Internal link — not the preview APK if you are validating the store binary.
5. After QA, promote Internal → Closed / Production if you want it wider.

Optional later (so `eas submit` works): Play Console → **Users and permissions** / **API access** → create a **Google Cloud service account** with Play Console permission on this app → download JSON → keep it **out of git** → `eas credentials -p android` → set the service-account key. Until then, always manual AAB.

## iOS — after processing

1. [TestFlight](https://appstoreconnect.apple.com/apps/6813693098/testflight/ios) → wait until build **1.0.1 (2)** is **Complete**.
2. Fill App Store listing (copy below). Prefer **Unlisted**.
3. Attach the build → **Add for Review**. Reviewer demo staff user belongs in review notes only.

```sh
cd apps/mobile
eas submit --profile production --platform ios --latest
```

## Owner still needed

- Production reviewer staff user (email/password in review notes, not git)
- Store screenshots from device
- Apple listing: Unlisted + Submit for Review when TestFlight build is Complete
- Airplane-mode drill (Crew 4.8) on a store or preview install
- VPS deploy of local Crew field-pass / booking work if production phones should match this tree

## What engineering already did

- Production phones call `https://tours.zettaz.com/api/mobile/…`, an allowlisted Next.js proxy to Nest (Bearer token, no cookie CSRF).
- EAS `preview` (internal APK) and `production` (AAB / App Store IPA). `eas.json` iOS submit has `ascAppId`.
- Icons, splash, Play feature graphic, privacy/terms/support links.
- Native IDs: iOS/Android `com.zettaz.crew`, marketing version `1.0.1`.

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
| Marketing URL |    |

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
