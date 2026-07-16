ALTER TABLE search_sessions
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'completed'
    CHECK (stage IN ('searching_index','evaluating_geographic_coverage','identifying_source_gaps','scanning_sources','normalizing_jobs','evaluating_eligibility','reranking','completed','partial')),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS search_session_sources (
  session_id UUID NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('fresh','stale','unscanned','queued','scanning','success','failed','deferred')),
  selected_reason JSONB NOT NULL DEFAULT '{}'::jsonb,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queued_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  source_run_id UUID REFERENCES source_runs(id) ON DELETE SET NULL,
  observed_jobs INTEGER,
  error TEXT,
  PRIMARY KEY (session_id, source_id)
);

CREATE INDEX IF NOT EXISTS search_session_sources_state_idx
  ON search_session_sources (session_id, state);

CREATE INDEX IF NOT EXISTS search_session_sources_source_idx
  ON search_session_sources (source_id, selected_at DESC);
