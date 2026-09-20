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

## Follow-up 19 September 2026

- Fleet toolbar matches Staff: search and **Add asset** on one row, add on the right. Dummy “Assets” tab removed.
- Search filters name, code, and type.
- Asset document rows no longer use inline layout styles.

## Fleet add/edit 19 September 2026

- Empty list has **Add asset**; row name opens **Edit asset**; submit disabled until name and valid code.
- Documents per asset uses the Staff file dropzone (`uploadComplianceDocument`), archive, storage meter, and download — not a free-text evidence path.
- Compliance list/usage load only when the session has `documents.expiry.manage`, so Fleet still lists assets without that permission.
- Deactivate asset and delete document stay on `ConfirmDialog`.

## Fleet roster 19 September 2026

- **Passenger seats** on the asset form: seats on this named unit, not a count of vehicles.
- Roster columns: seats, next upcoming assignment (link to Catalog → Assignments).
- Metrics: assigned today and coverage gaps (assigned unit seats below booked occupancy). Warn only — inventory unchanged.
- `GET ops/v1/assignments` includes `resource_capacity`, `departure_capacity`, `departure_committed`.

## Fleet kinds and one sheet 20 September 2026

- Kind list: land (vehicle, van, bus, tuk-tuk), water (vessel, boat, jet ski, kayak), equipment (equipment, snorkel gear, other).
- Identity: make, model, registration/ID (`093_fleet_asset_identity.sql`).
- Add/edit identity on the asset modal; papers are a list with view/download/remove. **Add document** and **View document** open their own modals. Suggested document types by kind family; custom types still allowed.
- Row **Edit** / **Remove** are icon-only; papers open from the document count. Nav and page header are **Assets**. Page intro copy removed 20 Sep.

## Automated evidence

- `resources are tenant-scoped…` first-slice test covers jet ski + identifier, resource update, documents, assignment occupancy fields, and deactivation.

## Browser verification (20 September 2026)

Local `/resources` 20 Sep: toolbar search + Active filter + Add asset; name stays on one line; documents show file icon + count (opens viewer); row actions are Edit/Remove. Edit asset sheet is a tall scrollable dialog (identity + papers above sticky Save). Document viewer opens PDF/image from papers. Page header has no teaching paragraph. Agent visual is not owner acceptance.

## Owner acceptance still needed

- Add/edit crew, resource, and document via heading-row buttons and modals on phone and tablet.
- Confirm Remove deactivates crew/resource; Delete permanently removes a document; ConfirmDialog copy is clear.
- Assign an active crew member to a departure and confirm readiness on the departure view.
