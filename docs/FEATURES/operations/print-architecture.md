# Print and document architecture

## Purpose

Provide tenant-controlled, auditable operational documents without coupling web pages or future mobile apps directly to printers.

## Delivery path

1. The web workspace renders browser-printable views and deterministic, server-produced PDF departure manifests and pickup lists.
2. Templates are versioned tenant data, with a document type, paper/output profile, structured template payload, status, default selection and publishing history.
3. Stations route document types to a configured printer/template with an explicit fallback.
4. A durable `print_jobs` record captures the source document, template version, destination, idempotency key, rendered format, attempts, result and errors.
5. Physical local printers use a separately deployed, authenticated Go print agent. It registers capabilities, pulls or receives authorized jobs, retries safely and writes outcome events. It does not receive unrestricted database access.

## Boundary

Web, API and mobile clients submit a canonical document request. Renderers adapt it to HTML/PDF, ESC/POS or ZPL. No feature screen calls a printer SDK or raw printer endpoint.

The Expo app may preview/share a PDF and later use a compatible local-print adapter. It must not embed the server-side Go agent. Device printing and stored document access remain tenant-scoped and auditable.

## Minimum data model

- `print_templates`: tenant, document type, output profile, version, structured payload, status, default marker, publisher and timestamps.
- `printer_routes`: tenant, station, document type, printer/device target, template selection and fallback policy.
- `print_jobs`: tenant, source document reference, template/version, route/device, idempotency key, rendered artifact reference, status, attempts, timestamps and error detail.

Rendered artifacts require tenant-scoped storage paths and a retention policy. Operational documents minimize passenger data by document type and audience. Short-lived waiver PDF hot copies and archive sync-out follow [document storage](document-storage.md): ≤7 day hot retention, immediate sync-out when a drive target is configured, and purge of production hot space after sync or expiry.

## Current implementation

Migration 023 provides tenant-scoped `print_templates`, `printer_routes`, and `print_jobs`, including RLS, append-only template versions, one published default per document type, audit/outbox events, and idempotent browser-job requests. A job provides a tenant-authorized PDF download derived from the canonical manifest or pickup-list data and the web workspace also supports the native browser print dialog. The job records the requested output; it does not claim that a browser download or physical print completed.

Migration 056 adds `document_artifacts` for short-lived hot PDF copies (waiver first), tenant `documentStorage` config, filesystem hot store, archive sync-out queueing, and purge. Google Drive / OneDrive / Dropbox adapters remain feature-flagged until OAuth credentials are approved.

The Go agent, agent enrollment credentials, job polling, stored-artifact rendering for station printers, retries, and completion callbacks are still pending. They require a separately deployed service and approved operational/privacy requirements.

## Acceptance

- A departure day manifest and pickup list can be printed or saved as PDF from the browser.
- A tenant cannot access another tenant's template, route, job or artifact.
- Repeating a request with the same idempotency key does not duplicate a physical print job.
- Template edits create a new version; completed jobs retain the version used.
- A failed printer agent attempt is visible, retryable and audited.
