-- Staff profile fields + backfill crew profiles for existing members.

ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS address jsonb NOT NULL DEFAULT '{
    "street":"",
    "suite":"",
    "city":"",
    "stateParish":"",
    "postalCode":"",
    "country":""
  }'::jsonb;

UPDATE staff_users
SET
  first_name = COALESCE(
    NULLIF(trim(first_name), ''),
    NULLIF(split_part(trim(name), ' ', 1), ''),
    name
  ),
  last_name = COALESCE(
    NULLIF(trim(last_name), ''),
    NULLIF(trim(substring(trim(name) FROM length(split_part(trim(name), ' ', 1)) + 1)), ''),
    ''
  )
WHERE first_name IS NULL OR trim(first_name) = '';

-- Every active membership gets an ops crew profile (assignable without a second page).
INSERT INTO crew_profiles(tenant_id, membership_actor_id, operational_name, notes, active)
SELECT m.tenant_id, m.actor_id, s.name, '', true
FROM memberships m
JOIN staff_users s ON s.id = m.actor_id
ON CONFLICT (tenant_id, membership_actor_id) DO NOTHING;
