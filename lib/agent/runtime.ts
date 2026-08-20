import { randomUUID } from "node:crypto";
import {
  budgetViolation,
  type AgentBudget,
  type AgentEvidence,
  type AgentPlan,
  type AgentRunStatus,
  type AgentUsage,
} from "./contracts.ts";
import {
  resolvePlanInput,
  type AgentPlanner,
} from "./planner.ts";
import {
  evaluateAgentToolPolicy,
  type AgentPrincipal,
  type AgentToolRegistry,
} from "./policy.ts";

export type RuntimeRun = {
  id: string;
  userId: string;
  goal: string;
  status: AgentRunStatus;
  planVersion: number;
  budget: AgentBudget;
  usage: AgentUsage;
  createdAt: string;
  cancellationRequestedAt?: string;
};

export type RuntimeStep = {
  id: string;
  key: string;
  ordinal: number;
  planVersion: number;
  title: string;
  objective: string;
  toolName?: string;
  input: Record<string, unknown>;
  status: "pending" | "running" | "waiting" | "succeeded" | "failed" | "skipped" | "cancelled";
  attemptCount: number;
  maxAttempts: number;
};

export type RuntimeSnapshot = {
  run: RuntimeRun;
  plan?: AgentPlan;
  steps: RuntimeStep[];
  observations: Record<string, unknown>;
  evidence: AgentEvidence[];
};

export type RuntimeToolCall = {
  id: string;
  stepId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  idempotencyKey: string;
};

export type RuntimeWorker = {
  id: string;
  key: string;
  task: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  maxSteps: number;
  stepsUsed: number;
  maxToolCalls: number;
  toolCallsUsed: number;
  result?: unknown;
  errorCode?: string;
};

export type RuntimeWorkerAttempt = {
  worker: RuntimeWorker;
  call: RuntimeToolCall;
};

export type ApprovedRuntimeToolCall = {
  call: RuntimeToolCall;
  step: RuntimeStep;
  approvalId: string;
  approvalExpiresAt: string;
};

export interface AgentRuntimeStore {
  claim(userId: string, runId: string, leaseOwner: string, leaseMs: number): Promise<boolean>;
  release(userId: string, runId: string, leaseOwner: string): Promise<void>;
  recoverInterrupted(userId: string, runId: string, idempotentToolNames: string[]): Promise<"recovered" | "manual_review" | null>;
  snapshot(userId: string, runId: string): Promise<RuntimeSnapshot | null>;
  savePlan(userId: string, runId: string, plan: AgentPlan, reason: "initial" | "tool_failure", planner: { provider: string; model: string }): Promise<void>;
  setRunStatus(userId: string, runId: string, status: AgentRunStatus, phase: string, error?: { code: string; message: string }): Promise<void>;
  startStep(userId: string, runId: string, stepId: string): Promise<void>;
  retryStep(userId: string, runId: string, stepId: string, error: { code: string; message: string }): Promise<void>;
  deferStep(userId: string, runId: string, stepId: string, output: unknown): Promise<void>;
  completeStep(userId: string, runId: string, stepId: string, output: unknown): Promise<void>;
  failStep(userId: string, runId: string, stepId: string, error: { code: string; message: string }): Promise<void>;
  createToolCall(userId: string, runId: string, step: RuntimeStep, toolName: string, args: Record<string, unknown>, effect: string): Promise<RuntimeToolCall>;
  completeToolCall(userId: string, runId: string, callId: string, result: unknown, latencyMs: number): Promise<void>;
  failToolCall(userId: string, runId: string, callId: string, error: { code: string; message: string }, latencyMs: number): Promise<void>;
  requestApproval(userId: string, runId: string, call: RuntimeToolCall, summary: string): Promise<void>;
  takeApprovedToolCall(userId: string, runId: string): Promise<ApprovedRuntimeToolCall | null>;
  consumeApproval(userId: string, runId: string, approvalId: string): Promise<void>;
  appendObservation(userId: string, runId: string, step: RuntimeStep, output: unknown): Promise<void>;
  appendEvent(userId: string, runId: string, eventType: string, data?: Record<string, unknown>): Promise<void>;
  prepareWorkers(userId: string, runId: string, stepId: string, workers: Array<{ key: string; task: string }>): Promise<void>;
  listWorkers(userId: string, runId: string, stepId: string): Promise<RuntimeWorker[]>;
  startWorker(userId: string, runId: string, step: RuntimeStep, workerId: string, toolName: string, args: Record<string, unknown>, effect: string): Promise<RuntimeWorkerAttempt | null>;
  completeWorker(userId: string, runId: string, workerId: string, callId: string, result: unknown, latencyMs: number): Promise<void>;
  failWorker(userId: string, runId: string, workerId: string, callId: string, error: { code: string; message: string }, latencyMs: number): Promise<"queued" | "failed">;
  cancelPendingWorkers(userId: string, runId: string, stepId: string): Promise<void>;
  isCancellationRequested(userId: string, runId: string): Promise<boolean>;
}

