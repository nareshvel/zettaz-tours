# Crew passenger waiver online evidence

**Date:** 10 September 2026  
**Scope:** Connected API and Expo implementation; offline and retained PDF are separate increments

## Implemented

- Migration 053 extends booking stay snapshots with cruise, hotel, private accommodation/Airbnb, local, and none states.
- Waiver evidence now retains normalized signature strokes, consent text, stay snapshot, captured time, and a device command identifier.
- The assignment-scoped crew endpoint verifies a confirmed passenger, active crew assignment for guide/driver roles, active tenant waiver version, and adult guardian membership for a minor before atomically updating stay details and appending signature evidence.
- The crew Today response includes the active waiver and passenger waiver status without exposing customer email or tenant-wide history.
- The Expo passenger row opens a dedicated waiver screen with stay fields, active waiver wording, guardian selection, signer identity, touch signature canvas, clear/retry, validation, and explicit submission.

## Verification

- Root API TypeScript build: passed.
- Expo TypeScript check: passed.
- Android production bundle export: passed, 589 modules and a 1.5 MB Hermes bundle.
- Fresh PostgreSQL migration run: all 53 scripts applied and migration rerun reported 53 skipped, zero pending.
- API/PostgreSQL suite: 40 of 40 tests passed. The crew integration verifies active-template delivery, an assigned guide recording a private-accommodation stay and signature, refreshed passenger waiver status, and rejection for an unassigned departure.
- Persistent local PostgreSQL migration: 053 applied successfully; zero pending.

## Remaining acceptance

- Physical iOS/Android phone and tablet visual/touch review is required before this screen is marked device-accepted.
- Encrypted offline cache/queue is Phase 4 (on production `cad0ed8`). Server-generated retained PDF is wired after accepted crew/web signature evidence; permissioned download is `GET /ops/v1/passengers/:id/waiver-pdf` (`manifest.read`). Optional Drive/OneDrive/Dropbox copy stays feature-flagged until credentials exist.
