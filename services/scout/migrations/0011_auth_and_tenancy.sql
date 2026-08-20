-- Better Auth tables. The shape is generated from lib/auth.ts and then kept in
-- the same migration history as the rest of RoleAtlas so clean installs and
-- upgrades use one deterministic path.
CREATE TABLE IF NOT EXISTS roleatlas_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope TEXT,
  password TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (provider_id, account_id)
);

CREATE INDEX IF NOT EXISTS auth_accounts_user_id_idx ON auth_accounts (user_id);

CREATE TABLE IF NOT EXISTS auth_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS auth_verifications_identifier_idx ON auth_verifications (identifier);
CREATE INDEX IF NOT EXISTS auth_verifications_expiry_idx ON auth_verifications (expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  last_request BIGINT NOT NULL
);

-- Preserve every historical local record under an explicit migration account.
-- It intentionally has no credential account; operators must claim or remove it
-- explicitly rather than inheriting a known password.
INSERT INTO roleatlas_users (id, name, email, email_verified, role)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Migrated local workspace',
  'bootstrap@local.roleatlas.invalid',
  TRUE,
  'admin'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS user_id UUID;
UPDATE candidate_profiles
SET user_id = '00000000-0000-4000-8000-000000000001'
WHERE user_id IS NULL;
ALTER TABLE candidate_profiles ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE candidate_profiles
  ADD CONSTRAINT candidate_profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES roleatlas_users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS candidate_profiles_user_updated_idx
  ON candidate_profiles (user_id, updated_at DESC);

ALTER TABLE search_plans ADD COLUMN IF NOT EXISTS user_id UUID;
UPDATE search_plans p
SET user_id = profile.user_id
FROM candidate_profiles profile
WHERE p.profile_id = profile.id AND p.user_id IS NULL;
ALTER TABLE search_plans ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE search_plans
  ADD CONSTRAINT search_plans_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES roleatlas_users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS search_plans_user_updated_idx
  ON search_plans (user_id, updated_at DESC);

ALTER TABLE search_sessions ADD COLUMN IF NOT EXISTS user_id UUID;
UPDATE search_sessions s
SET user_id = profile.user_id
FROM candidate_profiles profile
WHERE s.profile_id = profile.id AND s.user_id IS NULL;
UPDATE search_sessions s
SET user_id = plan.user_id
FROM search_plans plan
WHERE s.plan_id = plan.id AND s.user_id IS NULL;
UPDATE search_sessions
SET user_id = '00000000-0000-4000-8000-000000000001'
WHERE user_id IS NULL;
ALTER TABLE search_sessions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE search_sessions
  ADD CONSTRAINT search_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES roleatlas_users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS search_sessions_user_started_idx
  ON search_sessions (user_id, started_at DESC);

ALTER TABLE search_feedback ADD COLUMN IF NOT EXISTS user_id UUID;
UPDATE search_feedback f
SET user_id = s.user_id
FROM search_sessions s
WHERE f.session_id = s.id AND f.user_id IS NULL;
ALTER TABLE search_feedback ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE search_feedback
  ADD CONSTRAINT search_feedback_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES roleatlas_users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS search_feedback_user_created_idx
  ON search_feedback (user_id, created_at DESC);

ALTER TABLE daily_workspaces ADD COLUMN IF NOT EXISTS user_id UUID;
UPDATE daily_workspaces
SET user_id = '00000000-0000-4000-8000-000000000001'
WHERE user_id IS NULL;
ALTER TABLE daily_workspaces ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE daily_workspaces
  ADD CONSTRAINT daily_workspaces_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES roleatlas_users(id) ON DELETE CASCADE;
ALTER TABLE daily_workspaces DROP CONSTRAINT IF EXISTS daily_workspaces_pkey;
ALTER TABLE daily_workspaces ADD PRIMARY KEY (user_id, workspace_key);
CREATE INDEX IF NOT EXISTS daily_workspaces_user_updated_idx
  ON daily_workspaces (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES roleatlas_users(id) ON DELETE SET NULL,
  subject_user_id UUID REFERENCES roleatlas_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  request_id TEXT,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_subject_created_idx
  ON audit_events (subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_type_created_idx
  ON audit_events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS data_export_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'expired')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS data_export_requests_user_requested_idx
  ON data_export_requests (user_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'processing', 'completed', 'cancelled', 'failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS account_deletion_requests_user_requested_idx
  ON account_deletion_requests (user_id, requested_at DESC);
