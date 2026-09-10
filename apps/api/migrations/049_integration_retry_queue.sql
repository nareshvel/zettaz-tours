ALTER TABLE webhook_inbox DROP CONSTRAINT webhook_inbox_status_check;
ALTER TABLE webhook_inbox ADD CONSTRAINT webhook_inbox_status_check
  CHECK(status IN ('received','quarantined','retry_pending','processed','dead_letter'));
ALTER TABLE webhook_inbox
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 5),
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN last_reviewed_at timestamptz,
  ADD COLUMN dead_lettered_at timestamptz;
CREATE INDEX webhook_inbox_retry_due ON webhook_inbox(next_attempt_at,id)
  WHERE status='retry_pending';
