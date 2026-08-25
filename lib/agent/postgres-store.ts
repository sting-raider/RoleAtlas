import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { postgres } from "../postgres.ts";
import {
  AgentBudgetSchema,
  AgentPlanSchema,
  AgentRunRequestSchema,
  untrustedEvidence,
  type AgentPlan,
  type AgentRunRequest,
  type AgentRunStatus,
} from "./contracts.ts";
import type {
  ApprovedRuntimeToolCall,
  AgentRuntimeStore,
  RuntimeSnapshot,
  RuntimeStep,
  RuntimeToolCall,
  RuntimeWorker,
  RuntimeWorkerAttempt,
} from "./runtime.ts";

function asDate(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeMessage(message: string) {
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function rowToStep(row: QueryResultRow): RuntimeStep {
  return {
    id: String(row.id),
    key: String(row.step_key),
    ordinal: Number(row.ordinal),
    planVersion: Number(row.plan_version),
    title: String(row.title),
    objective: String(row.objective),
    toolName: row.tool_name ? String(row.tool_name) : undefined,
    input: asObject(row.input),
    status: row.status as RuntimeStep["status"],
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
  };
}

function rowToWorker(row: QueryResultRow): RuntimeWorker {
  return {
    id: String(row.id),
    key: String(row.worker_key),
    task: String(row.task),
    status: row.status as RuntimeWorker["status"],
    maxSteps: Number(row.max_steps),
    stepsUsed: Number(row.steps_used),
    maxToolCalls: Number(row.max_tool_calls),
    toolCallsUsed: Number(row.tool_calls_used),
    result: row.result ?? undefined,
    errorCode: row.error_code ? String(row.error_code) : undefined,
  };
}

export async function createPersistentAgentRun(
  userId: string,
  requestInput: AgentRunRequest,
) {
  const request = AgentRunRequestSchema.parse(requestInput);
  const budget = AgentBudgetSchema.parse(request.budget ?? {});
  const id = randomUUID();
  const row = await postgres.query(
    `INSERT INTO agent_runs (
       id,user_id,goal,autonomy,max_steps,max_tool_calls,max_tokens,max_cost_micros,
       max_wall_time_ms,max_concurrency,provider,model,deadline_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::bigint,$10,$11,$12,NOW()+($9::bigint * INTERVAL '1 millisecond'))
     RETURNING id,status,phase,created_at,deadline_at`,
    [
      id,
      userId,
      request.goal,
      request.autonomy,
      budget.maxSteps,
      budget.maxToolCalls,
      budget.maxTokens,
      budget.maxCostMicros,
      budget.maxWallTimeMs,
      budget.maxConcurrency,
      request.provider ?? null,
      request.model ?? null,
    ],
  );
  await postgres.query(
    "INSERT INTO agent_run_events (user_id,run_id,event_type,data) VALUES ($1,$2,'run.created',$3)",
    [userId, id, JSON.stringify({ autonomy: request.autonomy, budget })],
  );
  return {
    id,
    status: String(row.rows[0].status),
    phase: String(row.rows[0].phase),
    createdAt: asDate(row.rows[0].created_at),
    deadlineAt: asDate(row.rows[0].deadline_at),
  };
}

export async function listPersistentAgentRuns(userId: string, limit = 30) {
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 100)) : 30;
  const result = await postgres.query(
    `SELECT id,goal,status,phase,autonomy,plan_version,current_step_ordinal,
            steps_used,max_steps,tool_calls_used,max_tool_calls,tokens_used,max_tokens,
            cost_micros,max_cost_micros,summary,last_error_code,last_error_message,
            created_at,started_at,updated_at,completed_at
     FROM agent_runs WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2`,
    [userId, boundedLimit],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    goal: String(row.goal),
    status: String(row.status),
    phase: String(row.phase),
    autonomy: String(row.autonomy),
    planVersion: Number(row.plan_version),
    currentStepOrdinal: Number(row.current_step_ordinal),
    usage: {
      steps: Number(row.steps_used),
      maxSteps: Number(row.max_steps),
      toolCalls: Number(row.tool_calls_used),
      maxToolCalls: Number(row.max_tool_calls),
      tokens: Number(row.tokens_used),
      maxTokens: Number(row.max_tokens),
      costMicros: Number(row.cost_micros),
      maxCostMicros: Number(row.max_cost_micros),
    },
    summary: asObject(row.summary),
    error: row.last_error_code
      ? { code: String(row.last_error_code), message: String(row.last_error_message ?? "") }
      : null,
    createdAt: asDate(row.created_at),
    startedAt: row.started_at ? asDate(row.started_at) : null,
    updatedAt: asDate(row.updated_at),
    completedAt: row.completed_at ? asDate(row.completed_at) : null,
  }));
}

