# Team & resources polish — implementation evidence

**Date:** 11 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Changes

- Readiness metrics: active crew, active resources, expired documents, expiring within 14 days (tenant timezone).
- Expiry attention list when documents are expired or due soon, with subject name and status.
- Section heading rows include **Add** for crew, resources, documents, and assignments; create/edit open in `FormDialog`.
- Row **Edit** / **Remove**; removes use `ConfirmDialog` (crew/resource deactivate, document delete, assignment cancel).
- Safety override reason appears only when the selected subject has an expired document for that departure; spurious override text is ignored by the API.
- API: list/update/cancel assignments (`GET/PATCH/DELETE ops/v1/assignments`); gateway allowlist updated.
- Page uses Catalog-style tabs (Crew / Resources / Documents / Assignments) with metrics always visible; Add action sits on the active tab bar.
- Phone: icon-first Add button, scrollable tabs, card lists; metric tiles jump to the matching tab.
- Expiry callout appears when not on Documents and deep-links into that tab.

## Automated evidence

- `resources are tenant-scoped…` first-slice test covers resource update, document update/delete, deactivate blocking assignment, and reactivation.

## Owner acceptance still needed

- Add/edit crew, resource, and document via heading-row buttons and modals on phone and tablet.
- Confirm Remove deactivates crew/resource; Delete permanently removes a document; ConfirmDialog copy is clear.
- Assign an active crew member to a departure and confirm readiness on the departure view.
