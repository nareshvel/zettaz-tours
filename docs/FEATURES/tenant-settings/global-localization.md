# Global tenant localization

Tenant Settings is organized around profile, branding, localization, commercial policy, operations, integrations, security and data retention. This keeps future controls discoverable without making each new module a new unrelated screen.

Localization data includes supported customer locales, default locale, timezone, date/time formats, week start, number format and measurement system. Country belongs to the business profile, and phone inputs derive their regional default from that country when implemented. These are presentation and data-entry defaults; historic booking timestamps and price snapshots remain unchanged.

Currencies remain distinct: booking, collection, settlement and reporting. The current application allows the first three configured currencies only when equal, because exchange rate capture and reconciliation are not implemented. The UI must show that constraint rather than imply conversion is available.

## Implemented — 15 September 2026

The tab is a three-column grid of **operating timezone** (read-only; set at tenant create and the source of truth for every departure time), display language, number format, date format, time format, week start and measurement system, followed by the locked currency trio. A preview strip renders a fixed instant and amount through the current choices, so a wrong pick is caught before it reaches a printed manifest rather than after.

### Formatting now honours the tenant

`config.locale` and `config.numberFormat` existed in the schema and **no code read either**: `money()` defaulted to `"en"`, so a tenant that had chosen French or a decimal comma still saw English grouping nearly everywhere.

`setFormatContext()` in `apps/web/lib/client.ts` is now set beside the tenant context in `workspace.tsx`, and `money()`, `dateOnly()`, `dateTime()`, `formatMediumDate()` and `friendlyDateTime()` default to it. Roughly ninety call sites are corrected without passing config through render trees; the few that passed a locale explicitly were overriding the number convention and were removed.

`numberFormat` is a convention, not a language — a tenant may run the workspace in English and still write `1.234,56`. Intl exposes no way to set separators directly, so each convention maps to a locale known to produce it (`comma_decimal → en-US`, `decimal_comma → de-DE`), used **only** for numbers. Month and day names keep the display language. `numberLocaleFor()` is the single place that mapping lives.

### Deliberately not exposed

- **`supportedLocales`** stays unexposed. It only becomes meaningful when guest-facing output — waiver wording, receipts, confirmation emails — is actually translated. A control that changes nothing is worse than a missing one.
- **Default guest country / phone country.** No guest nationality or phone-country control exists in the app today, so the setting would have nowhere to apply. Add the setting with the field that uses it, not before.
