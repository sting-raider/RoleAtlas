import "server-only";

import { DeterministicAgentPlanner } from "./planner.ts";
import { createCoreAgentToolRegistry } from "./policy.ts";
import { PostgresAgentRuntimeStore } from "./postgres-store.ts";
import { AgentRuntime } from "./runtime.ts";
import { CoreAgentToolExecutor } from "./tools.ts";

export const coreAgentToolRegistry = createCoreAgentToolRegistry();
export const agentRuntimeStore = new PostgresAgentRuntimeStore();
export const agentPlanner = new DeterministicAgentPlanner();
export const agentToolExecutor = new CoreAgentToolExecutor();
const configuredToolTimeout = Number.parseInt(process.env.AGENT_TOOL_TIMEOUT_MS ?? "20000", 10);
export const agentRuntime = new AgentRuntime(
  agentRuntimeStore,
  agentPlanner,
  coreAgentToolRegistry,
  agentToolExecutor,
  {
    toolTimeoutMs: Number.isFinite(configuredToolTimeout) ? configuredToolTimeout : 20_000,
    cancellationPollMs: 500,
    retryBaseDelayMs: 250,
  },
);
