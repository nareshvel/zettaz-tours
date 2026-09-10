# General profile and critical-action controls

## General profile

Tenant Settings > General owns logo, business/display name, street address, suite, city, state/parish, postal code, country, public business email and public business phone. Country and phone country are not localization settings.

The initial tenant owner is the default authorized contact: name, email and phone. This contact receives future critical-action verification requests. The public business contact may differ from the authorized contact.

## Critical actions

Deletion, ownership transfer, payout/provider changes, retention/export changes, and changes to authorized contacts require a dedicated critical-action workflow. It must require re-authentication or a one-time verification, record reason and actor, preserve audit evidence, and apply a recovery delay where appropriate. These controls are not implemented by merely displaying the owner identity.

## Further settings to plan

- Legal name, registration/tax IDs and tax jurisdiction
- Support contact and customer-facing business contact
- Multiple authorized contacts and owner-transfer recovery
- Address validation and country-specific subdivision labels
- Data residency, retention and export contacts
- Domain/brand verification and customer communication sender identity

The current implementation will store country as general profile data and use localization only for language, formatting, week start, number formatting and measurement system.
