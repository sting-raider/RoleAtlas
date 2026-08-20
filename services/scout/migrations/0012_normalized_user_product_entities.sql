-- Durable, queryable user product state. The existing daily_workspaces JSON
-- remains as a backward-compatible presentation/preferences document while
-- these tables become the authoritative storage for business entities.

CREATE TABLE saved_jobs (
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  job_ref TEXT NOT NULL,
  canonical_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(snapshot) = 'object'),
  archived_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, job_ref),
  CHECK (length(job_ref) BETWEEN 1 AND 512)
);
CREATE INDEX saved_jobs_user_saved_idx ON saved_jobs (user_id, saved_at DESC);
CREATE INDEX saved_jobs_canonical_idx ON saved_jobs (canonical_job_id) WHERE canonical_job_id IS NOT NULL;

CREATE TABLE search_strategies (
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  profile_id UUID REFERENCES candidate_profiles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  active_revision_id TEXT NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_session_id UUID REFERENCES search_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id),
  CHECK (length(id) BETWEEN 1 AND 512)
);
CREATE INDEX search_strategies_user_status_idx ON search_strategies (user_id, status, updated_at DESC);

CREATE TABLE search_strategy_revisions (
  user_id UUID NOT NULL,
  strategy_id TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  reason TEXT NOT NULL CHECK (reason IN ('created', 'edited', 'regenerated', 'duplicated')),
  plan JSONB NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, strategy_id, id),
  UNIQUE (user_id, strategy_id, version),
  FOREIGN KEY (user_id, strategy_id) REFERENCES search_strategies(user_id, id) ON DELETE CASCADE
);
CREATE INDEX search_strategy_revisions_user_created_idx ON search_strategy_revisions (user_id, created_at DESC);

CREATE TABLE user_job_feedback (
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  job_ref TEXT NOT NULL,
  canonical_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  session_id UUID REFERENCES search_sessions(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN (
    'relevant', 'not_relevant', 'wrong_role', 'wrong_seniority', 'wrong_location',
    'not_eligible', 'compensation_too_low', 'not_interested_in_company', 'duplicate',
    'already_applied', 'closed', 'show_fewer_like_this'
  )),
  suggested_strategy_change TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  undone_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id),
  CHECK (length(job_ref) BETWEEN 1 AND 512)
);
CREATE INDEX user_job_feedback_user_job_idx ON user_job_feedback (user_id, job_ref, created_at DESC);

CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  job_ref TEXT NOT NULL,
  canonical_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN (
    'Interested', 'Saved', 'Preparing', 'Ready to apply', 'Applied', 'Recruiter screen',
    'Assessment', 'Technical interview', 'Final interview', 'Offer', 'Rejected',
    'Withdrawn', 'Closed before application', 'Archived'
  )),
  application_date DATE,
  next_action TEXT NOT NULL DEFAULT '',
  follow_up_date DATE,
  notes TEXT NOT NULL DEFAULT '',
  priority SMALLINT CHECK (priority BETWEEN 0 AND 5),
  tailored_resume_reference TEXT NOT NULL DEFAULT '',
  cover_letter_reference TEXT NOT NULL DEFAULT '',
  interview_preparation TEXT NOT NULL DEFAULT '',
  source_job_status TEXT NOT NULL DEFAULT 'unknown' CHECK (source_job_status IN ('active', 'possibly_closed', 'closed', 'unknown')),
  closure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, job_ref),
  CHECK (length(job_ref) BETWEEN 1 AND 512)
);
CREATE INDEX applications_user_stage_idx ON applications (user_id, stage, updated_at DESC);
CREATE INDEX applications_follow_up_idx ON applications (user_id, follow_up_date) WHERE follow_up_date IS NOT NULL;

CREATE TABLE application_activities (
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activity_type TEXT NOT NULL CHECK (activity_type IN ('created', 'stage_changed', 'note', 'follow_up', 'artifact', 'contact')),
  summary TEXT NOT NULL,
  PRIMARY KEY (application_id, id)
);
CREATE INDEX application_activities_user_at_idx ON application_activities (user_id, occurred_at DESC);

CREATE TABLE application_contacts (
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  detail TEXT NOT NULL,
  PRIMARY KEY (application_id, position)
);
CREATE INDEX application_contacts_user_idx ON application_contacts (user_id, application_id);

CREATE TABLE user_notifications (
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'new_strong_matches', 'source_expansion_completed', 'coverage_degraded',
    'saved_job_possibly_closing', 'saved_job_closed', 'follow_up_due', 'application_action'
  )),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  target_view TEXT NOT NULL CHECK (target_view IN ('home', 'discover', 'searches', 'saved', 'applications', 'sources')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX user_notifications_unread_idx ON user_notifications (user_id, created_at DESC) WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE TABLE recently_viewed_jobs (
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  job_ref TEXT NOT NULL,
  canonical_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, job_ref),
  CHECK (length(job_ref) BETWEEN 1 AND 512)
);
CREATE INDEX recently_viewed_jobs_user_at_idx ON recently_viewed_jobs (user_id, viewed_at DESC);

