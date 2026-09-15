-- 078: Seed Antigua accommodation properties as shared rows, and fold the demo
--      tenant's hand-entered duplicates into them.
--
-- Two halves:
--   1. Insert the properties as shared rows (tenant_id IS NULL), keyed on slug
--      so re-running or extending the list never duplicates.
--   2. Merge: several tenants already typed some of these in by hand. Left
--      alone, they would now see the hotel twice — once shared, once their own.
--      So any tenant row whose name matches a shared row has its bookings
--      repointed at the shared row and is then removed.
--
-- The merge is name-based and deliberately conservative: it only acts on an
-- exact case-insensitive match after light normalisation, plus one explicit
-- alias listed below. Anything it is unsure about is left untouched for a human.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Shared property catalog
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO accommodation_properties (id, tenant_id, slug, name, address, country, region, created_by) VALUES
  -- Luxury / 5-star
  (gen_random_uuid(), NULL, 'jumby-bay-island',        'Jumby Bay Island',                        'Long Island, Antigua',        'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'hermitage-bay',           'Hermitage Bay',                           'Jennings, Antigua',           'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'curtain-bluff',           'Curtain Bluff',                           'Old Road, Antigua',           'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'carlisle-bay',            'Carlisle Bay',                            'Old Road, Antigua',           'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'blue-waters-resort-spa',  'Blue Waters Resort & Spa',                'Soldiers Bay, Antigua',       'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'hammock-cove-antigua',    'Hammock Cove Antigua',                    'Willoughby Bay, Antigua',     'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'sandals-grande-antigua',  'Sandals Grande Antigua',                  'Dickenson Bay, Antigua',      'AG', 'Antigua', NULL),
  -- All-inclusive / mid-range
  (gen_random_uuid(), NULL, 'royalton-antigua',        'Royalton Antigua',                        'Deep Bay, Antigua',           'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'royalton-chic-antigua',   'Royalton CHIC Antigua',                   'Deep Bay, Antigua',           'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'galley-bay-resort-spa',   'Galley Bay Resort & Spa',                 'Five Islands, Antigua',       'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'cocos-hotel',             'COCOS Hotel',                             'Valley Church, Antigua',      'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'cocobay-resort',          'Cocobay Resort',                          'Valley Church, Antigua',      'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'keyonna-beach-resort',    'Keyonna Beach Resort',                    'Turners Beach, Antigua',      'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'pineapple-beach-club',    'Pineapple Beach Club',                    'Long Bay, Antigua',           'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'the-verandah-antigua',    'The Verandah Antigua',                    'Devils Bridge, Antigua',      'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'jolly-beach-antigua',     'Jolly Beach Antigua',                     'Bolans, Antigua',             'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'hawksbill-resort-antigua','Hawksbill Resort Antigua',                'Five Islands, Antigua',       'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'st-james-club-villas',    'St. James''s Club & Villa Resort',        'Mamora Bay, Antigua',         'AG', 'Antigua', NULL),
  -- Boutique / historic
  (gen_random_uuid(), NULL, 'admirals-inn',            'Admiral''s Inn & Gunpowder Suites',       'Nelson''s Dockyard, Antigua', 'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'copper-and-lumber-store', 'Copper and Lumber Store Hotel',           'Nelson''s Dockyard, Antigua', 'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'inn-at-english-harbour',  'Inn at English Harbour',                  'English Harbour, Antigua',    'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'weatherills-hotel',       'Weatherills Hotel',                       'St. John''s, Antigua',        'AG', 'Antigua', NULL),
  (gen_random_uuid(), NULL, 'ocean-point-resort-spa',  'Ocean Point Beach Resort & Spa',          'Hodges Bay, Antigua',         'AG', 'Antigua', NULL)
-- Predicate must match accommodation_global_slug_key exactly, or Postgres
-- cannot infer the partial unique index and the statement errors.
ON CONFLICT (slug) WHERE tenant_id IS NULL AND slug IS NOT NULL DO UPDATE SET
  name    = EXCLUDED.name,
  address = CASE WHEN accommodation_properties.address = '' THEN EXCLUDED.address ELSE accommodation_properties.address END,
  country = EXCLUDED.country,
  region  = EXCLUDED.region;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fold tenant duplicates into the shared rows
-- ─────────────────────────────────────────────────────────────────────────────
-- Normalisation used for matching: lowercase, strip punctuation and the words
-- "the"/"resort"/"hotel" are NOT stripped — only case, apostrophes, ampersand
-- spacing and repeated whitespace. Anything looser risks merging two genuinely
-- different properties, which would silently repoint a guest's booking.
CREATE OR REPLACE FUNCTION pg_temp.norm_property(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           regexp_replace(lower(btrim(coalesce(t, ''))), '[''’.]', '', 'g'),
           '\s+', ' ', 'g')
$$;

CREATE TEMP TABLE property_merge AS
WITH shared AS (
  SELECT id, name, pg_temp.norm_property(name) AS key
    FROM accommodation_properties WHERE tenant_id IS NULL
),
owned AS (
  SELECT id, tenant_id, name, pg_temp.norm_property(name) AS key
    FROM accommodation_properties WHERE tenant_id IS NOT NULL
),
-- Explicit alias. The demo tenant recorded "St. James's Club"; the property is
-- "St. James's Club & Villa Resort". Listed by hand rather than matched by a
-- fuzzy rule, so the decision is visible and reviewable.
aliased AS (
  SELECT o.id, o.tenant_id, o.name,
         CASE WHEN o.key = 'st jamess club' THEN 'st jamess club & villa resort'
              ELSE o.key END AS key
    FROM owned o
)
SELECT a.id AS tenant_property_id, a.tenant_id, a.name AS tenant_name,
       s.id AS shared_property_id, s.name AS shared_name
  FROM aliased a
  JOIN shared s ON s.key = a.key;

-- Repoint bookings before removing anything.
UPDATE bookings b
   SET accommodation_property_id = m.shared_property_id
  FROM property_merge m
 WHERE b.accommodation_property_id = m.tenant_property_id;

-- Keep the recorded hotel name on the booking consistent with the shared row.
UPDATE bookings b
   SET stay = jsonb_set(b.stay, '{hotelName}', to_jsonb(m.shared_name))
  FROM property_merge m
 WHERE b.accommodation_property_id = m.shared_property_id
   AND b.stay->>'kind' = 'hotel'
   AND pg_temp.norm_property(b.stay->>'hotelName') = pg_temp.norm_property(m.tenant_name);

-- Now the tenant copies are unreferenced and can go.
DELETE FROM accommodation_properties a
 USING property_merge m
 WHERE a.id = m.tenant_property_id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM property_merge;
  RAISE NOTICE 'Merged % tenant-entered properties into the shared catalog', n;
END $$;
