-- Enforce that every user-owned child points to a parent owned by the same user.
-- Route and repository authorization remain mandatory; these composite keys are
-- defense in depth against a future write path accidentally mixing tenants.

ALTER TABLE candidate_profiles
  ADD CONSTRAINT candidate_profiles_user_id_id_key UNIQUE (user_id, id);
ALTER TABLE search_plans
  ADD CONSTRAINT search_plans_user_id_id_key UNIQUE (user_id, id);
ALTER TABLE search_sessions
  ADD CONSTRAINT search_sessions_user_id_id_key UNIQUE (user_id, id);
ALTER TABLE applications
  ADD CONSTRAINT applications_user_id_id_key UNIQUE (user_id, id);

ALTER TABLE search_plans
  ADD CONSTRAINT search_plans_user_profile_fkey
  FOREIGN KEY (user_id, profile_id)
  REFERENCES candidate_profiles(user_id, id);

ALTER TABLE search_sessions
  ADD CONSTRAINT search_sessions_user_profile_fkey
  FOREIGN KEY (user_id, profile_id)
  REFERENCES candidate_profiles(user_id, id);
ALTER TABLE search_sessions
  ADD CONSTRAINT search_sessions_user_plan_fkey
  FOREIGN KEY (user_id, plan_id)
  REFERENCES search_plans(user_id, id);

ALTER TABLE search_feedback
  ADD CONSTRAINT search_feedback_user_session_fkey
  FOREIGN KEY (user_id, session_id)
  REFERENCES search_sessions(user_id, id)
  ON DELETE CASCADE;

ALTER TABLE daily_workspaces
  ADD CONSTRAINT daily_workspaces_user_profile_fkey
  FOREIGN KEY (user_id, profile_id)
  REFERENCES candidate_profiles(user_id, id);

ALTER TABLE search_strategies
  ADD CONSTRAINT search_strategies_user_profile_fkey
  FOREIGN KEY (user_id, profile_id)
  REFERENCES candidate_profiles(user_id, id);
ALTER TABLE search_strategies
  ADD CONSTRAINT search_strategies_user_session_fkey
  FOREIGN KEY (user_id, last_session_id)
  REFERENCES search_sessions(user_id, id);

ALTER TABLE user_job_feedback
  ADD CONSTRAINT user_job_feedback_user_session_fkey
  FOREIGN KEY (user_id, session_id)
  REFERENCES search_sessions(user_id, id);

ALTER TABLE application_activities
  ADD CONSTRAINT application_activities_user_application_fkey
  FOREIGN KEY (user_id, application_id)
  REFERENCES applications(user_id, id)
  ON DELETE CASCADE;
ALTER TABLE application_contacts
  ADD CONSTRAINT application_contacts_user_application_fkey
  FOREIGN KEY (user_id, application_id)
  REFERENCES applications(user_id, id)
  ON DELETE CASCADE;
ALTER TABLE generated_application_artifacts
  ADD CONSTRAINT generated_artifacts_user_application_fkey
  FOREIGN KEY (user_id, application_id)
  REFERENCES applications(user_id, id)
  ON DELETE CASCADE;
