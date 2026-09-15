-- 079: Record the paper a print job was rendered for.
--
-- The value travels with the job to the print agent as `mediaSize`, matching the
-- contract already used by the Zettaz Cloud print module so both products drive
-- the same agent. It matters beyond bookkeeping: CUPS prints at actual size
-- anchored to the queue's default media box, so a PDF whose page differs from
-- the queue's paper is silently clipped rather than scaled. Rendering at a known
-- size and telling the agent which one is what keeps the two in agreement.
--
-- Existing rows predate paper selection and were all rendered as A4.

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS media_size text NOT NULL DEFAULT 'a4';

ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_media_size_check;
ALTER TABLE print_jobs
  ADD CONSTRAINT print_jobs_media_size_check
  CHECK (media_size IN ('a4', 'letter', '58mm', '80mm'));

COMMENT ON COLUMN print_jobs.media_size IS
  'Paper the PDF page box was built for. Sent to the print agent as mediaSize so the queue''s media matches the document.';
