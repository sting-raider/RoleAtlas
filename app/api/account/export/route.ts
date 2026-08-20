import { postgres } from "../../../../lib/postgres.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../../lib/session.ts";

export async function GET(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();

  const rawClient = await postgres.connect();
  let queryTail = Promise.resolve();
  const client = {
    query(text: string, values?: unknown[]) {
      const result = queryTail.then(() => rawClient.query(text, values));
      queryTail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const [
      user,
      profiles,
      plans,
      sessions,
      feedback,
      workspaces,
      strategies,
      strategyRevisions,
      savedJobs,
      userJobFeedback,
      applications,
      applicationActivities,
      applicationContacts,
      notifications,
      recentViews,
      aiActivity,
      providerConfigurations,
      generatedArtifacts,
      agentRuns,
      agentPlanRevisions,
      agentSteps,
      agentToolCalls,
      agentApprovals,
      agentWorkers,
      agentEvents,
      auditEvents,
    ] = await Promise.all([
      client.query("SELECT id, name, email, email_verified, image_url, created_at, updated_at, role FROM roleatlas_users WHERE id = $1", [principal.userId]),
      client.query("SELECT id, profile, source_file, created_at, updated_at FROM candidate_profiles WHERE user_id = $1 ORDER BY created_at", [principal.userId]),
      client.query("SELECT id, profile_id, plan, confirmed_at, is_active, created_at, updated_at FROM search_plans WHERE user_id = $1 ORDER BY created_at", [principal.userId]),
      client.query("SELECT id, profile_id, plan_id, status, stage, plan_snapshot, coverage, query_count, result_count, started_at, completed_at, updated_at, error FROM search_sessions WHERE user_id = $1 ORDER BY started_at", [principal.userId]),
      client.query("SELECT id, session_id, job_id, action, created_at FROM search_feedback WHERE user_id = $1 ORDER BY created_at", [principal.userId]),
      client.query("SELECT workspace_key, profile_id, state, revision, created_at, updated_at FROM daily_workspaces WHERE user_id = $1 ORDER BY workspace_key", [principal.userId]),
      client.query("SELECT id, profile_id, name, status, active_revision_id, last_run_at, last_session_id, created_at, updated_at FROM search_strategies WHERE user_id = $1 ORDER BY created_at", [principal.userId]),
      client.query("SELECT strategy_id, id, version, reason, plan, created_at FROM search_strategy_revisions WHERE user_id = $1 ORDER BY strategy_id, version", [principal.userId]),
      client.query("SELECT job_ref, canonical_job_id, saved_at, snapshot, archived_at, updated_at FROM saved_jobs WHERE user_id = $1 ORDER BY saved_at", [principal.userId]),
      client.query("SELECT id, job_ref, canonical_job_id, session_id, reason, suggested_strategy_change, created_at, undone_at FROM user_job_feedback WHERE user_id = $1 ORDER BY created_at", [principal.userId]),
      client.query("SELECT id, job_ref, canonical_job_id, stage, application_date, next_action, follow_up_date, notes, priority, tailored_resume_reference, cover_letter_reference, interview_preparation, source_job_status, closure_reason, created_at, updated_at FROM applications WHERE user_id = $1 ORDER BY created_at", [principal.userId]),
      client.query("SELECT application_id, id, occurred_at, activity_type, summary FROM application_activities WHERE user_id = $1 ORDER BY occurred_at", [principal.userId]),
      client.query("SELECT application_id, position, name, detail FROM application_contacts WHERE user_id = $1 ORDER BY application_id, position", [principal.userId]),
      client.query("SELECT id, dedupe_key, notification_type, title, detail, target_view, created_at, read_at, dismissed_at FROM user_notifications WHERE user_id = $1 ORDER BY created_at", [principal.userId]),
      client.query("SELECT job_ref, canonical_job_id, viewed_at FROM recently_viewed_jobs WHERE user_id = $1 ORDER BY viewed_at", [principal.userId]),
      client.query("SELECT id, action, provider, model, endpoint, started_at, completed_at, outcome, data_sent, usage, message FROM ai_activity WHERE user_id = $1 ORDER BY completed_at", [principal.userId]),
      client.query("SELECT provider, model, base_url, profile_note, verification, credential_reference, created_at, updated_at FROM user_provider_configurations WHERE user_id = $1 ORDER BY provider", [principal.userId]),
      client.query("SELECT id, application_id, job_ref, artifact_type, content, provider, model, created_at, deleted_at FROM generated_application_artifacts WHERE user_id = $1 ORDER BY created_at", [principal.userId]),
      client.query("SELECT id, goal, status, phase, autonomy, plan_version, current_step_ordinal, max_steps, steps_used, max_tool_calls, tool_calls_used, max_tokens, tokens_used, max_cost_micros, cost_micros, max_wall_time_ms, max_concurrency, provider, model, summary, metadata, last_error_code, last_error_message, cancellation_requested_at, deadline_at, created_at, started_at, updated_at, completed_at FROM agent_runs WHERE user_id = $1 ORDER BY created_at", [principal.userId]),
      client.query("SELECT id, run_id, version, reason, rationale, plan, provider, model, created_at FROM agent_plan_revisions WHERE user_id = $1 ORDER BY run_id, version", [principal.userId]),
      client.query("SELECT id, run_id, plan_version, ordinal, step_key, kind, status, title, objective, tool_name, input, output, evidence, parent_step_id, worker_key, attempt_count, max_attempts, started_at, completed_at, error_code, error_message, created_at, updated_at FROM agent_steps WHERE user_id = $1 ORDER BY run_id, created_at, ordinal", [principal.userId]),
      client.query("SELECT id, run_id, step_id, tool_name, effect_level, status, arguments, result, policy_decision, idempotency_key, attempt, provider, model, input_tokens, output_tokens, estimated_cost_micros, latency_ms, started_at, completed_at, error_code, error_message, created_at FROM agent_tool_calls WHERE user_id = $1 ORDER BY run_id, created_at", [principal.userId]),
      client.query("SELECT id, run_id, tool_call_id, status, summary, scope, requested_at, expires_at, decided_at, decision_note, consumed_at FROM agent_approvals WHERE user_id = $1 ORDER BY run_id, requested_at", [principal.userId]),
      client.query("SELECT id, run_id, parent_step_id, worker_key, task, status, max_steps, steps_used, max_tool_calls, tool_calls_used, result, error_code, error_message, created_at, started_at, completed_at FROM agent_workers WHERE user_id = $1 ORDER BY run_id, created_at", [principal.userId]),
      client.query("SELECT id, run_id, event_type, data, created_at FROM agent_run_events WHERE user_id = $1 ORDER BY run_id, id", [principal.userId]),
      client.query("SELECT id, event_type, request_id, metadata, created_at FROM audit_events WHERE subject_user_id = $1 ORDER BY created_at", [principal.userId]),
    ]);
    await client.query("COMMIT");
    await postgres.query(
      "INSERT INTO audit_events (actor_user_id, subject_user_id, event_type, user_agent, metadata) VALUES ($1,$1,'account.export',$2,$3)",
      [principal.userId, request.headers.get("user-agent")?.slice(0, 500) ?? null, JSON.stringify({ format: "json", version: 3 })],
    );
    const exportedAt = new Date().toISOString();
    const filename = `roleatlas-export-${exportedAt.slice(0, 10)}.json`;
    return Response.json(
      {
        schemaVersion: 3,
        exportedAt,
        account: user.rows[0] ?? null,
        candidateProfiles: profiles.rows,
        searchPlans: plans.rows,
        searchSessions: sessions.rows,
        searchFeedback: feedback.rows,
        workspaces: workspaces.rows,
        searchStrategies: strategies.rows,
        searchStrategyRevisions: strategyRevisions.rows,
        savedJobs: savedJobs.rows,
        userJobFeedback: userJobFeedback.rows,
        applications: applications.rows,
        applicationActivities: applicationActivities.rows,
        applicationContacts: applicationContacts.rows,
        notifications: notifications.rows,
        recentlyViewedJobs: recentViews.rows,
        aiActivity: aiActivity.rows,
        providerConfigurations: providerConfigurations.rows,
        generatedApplicationArtifacts: generatedArtifacts.rows,
        agentRuns: agentRuns.rows,
        agentPlanRevisions: agentPlanRevisions.rows,
        agentSteps: agentSteps.rows,
        agentToolCalls: agentToolCalls.rows,
        agentApprovals: agentApprovals.rows,
        agentWorkers: agentWorkers.rows,
        agentEvents: agentEvents.rows,
        auditEvents: auditEvents.rows,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Account export failed", error);
    return Response.json(
      { error: { code: "export_failed", message: "Your data export could not be created." } },
      { status: 500 },
    );
  } finally {
    rawClient.release();
  }
}
