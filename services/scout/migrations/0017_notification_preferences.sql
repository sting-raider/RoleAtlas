-- Per-user notification preferences. The enabled_types map keys match the
-- user_notifications.notification_type CHECK constraint exactly; missing keys
-- default to enabled at read time (COALESCE TRUE) so older rows stay valid.
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  enabled_types JSONB NOT NULL DEFAULT '{
    "new_strong_matches": true,
    "source_expansion_completed": true,
    "coverage_degraded": true,
    "saved_job_possibly_closing": true,
    "saved_job_closed": true,
    "follow_up_due": true,
    "application_action": true
  }'::jsonb CHECK (jsonb_typeof(enabled_types) = 'object'),
  weekly_digest BOOLEAN NOT NULL DEFAULT FALSE,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
