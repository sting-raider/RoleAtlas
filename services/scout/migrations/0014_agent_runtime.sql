-- Persistent, tenant-owned state for the RoleAtlas plan -> act -> observe ->
-- re-plan runtime. Model providers never receive direct access to these tables;
-- the server-side runtime is the only writer.

CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES roleatlas_users(id) ON DELETE CASCADE,
  goal TEXT NOT NULL CHECK (length(goal) BETWEEN 3 AND 10000),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'planning', 'running', 'waiting_for_approval', 'waiting_for_tool',
    'paused', 'completed', 'failed', 'cancelled'
  )),
  phase TEXT NOT NULL DEFAULT 'planning' CHECK (phase IN (
    'planning', 'acting', 'observing', 'replanning', 'awaiting_approval', 'finished'
  )),
  autonomy TEXT NOT NULL DEFAULT 'guided' CHECK (autonomy IN ('guided', 'autonomous')),
  plan_version INTEGER NOT NULL DEFAULT 0 CHECK (plan_version >= 0),
  current_step_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (current_step_ordinal >= 0),
  max_steps INTEGER NOT NULL CHECK (max_steps BETWEEN 1 AND 100),
  steps_used INTEGER NOT NULL DEFAULT 0 CHECK (steps_used >= 0),
  max_tool_calls INTEGER NOT NULL CHECK (max_tool_calls BETWEEN 1 AND 200),
  tool_calls_used INTEGER NOT NULL DEFAULT 0 CHECK (tool_calls_used >= 0),
  max_tokens INTEGER NOT NULL CHECK (max_tokens BETWEEN 0 AND 1000000),
  tokens_used INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  max_cost_micros BIGINT NOT NULL CHECK (max_cost_micros >= 0),
  cost_micros BIGINT NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  max_wall_time_ms BIGINT NOT NULL CHECK (max_wall_time_ms BETWEEN 1000 AND 604800000),
  max_concurrency INTEGER NOT NULL CHECK (max_concurrency BETWEEN 1 AND 16),
  provider TEXT,
  model TEXT,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  last_error_code TEXT,
  last_error_message TEXT,
  cancellation_requested_at TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ NOT NULL,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, id),
  CHECK (steps_used <= max_steps),
  CHECK (tool_calls_used <= max_tool_calls),
  CHECK (tokens_used <= max_tokens OR max_tokens = 0),
  CHECK (cost_micros <= max_cost_micros OR max_cost_micros = 0)
);

CREATE INDEX agent_runs_user_updated_idx ON agent_runs (user_id, updated_at DESC);
CREATE INDEX agent_runs_runnable_idx ON agent_runs (status, lease_expires_at, updated_at)
  WHERE status IN ('queued', 'planning', 'running', 'waiting_for_tool');

CREATE TABLE agent_plan_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  run_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  reason TEXT NOT NULL CHECK (reason IN (
    'initial', 'new_evidence', 'tool_failure', 'coverage_change', 'user_feedback', 'user_edit'
  )),
  rationale TEXT NOT NULL DEFAULT '',
  plan JSONB NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, run_id, version),
  FOREIGN KEY (user_id, run_id) REFERENCES agent_runs(user_id, id) ON DELETE CASCADE
);

CREATE INDEX agent_plan_revisions_run_idx
  ON agent_plan_revisions (user_id, run_id, version DESC);

CREATE TABLE agent_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  run_id UUID NOT NULL,
  plan_version INTEGER NOT NULL CHECK (plan_version > 0),
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  kind TEXT NOT NULL CHECK (kind IN (
    'plan', 'tool', 'observation', 'replan', 'delegation', 'approval', 'message'
  )),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'waiting', 'succeeded', 'failed', 'skipped', 'cancelled'
  )),
  title TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  tool_name TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input) = 'object'),
  output JSONB CHECK (output IS NULL OR jsonb_typeof(output) IN ('object', 'array', 'string', 'number', 'boolean')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  parent_step_id UUID,
  worker_key TEXT,
  idempotency_key TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 10),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, run_id, plan_version, ordinal),
  UNIQUE (user_id, run_id, id),
  UNIQUE (user_id, run_id, idempotency_key),
  FOREIGN KEY (user_id, run_id) REFERENCES agent_runs(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, run_id, parent_step_id)
    REFERENCES agent_steps(user_id, run_id, id) ON DELETE CASCADE
);

