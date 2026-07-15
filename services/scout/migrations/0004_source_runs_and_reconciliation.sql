CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  supports_complete_scan BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_runs (
  id UUID PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_url TEXT NOT NULL,
  scan_kind TEXT NOT NULL CHECK (scan_kind IN ('complete', 'partial')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  observed_jobs INTEGER NOT NULL DEFAULT 0,
  chunks_expected INTEGER NOT NULL DEFAULT 1,
  chunks_received INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS source_runs_source_started_idx ON source_runs (source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS source_run_jobs (
  run_id UUID NOT NULL REFERENCES source_runs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, job_id)
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS missing_since_run_id UUID REFERENCES source_runs(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
UPDATE jobs SET last_verified_at = COALESCE(last_verified_at, last_seen_at), lifecycle_status = CASE WHEN is_active THEN 'active' ELSE 'closed' END;
ALTER TABLE jobs ADD CONSTRAINT jobs_lifecycle_status_check CHECK (lifecycle_status IN ('active', 'possibly_closed', 'closed'));

ALTER TABLE job_source_references ADD COLUMN IF NOT EXISTS last_seen_run_id UUID REFERENCES source_runs(id);
CREATE INDEX IF NOT EXISTS jobs_lifecycle_idx ON jobs (lifecycle_status, date_posted DESC);
