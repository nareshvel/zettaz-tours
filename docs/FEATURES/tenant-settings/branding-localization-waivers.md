# Tenant branding, localization and waiver content

Tenant Settings will own three independently versioned concerns:

- **Branding:** an optional local logo upload, stored under the application's tenant-scoped uploads directory. Allowed formats are JPG, PNG, WebP and sanitized SVG; the file limit is 2 MB. The API stores only a controlled local asset path and removes the replaced file after a successful update.
- **Localization:** display language, date format, time format and first day of week. Timezone remains the source of truth for operational timestamps; these preferences affect presentation only.
- **Waiver wording:** an owner/admin creates a new immutable waiver-template version rather than editing evidence already signed against an older version. Tenant staff can mark one current version active.

The Rock Adventures sample may be entered as a tenant-specific draft after legal approval. It is not a universal Zettaz default and must not be presented as approved legal advice.

The implementation uses the local application-directory upload pattern requested by the owner. Production deployment must later provide a durable mounted volume or replace this adapter with S3-compatible storage without changing tenant-facing API behavior.
