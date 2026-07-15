ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_job_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS canonical_url TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_url TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_domain TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS identity_key TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS identity_strategy TEXT;

UPDATE jobs SET
  source_type = COALESCE(source_type, LOWER(REGEXP_REPLACE(source_name, '[^a-zA-Z0-9]+', '_', 'g'))),
  source_id = COALESCE(source_id, LOWER(REGEXP_REPLACE(source_name, '[^a-zA-Z0-9]+', '_', 'g')) || ':legacy'),
  canonical_url = COALESCE(canonical_url, source_url),
  apply_url = COALESCE(apply_url, source_url),
  identity_key = COALESCE(identity_key, 'url:' || source_url),
  identity_strategy = COALESCE(identity_strategy, 'legacy_source_url');

ALTER TABLE jobs ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN source_type SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN canonical_url SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN apply_url SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN identity_key SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN identity_strategy SET NOT NULL;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_source_url_key;

CREATE INDEX IF NOT EXISTS jobs_source_identity_idx ON jobs (source_id, source_job_id) WHERE source_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_canonical_url_idx ON jobs (canonical_url);
CREATE INDEX IF NOT EXISTS jobs_identity_key_idx ON jobs (identity_key);

CREATE TABLE IF NOT EXISTS job_source_references (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  source_job_id TEXT,
  source_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, source_url)
);

CREATE TABLE IF NOT EXISTS job_merge_audit (
  id BIGSERIAL PRIMARY KEY,
  kept_job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  incoming_job_id UUID NOT NULL,
  matched_by TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  source_url TEXT NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