CREATE TABLE ai_activity (
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  action TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failed')),
  data_sent JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(data_sent) = 'array'),
  usage JSONB CHECK (usage IS NULL OR jsonb_typeof(usage) = 'object'),
  message TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX ai_activity_user_completed_idx ON ai_activity (user_id, completed_at DESC);

CREATE TABLE user_provider_configurations (
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  base_url TEXT NOT NULL,
  profile_note TEXT NOT NULL DEFAULT '',
  verification JSONB NOT NULL DEFAULT '{"status":"untested"}'::jsonb CHECK (jsonb_typeof(verification) = 'object'),
  credential_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, provider),
  CHECK (credential_reference IS NULL OR credential_reference <> '')
);

CREATE TABLE generated_application_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
  job_ref TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('evaluation', 'resume', 'cover_letter', 'interview', 'recruiter_message')),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) IN ('object', 'string')),
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CHECK (length(job_ref) BETWEEN 1 AND 512)
);
CREATE INDEX generated_artifacts_user_created_idx ON generated_application_artifacts (user_id, created_at DESC);

-- Backfill historical single-document state without discarding the JSON copy.
INSERT INTO saved_jobs (user_id, job_ref, canonical_job_id, saved_at, snapshot, updated_at)
SELECT w.user_id, item.key, j.id, w.updated_at, COALESCE(item.value->'snapshot', '{}'::jsonb), w.updated_at
FROM daily_workspaces w
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(w.state->'savedJobs') = 'object' THEN w.state->'savedJobs' ELSE '{}'::jsonb END) item
LEFT JOIN jobs j ON j.id::text = item.key
ON CONFLICT (user_id, job_ref) DO NOTHING;

INSERT INTO search_strategies (user_id, id, profile_id, name, status, active_revision_id, last_run_at, last_session_id, created_at, updated_at)
SELECT w.user_id, s.value->>'id', w.profile_id, COALESCE(NULLIF(s.value->>'name',''), 'My search'),
       CASE WHEN s.value->>'status' IN ('draft','active','paused','archived') THEN s.value->>'status' ELSE 'draft' END,
       COALESCE(NULLIF(s.value->>'activeRevisionId',''), 'legacy'), NULL, NULL, w.created_at, w.updated_at
FROM daily_workspaces w
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(w.state->'strategies') = 'array' THEN w.state->'strategies' ELSE '[]'::jsonb END) s
WHERE COALESCE(s.value->>'id','') <> ''
ON CONFLICT (user_id, id) DO NOTHING;

INSERT INTO search_strategy_revisions (user_id, strategy_id, id, version, reason, plan, created_at)
SELECT w.user_id, s.value->>'id', r.value->>'id',
       GREATEST(COALESCE((r.value->>'version')::integer, 1), 1),
       CASE WHEN r.value->>'reason' IN ('created','edited','regenerated','duplicated') THEN r.value->>'reason' ELSE 'created' END,
       CASE WHEN jsonb_typeof(r.value->'plan') = 'object' THEN r.value->'plan' ELSE '{}'::jsonb END,
       w.updated_at
FROM daily_workspaces w
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(w.state->'strategies') = 'array' THEN w.state->'strategies' ELSE '[]'::jsonb END) s
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.value->'revisions') = 'array' THEN s.value->'revisions' ELSE '[]'::jsonb END) r
WHERE COALESCE(s.value->>'id','') <> '' AND COALESCE(r.value->>'id','') <> ''
ON CONFLICT DO NOTHING;

INSERT INTO user_job_feedback (user_id, id, job_ref, canonical_job_id, reason, suggested_strategy_change, created_at, undone_at)
SELECT w.user_id, f.value->>'id', f.value->>'jobId', j.id,
       f.value->>'reason', NULLIF(f.value->>'suggestedStrategyChange',''), w.updated_at,
       CASE WHEN COALESCE(f.value->>'undoneAt','') <> '' THEN w.updated_at ELSE NULL END
FROM daily_workspaces w
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(w.state->'feedback') = 'array' THEN w.state->'feedback' ELSE '[]'::jsonb END) f
LEFT JOIN jobs j ON j.id::text = f.value->>'jobId'
WHERE COALESCE(f.value->>'id','') <> '' AND COALESCE(f.value->>'jobId','') <> ''
  AND f.value->>'reason' IN ('relevant','not_relevant','wrong_role','wrong_seniority','wrong_location','not_eligible','compensation_too_low','not_interested_in_company','duplicate','already_applied','closed','show_fewer_like_this')
