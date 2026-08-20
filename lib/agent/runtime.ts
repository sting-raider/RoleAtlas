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
}

export interface AgentToolExecutor {
  execute(input: {
    principal: AgentPrincipal;
    runId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
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

  constructor(
    store: AgentRuntimeStore,
    planner: AgentPlanner,
    registry: AgentToolRegistry,
    executor: AgentToolExecutor,
  ) {
    this.store = store;
    this.planner = planner;
    this.registry = registry;
    this.executor = executor;
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
          const started = Date.now();
          try {
            const result = await this.executor.execute({
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
            await this.store.consumeApproval(principal.userId, runId, approved.approvalId);
            await this.store.appendEvent(principal.userId, runId, "approval.consumed", {
              approvalId: approved.approvalId,
              toolName: approved.call.toolName,
            });
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
          const result = await this.executor.execute({
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
