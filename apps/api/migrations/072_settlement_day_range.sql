-- 072: Widen partner_organizations.settlement_day from 1–28 to 1–31.
--
-- 068 capped the day at 28 so the chosen day always exists in every month.
-- That is safe but wrong for the common real-world agreement "settle on the
-- 30th" or "settle on the last day of the month". The range is now 1–31 and
-- the consumer is responsible for clamping to the last day of a short month
-- (e.g. 31 in February settles on the 28th / 29th). Storing the agreed day
-- verbatim keeps the contract legible; clamping is a presentation concern.

-- Drop whatever CHECK constraint 068 left on settlement_day, without relying
-- on Postgres' generated constraint name.
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

ALTER TABLE partner_organizations
  ADD CONSTRAINT partner_organizations_settlement_day_check
  CHECK (settlement_day IS NULL OR settlement_day BETWEEN 1 AND 31);

COMMENT ON COLUMN partner_organizations.settlement_day IS
  'Day-of-month for monthly settlement (1-31). Values beyond a given month''s length clamp to that month''s last day.';