export interface AgentToolExecutor {
  execute(input: {
    principal: AgentPrincipal;
    runId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export class AgentToolExecutionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentToolExecutionError";
    this.code = code;
  }
}

function publicToolError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return { code: "tool_timeout", message: "The tool exceeded its time limit." };
  }
  if (error instanceof AgentToolExecutionError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "tool_failed",
    message: "The tool did not complete successfully.",
  };
}

function nextStep(snapshot: RuntimeSnapshot) {
  const succeeded = new Set(
    snapshot.steps.filter((step) => step.status === "succeeded" || step.status === "skipped").map((step) => step.key),
  );
  const planStep = snapshot.plan?.steps.find((candidate) => {
    const persisted = snapshot.steps.find((step) => step.key === candidate.key && step.planVersion === snapshot.plan?.version);
    return persisted?.status === "pending" && candidate.dependsOn.every((dependency) => succeeded.has(dependency));
  });
  return planStep
    ? snapshot.steps.find((step) => step.key === planStep.key && step.planVersion === snapshot.plan?.version)
    : undefined;
}

function asynchronousToolIsPending(toolName: string, output: unknown) {
  if (toolName !== "get_source_scan_status" || !output || typeof output !== "object") return false;
  const status = (output as Record<string, unknown>).status;
  return status === "queued" || status === "running";
}

export class AgentRuntime {
  private readonly store: AgentRuntimeStore;
  private readonly planner: AgentPlanner;
  private readonly registry: AgentToolRegistry;
  private readonly executor: AgentToolExecutor;
  private readonly toolTimeoutMs: number;
  private readonly cancellationPollMs: number;
  private readonly retryBaseDelayMs: number;

  constructor(
    store: AgentRuntimeStore,
    planner: AgentPlanner,
    registry: AgentToolRegistry,
    executor: AgentToolExecutor,
    options: {
      toolTimeoutMs?: number;
      cancellationPollMs?: number;
      retryBaseDelayMs?: number;
    } = {},
  ) {
    this.store = store;
    this.planner = planner;
    this.registry = registry;
    this.executor = executor;
    this.toolTimeoutMs = Math.max(100, Math.min(options.toolTimeoutMs ?? 20_000, 300_000));
    this.cancellationPollMs = Math.max(25, Math.min(options.cancellationPollMs ?? 500, 5_000));
    this.retryBaseDelayMs = Math.max(0, Math.min(options.retryBaseDelayMs ?? 0, 30_000));
  }

