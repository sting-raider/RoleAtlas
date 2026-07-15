CREATE TABLE IF NOT EXISTS search_sessions (
  id UUID PRIMARY KEY,
  profile_id UUID REFERENCES candidate_profiles(id) ON DELETE SET NULL,
  plan_id UUID REFERENCES search_plans(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  plan_snapshot JSONB NOT NULL,
  coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
  query_count INTEGER NOT NULL DEFAULT 0,
  result_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error TEXT
);

CREATE TABLE IF NOT EXISTS search_session_queries (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  match_count INTEGER NOT NULL DEFAULT 0,
  execution_ms BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS search_session_results (
  session_id UUID NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  score DOUBLE PRECISION NOT NULL,
  rank INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, job_id)
);

CREATE TABLE IF NOT EXISTS search_result_matches (
  session_id UUID NOT NULL,
  job_id UUID NOT NULL,
  query_id UUID NOT NULL REFERENCES search_session_queries(id) ON DELETE CASCADE,
  reason JSONB NOT NULL,
  PRIMARY KEY (session_id, job_id, query_id),
  FOREIGN KEY (session_id, job_id) REFERENCES search_session_results(session_id, job_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS search_feedback (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('viewed', 'saved', 'dismissed', 'applied')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS search_sessions_started_idx ON search_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS search_feedback_session_idx ON search_feedback (session_id, created_at DESC);
