ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS geographic_locations JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS remote_policy JSONB NOT NULL DEFAULT '{"mode":"unknown","scope":"unspecified","eligibleCountryCodes":[],"excludedCountryCodes":[],"eligibleRegionCodes":[],"excludedRegionCodes":[],"excludedSubdivisionCodes":[],"requiredTimezones":[],"requiredUtcOffsetRange":null,"residencyRequirements":[],"workAuthorizationRequirements":[],"sponsorshipAvailable":null,"officeLocations":[],"officeFrequency":null,"confidence":0.2,"evidence":["This historical listing has not yet been re-normalized."],"originalWording":""}'::jsonb,
  ADD COLUMN IF NOT EXISTS geography_normalization_version SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE search_session_results
  ADD COLUMN IF NOT EXISTS eligibility_status TEXT NOT NULL DEFAULT 'unclear'
    CHECK (eligibility_status IN ('confirmed', 'likely', 'unclear', 'excluded', 'requires_sponsorship', 'requires_relocation', 'requires_office_attendance', 'timezone_mismatch')),
  ADD COLUMN IF NOT EXISTS eligibility JSONB NOT NULL DEFAULT '{"status":"unclear","confidence":0.2,"evidence":["Eligibility has not yet been evaluated."]}'::jsonb;

CREATE INDEX IF NOT EXISTS jobs_geographic_locations_gin_idx
  ON jobs USING GIN (geographic_locations);

CREATE INDEX IF NOT EXISTS jobs_remote_policy_gin_idx
  ON jobs USING GIN (remote_policy);

CREATE INDEX IF NOT EXISTS search_session_results_eligibility_idx
  ON search_session_results (session_id, eligibility_status, rank);
