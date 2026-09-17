# Print/PDF and connected crew evidence

**Date:** 10 September 2026 · **Environment:** persistent local PostgreSQL, Node 22.14.0, Expo SDK 56.

## PDF output

- The API and optimized Next.js builds pass.
- A print-job request against the running persistent workspace produced an authenticated `application/pdf` response with a valid `%PDF-1.4` header.
- The API integration test covers PDF content type/signature and rejects a second tenant's attempt to download the job.
- Manifest and pickup-list screens provide separate native-print and PDF-download actions. The gateway forwards binary bytes and `Content-Disposition` without exposing the bearer token to browser code.
- PDFs are derived from current canonical operational data and generated on demand. They are not retained artifacts and do not prove physical printer delivery.

The complete PostgreSQL test suite applies migrations 001–051 to a fresh isolated database and passes all 40 tests, including the cross-tenant PDF, payment-correction, account-recovery, connector-registry, integration-review, and import-reconciliation assertions. The persistent local database also reports zero pending migrations.

## Connected crew mobile

- `npm run mobile:typecheck` passes under strict TypeScript.
- `npx expo export --platform android` produces the Android Hermes bundle.
- The app stores the opaque session token in Expo SecureStore and does not store roster data offline.
- Navigation is restricted to Today, assigned trip, minimized guest roster, passenger check-in and trip-run events.
- QR capture uses Expo Camera, retains no image, resolves an opaque expiring token and relies on the API's assignment predicate before exposing the passenger.
- The existing PostgreSQL/API integration test proves assigned-trip isolation, unassigned-trip denial, permission denial and idempotent trip events.

Physical-device iOS/Android interaction, accessibility, and unreliable-network behavior remain release acceptance work; store packaging for connected 1.0 is tracked in [crew-mobile-store-readiness-evidence.md](crew-mobile-store-readiness-evidence.md). Encrypted offline storage is not enabled because the privacy, device-expiry, retention and conflict policies remain unresolved.
