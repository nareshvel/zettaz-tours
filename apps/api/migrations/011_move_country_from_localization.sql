-- Business country belongs to the tenant profile. Remove legacy localization
-- metadata before the strict configuration contract stops accepting it.
UPDATE tenants
SET config = config - 'operatingCountry' - 'defaultPhoneCountry'
WHERE config ? 'operatingCountry' OR config ? 'defaultPhoneCountry';
