import assert from "node:assert/strict";
import test from "node:test";
import { AgentBudgetSchema, type AgentPlan } from "../lib/agent/contracts.ts";
import { DeterministicAgentPlanner, resolvePlanInput } from "../lib/agent/planner.ts";
import { createCoreAgentToolRegistry } from "../lib/agent/policy.ts";
import {
  AgentRuntime,
  type AgentRuntimeStore,
  type RuntimeSnapshot,
  type RuntimeStep,
  type RuntimeToolCall,
} from "../lib/agent/runtime.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

class MemoryAgentStore implements AgentRuntimeStore {
  leased = false;
  recoveryResult: "recovered" | "manual_review" | null = null;
  events: string[] = [];
  toolCalls: RuntimeToolCall[] = [];
  failedToolErrors: Array<{ code: string; message: string }> = [];
  approvals: RuntimeToolCall[] = [];
  state: RuntimeSnapshot = {
    run: {
      id: runId,
      userId,
      goal: "Find product design internships with realistic eligibility",
      status: "queued",
      planVersion: 0,
      budget: AgentBudgetSchema.parse({}),
      usage: {
        steps: 0,
        toolCalls: 0,
        tokens: 0,
        costMicros: 0,
        elapsedMs: 0,
        concurrentWorkers: 0,
      },
      createdAt: new Date().toISOString(),
    },
    steps: [],
    observations: {},
    evidence: [],
  };

  async claim() {
    if (this.leased) return false;
    this.leased = true;
    return true;
  }

  async release() {
    this.leased = false;
  }

  async recoverInterrupted() {
    return this.recoveryResult;
  }

  async snapshot() {
    return this.state;
  }

  async savePlan(
    _userId: string,
    _runId: string,
    plan: AgentPlan,
  ) {
    this.state.plan = plan;
    this.state.run.planVersion = plan.version;
    this.state.run.status = "running";
    this.state.steps.push(...plan.steps.map((step, index): RuntimeStep => ({
      id: `${plan.version}-${step.key}`,
      key: step.key,
      ordinal: index + 1,
      planVersion: plan.version,
      title: step.title,
      objective: step.objective,
      toolName: step.toolName,
      input: step.input,
      status: "pending",
      attemptCount: 0,
      maxAttempts: step.maxAttempts,
    })));
  }

  async setRunStatus(
    _userId: string,
    _runId: string,
    status: RuntimeSnapshot["run"]["status"],
  ) {
    this.state.run.status = status;
  }

  async startStep(_userId: string, _runId: string, stepId: string) {
    const step = this.step(stepId);
    step.status = "running";
    step.attemptCount += 1;
    this.state.run.usage.steps += 1;
  }

  async retryStep(_userId: string, _runId: string, stepId: string) {
    this.step(stepId).status = "pending";
  }

  async deferStep(_userId: string, _runId: string, stepId: string) {
    this.step(stepId).status = "pending";
    this.state.run.status = "waiting_for_tool";
  }

  async completeStep(_userId: string, _runId: string, stepId: string) {
    this.step(stepId).status = "succeeded";
  }

  async failStep(_userId: string, _runId: string, stepId: string) {
    this.step(stepId).status = "failed";
  }

  async createToolCall(
    _userId: string,
    _runId: string,
    step: RuntimeStep,
    toolName: string,
    args: Record<string, unknown>,
  ) {
    const call = {
      id: `call-${this.toolCalls.length + 1}`,
      stepId: step.id,
      toolName,
      arguments: args,
      idempotencyKey: `${step.id}:${step.attemptCount}`,
    };
    this.toolCalls.push(call);
    this.state.run.usage.toolCalls += 1;
    return call;
  }

  async completeToolCall() {}
  async failToolCall(
    _userId: string,
    _runId: string,
    _callId: string,
    error: { code: string; message: string },
  ) {
    this.failedToolErrors.push(error);
  }

  async requestApproval(_userId: string, _runId: string, call: RuntimeToolCall) {
    this.approvals.push(call);
  }

