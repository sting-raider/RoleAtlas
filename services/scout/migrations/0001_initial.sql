CREATE TABLE IF NOT EXISTS crawl_frontier (
  url TEXT PRIMARY KEY,
  depth SMALLINT NOT NULL DEFAULT 0,
  discovered_from TEXT,
  state TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetched_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS crawl_frontier_state_idx ON crawl_frontier (state, queued_at);

CREATE TABLE IF NOT EXISTS crawled_pages (
  url TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  content_hash TEXT,
  content_bytes BIGINT NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL,
  elapsed_ms BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  source_url TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  country TEXT,
  remote BOOLEAN NOT NULL DEFAULT FALSE,
  employment_type TEXT,
  experience_years SMALLINT,
  degree_required BOOLEAN,
  salary_min DOUBLE PRECISION,
  salary_max DOUBLE PRECISION,
  salary_currency TEXT,
  date_posted DATE,
  valid_through DATE,
  description TEXT NOT NULL,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw JSONB NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS jobs_match_idx ON jobs (experience_years, remote, date_posted DESC);
CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs (LOWER(company));
CREATE INDEX IF NOT EXISTS jobs_title_idx ON jobs (LOWER(title));
