-- Migration 059: Add columns used by subscription background jobs
-- reminder_7d_sent / reminder_1d_sent: prevent duplicate trial-ending emails
-- suspension_notified_at: track when grace-period suspension email was last sent

ALTER TABLE tenant_subscriptions
  ADD COLUMN IF NOT EXISTS reminder_7d_sent        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_1d_sent        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspension_notified_at  timestamptz;