  async takeApprovedToolCall() {
    return null;
  }

  async consumeApproval() {}

  async appendObservation(
    _userId: string,
    _runId: string,
    step: RuntimeStep,
    output: unknown,
  ) {
    this.state.observations[step.key] = output;
  }

  async appendEvent(_userId: string, _runId: string, eventType: string) {
    this.events.push(eventType);
  }

  private step(id: string) {
    const step = this.state.steps.find((candidate) => candidate.id === id);
    if (!step) throw new Error("Missing test step.");
    return step;
  }
}

test("deterministic plan references resolve only from persisted observations", () => {
  assert.deepEqual(resolvePlanInput({
    jobIds: { $from: "search.jobIds", $take: 2 },
  }, {
    search: { jobIds: ["one", "two", "three"] },
  }), {
    jobIds: ["one", "two"],
  });
  assert.deepEqual(resolvePlanInput({ value: { $from: "missing.value" } }, {}), { value: undefined });
});

test("the runtime persists plan, acts through registered tools, observes, and completes", async () => {
  const store = new MemoryAgentStore();
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const jobIds = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ];
  const executor = {
    async execute(input: { toolName: string; arguments: Record<string, unknown> }) {
      calls.push({ name: input.toolName, arguments: input.arguments });
      if (input.toolName === "get_search_strategy") return { strategies: [] };
      if (input.toolName === "search_jobs") return { jobIds, total: 3 };
      if (input.toolName === "get_search_coverage") return { coverage: { configuredSources: 16, wholeMarketCoverage: false } };
      if (input.toolName === "compare_jobs") {
        return { comparisons: (input.arguments.jobIds as string[]).map((id) => ({ id })) };
      }
      throw new Error(`Unexpected tool ${input.toolName}`);
    },
  };
  const runtime = new AgentRuntime(
    store,
    new DeterministicAgentPlanner(),
    createCoreAgentToolRegistry(),
    executor,
  );

  const result = await runtime.resume({ userId, role: "user" }, runId, 12);
  assert.equal(result.outcome, "completed");
  assert.equal(store.state.run.status, "completed");
  assert.deepEqual(calls.map((call) => call.name), [
    "get_search_strategy",
    "search_jobs",
    "get_search_coverage",
    "compare_jobs",
  ]);
  assert.deepEqual(calls[3].arguments.jobIds, jobIds);
  assert.ok(store.events.includes("plan.created"));
  assert.ok(store.events.includes("run.completed"));
});

test("an empty search completes honestly without issuing an invalid comparison call", async () => {
  const store = new MemoryAgentStore();
  const calls: string[] = [];
  const runtime = new AgentRuntime(
    store,
    new DeterministicAgentPlanner(),
    createCoreAgentToolRegistry(),
    {
      async execute(input) {
        calls.push(input.toolName);
        if (input.toolName === "get_search_strategy") return { strategies: [] };
        if (input.toolName === "search_jobs") return { jobIds: [], total: 0 };
        if (input.toolName === "get_search_coverage") {
          return { coverage: { configuredSources: 16, wholeMarketCoverage: false } };
        }
        throw new Error(`Unexpected tool ${input.toolName}`);
      },
    },
  );

  const result = await runtime.resume({ userId, role: "user" }, runId, 12);
  assert.equal(result.outcome, "completed");
  assert.equal(store.state.run.status, "completed");
  assert.deepEqual(calls, ["get_search_strategy", "search_jobs", "get_search_coverage"]);
  assert.deepEqual(store.state.observations.compare_shortlist, { comparisons: [] });
  assert.ok(store.events.includes("tool.skipped"));
});

