ALTER TABLE bookings ADD COLUMN stay jsonb NOT NULL DEFAULT '{"kind":"none"}'::jsonb;
