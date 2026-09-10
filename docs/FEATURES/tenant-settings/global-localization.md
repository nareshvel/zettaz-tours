# Global tenant localization

Tenant Settings is organized around profile, branding, localization, commercial policy, operations, integrations, security and data retention. This keeps future controls discoverable without making each new module a new unrelated screen.

Localization data includes supported customer locales, default locale, timezone, date/time formats, week start, number format and measurement system. Country belongs to the business profile, and phone inputs derive their regional default from that country when implemented. These are presentation and data-entry defaults; historic booking timestamps and price snapshots remain unchanged.

Currencies remain distinct: booking, collection, settlement and reporting. The current application allows the first three configured currencies only when equal, because exchange rate capture and reconciliation are not implemented. The UI must show that constraint rather than imply conversion is available.
