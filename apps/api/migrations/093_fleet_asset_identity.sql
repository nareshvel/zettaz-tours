-- Identity facts on a named fleet unit (plate / HIN / registration mark).
-- Papers (insurance, license, registration expiry) stay on compliance_documents.

ALTER TABLE operational_resources
  ADD COLUMN IF NOT EXISTS make text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS identifier text NOT NULL DEFAULT '';
