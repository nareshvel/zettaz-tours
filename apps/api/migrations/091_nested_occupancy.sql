ALTER TABLE passenger_units
  ADD COLUMN occupancy_class text NOT NULL DEFAULT 'adult'
    CHECK (occupancy_class IN ('adult', 'child', 'none'));

UPDATE passenger_units
SET occupancy_class = CASE
  WHEN NOT counts_toward_capacity THEN 'none'
  WHEN code = 'child' THEN 'child'
  ELSE 'adult'
END;

ALTER TABLE availability_rules
  ADD COLUMN capacity_adult integer,
  ADD COLUMN capacity_child integer;

UPDATE availability_rules
SET capacity_adult = capacity
WHERE capacity IS NOT NULL AND capacity_adult IS NULL;

ALTER TABLE availability_rules
  ADD CONSTRAINT availability_rules_occupancy CHECK (
    (capacity IS NULL AND capacity_adult IS NULL AND capacity_child IS NULL)
    OR (
      capacity IS NOT NULL
      AND capacity_adult IS NOT NULL
      AND capacity_adult > 0
      AND capacity_adult <= capacity
      AND (capacity_child IS NULL OR (capacity_child >= 0 AND capacity_child <= capacity))
    )
  );

ALTER TABLE departures
  ADD COLUMN capacity_adult integer,
  ADD COLUMN capacity_child integer,
  ADD COLUMN committed_adults integer NOT NULL DEFAULT 0,
  ADD COLUMN overbooked_adults integer NOT NULL DEFAULT 0,
  ADD COLUMN committed_children integer NOT NULL DEFAULT 0,
  ADD COLUMN overbooked_children integer NOT NULL DEFAULT 0;

UPDATE departures
SET capacity_adult = capacity,
    committed_adults = committed,
    overbooked_adults = overbooked
WHERE capacity_adult IS NULL;

ALTER TABLE departures
  ALTER COLUMN capacity_adult SET NOT NULL;

ALTER TABLE departures
  ADD CONSTRAINT departures_occupancy CHECK (
    capacity_adult > 0
    AND capacity_adult <= capacity
    AND (capacity_child IS NULL OR (capacity_child >= 0 AND capacity_child <= capacity))
    AND committed_adults >= 0
    AND overbooked_adults >= 0
    AND committed_children >= 0
    AND overbooked_children >= 0
    AND committed_adults <= capacity_adult
    AND (capacity_child IS NULL OR committed_children <= capacity_child)
  );

ALTER TABLE holds
  ADD COLUMN adult_seats integer NOT NULL DEFAULT 0,
  ADD COLUMN child_seats integer NOT NULL DEFAULT 0;

UPDATE holds SET adult_seats = seats WHERE adult_seats = 0 AND seats > 0;

ALTER TABLE holds
  ADD CONSTRAINT holds_occupancy_seats CHECK (
    adult_seats >= 0 AND child_seats >= 0 AND adult_seats + child_seats <= seats
  );

UPDATE tenants
SET config = jsonb_set(
  config,
  '{overbookPolicy}',
  '"authorized"'::jsonb,
  true
)
WHERE NOT (config ? 'overbookPolicy');
