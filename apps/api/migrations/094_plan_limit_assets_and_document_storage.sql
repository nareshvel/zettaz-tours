-- Plan limit labels: Assets (fleet) instead of Locations; Document storage
-- instead of Storage. Pickup locations are no longer a plan cap.

UPDATE subscription_plans
SET limits = jsonb_build_object(
  'Staff users', limits->'Staff users',
  'Assets', CASE id::text
    WHEN '4e0e6cc1-89b1-4dcb-a627-bfccb14f0af9' THEN to_jsonb(5)
    WHEN 'f7317df1-086a-4ad9-a9c9-c229a5995dcd' THEN to_jsonb(15)
    WHEN '3e595412-81e5-4c76-8216-25321d7ba56a' THEN to_jsonb(40)
    ELSE to_jsonb('Unlimited'::text)
  END,
  'Tour products', limits->'Tour products',
  'Document storage', CASE
    WHEN limits ? 'Document storage' THEN limits->'Document storage'
    WHEN limits ? 'Storage' THEN limits->'Storage'
    ELSE to_jsonb('2 GB'::text)
  END
)
WHERE active
  AND (
    limits ? 'Locations'
    OR limits ? 'Storage'
    OR NOT (limits ? 'Assets')
  );
