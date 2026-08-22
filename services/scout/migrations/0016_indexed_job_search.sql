-- Indexed lexical retrieval and stable cursor support for the shared canonical
-- job index. Eligibility remains a separate deterministic layer.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS search_document TSVECTOR
  GENERATED ALWAYS AS (
    SETWEIGHT(TO_TSVECTOR('simple', COALESCE(title, '')), 'A') ||
    SETWEIGHT(TO_TSVECTOR('simple', COALESCE(company, '')), 'B') ||
    SETWEIGHT(TO_TSVECTOR('simple', COALESCE(description, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS jobs_search_document_gin_idx
  ON jobs USING GIN (search_document);
CREATE INDEX IF NOT EXISTS jobs_title_trgm_idx
  ON jobs USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS jobs_company_trgm_idx
  ON jobs USING GIN (company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS jobs_location_trgm_idx
  ON jobs USING GIN (location gin_trgm_ops);

CREATE INDEX IF NOT EXISTS jobs_active_cursor_idx
  ON jobs (
    date_posted DESC NULLS LAST,
    first_seen_at DESC,
    id DESC
  )
  WHERE lifecycle_status IN ('active', 'possibly_closed');

CREATE INDEX IF NOT EXISTS jobs_active_source_cursor_idx
  ON jobs (
    source_id,
    date_posted DESC NULLS LAST,
    first_seen_at DESC,
    id DESC
  )
  WHERE lifecycle_status IN ('active', 'possibly_closed');

CREATE INDEX IF NOT EXISTS jobs_active_remote_experience_idx
  ON jobs (
    remote,
    experience_years,
    date_posted DESC NULLS LAST,
    id DESC
  )
  WHERE lifecycle_status IN ('active', 'possibly_closed');