test("the runtime stops a repeated tool failure instead of replanning forever", async () => {
  const store = new MemoryAgentStore();
  const jobIds = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ];
  const runtime = new AgentRuntime(
    store,
    new DeterministicAgentPlanner(),
    createCoreAgentToolRegistry(),
    {
      async execute(input) {
        if (input.toolName === "get_search_strategy") return { strategies: [] };
        if (input.toolName === "search_jobs") return { jobIds, total: 2 };
        if (input.toolName === "get_search_coverage") return { coverage: {} };
        if (input.toolName === "compare_jobs") throw new Error("private database detail");
        throw new Error("unexpected tool");
      },
    },
  );

  const result = await runtime.resume({ userId, role: "user" }, runId, 20);
  assert.deepEqual(result, { outcome: "failed", reason: "repeated_tool_failure" });
  assert.equal(store.state.run.status, "failed");
  assert.equal(store.state.run.planVersion, 2);
  assert.equal(store.toolCalls.filter((call) => call.toolName === "compare_jobs").length, 2);
  assert.deepEqual(store.failedToolErrors, [
    { code: "tool_failed", message: "The tool did not complete successfully." },
    { code: "tool_failed", message: "The tool did not complete successfully." },
  ]);
  assert.ok(store.events.includes("run.loop_prevented"));
});

test("a cancellation request stops before another tool can execute", async () => {
  const store = new MemoryAgentStore();
  store.state.run.cancellationRequestedAt = new Date().toISOString();
  let executed = false;
  const runtime = new AgentRuntime(
    store,
    new DeterministicAgentPlanner(),
    createCoreAgentToolRegistry(),
    { async execute() { executed = true; return {}; } },
  );

  const result = await runtime.resume({ userId, role: "user" }, runId);
  assert.equal(result.outcome, "cancelled");
  assert.equal(executed, false);
  assert.equal(store.state.run.status, "cancelled");
});

test("an interrupted non-idempotent action pauses for human review instead of retrying", async () => {
  const store = new MemoryAgentStore();
  store.recoveryResult = "manual_review";
  let executed = false;
  const runtime = new AgentRuntime(
    store,
    new DeterministicAgentPlanner(),
    createCoreAgentToolRegistry(),
    { async execute() { executed = true; return {}; } },
  );

  const result = await runtime.resume({ userId, role: "user" }, runId);
  assert.deepEqual(result, { outcome: "paused", reason: "non_idempotent_outcome_unknown" });
  assert.equal(executed, false);
});

test("an asynchronous source scan is observed without pretending it already finished", async () => {
  const store = new MemoryAgentStore();
  const scanPlan: AgentPlan = {
    version: 1,
    rationale: "Observe a previously authorized asynchronous scan.",
    steps: [
      {
        key: "scan_status",
        title: "Observe source scan status",
        objective: "Wait for the crawler's persisted source-run result.",
        toolName: "get_source_scan_status",
        input: { requestId: "fixture-request" },
        dependsOn: [],
        maxAttempts: 3,
      },
      {
        key: "summarize",
        title: "Summarize the result",
        objective: "Use only the persisted crawler observation.",
        input: {},
        dependsOn: ["scan_status"],
        maxAttempts: 1,
      },
    ],
  };
  const planner = {
    provider: "deterministic",
    model: "fixture",
    async createPlan() { return scanPlan; },
    async revisePlan() { return scanPlan; },
  };
  let observations = 0;
  const runtime = new AgentRuntime(
    store,
    planner,
    createCoreAgentToolRegistry(),
    {
      async execute() {
        observations += 1;
        return observations === 1 ? { status: "running" } : { status: "success", observedJobs: 14 };
      },
    },
  );

  const waiting = await runtime.resume({ userId, role: "user" }, runId, 5);
  assert.deepEqual(waiting, { outcome: "waiting_for_tool", retryAfterMs: 5_000 });
  assert.equal(store.state.run.status, "waiting_for_tool");
  assert.equal(store.state.steps.find((step) => step.key === "scan_status")?.status, "pending");
  assert.equal(store.state.steps.find((step) => step.key === "summarize")?.status, "pending");
  assert.ok(store.events.includes("tool.waiting"));

  const completed = await runtime.resume({ userId, role: "user" }, runId, 5);
  assert.equal(completed.outcome, "completed");
  assert.equal(store.state.run.status, "completed");
  assert.equal(observations, 2);
});