CREATE INDEX agent_steps_run_status_idx
  ON agent_steps (user_id, run_id, status, plan_version, ordinal);

CREATE TABLE agent_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  run_id UUID NOT NULL,
  step_id UUID NOT NULL,
  tool_name TEXT NOT NULL,
  effect_level TEXT NOT NULL CHECK (effect_level IN (
    'read_only', 'internal_write', 'approval_required'
  )),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed', 'waiting_for_approval', 'running', 'succeeded', 'failed', 'rejected', 'cancelled'
  )),
  arguments JSONB NOT NULL CHECK (jsonb_typeof(arguments) = 'object'),
  result JSONB CHECK (result IS NULL OR jsonb_typeof(result) IN ('object', 'array', 'string', 'number', 'boolean')),
  policy_decision JSONB NOT NULL CHECK (jsonb_typeof(policy_decision) = 'object'),
  idempotency_key TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 10),
  provider TEXT,
  model TEXT,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  estimated_cost_micros BIGINT CHECK (estimated_cost_micros IS NULL OR estimated_cost_micros >= 0),
  latency_ms BIGINT CHECK (latency_ms IS NULL OR latency_ms >= 0),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, run_id, id),
  UNIQUE (user_id, run_id, idempotency_key),
  FOREIGN KEY (user_id, run_id) REFERENCES agent_runs(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, run_id, step_id)
    REFERENCES agent_steps(user_id, run_id, id) ON DELETE CASCADE
);

CREATE INDEX agent_tool_calls_run_created_idx
  ON agent_tool_calls (user_id, run_id, created_at);

CREATE TABLE agent_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  run_id UUID NOT NULL,
  tool_call_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'expired', 'consumed', 'cancelled'
  )),
  summary TEXT NOT NULL,
  scope JSONB NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES roleatlas_users(id) ON DELETE SET NULL,
  decision_note TEXT,
  consumed_at TIMESTAMPTZ,
  UNIQUE (user_id, run_id, tool_call_id),
  FOREIGN KEY (user_id, run_id) REFERENCES agent_runs(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, run_id, tool_call_id)
    REFERENCES agent_tool_calls(user_id, run_id, id) ON DELETE CASCADE
);

CREATE INDEX agent_approvals_pending_idx
  ON agent_approvals (user_id, requested_at DESC) WHERE status = 'pending';

CREATE TABLE agent_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  run_id UUID NOT NULL,
  parent_step_id UUID NOT NULL,
  worker_key TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'completed', 'failed', 'cancelled'
  )),
  max_steps INTEGER NOT NULL CHECK (max_steps BETWEEN 1 AND 50),
  steps_used INTEGER NOT NULL DEFAULT 0 CHECK (steps_used BETWEEN 0 AND max_steps),
  max_tool_calls INTEGER NOT NULL CHECK (max_tool_calls BETWEEN 1 AND 100),
  tool_calls_used INTEGER NOT NULL DEFAULT 0 CHECK (tool_calls_used BETWEEN 0 AND max_tool_calls),
  result JSONB CHECK (result IS NULL OR jsonb_typeof(result) IN ('object', 'array', 'string', 'number', 'boolean')),
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, run_id, worker_key),
  FOREIGN KEY (user_id, run_id) REFERENCES agent_runs(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, run_id, parent_step_id)
    REFERENCES agent_steps(user_id, run_id, id) ON DELETE CASCADE
);

CREATE INDEX agent_workers_run_status_idx
  ON agent_workers (user_id, run_id, status, created_at);

CREATE TABLE agent_run_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  run_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id, run_id) REFERENCES agent_runs(user_id, id) ON DELETE CASCADE
);

CREATE INDEX agent_run_events_run_idx
  ON agent_run_events (user_id, run_id, id);
