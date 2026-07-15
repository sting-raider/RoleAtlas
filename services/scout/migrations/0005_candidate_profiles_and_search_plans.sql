CREATE TABLE IF NOT EXISTS candidate_profiles (
  id UUID PRIMARY KEY,
  profile JSONB NOT NULL,
  source_file TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS search_plans (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  plan JSONB NOT NULL,
  confirmed_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_search_plan_per_profile ON search_plans (profile_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS candidate_profiles_updated_idx ON candidate_profiles (updated_at DESC);
