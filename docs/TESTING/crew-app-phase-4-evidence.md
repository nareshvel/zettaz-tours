# Crew app Phase 4 evidence

**Date:** 17 September 2026  
**Scope:** Encrypted offline lease for the one Zettaz Crew binary. GPS, card-present, kiosk, and Phase 5 Track B remain later.

## Implemented

- Migration `088_crew_offline.sql`: `crew_devices` (active client-device uniqueness) and `crew_offline_commands` (`UNIQUE (tenant_id, client_command_id)`), RLS on `app.tenant`.
- `POST /crew/v1/devices` enrolls a device and returns the credential secret once. `POST /crew/v1/devices/:id/revoke` is own-device or `members.write`.
- `GET /crew/v1/offline/snapshot` returns assigned Today plus a 24h lease (tenant `offlineLeaseHours` clamped 4–72). Requires `x-crew-device-id` / `x-crew-device-secret`.
- `POST /crew/v1/offline/commands` (max 50) applies check-in, trip_event, waiver, and payment. Duplicate `clientCommandId` returns `duplicate` when the original was accepted; rejected/conflict originals stay rejected/conflict. Server remains authoritative for assignment and money.
- Revoked device → HTTP 410 `{ code: "device_revoked" }`. Expo wipes the local box key, device secret, PIN, and SQLite blobs on next connect.
- `/api/mobile` allowlists the new GET/POST paths and forwards device headers. Walk-up, weather, start-trip, print, and scan stay online-only.
- Expo: `expo-sqlite` + tweetnacl secretbox of snapshot/command blobs; key in SecureStore. Profile **Prepare offline** (PIN + enroll + snapshot). Lock screen (PIN / biometrics). Queue banner, last-sync time, authorized discard of quarantined commands, reconnect sync before live Today. Sign-out is blocked while commands are queued.

## Verification this session

- `npx tsc -p tsconfig.json --noEmit` — passed
- `npm run mobile:typecheck` — passed
- `npm run web:typecheck` — passed
- Crew isolation tests — façade (including waiver PDF 200 / guide 403), today, Pay, tablet board/walk-up, walk-up deposit, **offline enroll/snapshot/dedupe/revoke 410** — passed
- Local `db:migrate` was `INCOMPLETE` after 088’s file was edited post-apply (`Applied migration was modified`). Restored `088_crew_offline.sql` to the exact applied checksum. Local migrate is `COMPLETE` again (skip 088/089). Fresh empty-database migrate ran **001–089** including 088/089, then the offline enroll test passed. **Do not edit 088 or 089 after this; add a new script if schema must change.**
- Production `./deploy.sh` at `cad0ed8` applied **088** and **089**, Pending: 0.

## Not verified here

- Airplane-mode cycle on a physical iPhone and Android (task 4.8). Needs a new EAS preview against this production tip, then owner full test.
- Cached money is not updated until sync (by design). Do not collect the same cash twice.

## Out of this increment

Phase 5 Track B: kiosk lock, GPS, card-present, push, white-label binary, consumer app. Do not start.
