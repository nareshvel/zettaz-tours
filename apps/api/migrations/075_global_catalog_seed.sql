-- 075: Starter seed for the global vessel and port catalogs.
--
-- Deliberately small. The catalogs are meant to be worldwide, but the bulk
-- load belongs to the importer reading authoritative sources (UN/LOCODE from
-- UNECE for ports, the ship registry for IMO numbers) — not to SQL literals
-- typed from memory. See docs/MODULES/Tenant_settings/global-catalogs-plan.md
-- for why: two identifiers checked while drafting were both wrong from memory.
--
-- Rules followed here:
--   * imo / locode appear ONLY where the value was verified against a source.
--     Everything else is NULL — a row is perfectly usable without one.
--   * Every statement upserts on the natural key, so re-running this migration
--     or overlapping it with an import cannot create duplicates.

-- ─────────────────────────────────────────────────────────────────────────────
-- Vessels
-- IMO numbers below are 7-digit values taken from published fleet data.
-- Ships whose IMO was not confirmed are seeded with imo = NULL rather than a
-- guess; the importer fills them in later, matched on slug.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO global_vessels (slug, name, cruise_line, imo, passenger_capacity, tenders_by_default) VALUES
  ('icon-of-the-seas',     'Icon of the Seas',     'Royal Caribbean International', '9829930', 7600, false),
  ('star-of-the-seas',     'Star of the Seas',     'Royal Caribbean International', NULL,      7600, false),
  ('wonder-of-the-seas',   'Wonder of the Seas',   'Royal Caribbean International', NULL,      6988, false),
  ('oasis-of-the-seas',    'Oasis of the Seas',    'Royal Caribbean International', NULL,      6771, false),
  ('allure-of-the-seas',   'Allure of the Seas',   'Royal Caribbean International', NULL,      6780, false),
  ('symphony-of-the-seas', 'Symphony of the Seas', 'Royal Caribbean International', NULL,      6680, false),
  ('ovation-of-the-seas',  'Ovation of the Seas',  'Royal Caribbean International', NULL,      4905, false),
  ('mardi-gras',           'Mardi Gras',           'Carnival Cruise Line',          '9837444', 6631, false),
  ('carnival-celebration', 'Carnival Celebration', 'Carnival Cruise Line',          '9837456', 6631, false),
  ('carnival-jubilee',     'Carnival Jubilee',     'Carnival Cruise Line',          '9851737', 6631, false),
  ('msc-grandiosa',        'MSC Grandiosa',        'MSC Cruises',                   '9803613', 6761, false),
  ('msc-virtuosa',         'MSC Virtuosa',         'MSC Cruises',                   '9803625', 6334, false),
  ('costa-smeralda',       'Costa Smeralda',       'Costa Cruises',                 '9781889', 6554, false),
  ('costa-toscana',        'Costa Toscana',        'Costa Cruises',                 '9781891', 6554, false),
  ('aidanova',             'AIDAnova',             'AIDA Cruises',                  '9781865', 6654, false),
  ('iona',                 'Iona',                 'P&O Cruises',                   '9826548', 6600, false),
  ('arvia',                'Arvia',                'P&O Cruises',                   '9849693', 6685, false),
  ('sun-princess',         'Sun Princess',         'Princess Cruises',              '9863118', 5189, false),
  ('discovery-princess',   'Discovery Princess',   'Princess Cruises',              NULL,      3660, false),
  ('diamond-princess',     'Diamond Princess',     'Princess Cruises',              NULL,      2670, false),
  ('norwegian-prima',      'Norwegian Prima',      'Norwegian Cruise Line',         NULL,      3100, false),
  ('norwegian-bliss',      'Norwegian Bliss',      'Norwegian Cruise Line',         NULL,      4004, false),
  ('celebrity-ascent',     'Celebrity Ascent',     'Celebrity Cruises',             NULL,      3260, false),
  ('celebrity-beyond',     'Celebrity Beyond',     'Celebrity Cruises',             NULL,      3260, false),
  ('celebrity-equinox',    'Celebrity Equinox',    'Celebrity Cruises',             NULL,      2850, false),
  ('queen-mary-2',         'Queen Mary 2',         'Cunard Line',                   NULL,      2691, false),
  ('spectrum-of-the-seas', 'Spectrum of the Seas', 'Royal Caribbean International', NULL,      4246, false),
  ('seabourn-quest',       'Seabourn Quest',       'Seabourn Cruise Line',          NULL,       458, true),
  ('silver-shadow',        'Silver Shadow',        'Silversea Cruises',             NULL,       388, true),
  ('windstar-wind-surf',   'Wind Surf',            'Windstar Cruises',              NULL,       342, true)
