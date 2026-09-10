ALTER TABLE tenants ADD COLUMN business_profile jsonb NOT NULL DEFAULT '{"displayName":"","streetAddress":"","suite":"","city":"","stateParish":"","postalCode":"","country":"","email":"","phone":""}'::jsonb;
ALTER TABLE tenants ADD COLUMN authorized_contact jsonb NOT NULL DEFAULT '{"name":"","email":"","phone":""}'::jsonb;
