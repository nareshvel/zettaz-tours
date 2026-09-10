ALTER TABLE pickup_locations
  ADD COLUMN address text NOT NULL DEFAULT '',
  ADD COLUMN latitude numeric(9,6),
  ADD COLUMN longitude numeric(9,6),
  ADD COLUMN map_url text NOT NULL DEFAULT '',
  ADD COLUMN visibility text NOT NULL DEFAULT 'internal'
    CHECK(visibility IN ('internal','guest')),
  ADD CONSTRAINT pickup_location_coordinates_pair
    CHECK((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL)),
  ADD CONSTRAINT pickup_location_latitude_range
    CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT pickup_location_longitude_range
    CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180);
