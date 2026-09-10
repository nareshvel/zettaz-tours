ALTER TABLE assisted_imports
  ADD COLUMN file_name text,
  ADD COLUMN total_rows integer NOT NULL DEFAULT 0 CHECK(total_rows >= 0),
  ADD COLUMN valid_rows integer NOT NULL DEFAULT 0 CHECK(valid_rows >= 0),
  ADD COLUMN quarantined_rows integer NOT NULL DEFAULT 0 CHECK(quarantined_rows >= 0),
  ADD COLUMN duplicate_rows integer NOT NULL DEFAULT 0 CHECK(duplicate_rows >= 0),
  ADD COLUMN currency text,
  ADD COLUMN total_minor bigint,
  ADD COLUMN paid_minor bigint,
  ADD COLUMN reconciliation jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX assisted_import_rows_review
  ON assisted_import_rows(tenant_id,import_id,status,row_number);
