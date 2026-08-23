-- Weekly-digest scheduling state. The timestamp doubles as the outbox marker:
-- a digest send that fails must leave it NULL so the next attempt retries.
ALTER TABLE user_notification_preferences
  ADD COLUMN IF NOT EXISTS last_digest_sent_at TIMESTAMPTZ;
