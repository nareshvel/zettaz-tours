# Crew mobile store-readiness evidence

**Date:** 17 September 2026  
**Scope:** Connected 1.0 packaging for TestFlight / Play Internal. Offline, Pay, and GPS are out of scope.

## Implemented

- Public crew API façade `POST/GET /api/mobile/<nest-path>` on the Next.js workspace. Allowlist is `apps/web/lib/mobile-api.ts` (sign-in, sign-out, password-recovery request, today, check-in, QR resolve, trip events, passenger waiver). Bearer token only; mutations do not require a browser Origin.
- Production EAS env points at `https://tours.zettaz.com/api/mobile`. Local `expo start` still uses loopback unless `EXPO_PUBLIC_API_BASE_URL` is set.
- App version `1.0.0`, bundle/package `com.zettaz.crew`, icons/splash/feature graphic generated from `apps/web/public/brand/app-icon.svg` (1024 icon flattened, no alpha).
- Sign-in: password reset request, Privacy / Terms / Support links, version label, staff-only copy.
- Assigned-trip list: pull-to-refresh, network failure copy, 401 clears the secure session.
- `eas.json` preview (internal APK) and production (auto-increment) profiles. Submit Android track is internal/draft.

## Verification this session

- `npm run mobile:typecheck` — passed
- `npm run web:typecheck` — passed
- `npx expo export --platform android` — passed, 591 modules, 1.5 MB Hermes bundle
- Icon metadata: `icon.png` 1024×1024, no alpha; `feature-graphic.png` 1024×500
- Allowlist assertions: today/sign-in/waiver allowed; admin/register/finance rejected

## Still owner / device work

- **App Store 5.1.2(i) (21 Sep):** update App Privacy so Tracking is No; Resolution Center reply. Do not add ATT. [crew-app-store-5.1.2-tracking.md](../ISSUES_FIXES/crew-app-store-5.1.2-tracking.md)
- App Review demo staff account with a same-day assignment
- Store screenshots from those devices
- Unlisted / internal distribution choice in the consoles

See [crew mobile store publish](../HANDOFF/crew-mobile-store-publish.md).
