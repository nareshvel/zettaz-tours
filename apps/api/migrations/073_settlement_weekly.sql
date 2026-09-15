-- 073: Add 'weekly' to settlement_schedule, and give settlement_day a
--      schedule-dependent meaning.
--
-- 068 shipped monthly / biweekly / per_booking / custom / manual. A plain
-- weekly cycle is common for high-volume OTA channels and was missing.
--
-- settlement_day is reused for two different units, which the CHECK below
-- makes explicit rather than leaving to convention:
--   monthly           -> day of month, 1–31 (short months clamp to last day)
--   weekly, biweekly  -> ISO day of week,  1–7 (1 = Monday .. 7 = Sunday)
--   per_booking, custom, manual -> not meaningful, must be NULL

-- Rebuild the schedule CHECK with 'weekly' included.
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE rel.relname = 'partner_organizations'
       AND nsp.nspname = 'public'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%settlement_schedule%'
  LOOP
    EXECUTE format('ALTER TABLE partner_organizations DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE partner_organizations
  ADD CONSTRAINT partner_organizations_settlement_schedule_check
  CHECK (settlement_schedule IN
    ('weekly','biweekly','monthly','per_booking','custom','manual'));

-- Replace the 1–31 day rule from 072 with the schedule-aware rule.
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE rel.relname = 'partner_organizations'
       AND nsp.nspname = 'public'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%settlement_day%'
  LOOP
    EXECUTE format('ALTER TABLE partner_organizations DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

-- Existing rows may hold a day-of-month under a weekly/biweekly schedule
-- (biweekly accepted 1–28 before this migration). Clear those so the new
-- constraint can be added without failing on legacy data.
UPDATE partner_organizations
   SET settlement_day = NULL
 WHERE settlement_schedule IN ('weekly','biweekly')
   AND settlement_day IS NOT NULL
   AND settlement_day NOT BETWEEN 1 AND 7;

ALTER TABLE partner_organizations
  ADD CONSTRAINT partner_organizations_settlement_day_check
  CHECK (
    settlement_day IS NULL
    OR (settlement_schedule = 'monthly' AND settlement_day BETWEEN 1 AND 31)
    OR (settlement_schedule IN ('weekly','biweekly') AND settlement_day BETWEEN 1 AND 7)
  );

COMMENT ON COLUMN partner_organizations.settlement_day IS
  'Schedule-dependent: day of month 1-31 when settlement_schedule = monthly (short months clamp to their last day); ISO day of week 1-7 (Mon-Sun) when weekly or biweekly; NULL otherwise.';
