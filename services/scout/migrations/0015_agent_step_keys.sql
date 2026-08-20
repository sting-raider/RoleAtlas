-- Plan keys are stable references used to resolve observations across resumable
-- executions. Keep this additive rather than rewriting migration 0014.

ALTER TABLE agent_steps ADD COLUMN step_key TEXT;

UPDATE agent_steps
SET step_key = 'step_' || plan_version::text || '_' || ordinal::text
WHERE step_key IS NULL;

ALTER TABLE agent_steps ALTER COLUMN step_key SET NOT NULL;
ALTER TABLE agent_steps
  ADD CONSTRAINT agent_steps_step_key_format
  CHECK (step_key ~ '^[a-z][a-z0-9_]{0,127}$');
ALTER TABLE agent_steps
  ADD CONSTRAINT agent_steps_run_plan_key_unique
  UNIQUE (user_id, run_id, plan_version, step_key);
