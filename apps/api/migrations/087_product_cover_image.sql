-- Single cover image path for catalog product cards (filesystem upload, like tenant logos).
ALTER TABLE products ADD COLUMN IF NOT EXISTS cover_path text;
