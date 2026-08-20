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
export const agentRuntime = new AgentRuntime(
  agentRuntimeStore,
  agentPlanner,
  coreAgentToolRegistry,
  agentToolExecutor,
);
