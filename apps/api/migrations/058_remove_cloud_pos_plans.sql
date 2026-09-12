-- Remove the old Zettaz Cloud POS placeholder plans.
-- These were deactivated in migration 057. Any tenant_subscriptions rows
-- that referenced them were manually reassigned to the new T&C plan UUIDs
-- before this migration was applied.
-- Safe to delete: ON DELETE RESTRICT would error here if any FK still exists.
DELETE FROM subscription_plans
WHERE id IN (
  '2487711b-a560-11f1-97e5-525400d69130',  -- old Starter
  '6baf0d04-4c50-11f0-8dfa-525400d69130',  -- old Growth
  '6baf1082-4c50-11f0-8dfa-525400d69130',  -- old Professional
  '6baf11e2-4c50-11f0-8dfa-525400d69130'   -- old Enterprise
);
