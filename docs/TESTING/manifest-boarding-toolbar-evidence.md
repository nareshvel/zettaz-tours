# Manifest boarding gate toolbar — evidence

**Date:** 14 September 2026  
**Status:** Implemented; awaiting owner visual pass on phone/tablet/desktop

## What changed

- Removed Manifest setup cards: Operational readiness, Itinerary & locations (incl. add form), and the inline scan card.
- Added gate toolbar: guest **Search**, **Scan** sheet (camera via `BarcodeDetector` when available + paste fallback), **Crew** readiness sheet (read-only).
- Guest list filters by lead name, passenger name, or booking reference.
- Scan still resolves `staff/v1/crew/checkin-token/resolve` and **Arrived** uses passenger check-in.
- Docs: [manifest-boarding-toolbar.md](../FEATURES/operations/manifest-boarding-toolbar.md), MEMORY, ui-waiver task list row 11, resources-and-assignments, ops IA plan.

## Verification

- `apps/web` `tsc --noEmit` clean after toolbar component.
- Manual: open a departure Manifest → Search filters Board guests; Scan opens sheet; Crew shows readiness; Print/PDF unchanged; no itinerary/pickup CRUD on Manifest.

## Deferred

- QR on confirmation email/reservation PDF
- Camera polyfill for browsers without `BarcodeDetector` (crew Expo app remains primary field scanner)
- Optional read-only Route sheet