ON CONFLICT (slug) DO UPDATE SET
  name               = EXCLUDED.name,
  cruise_line        = EXCLUDED.cruise_line,
  -- Never overwrite a verified identifier with NULL.
  imo                = COALESCE(EXCLUDED.imo, global_vessels.imo),
  passenger_capacity = COALESCE(EXCLUDED.passenger_capacity, global_vessels.passenger_capacity),
  tenders_by_default = EXCLUDED.tenders_by_default;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ports
-- Names, countries and regions are stated with confidence. UN/LOCODE is left
-- NULL except where verified — the importer backfills from the UNECE list,
-- matched on slug, and the locode/country CHECK in 074 guards bad pairings.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO global_ports (slug, name, country, region, locode, timezone) VALUES
  -- Caribbean
  ('st-johns-antigua',      'St. John''s',                 'AG', 'Caribbean',     'AGSJO', 'America/Antigua'),
  ('bridgetown-barbados',   'Bridgetown',                  'BB', 'Caribbean',     NULL,    'America/Barbados'),
  ('nassau-bahamas',        'Nassau',                      'BS', 'Caribbean',     NULL,    'America/Nassau'),
  ('george-town-cayman',    'George Town',                 'KY', 'Caribbean',     NULL,    'America/Cayman'),
  ('philipsburg-sxm',       'Philipsburg',                 'SX', 'Caribbean',     NULL,    'America/Lower_Princes'),
  ('charlotte-amalie-vi',   'Charlotte Amalie, St. Thomas','VI', 'Caribbean',     NULL,    'America/St_Thomas'),
  ('san-juan-pr',           'San Juan',                    'PR', 'Caribbean',     NULL,    'America/Puerto_Rico'),
  ('castries-st-lucia',     'Castries',                    'LC', 'Caribbean',     NULL,    'America/St_Lucia'),
  ('roseau-dominica',       'Roseau',                      'DM', 'Caribbean',     NULL,    'America/Dominica'),
  ('basseterre-skn',        'Basseterre',                  'KN', 'Caribbean',     NULL,    'America/St_Kitts'),
  ('st-georges-grenada',    'St. George''s',               'GD', 'Caribbean',     NULL,    'America/Grenada'),
  ('kingstown-svg',         'Kingstown',                   'VC', 'Caribbean',     NULL,    'America/St_Vincent'),
  ('oranjestad-aruba',      'Oranjestad',                  'AW', 'Caribbean',     NULL,    'America/Aruba'),
  ('willemstad-curacao',    'Willemstad',                  'CW', 'Caribbean',     NULL,    'America/Curacao'),
  ('cozumel-mexico',        'Cozumel',                     'MX', 'Caribbean',     NULL,    'America/Cancun'),
  ('ocho-rios-jamaica',     'Ocho Rios',                   'JM', 'Caribbean',     NULL,    'America/Jamaica'),
  ('road-town-bvi',         'Road Town, Tortola',          'VG', 'Caribbean',     NULL,    'America/Tortola'),
  -- North America
  ('miami-fl',              'Miami',                       'US', 'North America', NULL,    'America/New_York'),
  ('port-canaveral-fl',     'Port Canaveral',              'US', 'North America', NULL,    'America/New_York'),
  ('fort-lauderdale-fl',    'Fort Lauderdale',             'US', 'North America', NULL,    'America/New_York'),
  ('galveston-tx',          'Galveston',                   'US', 'North America', NULL,    'America/Chicago'),
  ('new-york-ny',           'New York',                    'US', 'North America', NULL,    'America/New_York'),
  ('vancouver-bc',          'Vancouver',                   'CA', 'North America', NULL,    'America/Vancouver'),
  -- Alaska
  ('juneau-ak',             'Juneau',                      'US', 'Alaska',        NULL,    'America/Juneau'),
  ('ketchikan-ak',          'Ketchikan',                   'US', 'Alaska',        NULL,    'America/Sitka'),
  ('skagway-ak',            'Skagway',                     'US', 'Alaska',        NULL,    'America/Juneau'),
  ('sitka-ak',              'Sitka',                       'US', 'Alaska',        NULL,    'America/Sitka'),
  -- Mediterranean
  ('barcelona-spain',       'Barcelona',                   'ES', 'Mediterranean', NULL,    'Europe/Madrid'),
  ('palma-mallorca',        'Palma de Mallorca',           'ES', 'Mediterranean', NULL,    'Europe/Madrid'),
  ('civitavecchia-italy',   'Civitavecchia (Rome)',        'IT', 'Mediterranean', NULL,    'Europe/Rome'),
  ('naples-italy',          'Naples',                      'IT', 'Mediterranean', NULL,    'Europe/Rome'),
  ('venice-italy',          'Venice',                      'IT', 'Mediterranean', NULL,    'Europe/Rome'),
  ('santorini-greece',      'Santorini',                   'GR', 'Mediterranean', NULL,    'Europe/Athens'),
  ('piraeus-greece',        'Piraeus (Athens)',            'GR', 'Mediterranean', NULL,    'Europe/Athens'),
  ('mykonos-greece',        'Mykonos',                     'GR', 'Mediterranean', NULL,    'Europe/Athens'),
  ('dubrovnik-croatia',     'Dubrovnik',                   'HR', 'Mediterranean', NULL,    'Europe/Zagreb'),
  ('valletta-malta',        'Valletta',                    'MT', 'Mediterranean', NULL,    'Europe/Malta'),
  ('marseille-france',      'Marseille',                   'FR', 'Mediterranean', NULL,    'Europe/Paris'),
  ('lisbon-portugal',       'Lisbon',                      'PT', 'Atlantic Europe', NULL,  'Europe/Lisbon'),
  -- Northern Europe & Baltic
  ('southampton-uk',        'Southampton',                 'GB', 'Northern Europe', NULL,  'Europe/London'),
  ('copenhagen-denmark',    'Copenhagen',                  'DK', 'Baltic',        NULL,    'Europe/Copenhagen'),
  ('stockholm-sweden',      'Stockholm',                   'SE', 'Baltic',        NULL,    'Europe/Stockholm'),
  ('helsinki-finland',      'Helsinki',                    'FI', 'Baltic',        NULL,    'Europe/Helsinki'),
  ('tallinn-estonia',       'Tallinn',                     'EE', 'Baltic',        NULL,    'Europe/Tallinn'),
  ('bergen-norway',         'Bergen',                      'NO', 'Northern Europe', NULL,  'Europe/Oslo'),
  ('reykjavik-iceland',     'Reykjavik',                   'IS', 'Northern Europe', NULL,  'Atlantic/Reykjavik'),
  -- Asia-Pacific
  ('singapore',             'Singapore',                   'SG', 'Asia-Pacific',  NULL,    'Asia/Singapore'),
  ('yokohama-japan',        'Yokohama (Tokyo)',            'JP', 'Asia-Pacific',  NULL,    'Asia/Tokyo'),
  ('hong-kong',             'Hong Kong',                   'HK', 'Asia-Pacific',  NULL,    'Asia/Hong_Kong'),
  ('sydney-australia',      'Sydney',                      'AU', 'Australia & NZ', NULL,   'Australia/Sydney'),
  ('auckland-nz',           'Auckland',                    'NZ', 'Australia & NZ', NULL,   'Pacific/Auckland'),
  -- Middle East
  ('dubai-uae',             'Dubai',                       'AE', 'Middle East',   NULL,    'Asia/Dubai')
ON CONFLICT (slug) DO UPDATE SET
  name     = EXCLUDED.name,
  country  = EXCLUDED.country,
  region   = EXCLUDED.region,
  locode   = COALESCE(EXCLUDED.locode, global_ports.locode),
  timezone = COALESCE(EXCLUDED.timezone, global_ports.timezone);
