import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { postgres } from "../postgres.ts";
import { fetchScoutForUser } from "../scout-client.ts";
import { AgentToolExecutionError, type AgentToolExecutor } from "./runtime.ts";

function value<T>(input: Record<string, unknown>, key: string) {
  return input[key] as T;
}

function toolFailure(code: string, message: string): never {
  throw new AgentToolExecutionError(code, message);
}

function stableUuid(idempotencyKey: string, suffix: string) {
  const hex = createHash("sha256")
    .update(`roleatlas-agent-tool:${idempotencyKey}:${suffix}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function stableTextId(prefix: string, idempotencyKey: string, suffix: string) {
  return `${prefix}_${stableUuid(idempotencyKey, suffix).replaceAll("-", "")}`;
}

function asJob(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    company: String(row.company),
    location: row.location == null ? null : String(row.location),
    country: row.country == null ? null : String(row.country),
    remote: row.remote == null ? null : Boolean(row.remote),
    employmentType: row.employment_type == null ? null : String(row.employment_type),
    experienceYears: row.experience_years == null ? null : Number(row.experience_years),
    degreeRequired: row.degree_required == null ? null : Boolean(row.degree_required),
    salaryMin: row.salary_min == null ? null : Number(row.salary_min),
    salaryMax: row.salary_max == null ? null : Number(row.salary_max),
    salaryCurrency: row.salary_currency == null ? null : String(row.salary_currency),
    datePosted: row.date_posted == null ? null : String(row.date_posted),
    lifecycleStatus: String(row.lifecycle_status),
    lastVerifiedAt: row.last_verified_at == null ? null : String(row.last_verified_at),
    eligibilityStatus: row.eligibility_status == null ? "unknown" : String(row.eligibility_status),
    eligibilityEvidence: row.eligibility ?? null,
    sourceName: String(row.source_name),
    canonicalUrl: String(row.canonical_url),
  };
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>) {
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

const applicationStages = new Set([
  "Interested",
  "Saved",
  "Preparing",
  "Ready to apply",
  "Applied",
  "Recruiter screen",
  "Assessment",
  "Technical interview",
  "Final interview",
  "Offer",
  "Rejected",
  "Withdrawn",
  "Closed before application",
  "Archived",
]);

export class CoreAgentToolExecutor implements AgentToolExecutor {
  async execute({ principal, toolName, arguments: input, idempotencyKey, signal }: Parameters<AgentToolExecutor["execute"]>[0]) {
    switch (toolName) {
      case "search_jobs": {
        const query = value<string>(input, "query");
        const location = value<string | undefined>(input, "location") ?? null;
        const limit = value<number>(input, "limit");
        const params = new URLSearchParams({ q: query, limit: String(limit) });
        if (location) params.set("location", location);
        let response: Response;
        try {
          response = await fetchScoutForUser(
            principal,
            `/api/jobs?${params.toString()}`,
            { headers: { Accept: "application/json" }, cache: "no-store", signal },
          );
        } catch {
          toolFailure(
            "search_unavailable",
            "The persistent canonical search service is unavailable.",
          );
        }
        if (!response.ok) {
          toolFailure("search_failed", "The canonical search request did not complete.");
        }
        const payload = await response.json().catch(() => null) as {
          jobs?: Array<{ id?: unknown }>;
          count?: unknown;
        } | null;
        if (!payload || !Array.isArray(payload.jobs) || typeof payload.count !== "number") {
          toolFailure("search_invalid_response", "The canonical search returned an invalid response.");
        }
        return {
          jobIds: payload.jobs.flatMap((job) => (
            typeof job.id === "string" ? [job.id] : []
          )),
          total: payload.count,
        };
      }
      case "get_job": {
        const result = await postgres.query(
          `SELECT j.id,j.title,j.company,j.location,j.country,j.remote,j.employment_type,j.experience_years,
                  j.degree_required,j.salary_min,j.salary_max,j.salary_currency,j.date_posted,
                  j.lifecycle_status,j.last_verified_at,latest.eligibility_status,latest.eligibility,
                  j.source_name,j.canonical_url
           FROM jobs j
           LEFT JOIN LATERAL (
             SELECT r.eligibility_status,r.eligibility
             FROM search_session_results r
             JOIN search_sessions s ON s.id=r.session_id AND s.user_id=$2
             WHERE r.job_id=j.id
             ORDER BY s.updated_at DESC,r.created_at DESC LIMIT 1
           ) latest ON TRUE
           WHERE j.id=$1`,
          [value<string>(input, "jobId"), principal.userId],
        );
        if (!result.rowCount) toolFailure("job_not_found", "The canonical job was not found.");
        return { job: asJob(result.rows[0]) };
      }
      case "compare_jobs": {
        const ids = value<string[]>(input, "jobIds");
        const result = await postgres.query(
          `SELECT j.id,j.title,j.company,j.location,j.country,j.remote,j.employment_type,j.experience_years,
                  j.degree_required,j.salary_min,j.salary_max,j.salary_currency,j.date_posted,
                  j.lifecycle_status,j.last_verified_at,latest.eligibility_status,latest.eligibility,
                  j.source_name,j.canonical_url
           FROM jobs j
           LEFT JOIN LATERAL (
             SELECT r.eligibility_status,r.eligibility
             FROM search_session_results r
             JOIN search_sessions s ON s.id=r.session_id AND s.user_id=$2
             WHERE r.job_id=j.id
             ORDER BY s.updated_at DESC,r.created_at DESC LIMIT 1
           ) latest ON TRUE
           WHERE j.id=ANY($1::uuid[])`,
          [ids, principal.userId],
        );
        const byId = new Map(result.rows.map((row) => [String(row.id), asJob(row)]));
        return { comparisons: ids.flatMap((id) => byId.has(id) ? [byId.get(id)] : []) };
      }
      case "get_search_strategy": {
        const strategyId = value<string | undefined>(input, "strategyId");
        const result = await postgres.query(
          `SELECT s.id,s.name,s.status,s.active_revision_id,s.last_run_at,s.last_session_id,
             COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'id',r.id,'version',r.version,'reason',r.reason,'plan',r.plan,'createdAt',r.created_at
             ) ORDER BY r.version) FROM search_strategy_revisions r
             WHERE r.user_id=s.user_id AND r.strategy_id=s.id),'[]'::jsonb) AS revisions
           FROM search_strategies s
           WHERE s.user_id=$1 AND ($2::text IS NULL OR s.id=$2)
           ORDER BY s.updated_at DESC LIMIT 20`,
          [principal.userId, strategyId ?? null],
        );
        return {
          strategies: result.rows.map((row) => ({
            id: String(row.id),
            name: String(row.name),
            status: String(row.status),
            activeRevisionId: String(row.active_revision_id),
            lastRunAt: row.last_run_at,
            lastSessionId: row.last_session_id,
            revisions: row.revisions,
          })),
        };
      }
      case "create_search_strategy": {
        const strategyId = stableTextId("strategy", idempotencyKey, "strategy");
        const revisionId = stableTextId("revision", idempotencyKey, "revision");
        await inTransaction(async (client) => {
          await client.query(
            `INSERT INTO search_strategies (user_id,id,name,status,active_revision_id)
             VALUES ($1,$2,$3,'active',$4) ON CONFLICT (user_id,id) DO NOTHING`,
            [principal.userId, strategyId, value<string>(input, "name"), revisionId],
          );
          await client.query(
            `INSERT INTO search_strategy_revisions (user_id,strategy_id,id,version,reason,plan)
             VALUES ($1,$2,$3,1,'created',$4) ON CONFLICT DO NOTHING`,
            [principal.userId, strategyId, revisionId, value<Record<string, unknown>>(input, "plan")],
          );
        });
        return { strategyId, revisionId };
      }
      case "revise_search_strategy": {
        const strategyId = value<string>(input, "strategyId");
        return inTransaction(async (client) => {
          const revisionId = stableTextId("revision", idempotencyKey, "revision");
          const existing = await client.query(
            "SELECT version FROM search_strategy_revisions WHERE user_id=$1 AND strategy_id=$2 AND id=$3",
            [principal.userId, strategyId, revisionId],
          );
          if (existing.rowCount) {
            return { revisionId, version: Number(existing.rows[0].version) };
          }
          const strategy = await client.query(
            "SELECT active_revision_id FROM search_strategies WHERE user_id=$1 AND id=$2 FOR UPDATE",
            [principal.userId, strategyId],
          );
          if (!strategy.rowCount) toolFailure("strategy_not_found", "The owned search strategy was not found.");
          const versionResult = await client.query(
            "SELECT COALESCE(MAX(version),0)+1 AS version FROM search_strategy_revisions WHERE user_id=$1 AND strategy_id=$2",
            [principal.userId, strategyId],
          );
          const version = Number(versionResult.rows[0].version);
          await client.query(
            `INSERT INTO search_strategy_revisions (user_id,strategy_id,id,version,reason,plan)
             VALUES ($1,$2,$3,$4,'edited',$5)`,
            [principal.userId, strategyId, revisionId, version, value<Record<string, unknown>>(input, "plan")],
          );
          await client.query(
            "UPDATE search_strategies SET active_revision_id=$3,updated_at=NOW() WHERE user_id=$1 AND id=$2",
            [principal.userId, strategyId, revisionId],
          );
          return { revisionId, version };
        });
      }
      case "get_search_coverage": {
        const sessionId = value<string | undefined>(input, "searchSessionId");
        if (sessionId) {
          const result = await postgres.query(
            "SELECT coverage,status,stage,result_count,updated_at FROM search_sessions WHERE user_id=$1 AND id=$2",
            [principal.userId, sessionId],
          );
          if (!result.rowCount) toolFailure("search_not_found", "The owned search session was not found.");
          return { coverage: result.rows[0] };
        }
        const result = await postgres.query(
          `SELECT COUNT(*) FILTER (WHERE enabled) AS configured,
                  COUNT(*) FILTER (WHERE enabled AND last_success_at IS NOT NULL) AS successful,
                  MAX(last_success_at) AS freshest_success
           FROM sources`,
        );
        return {
          coverage: {
            configuredSources: Number(result.rows[0].configured),
            successfullyCheckedSources: Number(result.rows[0].successful),
            freshestSuccess: result.rows[0].freshest_success,
            wholeMarketCoverage: false,
          },
        };
      }
      case "request_source_scan": {
        let response: Response;
        try {
          response = await fetchScoutForUser(principal, "/api/source-scans", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify({ source_id: value<string>(input, "sourceId") }),
            signal,
          });
        } catch {
          toolFailure(
            "source_scan_unavailable",
            "The approved-source crawler service is unavailable. Existing indexed jobs remain searchable.",
          );
        }
        if (!response.ok) {
          if (response.status === 404) {
            toolFailure("source_not_approved", "The source is not in the enabled trusted registry.");
          }
          if (response.status === 403) {
            toolFailure("source_disabled", "The approved source is currently disabled or quarantined.");
          }
          if (response.status === 503) {
            toolFailure(
              "source_scan_unavailable",
              "The crawler queue is unavailable. Existing indexed jobs remain searchable.",
            );
          }
          toolFailure("source_scan_failed", "The approved source scan could not be queued.");
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          toolFailure("source_scan_invalid_response", "The crawler returned an invalid scan receipt.");
        }
        if (
          typeof payload !== "object"
          || payload === null
          || typeof (payload as Record<string, unknown>).requestId !== "string"
          || typeof (payload as Record<string, unknown>).status !== "string"
        ) {
          toolFailure("source_scan_invalid_response", "The crawler returned an invalid scan receipt.");
        }
        return {
          requestId: (payload as Record<string, unknown>).requestId,
          status: (payload as Record<string, unknown>).status,
        };
      }
      case "get_source_scan_status": {
        const requestId = value<string>(input, "requestId");
        const result = await postgres.query(
          "SELECT status,observed_jobs,completed_at,error FROM source_runs WHERE id::text=$1 ORDER BY started_at DESC LIMIT 1",
          [requestId],
        );
        if (!result.rowCount) return { status: "unknown" };
        return {
          status: String(result.rows[0].status),
          observedJobs: Number(result.rows[0].observed_jobs),
          completedAt: result.rows[0].completed_at,
          error: result.rows[0].error,
        };
      }
      case "rank_jobs": {
        const ids = value<string[]>(input, "jobIds");
        const result = await postgres.query(
          `SELECT j.id FROM jobs j
           LEFT JOIN LATERAL (
             SELECT r.eligibility_status
             FROM search_session_results r
             JOIN search_sessions s ON s.id=r.session_id AND s.user_id=$2
             WHERE r.job_id=j.id
             ORDER BY s.updated_at DESC,r.created_at DESC LIMIT 1
           ) latest ON TRUE
           WHERE j.id=ANY($1::uuid[])
           ORDER BY CASE latest.eligibility_status
                      WHEN 'confirmed' THEN 0 WHEN 'likely' THEN 1 WHEN 'unclear' THEN 2
                      WHEN 'requires_sponsorship' THEN 3 WHEN 'requires_relocation' THEN 3
                      WHEN 'requires_office_attendance' THEN 3 WHEN 'timezone_mismatch' THEN 4
                      WHEN 'excluded' THEN 5 ELSE 2
                    END,
                    j.date_posted DESC NULLS LAST,j.last_verified_at DESC NULLS LAST,j.id`,
          [ids, principal.userId],
        );
        return { rankedJobIds: result.rows.map((row) => String(row.id)) };
      }
      case "analyze_job": {
        const result = await postgres.query(
          `SELECT j.id,j.title,j.company,j.location,j.country,j.remote,j.employment_type,j.experience_years,
                  j.degree_required,j.salary_min,j.salary_max,j.salary_currency,j.date_posted,
                  j.lifecycle_status,j.last_verified_at,latest.eligibility_status,latest.eligibility,
                  j.source_name,j.canonical_url
           FROM jobs j
           LEFT JOIN LATERAL (
             SELECT r.eligibility_status,r.eligibility
             FROM search_session_results r
             JOIN search_sessions s ON s.id=r.session_id AND s.user_id=$2
             WHERE r.job_id=j.id
             ORDER BY s.updated_at DESC,r.created_at DESC LIMIT 1
           ) latest ON TRUE
           WHERE j.id=$1`,
          [value<string>(input, "jobId"), principal.userId],
        );
        if (!result.rowCount) toolFailure("job_not_found", "The canonical job was not found.");
        return {
          analysis: {
            listing: asJob(result.rows[0]),
            eligibilityAuthority: "deterministic_listing_evidence",
            uncertaintyRule: "Unknown evidence remains unknown.",
          },
        };
      }
      case "research_company":
      case "research_compensation":
        return { findings: [], unavailableReason: "No controlled research provider is configured for this capability." };
      case "find_contact":
        return { contacts: [], unavailableReason: "No controlled public-contact provider is configured." };
      case "prepare_application": {
        const jobId = value<string>(input, "jobId");
        const artifactTypes = value<Array<"evaluation" | "resume" | "cover_letter" | "recruiter_message">>(input, "artifactTypes");
        const jobResult = await postgres.query(
          "SELECT id,title,company,canonical_url FROM jobs WHERE id=$1",
          [jobId],
        );
        if (!jobResult.rowCount) toolFailure("job_not_found", "The canonical job was not found.");
        const profileResult = await postgres.query(
          "SELECT profile FROM candidate_profiles WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1",
          [principal.userId],
        );
        if (!profileResult.rowCount) {
          toolFailure("profile_required", "A reviewed candidate profile is required before preparing artifacts.");
        }
        const artifactIds: string[] = [];
        for (const artifactType of artifactTypes) {
          const id = stableUuid(idempotencyKey, artifactType);
          const content = {
            status: "evidence_required",
            job: {
              id: String(jobResult.rows[0].id),
              title: String(jobResult.rows[0].title),
              company: String(jobResult.rows[0].company),
              url: String(jobResult.rows[0].canonical_url),
            },
            candidateEvidenceAvailable: true,
            message: "Open this artifact with an approved model action or edit it manually. No candidate claim was invented.",
          };
          await postgres.query(
            `INSERT INTO generated_application_artifacts (id,user_id,job_ref,artifact_type,content,provider,model)
             VALUES ($1,$2,$3,$4,$5,'deterministic','roleatlas-evidence-template-v1')
             ON CONFLICT (id) DO NOTHING`,
            [id, principal.userId, jobId, artifactType, content],
          );
          artifactIds.push(id);
        }
        return { artifactIds };
      }
      case "prepare_interview": {
        const jobId = value<string>(input, "jobId");
        const jobResult = await postgres.query("SELECT id,title,company FROM jobs WHERE id=$1", [jobId]);
        if (!jobResult.rowCount) toolFailure("job_not_found", "The canonical job was not found.");
        const artifactId = stableUuid(idempotencyKey, "interview");
        await postgres.query(
          `INSERT INTO generated_application_artifacts (id,user_id,job_ref,artifact_type,content,provider,model)
           VALUES ($1,$2,$3,'interview',$4,'deterministic','roleatlas-evidence-template-v1')
           ON CONFLICT (id) DO NOTHING`,
          [
            artifactId,
            principal.userId,
            jobId,
            {
              status: "evidence_required",
              role: String(jobResult.rows[0].title),
              company: String(jobResult.rows[0].company),
              prompts: [
                "Choose examples only from your confirmed profile.",
                "Prepare questions about the role scope, team, and success measures.",
              ],
            },
          ],
        );
        return { artifactId };
      }
      case "get_application_state": {
        const applicationId = value<string>(input, "applicationId");
        const application = await postgres.query(
          "SELECT * FROM applications WHERE user_id=$1 AND id=$2",
          [principal.userId, applicationId],
        );
        if (!application.rowCount) toolFailure("application_not_found", "The owned application was not found.");
        const activity = await postgres.query(
          "SELECT id,occurred_at,activity_type,summary FROM application_activities WHERE user_id=$1 AND application_id=$2 ORDER BY occurred_at",
          [principal.userId, applicationId],
        );
        return { application: { ...application.rows[0], activity: activity.rows } };
      }
      case "update_application_state": {
        const stage = value<string>(input, "stage");
        if (!applicationStages.has(stage)) {
          toolFailure("invalid_application_stage", "The application stage is not supported.");
        }
        const applicationId = value<string>(input, "applicationId");
        const note = value<string | undefined>(input, "note");
        return inTransaction(async (client) => {
          const updated = await client.query(
            "UPDATE applications SET stage=$3,updated_at=NOW() WHERE user_id=$1 AND id=$2 RETURNING id",
            [principal.userId, applicationId, stage],
          );
          if (!updated.rowCount) toolFailure("application_not_found", "The owned application was not found.");
          const activityId = stableTextId("activity", idempotencyKey, "stage-change");
          await client.query(
            `INSERT INTO application_activities (application_id,id,user_id,activity_type,summary)
             VALUES ($1,$2,$3,'stage_changed',$4) ON CONFLICT (application_id,id) DO NOTHING`,
            [applicationId, activityId, principal.userId, note || `Stage changed to ${stage}.`],
          );
          return { updated: true as const, activityId };
        });
      }
      case "get_followups": {
        const through = value<string | undefined>(input, "through") ?? new Date().toISOString().slice(0, 10);
        const result = await postgres.query(
          `SELECT id,job_ref,stage,follow_up_date,next_action
           FROM applications WHERE user_id=$1 AND follow_up_date IS NOT NULL AND follow_up_date <= $2::date
           ORDER BY follow_up_date,id LIMIT 100`,
          [principal.userId, through],
        );
        return { followups: result.rows };
      }
      case "get_notifications": {
        const unreadOnly = value<boolean>(input, "unreadOnly");
        const limit = value<number>(input, "limit");
        const result = await postgres.query(
          `SELECT id,notification_type,title,detail,target_view,created_at,read_at,dismissed_at
           FROM user_notifications
           WHERE user_id=$1 AND dismissed_at IS NULL AND (NOT $2::boolean OR read_at IS NULL)
           ORDER BY created_at DESC LIMIT $3`,
          [principal.userId, unreadOnly, limit],
        );
        return { notifications: result.rows };
      }
      case "send_external_message":
        toolFailure("external_delivery_unavailable", "External message delivery is intentionally unavailable.");
      default:
        toolFailure("executor_missing", "The requested tool has no registered executor.");
    }
  }
}