  private async waitBeforeRetry(attempt: number) {
    const delayMs = Math.min(this.retryBaseDelayMs * (2 ** Math.max(0, attempt - 1)), 30_000);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private async executeTool(input: Parameters<AgentToolExecutor["execute"]>[0]) {
    const controller = new AbortController();
    let abortError = new AgentToolExecutionError(
      "tool_timeout",
      "The tool exceeded its time limit.",
    );
    let checkingCancellation = false;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(abortError), { once: true });
    });
    const timeout = setTimeout(() => controller.abort(), this.toolTimeoutMs);
    const cancellationPoll = setInterval(async () => {
      if (checkingCancellation || controller.signal.aborted) return;
      checkingCancellation = true;
      try {
        if (await this.store.isCancellationRequested(input.principal.userId, input.runId)) {
          abortError = new AgentToolExecutionError(
            "tool_cancelled",
            "The tool stopped because the agent run was cancelled.",
          );
          controller.abort();
        }
      } catch {
        // A transient cancellation-check failure must not replace the tool's own result.
      } finally {
        checkingCancellation = false;
      }
    }, this.cancellationPollMs);
    try {
      return await Promise.race([
        this.executor.execute({ ...input, signal: controller.signal }),
        abortPromise,
      ]);
    } finally {
      clearTimeout(timeout);
      clearInterval(cancellationPoll);
    }
  }

  private async analyzeJobsInParallel(
    principal: AgentPrincipal,
    runId: string,
    step: RuntimeStep,
    jobIds: string[],
    maxConcurrency: number,
  ) {
    const uniqueJobIds = [...new Set(jobIds)].slice(0, 10);
    await this.store.prepareWorkers(
      principal.userId,
      runId,
      step.id,
      uniqueJobIds.map((jobId) => ({
        key: `v${step.planVersion}:${step.key}:job:${jobId}`,
        task: `Analyze canonical job ${jobId} using only registered read-only tools.`,
      })),
    );
    const analyzeTool = this.registry.get("analyze_job");
    if (!analyzeTool) throw new Error("The bounded worker tool is not registered.");
    const concurrency = Math.max(1, Math.min(maxConcurrency, 16));
    for (let batchNumber = 0; batchNumber < 20; batchNumber += 1) {
      const fresh = await this.store.snapshot(principal.userId, runId);
      if (!fresh || fresh.run.cancellationRequestedAt) {
        await this.store.cancelPendingWorkers(principal.userId, runId, step.id);
        break;
      }
      const workers = await this.store.listWorkers(principal.userId, runId, step.id);
      const queued = workers.filter((worker) => worker.status === "queued");
      if (queued.length === 0) break;
      const available = Math.max(0, concurrency - workers.filter((worker) => worker.status === "running").length);
      if (available === 0) break;
      await Promise.all(queued.slice(0, available).map(async (worker) => {
        const jobId = worker.key.includes(":job:") ? worker.key.split(":job:").at(-1) ?? "" : "";
        const arguments_ = { jobId };
        const decision = evaluateAgentToolPolicy(this.registry, "analyze_job", arguments_, {
          principal,
          runId,
        });
        if (decision.outcome !== "allow") {
          throw new Error("The policy layer rejected a runtime-owned worker tool.");
        }
        const attempt = await this.store.startWorker(
          principal.userId,
          runId,
          step,
          worker.id,
          "analyze_job",
          arguments_,
          analyzeTool.effect,
        );
        if (!attempt) return;
        await this.store.appendEvent(principal.userId, runId, "worker.started", {
          workerId: worker.id,
          workerKey: worker.key,
          toolName: "analyze_job",
        });
        const started = Date.now();
        try {
          const result = await this.executeTool({
            principal,
            runId,
            toolName: "analyze_job",
            arguments: arguments_,
            idempotencyKey: attempt.call.idempotencyKey,
          });
          const parsed = this.registry.parseOutput("analyze_job", result);
          await this.store.completeWorker(
            principal.userId,
            runId,
            worker.id,
            attempt.call.id,
            parsed,
            Date.now() - started,
          );
          await this.store.appendEvent(principal.userId, runId, "worker.completed", {
            workerId: worker.id,
            workerKey: worker.key,
          });
        } catch (error) {
          const safeError = publicToolError(error);
          const status = await this.store.failWorker(
            principal.userId,
            runId,
            worker.id,
            attempt.call.id,
            safeError,
            Date.now() - started,
          );
          await this.store.appendEvent(principal.userId, runId, "worker.failed", {
            workerId: worker.id,
            workerKey: worker.key,
            errorCode: safeError.code,
            retryScheduled: status === "queued",
          });
          if (status === "queued") await this.waitBeforeRetry(attempt.worker.stepsUsed);
        }
      }));
    }
    const workers = await this.store.listWorkers(principal.userId, runId, step.id);
    const analyses = workers.map((worker) => {
      const jobId = worker.key.includes(":job:") ? worker.key.split(":job:").at(-1) ?? worker.key : worker.key;
      if (worker.status === "completed") {
        const result = worker.result && typeof worker.result === "object"
          ? worker.result as Record<string, unknown>
          : {};
        return {
          jobId,
          status: "completed" as const,
          analysis: result.analysis && typeof result.analysis === "object" && !Array.isArray(result.analysis)
            ? result.analysis as Record<string, unknown>
            : {},
        };
      }
      return {
        jobId,
        status: "failed" as const,
        errorCode: worker.errorCode ?? (worker.status === "cancelled" ? "cancelled" : "worker_incomplete"),
      };
    });
    return {
      analyses,
      completed: analyses.filter((analysis) => analysis.status === "completed").length,
      failed: analyses.filter((analysis) => analysis.status === "failed").length,
      omitted: Math.max(0, jobIds.length - uniqueJobIds.length),
    };
  }

  async resume(principal: AgentPrincipal, runId: string, transitionLimit = 12) {
    const leaseOwner = randomUUID();
    const claimed = await this.store.claim(principal.userId, runId, leaseOwner, 30_000);
    if (!claimed) return { outcome: "busy" as const };
    try {
      const recovery = await this.store.recoverInterrupted(
        principal.userId,
        runId,
        this.registry.list().filter((tool) => tool.idempotent).map((tool) => tool.name),
      );
      if (recovery === "manual_review") {
        return { outcome: "paused" as const, reason: "non_idempotent_outcome_unknown" };
      }
      for (let transition = 0; transition < Math.max(1, Math.min(transitionLimit, 50)); transition += 1) {
        const snapshot = await this.store.snapshot(principal.userId, runId);
        if (!snapshot) return { outcome: "not_found" as const };
        if (["completed", "failed", "cancelled"].includes(snapshot.run.status)) {
          return { outcome: snapshot.run.status as "completed" | "failed" | "cancelled" };
        }
        if (snapshot.run.cancellationRequestedAt) {
          await this.store.setRunStatus(principal.userId, runId, "cancelled", "finished");
          await this.store.appendEvent(principal.userId, runId, "run.cancelled");
          return { outcome: "cancelled" as const };
        }
        const violation = budgetViolation(snapshot.run.budget, snapshot.run.usage);
        if (violation) {
          await this.store.setRunStatus(principal.userId, runId, "failed", "finished", {
            code: violation,
            message: `The agent stopped at its ${violation.replaceAll("_", " ")}.`,
          });
          await this.store.appendEvent(principal.userId, runId, "run.budget_exhausted", { violation });
          return { outcome: "failed" as const, reason: violation };
        }
        if (!snapshot.plan) {
          await this.store.setRunStatus(principal.userId, runId, "planning", "planning");
          const plan = await this.planner.createPlan({
            goal: snapshot.run.goal,
            currentVersion: snapshot.run.planVersion,
            evidence: snapshot.evidence,
          });
          await this.store.savePlan(principal.userId, runId, plan, "initial", this.planner);
          await this.store.appendEvent(principal.userId, runId, "plan.created", { version: plan.version });
          continue;
        }
        const approved = await this.store.takeApprovedToolCall(principal.userId, runId);
        if (approved) {
          const decision = evaluateAgentToolPolicy(
            this.registry,
            approved.call.toolName,
            approved.call.arguments,
            {
              principal,
              runId,
              toolCallId: approved.call.id,
              approvedToolCallId: approved.call.id,
              approvalExpiresAt: approved.approvalExpiresAt,
            },
          );
          if (decision.outcome !== "allow") {
            const error = { code: "approval_invalid", message: decision.reason };
            await this.store.failToolCall(principal.userId, runId, approved.call.id, error, 0);
            await this.store.failStep(principal.userId, runId, approved.step.id, error);
            await this.store.setRunStatus(principal.userId, runId, "paused", "awaiting_approval", error);
            return { outcome: "paused" as const, reason: error.code };
          }
          await this.store.appendEvent(principal.userId, runId, "approval.consumed", {
            approvalId: approved.approvalId,
            toolName: approved.call.toolName,
          });
          const started = Date.now();
          try {
            const result = await this.executeTool({
              principal,
              runId,
              toolName: approved.call.toolName,
              arguments: approved.call.arguments,
              idempotencyKey: approved.call.idempotencyKey,
            });
            const parsedOutput = this.registry.parseOutput(approved.call.toolName, result);
            await this.store.completeToolCall(principal.userId, runId, approved.call.id, parsedOutput, Date.now() - started);
            await this.store.completeStep(principal.userId, runId, approved.step.id, parsedOutput);
            await this.store.appendObservation(principal.userId, runId, approved.step, parsedOutput);
            continue;
          } catch (error) {
            const safeError = publicToolError(error);
            await this.store.failToolCall(principal.userId, runId, approved.call.id, safeError, Date.now() - started);
            await this.store.failStep(principal.userId, runId, approved.step.id, safeError);
            await this.store.setRunStatus(principal.userId, runId, "paused", "acting", safeError);
            return { outcome: "paused" as const, reason: safeError.code };
          }
        }
        const step = nextStep(snapshot);
        if (!step) {
          const unfinished = snapshot.steps.some((candidate) => candidate.planVersion === snapshot.plan?.version && ["pending", "running", "waiting"].includes(candidate.status));
          if (unfinished) {
            await this.store.setRunStatus(principal.userId, runId, "paused", "acting", {
              code: "dependency_blocked",
              message: "The remaining plan steps are waiting on unresolved dependencies.",
            });
            return { outcome: "paused" as const };
          }
          const failed = snapshot.steps.some((candidate) => (
            candidate.planVersion === snapshot.plan?.version && candidate.status === "failed"
          ));
          if (failed) {
            await this.store.setRunStatus(principal.userId, runId, "paused", "acting", {
              code: "step_failed",
              message: "A current plan step failed and requires review before the run can continue.",
            });
            return { outcome: "paused" as const, reason: "step_failed" };
          }
          await this.store.setRunStatus(principal.userId, runId, "completed", "finished");
          await this.store.appendEvent(principal.userId, runId, "run.completed");
          return { outcome: "completed" as const };
        }
        await this.store.startStep(principal.userId, runId, step.id);
        if (!step.toolName) {
          const output = {
            summary: "The deterministic plan completed without external or irreversible action.",
            evidenceKeys: Object.keys(snapshot.observations),
          };
          await this.store.completeStep(principal.userId, runId, step.id, output);
          await this.store.appendObservation(principal.userId, runId, step, output);
          continue;
        }
        const resolvedInput = resolvePlanInput(step.input, snapshot.observations);
        if (
          step.toolName === "compare_jobs"
          && Array.isArray(resolvedInput.jobIds)
          && resolvedInput.jobIds.length < 2
        ) {
          const output = { comparisons: [] };
          await this.store.completeStep(principal.userId, runId, step.id, output);
          await this.store.appendObservation(principal.userId, runId, step, output);
          await this.store.appendEvent(principal.userId, runId, "tool.skipped", {
            toolName: step.toolName,
            reason: "shortlist_too_small",
          });
          continue;
        }
        if (
          step.toolName === "analyze_jobs_parallel"
          && Array.isArray(resolvedInput.jobIds)
          && resolvedInput.jobIds.length === 0
        ) {
          const output = { analyses: [], completed: 0, failed: 0, omitted: 0 };
          await this.store.completeStep(principal.userId, runId, step.id, output);
          await this.store.appendObservation(principal.userId, runId, step, output);
          await this.store.appendEvent(principal.userId, runId, "tool.skipped", {
            toolName: step.toolName,
            reason: "shortlist_empty",
          });
          continue;
        }
        const decision = evaluateAgentToolPolicy(this.registry, step.toolName, resolvedInput, {
          principal,
          runId,
        });
        if (decision.outcome === "deny") {
          const error = { code: "tool_policy_denied", message: decision.reason };
          await this.store.failStep(principal.userId, runId, step.id, error);
          await this.store.setRunStatus(principal.userId, runId, "failed", "finished", error);
          await this.store.appendEvent(principal.userId, runId, "tool.denied", { toolName: step.toolName });
          return { outcome: "failed" as const, reason: error.code };
        }
        const tool = this.registry.get(step.toolName);
        if (!tool) throw new Error("Registered tool disappeared during execution.");
        const parsedInput = this.registry.parseInput(step.toolName, resolvedInput) as Record<string, unknown>;
        const call = await this.store.createToolCall(
          principal.userId,
          runId,
          step,
          step.toolName,
          parsedInput,
          tool.effect,
        );
        if (decision.outcome === "approval_required") {
          await this.store.requestApproval(principal.userId, runId, call, decision.reason);
          await this.store.setRunStatus(principal.userId, runId, "waiting_for_approval", "awaiting_approval");
          return { outcome: "waiting_for_approval" as const };
        }
        const started = Date.now();
        try {
          const result = step.toolName === "analyze_jobs_parallel"
            ? await this.analyzeJobsInParallel(
                principal,
                runId,
                step,
                parsedInput.jobIds as string[],
                snapshot.run.budget.maxConcurrency,
              )
            : await this.executeTool({
                principal,
                runId,
                toolName: step.toolName,
                arguments: parsedInput,
                idempotencyKey: call.idempotencyKey,
              });
          const parsedOutput = this.registry.parseOutput(step.toolName, result);
          await this.store.completeToolCall(principal.userId, runId, call.id, parsedOutput, Date.now() - started);
          if (asynchronousToolIsPending(step.toolName, parsedOutput)) {
            await this.store.deferStep(principal.userId, runId, step.id, parsedOutput);
            await this.store.appendObservation(principal.userId, runId, step, parsedOutput);
            await this.store.appendEvent(principal.userId, runId, "tool.waiting", {
              toolName: step.toolName,
              status: (parsedOutput as Record<string, unknown>).status,
            });
            return { outcome: "waiting_for_tool" as const, retryAfterMs: 5_000 };
          }
          await this.store.completeStep(principal.userId, runId, step.id, parsedOutput);
          await this.store.appendObservation(principal.userId, runId, step, parsedOutput);
          await this.store.appendEvent(principal.userId, runId, "tool.succeeded", { toolName: step.toolName });
        } catch (error) {
          const safeError = publicToolError(error);
          await this.store.failToolCall(principal.userId, runId, call.id, safeError, Date.now() - started);
          if (step.attemptCount + 1 < step.maxAttempts && tool.idempotent) {
            await this.store.retryStep(principal.userId, runId, step.id, safeError);
            await this.store.appendEvent(principal.userId, runId, "tool.retry_scheduled", { toolName: step.toolName });
            await this.waitBeforeRetry(step.attemptCount + 1);
            continue;
          }
          const priorMatchingFailures = snapshot.steps.filter((candidate) => (
            candidate.toolName === step.toolName && candidate.status === "failed"
          )).length;
          await this.store.failStep(principal.userId, runId, step.id, safeError);
          if (priorMatchingFailures >= 1) {
            const repeatedError = {
              code: "repeated_tool_failure",
              message: "The agent stopped after the same tool failed in two plan revisions.",
            };
            await this.store.setRunStatus(principal.userId, runId, "failed", "finished", repeatedError);
            await this.store.appendEvent(principal.userId, runId, "run.loop_prevented", {
              failedTool: step.toolName,
            });
            return { outcome: "failed" as const, reason: repeatedError.code };
          }
          const revised = await this.planner.revisePlan({
            goal: snapshot.run.goal,
            currentVersion: snapshot.run.planVersion,
            evidence: snapshot.evidence,
            failedTool: { name: step.toolName, code: safeError.code },
          });
          await this.store.savePlan(principal.userId, runId, revised, "tool_failure", this.planner);
          await this.store.appendEvent(principal.userId, runId, "plan.revised", {
            failedTool: step.toolName,
            version: revised.version,
          });
        }
      }
      return { outcome: "yielded" as const };
    } finally {
      await this.store.release(principal.userId, runId, leaseOwner);
    }
  }
}
