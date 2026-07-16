ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS opportunity_classification JSONB NOT NULL DEFAULT '{"category":"unknown","jobType":"Full-time","originalLabel":"","matchedTerm":null,"evidenceSource":"unresolved","confidence":0.25,"evidence":["This historical listing has not yet been classified."]}'::jsonb,
  ADD COLUMN IF NOT EXISTS opportunity_normalization_version SMALLINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS jobs_opportunity_category_idx
  ON jobs ((opportunity_classification->>'category'));

CREATE INDEX IF NOT EXISTS jobs_opportunity_job_type_idx
  ON jobs ((opportunity_classification->>'jobType'));
