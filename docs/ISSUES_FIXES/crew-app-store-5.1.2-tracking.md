# Zettaz Crew — App Review 5.1.2(i) (tracking / ATT)

**Date:** 22 September 2026  
**Submission:** `7482197c-f3e5-420d-8dee-02986d876523`  
**Reviewed:** 21 September 2026 · iPhone 17 Pro Max · **1.0 (2)**  
**Guideline:** 5.1.2(i) Legal — Privacy — Data Use and Sharing

Apple rejected the binary because App Store Connect said the app **tracks** users (Device ID, Coarse Location, User ID, Precise Location) but the app never shows App Tracking Transparency.

## Decision (do not add ATT)

Zettaz Crew **does not track** in Apple’s sense: it does not link app data with third-party data for advertising, and it does not share data with a data broker.

GPS / live location is gated Track B ([crew-gps-later.md](../STRATEGY/crew-gps-later.md)). There is no `expo-location`, no advertising identifier, no analytics SDK, no ATT prompt. Pickup “location” on a booking is a catalog hotel/stop name, not device GPS.

A staff **user id** and an **offline device UUID** (SecureStore) exist for operations. That is product functionality, not tracking.

**Correct fix:** Apple’s first option — update **App Privacy** in App Store Connect (Account Holder / Admin). Do **not** add `AppTrackingTransparency` unless product later sells ads or shares identifiers with ad networks.

A new IPA is **not required** for the questionnaire change. The next production EAS build still ships `NSPrivacyTracking: false` in `apps/mobile/app.config.ts` so the binary and the listing stay aligned.

## App Store Connect — App Privacy answers

App Store Connect → Zettaz Crew → **App Privacy**.

1. **Does this app use data for tracking purposes as defined under the App Store Review Guidelines?**  
   **No.**
2. Remove **Used for Tracking** from every data type (especially Device ID, User ID, Precise Location, Coarse Location).
3. **Do not collect** Precise Location or Coarse Location. Those checkboxes should be off.
4. Data that **is** collected, **linked to the staff identity**, **not used for tracking**, purpose **App Functionality**:

| Type | Why |
| --- | --- |
| Email | Staff sign-in |
| Name | Roster / waiver signer |
| User ID | Staff / tenant identifiers |
| Device ID | Offline device enrollment UUID (not IDFA) |
| Other user content | Waiver signature strokes |
| Payment info (optional) | Manual cash/method amounts at boarding — no cards |

Advertising Data / Advertising ID: **No**.

Save. If the UI will not let you clear Tracking, reply in Resolution Center (paste below) and ask App Review to re-check after the Account Holder updates the form.

## Reply to paste in App Store Connect (Resolution Center)

```
Hello App Review,

Zettaz Crew does not track users under guideline 5.1.2.

We do not link data from the app with third-party data for advertising, and we do not share data with a data broker. There is no advertising identifier, no analytics or ads SDK, and no App Tracking Transparency prompt because tracking is not used.

Staff sign in with a work email. The app shows assigned trip rosters, scans check-in QR codes (no photo saved), records waiver signatures, and optionally records boarding cash amounts. An offline device UUID is stored in the Keychain for field sync. Pickup “location” is a named stop from the operator catalog, not GPS. Precise and coarse location are not collected. Live GPS is not in this binary.

The App Privacy questionnaire incorrectly marked Device ID, User ID, Precise Location, and Coarse Location as used for tracking. We have updated App Privacy so tracking is No, location types are not collected, and remaining data types are App Functionality only (not tracking).

Please re-review. We can provide a demo staff login in the review notes if needed.

Thank you,
Naresh
Zettaz
```

## After the labels are saved

1. Confirm App Privacy no longer lists those types under Tracking.
2. Send the Resolution Center reply (same thread as the rejection).
3. Resubmit **the same build** unless Apple asks for a new binary.
4. Next EAS production build already includes `NSPrivacyTracking: false` and collected-data types with `NSPrivacyCollectedDataTypeTracking: false`.

## Not this rejection

Do not start ATT, IDFA, SKAdNetwork, or Crew GPS to “satisfy” 5.1.2. That would be the wrong product and a worse privacy story.
