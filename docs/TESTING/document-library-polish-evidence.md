# Document library polish — implementation evidence

**Date:** 17 September 2026  
**Status:** Implemented; owner visual acceptance still outstanding

## Boundary

Upload, download, quota, and compliance-document APIs are unchanged. This is a workspace UX pass.

## Changes

- Metrics for documents in view, expired, and files attached. Storage meter kept.
- Search uses the shared search box; subject filter and Add sit on the list-action bar (Add is icon-only on phone).
- Expired rows show a status badge.
- Remove uses in-app `ConfirmDialog` instead of an immediate DELETE.

## Owner acceptance still needed

- Search and Staff/Fleet filter.
- Confirm remove, then confirm the row is gone.
- Phone cards vs desktop table.
- Quota meter still blocks upload when full.
