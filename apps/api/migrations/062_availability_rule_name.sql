ALTER TABLE availability_rules ADD COLUMN name text;
UPDATE availability_rules SET name = 'Schedule' WHERE name IS NULL;
ALTER TABLE availability_rules ALTER COLUMN name SET NOT NULL;