ON CONFLICT DO NOTHING;

INSERT INTO applications (user_id, job_ref, canonical_job_id, stage, application_date, next_action, follow_up_date, notes, tailored_resume_reference, cover_letter_reference, interview_preparation, source_job_status, created_at, updated_at)
SELECT w.user_id, item.key, j.id,
       CASE WHEN item.value->>'stage' IN ('Interested','Saved','Preparing','Ready to apply','Applied','Recruiter screen','Assessment','Technical interview','Final interview','Offer','Rejected','Withdrawn','Closed before application','Archived') THEN item.value->>'stage' ELSE 'Saved' END,
       NULL, COALESCE(item.value->>'nextAction',''), NULL, COALESCE(item.value->>'notes',''),
       COALESCE(item.value->>'tailoredResumeReference',''), COALESCE(item.value->>'coverLetterReference',''), COALESCE(item.value->>'interviewPreparation',''),
       CASE WHEN item.value->>'sourceJobStatus' IN ('active','possibly_closed','closed','unknown') THEN item.value->>'sourceJobStatus' ELSE 'unknown' END,
       w.created_at, w.updated_at
FROM daily_workspaces w
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(w.state->'applications') = 'object' THEN w.state->'applications' ELSE '{}'::jsonb END) item
LEFT JOIN jobs j ON j.id::text = item.key
ON CONFLICT (user_id, job_ref) DO NOTHING;

INSERT INTO application_activities (application_id, id, user_id, occurred_at, activity_type, summary)
SELECT a.id, activity.value->>'id', w.user_id, w.updated_at,
       CASE WHEN activity.value->>'type' IN ('created','stage_changed','note','follow_up','artifact','contact') THEN activity.value->>'type' ELSE 'note' END,
       COALESCE(activity.value->>'summary','')
FROM daily_workspaces w
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(w.state->'applications') = 'object' THEN w.state->'applications' ELSE '{}'::jsonb END) item
JOIN applications a ON a.user_id = w.user_id AND a.job_ref = item.key
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(item.value->'activity') = 'array' THEN item.value->'activity' ELSE '[]'::jsonb END) activity
WHERE COALESCE(activity.value->>'id','') <> ''
ON CONFLICT DO NOTHING;

INSERT INTO application_contacts (application_id, position, user_id, name, detail)
SELECT a.id, contact.ordinality::integer - 1, w.user_id,
       COALESCE(contact.value->>'name',''), COALESCE(contact.value->>'detail','')
FROM daily_workspaces w
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(w.state->'applications') = 'object' THEN w.state->'applications' ELSE '{}'::jsonb END) item
JOIN applications a ON a.user_id = w.user_id AND a.job_ref = item.key
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(item.value->'contacts') = 'array' THEN item.value->'contacts' ELSE '[]'::jsonb END) WITH ORDINALITY contact
ON CONFLICT DO NOTHING;

INSERT INTO user_notifications (user_id, id, dedupe_key, notification_type, title, detail, target_view, created_at, read_at, dismissed_at)
SELECT w.user_id, n.value->>'id', n.value->>'dedupeKey', n.value->>'type', COALESCE(n.value->>'title',''), COALESCE(n.value->>'detail',''), n.value->>'targetView', w.updated_at,
       CASE WHEN COALESCE(n.value->>'readAt','') <> '' THEN w.updated_at ELSE NULL END,
       CASE WHEN COALESCE(n.value->>'dismissedAt','') <> '' THEN w.updated_at ELSE NULL END
FROM daily_workspaces w
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(w.state->'notifications') = 'array' THEN w.state->'notifications' ELSE '[]'::jsonb END) n
WHERE COALESCE(n.value->>'id','') <> '' AND COALESCE(n.value->>'dedupeKey','') <> ''
  AND n.value->>'type' IN ('new_strong_matches','source_expansion_completed','coverage_degraded','saved_job_possibly_closing','saved_job_closed','follow_up_due','application_action')
  AND n.value->>'targetView' IN ('home','discover','searches','saved','applications','sources')
ON CONFLICT DO NOTHING;

INSERT INTO recently_viewed_jobs (user_id, job_ref, canonical_job_id, viewed_at)
SELECT w.user_id, v.value->>'jobId', j.id, w.updated_at
FROM daily_workspaces w
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(w.state->'recentViews') = 'array' THEN w.state->'recentViews' ELSE '[]'::jsonb END) v
LEFT JOIN jobs j ON j.id::text = v.value->>'jobId'
WHERE COALESCE(v.value->>'jobId','') <> ''
ON CONFLICT (user_id, job_ref) DO NOTHING;