export async function getPersistentAgentRun(userId: string, runId: string) {
  const client = await postgres.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const run = await client.query(
      `SELECT id,goal,status,phase,autonomy,plan_version,current_step_ordinal,
              steps_used,max_steps,tool_calls_used,max_tool_calls,tokens_used,max_tokens,
              cost_micros,max_cost_micros,max_wall_time_ms,max_concurrency,provider,model,
              summary,last_error_code,last_error_message,cancellation_requested_at,deadline_at,
              created_at,started_at,updated_at,completed_at
       FROM agent_runs WHERE user_id=$1 AND id=$2`,
      [userId, runId],
    );
    if (!run.rowCount) {
      await client.query("COMMIT");
      return null;
    }
    const plans = await client.query(
        `SELECT id,version,reason,rationale,plan,provider,model,created_at
         FROM agent_plan_revisions WHERE user_id=$1 AND run_id=$2 ORDER BY version`,
        [userId, runId],
      );
    const steps = await client.query(
        `SELECT id,step_key,plan_version,ordinal,kind,status,title,objective,tool_name,input,output,
                evidence,parent_step_id,worker_key,attempt_count,max_attempts,started_at,completed_at,
                error_code,error_message,created_at,updated_at
         FROM agent_steps WHERE user_id=$1 AND run_id=$2 ORDER BY created_at,ordinal`,
        [userId, runId],
      );
    const calls = await client.query(
        `SELECT id,step_id,tool_name,effect_level,status,arguments,result,policy_decision,
                idempotency_key,attempt,provider,model,input_tokens,output_tokens,
                estimated_cost_micros,latency_ms,started_at,completed_at,error_code,error_message,created_at
         FROM agent_tool_calls WHERE user_id=$1 AND run_id=$2 ORDER BY created_at`,
        [userId, runId],
      );
    const approvals = await client.query(
        `SELECT id,tool_call_id,status,summary,scope,requested_at,expires_at,decided_at,
                decision_note,consumed_at
         FROM agent_approvals WHERE user_id=$1 AND run_id=$2 ORDER BY requested_at`,
        [userId, runId],
      );
    const workers = await client.query(
        `SELECT id,parent_step_id,worker_key,task,status,max_steps,steps_used,max_tool_calls,
                tool_calls_used,result,error_code,error_message,created_at,started_at,completed_at
         FROM agent_workers WHERE user_id=$1 AND run_id=$2 ORDER BY created_at`,
        [userId, runId],
      );
    const events = await client.query(
        "SELECT id,event_type,data,created_at FROM agent_run_events WHERE user_id=$1 AND run_id=$2 ORDER BY id",
        [userId, runId],
      );
    await client.query("COMMIT");
    return {
      run: run.rows[0],
      planRevisions: plans.rows,
      steps: steps.rows,
      toolCalls: calls.rows,
      approvals: approvals.rows,
      workers: workers.rows,
      events: events.rows,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresAgentRuntimeStore implements AgentRuntimeStore {
  async claim(userId: string, runId: string, leaseOwner: string, leaseMs: number) {
    const result = await postgres.query(
      `UPDATE agent_runs
       SET lease_owner=$3, lease_expires_at=NOW()+($4::text||' milliseconds')::interval,
           started_at=COALESCE(started_at,NOW()), updated_at=NOW()
       WHERE user_id=$1 AND id=$2
         AND status NOT IN ('completed','failed','cancelled')
         AND (lease_expires_at IS NULL OR lease_expires_at < NOW() OR lease_owner=$3)
       RETURNING id`,
      [userId, runId, leaseOwner, Math.max(1_000, Math.min(leaseMs, 300_000))],
    );
    return result.rowCount === 1;
  }

  async release(userId: string, runId: string, leaseOwner: string) {
    await postgres.query(
      "UPDATE agent_runs SET lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW() WHERE user_id=$1 AND id=$2 AND lease_owner=$3",
      [userId, runId, leaseOwner],
    );
  }

  async recoverInterrupted(
    userId: string,
    runId: string,
    idempotentToolNames: string[],
  ): Promise<"recovered" | "manual_review" | null> {
    return transaction(async (client) => {
      const running = await client.query(
        `SELECT s.id AS step_id,c.id AS call_id,c.tool_name,c.effect_level
         FROM agent_steps s
         LEFT JOIN agent_tool_calls c
           ON c.user_id=s.user_id AND c.run_id=s.run_id AND c.step_id=s.id AND c.status='running'
         WHERE s.user_id=$1 AND s.run_id=$2 AND s.status='running'
         FOR UPDATE OF s`,
        [userId, runId],
      );
      const interruptedWorkers = await client.query(
        `UPDATE agent_workers
         SET status=CASE WHEN steps_used < max_steps AND tool_calls_used < max_tool_calls
                         THEN 'queued' ELSE 'failed' END,
             error_code='execution_interrupted',
             error_message='Worker execution was interrupted before a durable result was recorded.'
         WHERE user_id=$1 AND run_id=$2 AND status='running'
         RETURNING id,status`,
        [userId, runId],
      );
      if (!running.rowCount && !interruptedWorkers.rowCount) return null;
      let manualReview = false;
      for (const row of running.rows) {
        const callId = row.call_id ? String(row.call_id) : null;
        const toolName = row.tool_name ? String(row.tool_name) : null;
        const safeToRetry = !callId || (toolName != null && idempotentToolNames.includes(toolName));
        if (safeToRetry) {
          if (callId) {
            await client.query(
              `UPDATE agent_tool_calls SET status='failed',error_code='execution_interrupted',
                 error_message='Execution was interrupted before a durable result was recorded.',completed_at=NOW()
               WHERE user_id=$1 AND run_id=$2 AND id=$3`,
              [userId, runId, callId],
            );
          }
          await client.query(
            `UPDATE agent_steps SET status='pending',error_code='execution_interrupted',
               error_message='Safe retry scheduled after an interrupted execution.',updated_at=NOW()
             WHERE user_id=$1 AND run_id=$2 AND id=$3`,
            [userId, runId, row.step_id],
          );
        } else {
          manualReview = true;
          await client.query(
            `UPDATE agent_tool_calls SET status='failed',error_code='non_idempotent_outcome_unknown',
               error_message='Execution was interrupted and the external outcome cannot be assumed.',completed_at=NOW()
             WHERE user_id=$1 AND run_id=$2 AND id=$3`,
            [userId, runId, callId],
          );
          await client.query(
            `UPDATE agent_steps SET status='waiting',error_code='non_idempotent_outcome_unknown',
               error_message='Human review is required before any retry.',updated_at=NOW()
             WHERE user_id=$1 AND run_id=$2 AND id=$3`,
            [userId, runId, row.step_id],
          );
        }
      }
      await client.query(
        `UPDATE agent_runs SET status=$3,phase=$4,last_error_code=$5,last_error_message=$6,updated_at=NOW()
         WHERE user_id=$1 AND id=$2`,
        [
          userId,
          runId,
          manualReview ? "paused" : "running",
          manualReview ? "awaiting_approval" : "acting",
          manualReview ? "non_idempotent_outcome_unknown" : null,
          manualReview ? "An interrupted external action needs human review." : null,
        ],
      );
      await client.query(
        "INSERT INTO agent_run_events (user_id,run_id,event_type,data) VALUES ($1,$2,$3,$4)",
        [
          userId,
          runId,
          manualReview ? "run.manual_review_required" : "run.interrupted_steps_recovered",
          JSON.stringify({
            interruptedSteps: running.rowCount,
            interruptedWorkers: interruptedWorkers.rowCount,
          }),
        ],
      );
      return manualReview ? "manual_review" : "recovered";
    });
  }

  async snapshot(userId: string, runId: string): Promise<RuntimeSnapshot | null> {
    const client = await postgres.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const runResult = await client.query(
        `SELECT id,user_id,goal,status,plan_version,max_steps,steps_used,max_tool_calls,
                tool_calls_used,max_tokens,tokens_used,max_cost_micros,cost_micros,
                max_wall_time_ms,max_concurrency,created_at,cancellation_requested_at
         FROM agent_runs WHERE user_id=$1 AND id=$2`,
        [userId, runId],
      );
      if (!runResult.rowCount) {
        await client.query("COMMIT");
        return null;
      }
      const run = runResult.rows[0];
      const planResult = await client.query(
          "SELECT plan FROM agent_plan_revisions WHERE user_id=$1 AND run_id=$2 ORDER BY version DESC LIMIT 1",
          [userId, runId],
        );
      const stepResult = await client.query(
          `SELECT id,step_key,ordinal,plan_version,title,objective,tool_name,input,status,attempt_count,max_attempts
           FROM agent_steps
           WHERE user_id=$1 AND run_id=$2 AND kind IN ('tool','message','delegation')
           ORDER BY plan_version,ordinal`,
          [userId, runId],
        );
      const observationResult = await client.query(
          `SELECT parent.step_key,observation.output,observation.completed_at,observation.created_at
           FROM agent_steps observation
           JOIN agent_steps parent
             ON parent.user_id=observation.user_id AND parent.run_id=observation.run_id
            AND parent.id=observation.parent_step_id
           WHERE observation.user_id=$1 AND observation.run_id=$2
             AND observation.kind='observation' AND observation.status='succeeded'
           ORDER BY observation.created_at`,
          [userId, runId],
        );
      const workerResult = await client.query(
          "SELECT COUNT(*)::int AS count FROM agent_workers WHERE user_id=$1 AND run_id=$2 AND status='running'",
          [userId, runId],
        );
      await client.query("COMMIT");
      const observations: Record<string, unknown> = {};
      const evidence = observationResult.rows.map((row) => {
        observations[String(row.step_key)] = row.output;
        return untrustedEvidence(
          `agent-tool:${String(row.step_key)}`,
          JSON.stringify(row.output ?? null),
        );
      });
      const createdAt = asDate(run.created_at);
      const plan = planResult.rowCount ? AgentPlanSchema.parse(planResult.rows[0].plan) : undefined;
      return {
        run: {
          id: String(run.id),
          userId: String(run.user_id),
          goal: String(run.goal),
          status: run.status as AgentRunStatus,
          planVersion: Number(run.plan_version),
          budget: AgentBudgetSchema.parse({
            maxSteps: Number(run.max_steps),
            maxToolCalls: Number(run.max_tool_calls),
            maxTokens: Number(run.max_tokens),
            maxCostMicros: Number(run.max_cost_micros),
            maxWallTimeMs: Number(run.max_wall_time_ms),
            maxConcurrency: Number(run.max_concurrency),
          }),
          usage: {
            steps: Number(run.steps_used),
            toolCalls: Number(run.tool_calls_used),
            tokens: Number(run.tokens_used),
            costMicros: Number(run.cost_micros),
            elapsedMs: Date.now() - Date.parse(createdAt),
            concurrentWorkers: Number(workerResult.rows[0]?.count ?? 0),
          },
          createdAt,
          cancellationRequestedAt: run.cancellation_requested_at
            ? asDate(run.cancellation_requested_at)
            : undefined,
        },
        plan,
        steps: stepResult.rows.map(rowToStep),
        observations,
        evidence,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async savePlan(
    userId: string,
    runId: string,
    plan: AgentPlan,
    reason: "initial" | "tool_failure",
    planner: { provider: string; model: string },
  ) {
    const validated = AgentPlanSchema.parse(plan);
    await transaction(async (client) => {
      const run = await client.query(
        "SELECT plan_version FROM agent_runs WHERE user_id=$1 AND id=$2 FOR UPDATE",
        [userId, runId],
      );
      if (!run.rowCount) throw new Error("Agent run not found.");
      const version = Number(run.rows[0].plan_version) + 1;
      if (validated.version !== version) throw new Error("Agent plan version is stale.");
      await client.query(
        `INSERT INTO agent_plan_revisions (user_id,run_id,version,reason,rationale,plan,provider,model)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [userId, runId, version, reason, validated.rationale, validated, planner.provider, planner.model],
      );
      for (const [index, step] of validated.steps.entries()) {
        await client.query(
          `INSERT INTO agent_steps (
             user_id,run_id,plan_version,ordinal,step_key,kind,status,title,objective,
             tool_name,input,idempotency_key,max_attempts
           ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11,$12)`,
          [
            userId,
            runId,
            version,
            index + 1,
            step.key,
            step.toolName === "analyze_jobs_parallel"
              ? "delegation"
              : step.toolName
                ? "tool"
                : "message",
            step.title,
            step.objective,
            step.toolName ?? null,
            step.input,
            `${runId}:${version}:${step.key}`,
            step.maxAttempts,
          ],
        );
      }
      await client.query(
        `UPDATE agent_runs
         SET plan_version=$3,current_step_ordinal=0,status='running',phase='acting',
             provider=$4,model=$5,last_error_code=NULL,last_error_message=NULL,updated_at=NOW()
         WHERE user_id=$1 AND id=$2`,
        [userId, runId, version, planner.provider, planner.model],
      );
    });
  }

  async setRunStatus(
    userId: string,
    runId: string,
    status: AgentRunStatus,
    phase: string,
    error?: { code: string; message: string },
  ) {
    const terminal = ["completed", "failed", "cancelled"].includes(status);
    await postgres.query(
      `UPDATE agent_runs SET status=$3,phase=$4,last_error_code=$5,last_error_message=$6,
         completed_at=CASE WHEN $7 THEN COALESCE(completed_at,NOW()) ELSE completed_at END,
         updated_at=NOW() WHERE user_id=$1 AND id=$2`,
      [
        userId,
        runId,
        status,
        phase,
        error?.code ?? null,
        error ? safeMessage(error.message) : null,
        terminal,
      ],
    );
  }

  async startStep(userId: string, runId: string, stepId: string) {
    await transaction(async (client) => {
      const step = await client.query(
        `UPDATE agent_steps SET status='running',attempt_count=attempt_count+1,
           started_at=COALESCE(started_at,NOW()),updated_at=NOW()
         WHERE user_id=$1 AND run_id=$2 AND id=$3 AND status='pending'
         RETURNING ordinal`,
        [userId, runId, stepId],
      );
      if (!step.rowCount) throw new Error("Agent step is not pending.");
      await client.query(
        `UPDATE agent_runs SET status='running',phase='acting',steps_used=steps_used+1,
           current_step_ordinal=$3,updated_at=NOW()
         WHERE user_id=$1 AND id=$2`,
        [userId, runId, Number(step.rows[0].ordinal)],
      );
    });
  }

  async retryStep(userId: string, runId: string, stepId: string, error: { code: string; message: string }) {
    await postgres.query(
      `UPDATE agent_steps SET status='pending',error_code=$4,error_message=$5,updated_at=NOW()
       WHERE user_id=$1 AND run_id=$2 AND id=$3`,
      [userId, runId, stepId, error.code, safeMessage(error.message)],
    );
  }

  async deferStep(userId: string, runId: string, stepId: string, output: unknown) {
    await transaction(async (client) => {
      await client.query(
        `UPDATE agent_steps SET status='pending',output=$4,error_code=NULL,error_message=NULL,updated_at=NOW()
         WHERE user_id=$1 AND run_id=$2 AND id=$3`,
        [userId, runId, stepId, JSON.stringify(output ?? null)],
      );
      await client.query(
        `UPDATE agent_runs SET status='waiting_for_tool',phase='observing',updated_at=NOW()
         WHERE user_id=$1 AND id=$2`,
        [userId, runId],
      );
    });
  }

  async completeStep(userId: string, runId: string, stepId: string, output: unknown) {
    await postgres.query(
      `UPDATE agent_steps SET status='succeeded',output=$4,completed_at=NOW(),updated_at=NOW(),
         error_code=NULL,error_message=NULL WHERE user_id=$1 AND run_id=$2 AND id=$3`,
      [userId, runId, stepId, JSON.stringify(output ?? null)],
    );
  }

  async failStep(userId: string, runId: string, stepId: string, error: { code: string; message: string }) {
    await postgres.query(
      `UPDATE agent_steps SET status='failed',error_code=$4,error_message=$5,
         completed_at=NOW(),updated_at=NOW() WHERE user_id=$1 AND run_id=$2 AND id=$3`,
      [userId, runId, stepId, error.code, safeMessage(error.message)],
    );
  }

  async createToolCall(
    userId: string,
    runId: string,
    step: RuntimeStep,
    toolName: string,
    args: Record<string, unknown>,
    effect: string,
  ): Promise<RuntimeToolCall> {
    return transaction(async (client) => {
      const id = randomUUID();
      const idempotencyKey = `${runId}:${step.planVersion}:${step.key}:${step.attemptCount + 1}`;
      const result = await client.query(
        `INSERT INTO agent_tool_calls (
           id,user_id,run_id,step_id,tool_name,effect_level,status,arguments,
           policy_decision,idempotency_key,attempt,started_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'running',$7,$8,$9,$10,NOW())
         ON CONFLICT (user_id,run_id,idempotency_key) DO UPDATE SET id=agent_tool_calls.id
         RETURNING id,idempotency_key`,
        [
          id,
          userId,
          runId,
          step.id,
          toolName,
          effect,
          args,
          JSON.stringify({ outcome: "allow", effect }),
          idempotencyKey,
          step.attemptCount + 1,
        ],
      );
      await client.query(
        "UPDATE agent_runs SET tool_calls_used=tool_calls_used+1,updated_at=NOW() WHERE user_id=$1 AND id=$2",
        [userId, runId],
      );
      return {
        id: String(result.rows[0].id),
        stepId: step.id,
        toolName,
        arguments: args,
        idempotencyKey: String(result.rows[0].idempotency_key),
      };
    });
  }

  async completeToolCall(userId: string, runId: string, callId: string, result: unknown, latencyMs: number) {
    await postgres.query(
      `UPDATE agent_tool_calls SET status='succeeded',result=$4,latency_ms=$5,
         completed_at=NOW() WHERE user_id=$1 AND run_id=$2 AND id=$3`,
      [userId, runId, callId, JSON.stringify(result ?? null), latencyMs],
    );
  }

  async failToolCall(
    userId: string,
    runId: string,
    callId: string,
    error: { code: string; message: string },
    latencyMs: number,
  ) {
    await postgres.query(
      `UPDATE agent_tool_calls SET status='failed',error_code=$4,error_message=$5,
         latency_ms=$6,completed_at=NOW() WHERE user_id=$1 AND run_id=$2 AND id=$3`,
      [userId, runId, callId, error.code, safeMessage(error.message), latencyMs],
    );
  }

  async requestApproval(userId: string, runId: string, call: RuntimeToolCall, summary: string) {
    await transaction(async (client) => {
      await client.query(
        "UPDATE agent_tool_calls SET status='waiting_for_approval' WHERE user_id=$1 AND run_id=$2 AND id=$3",
        [userId, runId, call.id],
      );
      await client.query(
        `INSERT INTO agent_approvals (user_id,run_id,tool_call_id,summary,scope,expires_at)
         VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '10 minutes')`,
        [
          userId,
          runId,
          call.id,
          safeMessage(summary),
          JSON.stringify({ toolName: call.toolName, arguments: call.arguments }),
        ],
      );
      await client.query(
        "UPDATE agent_steps SET status='waiting',updated_at=NOW() WHERE user_id=$1 AND run_id=$2 AND id=$3",
        [userId, runId, call.stepId],
      );
    });
  }

  async takeApprovedToolCall(userId: string, runId: string): Promise<ApprovedRuntimeToolCall | null> {
    return transaction(async (client) => {
      await client.query(
        `UPDATE agent_approvals SET status='expired',decided_at=COALESCE(decided_at,NOW())
         WHERE user_id=$1 AND run_id=$2 AND status IN ('pending','approved') AND expires_at <= NOW()`,
        [userId, runId],
      );
      const result = await client.query(
        `SELECT a.id AS approval_id,a.expires_at,c.id AS call_id,c.step_id,c.tool_name,
                c.arguments,c.idempotency_key,s.step_key,s.ordinal,s.plan_version,s.title,
                s.objective,s.input,s.status,s.attempt_count,s.max_attempts
         FROM agent_approvals a
         JOIN agent_tool_calls c
           ON c.user_id=a.user_id AND c.run_id=a.run_id AND c.id=a.tool_call_id
         JOIN agent_steps s
           ON s.user_id=c.user_id AND s.run_id=c.run_id AND s.id=c.step_id
         WHERE a.user_id=$1 AND a.run_id=$2 AND a.status='approved' AND a.expires_at > NOW()
         ORDER BY a.requested_at LIMIT 1 FOR UPDATE OF a,c,s`,
        [userId, runId],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0];
      await client.query(
        "UPDATE agent_tool_calls SET status='running',started_at=COALESCE(started_at,NOW()) WHERE user_id=$1 AND run_id=$2 AND id=$3",
        [userId, runId, row.call_id],
      );
      await client.query(
        "UPDATE agent_steps SET status='running',updated_at=NOW() WHERE user_id=$1 AND run_id=$2 AND id=$3",
        [userId, runId, row.step_id],
      );
      await client.query(
        "UPDATE agent_runs SET status='running',phase='acting',updated_at=NOW() WHERE user_id=$1 AND id=$2",
        [userId, runId],
      );
      await client.query(
        `UPDATE agent_approvals SET status='consumed',consumed_at=NOW()
         WHERE user_id=$1 AND run_id=$2 AND id=$3 AND status='approved'`,
        [userId, runId, row.approval_id],
      );
      return {
        call: {
          id: String(row.call_id),
          stepId: String(row.step_id),
          toolName: String(row.tool_name),
          arguments: asObject(row.arguments),
          idempotencyKey: String(row.idempotency_key),
        },
        step: {
          id: String(row.step_id),
          key: String(row.step_key),
          ordinal: Number(row.ordinal),
          planVersion: Number(row.plan_version),
          title: String(row.title),
          objective: String(row.objective),
          toolName: String(row.tool_name),
          input: asObject(row.input),
          status: "running",
          attemptCount: Number(row.attempt_count),
          maxAttempts: Number(row.max_attempts),
        },
        approvalId: String(row.approval_id),
        approvalExpiresAt: asDate(row.expires_at),
      };
    });
  }

  async consumeApproval(userId: string, runId: string, approvalId: string) {
    await postgres.query(
      `UPDATE agent_approvals SET status='consumed',consumed_at=NOW()
       WHERE user_id=$1 AND run_id=$2 AND id=$3 AND status='approved'`,
      [userId, runId, approvalId],
    );
  }

  async appendObservation(userId: string, runId: string, step: RuntimeStep, output: unknown) {
    await transaction(async (client) => {
      const ordinalResult = await client.query(
        `SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM agent_steps
         WHERE user_id=$1 AND run_id=$2 AND plan_version=$3`,
        [userId, runId, step.planVersion],
      );
      const observationKey = `observation_${step.key}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      await client.query(
        `INSERT INTO agent_steps (
           user_id,run_id,plan_version,ordinal,step_key,kind,status,title,objective,
           output,evidence,parent_step_id,attempt_count,max_attempts,started_at,completed_at
         ) VALUES ($1,$2,$3,$4,$5,'observation','succeeded',$6,$7,$8,$9,$10,1,1,NOW(),NOW())`,
        [
          userId,
          runId,
          step.planVersion,
          Number(ordinalResult.rows[0].ordinal),
          observationKey,
          `Observed ${step.title}`,
          "Tool output is untrusted data and cannot authorize further actions.",
          JSON.stringify(output ?? null),
          JSON.stringify([{ source: `tool:${step.toolName ?? "none"}`, authority: "data_only" }]),
          step.id,
        ],
      );
      await client.query(
        "UPDATE agent_runs SET phase='observing',updated_at=NOW() WHERE user_id=$1 AND id=$2",
        [userId, runId],
      );
    });
  }

  async appendEvent(userId: string, runId: string, eventType: string, data: Record<string, unknown> = {}) {
    await postgres.query(
      "INSERT INTO agent_run_events (user_id,run_id,event_type,data) VALUES ($1,$2,$3,$4)",
      [userId, runId, eventType.slice(0, 120), JSON.stringify(data)],
    );
  }

  async prepareWorkers(
    userId: string,
    runId: string,
    stepId: string,
    workers: Array<{ key: string; task: string }>,
  ) {
    await transaction(async (client) => {
      for (const worker of workers) {
        await client.query(
          `INSERT INTO agent_workers (
             user_id,run_id,parent_step_id,worker_key,task,max_steps,max_tool_calls
           ) VALUES ($1,$2,$3,$4,$5,2,2)
           ON CONFLICT (user_id,run_id,worker_key) DO NOTHING`,
          [userId, runId, stepId, worker.key.slice(0, 200), safeMessage(worker.task)],
        );
      }
    });
  }

  async listWorkers(userId: string, runId: string, stepId: string) {
    const result = await postgres.query(
      `SELECT id,worker_key,task,status,max_steps,steps_used,max_tool_calls,tool_calls_used,
              result,error_code
       FROM agent_workers
       WHERE user_id=$1 AND run_id=$2 AND parent_step_id=$3
       ORDER BY created_at,worker_key`,
      [userId, runId, stepId],
    );
    return result.rows.map(rowToWorker);
  }

  async startWorker(
    userId: string,
    runId: string,
    step: RuntimeStep,
    workerId: string,
    toolName: string,
    args: Record<string, unknown>,
    effect: string,
  ): Promise<RuntimeWorkerAttempt | null> {
    return transaction(async (client) => {
      const workerResult = await client.query(
        `UPDATE agent_workers
         SET status='running',steps_used=steps_used+1,tool_calls_used=tool_calls_used+1,
             started_at=COALESCE(started_at,NOW()),error_code=NULL,error_message=NULL
         WHERE user_id=$1 AND run_id=$2 AND parent_step_id=$3 AND id=$4
           AND status='queued' AND steps_used < max_steps AND tool_calls_used < max_tool_calls
         RETURNING id,worker_key,task,status,max_steps,steps_used,max_tool_calls,tool_calls_used,
                   result,error_code`,
        [userId, runId, step.id, workerId],
      );
      if (!workerResult.rowCount) return null;
      const worker = rowToWorker(workerResult.rows[0]);
      const runBudget = await client.query(
        `UPDATE agent_runs
         SET tool_calls_used=tool_calls_used+1,steps_used=steps_used+1,updated_at=NOW()
         WHERE user_id=$1 AND id=$2
           AND tool_calls_used < max_tool_calls AND steps_used < max_steps
         RETURNING tool_calls_used,steps_used`,
        [userId, runId],
      );
      if (!runBudget.rowCount) {
        const limits = await client.query(
          "SELECT steps_used,max_steps,tool_calls_used,max_tool_calls FROM agent_runs WHERE user_id=$1 AND id=$2",
          [userId, runId],
        );
        const stepLimit = Number(limits.rows[0]?.steps_used ?? 0) >= Number(limits.rows[0]?.max_steps ?? 0);
        const errorCode = stepLimit ? "step_limit" : "tool_call_limit";
        await client.query(
          `UPDATE agent_workers SET status='failed',error_code=$4,
             error_message='The parent run has no remaining worker budget.',completed_at=NOW()
           WHERE user_id=$1 AND run_id=$2 AND id=$3`,
          [userId, runId, workerId, errorCode],
        );
        return null;
      }
      const callId = randomUUID();
      const idempotencyKey = `${runId}:${step.planVersion}:${step.key}:worker:${worker.key}:${worker.toolCallsUsed}`;
      const callResult = await client.query(
        `INSERT INTO agent_tool_calls (
           id,user_id,run_id,step_id,tool_name,effect_level,status,arguments,
           policy_decision,idempotency_key,attempt,started_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'running',$7,$8,$9,$10,NOW())
         RETURNING id,idempotency_key`,
        [
          callId,
          userId,
          runId,
          step.id,
          toolName,
          effect,
          args,
          JSON.stringify({ outcome: "allow", effect, workerId, workerKey: worker.key }),
          idempotencyKey,
          worker.toolCallsUsed,
        ],
      );
      return {
        worker,
        call: {
          id: String(callResult.rows[0].id),
          stepId: step.id,
          toolName,
          arguments: args,
          idempotencyKey: String(callResult.rows[0].idempotency_key),
        },
      };
    });
  }

  async completeWorker(
    userId: string,
    runId: string,
    workerId: string,
    callId: string,
    result: unknown,
    latencyMs: number,
  ) {
    await transaction(async (client) => {
      await client.query(
        `UPDATE agent_tool_calls SET status='succeeded',result=$4,latency_ms=$5,completed_at=NOW()
         WHERE user_id=$1 AND run_id=$2 AND id=$3 AND status='running'`,
        [userId, runId, callId, JSON.stringify(result ?? null), latencyMs],
      );
      await client.query(
        `UPDATE agent_workers SET status='completed',result=$4,error_code=NULL,error_message=NULL,
           completed_at=NOW()
         WHERE user_id=$1 AND run_id=$2 AND id=$3 AND status='running'`,
        [userId, runId, workerId, JSON.stringify(result ?? null)],
      );
    });
  }

  async failWorker(
    userId: string,
    runId: string,
    workerId: string,
    callId: string,
    error: { code: string; message: string },
    latencyMs: number,
  ): Promise<"queued" | "failed"> {
    return transaction(async (client) => {
      await client.query(
        `UPDATE agent_tool_calls SET status='failed',error_code=$4,error_message=$5,
           latency_ms=$6,completed_at=NOW()
         WHERE user_id=$1 AND run_id=$2 AND id=$3`,
        [userId, runId, callId, error.code, safeMessage(error.message), latencyMs],
      );
      const result = await client.query(
        `UPDATE agent_workers
         SET status=CASE WHEN steps_used < max_steps AND tool_calls_used < max_tool_calls
                         THEN 'queued' ELSE 'failed' END,
             error_code=$4,error_message=$5,
             completed_at=CASE WHEN steps_used >= max_steps OR tool_calls_used >= max_tool_calls
                               THEN NOW() ELSE NULL END
         WHERE user_id=$1 AND run_id=$2 AND id=$3
         RETURNING status`,
        [userId, runId, workerId, error.code, safeMessage(error.message)],
      );
      return result.rows[0]?.status === "queued" ? "queued" : "failed";
    });
  }

  async cancelPendingWorkers(userId: string, runId: string, stepId: string) {
    await postgres.query(
      `UPDATE agent_workers SET status='cancelled',error_code='cancelled',
         error_message='The parent agent run was cancelled.',completed_at=NOW()
       WHERE user_id=$1 AND run_id=$2 AND parent_step_id=$3 AND status='queued'`,
      [userId, runId, stepId],
    );
  }

  async isCancellationRequested(userId: string, runId: string) {
    const result = await postgres.query(
      "SELECT cancellation_requested_at IS NOT NULL AS requested FROM agent_runs WHERE user_id=$1 AND id=$2",
      [userId, runId],
    );
    return result.rows[0]?.requested === true;
  }
}

export async function requestAgentCancellation(userId: string, runId: string) {
  const result = await postgres.query(
    `UPDATE agent_runs SET cancellation_requested_at=COALESCE(cancellation_requested_at,NOW()),updated_at=NOW()
     WHERE user_id=$1 AND id=$2 AND status NOT IN ('completed','failed','cancelled') RETURNING id`,
    [userId, runId],
  );
  return result.rowCount === 1;
}

export async function decideAgentApproval(
  userId: string,
  runId: string,
  approvalId: string,
  decision: "approve" | "reject",
  note = "",
) {
  return transaction(async (client) => {
    const approval = await client.query(
      `SELECT tool_call_id,expires_at FROM agent_approvals
       WHERE user_id=$1 AND run_id=$2 AND id=$3 AND status='pending' FOR UPDATE`,
      [userId, runId, approvalId],
    );
    if (!approval.rowCount) return "not_found" as const;
    if (Date.parse(asDate(approval.rows[0].expires_at)) <= Date.now()) {
      await client.query(
        "UPDATE agent_approvals SET status='expired',decided_at=NOW(),decided_by=$1 WHERE user_id=$1 AND run_id=$2 AND id=$3",
        [userId, runId, approvalId],
      );
      return "expired" as const;
    }
    const approved = decision === "approve";
    await client.query(
      `UPDATE agent_approvals SET status=$4,decided_at=NOW(),decided_by=$1,decision_note=$5
       WHERE user_id=$1 AND run_id=$2 AND id=$3`,
      [userId, runId, approvalId, approved ? "approved" : "rejected", safeMessage(note)],
    );
    if (approved) {
      await client.query(
        "UPDATE agent_runs SET status='running',phase='acting',updated_at=NOW() WHERE user_id=$1 AND id=$2",
        [userId, runId],
      );
      return "approved" as const;
    }
    const callId = approval.rows[0].tool_call_id;
    const call = await client.query(
      `UPDATE agent_tool_calls SET status='rejected',completed_at=NOW(),error_code='approval_rejected',
         error_message='The user rejected this action.'
       WHERE user_id=$1 AND run_id=$2 AND id=$3 RETURNING step_id`,
      [userId, runId, callId],
    );
    if (call.rowCount) {
      await client.query(
        `UPDATE agent_steps SET status='failed',completed_at=NOW(),error_code='approval_rejected',
           error_message='The user rejected this action.',updated_at=NOW()
         WHERE user_id=$1 AND run_id=$2 AND id=$3`,
        [userId, runId, call.rows[0].step_id],
      );
    }
    await client.query(
      `UPDATE agent_runs SET status='paused',phase='awaiting_approval',
         last_error_code='approval_rejected',last_error_message='The user rejected a proposed action.',updated_at=NOW()
       WHERE user_id=$1 AND id=$2`,
      [userId, runId],
    );
    return "rejected" as const;
  });
}
