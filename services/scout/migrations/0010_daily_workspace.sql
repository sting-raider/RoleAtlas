CREATE TABLE IF NOT EXISTS daily_workspaces (
  workspace_key TEXT PRIMARY KEY,
  profile_id UUID REFERENCES candidate_profiles(id) ON DELETE SET NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (workspace_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  CHECK (jsonb_typeof(state) = 'object')
);

CREATE INDEX IF NOT EXISTS daily_workspaces_profile_idx
  ON daily_workspaces (profile_id, updated_at DESC);
