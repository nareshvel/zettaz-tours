-- 077: accommodation_properties gains the same shared-catalog shape as vessels.
--
--   tenant_id IS NULL  -> platform-seeded property, visible to every tenant
--   tenant_id = <uuid> -> added by that tenant, visible only to them
--
-- The hotel list will land later as NULL-tenant rows; this migration is the
-- schema change so that seed needs no further structural work.
--
-- Note the PK change. The table was PRIMARY KEY(tenant_id, id) and bookings
-- referenced it with a composite FK. tenant_id cannot be part of a primary key
-- once it is nullable, so the PK becomes id alone and the booking FK follows.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Release the composite FK before reshaping the key
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS booking_accommodation_fk;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. id alone becomes the key; tenant_id becomes optional ownership
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE accommodation_properties DROP CONSTRAINT IF EXISTS accommodation_properties_pkey;
ALTER TABLE accommodation_properties ADD PRIMARY KEY (id);

ALTER TABLE accommodation_properties ALTER COLUMN tenant_id DROP NOT NULL;
-- Seeded rows are created by the platform, not by a staff user.
ALTER TABLE accommodation_properties ALTER COLUMN created_by DROP NOT NULL;

-- Columns the seed will use, mirroring global_ports' shape.
ALTER TABLE accommodation_properties
  ADD COLUMN IF NOT EXISTS slug    text,
  ADD COLUMN IF NOT EXISTS country char(2) CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  ADD COLUMN IF NOT EXISTS region  text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Uniqueness, split by ownership
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE accommodation_properties
  DROP CONSTRAINT IF EXISTS accommodation_properties_tenant_id_name_key;

-- Seeded rows keyed by slug so a re-import cannot duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS accommodation_global_slug_key
  ON accommodation_properties (slug) WHERE tenant_id IS NULL AND slug IS NOT NULL;

-- Tenant rows: one entry per property name per tenant, case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS accommodation_tenant_name_key
  ON accommodation_properties (tenant_id, lower(name)) WHERE tenant_id IS NOT NULL;

DROP INDEX IF EXISTS accommodation_properties_active_name_idx;
CREATE INDEX IF NOT EXISTS accommodation_visible
  ON accommodation_properties (tenant_id, active, name);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Re-attach bookings on the new single-column key
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE bookings
  ADD CONSTRAINT booking_accommodation_fk
  FOREIGN KEY (accommodation_property_id) REFERENCES accommodation_properties(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS: read seeded + own, write only own
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_scope           ON accommodation_properties;
DROP POLICY IF EXISTS accommodation_read     ON accommodation_properties;
DROP POLICY IF EXISTS accommodation_insert   ON accommodation_properties;
DROP POLICY IF EXISTS accommodation_update   ON accommodation_properties;

CREATE POLICY accommodation_read ON accommodation_properties FOR SELECT
  USING (tenant_id IS NULL
         OR tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);

CREATE POLICY accommodation_insert ON accommodation_properties FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);

CREATE POLICY accommodation_update ON accommodation_properties FOR UPDATE
  USING      (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON accommodation_properties TO zettaz_runtime;

-- 074 added this for a copy-on-adopt model that this design replaces: a tenant
-- no longer copies a catalog row, it just uses it.
ALTER TABLE accommodation_properties DROP COLUMN IF EXISTS source_property_id;

COMMENT ON COLUMN accommodation_properties.tenant_id IS
  'NULL for platform-seeded properties shared by all tenants; set to the owning tenant for properties that tenant added.';
