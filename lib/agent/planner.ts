import {
  AgentPlanSchema,
  type AgentPlan,
  type AgentEvidence,
} from "./contracts.ts";

export type AgentPlanningContext = {
  goal: string;
  currentVersion: number;
  evidence: AgentEvidence[];
  failedTool?: { name: string; code: string };
};

export interface AgentPlanner {
  readonly provider: string;
  readonly model: string;
  createPlan(context: AgentPlanningContext): Promise<AgentPlan>;
  revisePlan(context: AgentPlanningContext): Promise<AgentPlan>;
}

function boundedGoalQuery(goal: string) {
  return goal.replace(/\s+/g, " ").trim().slice(0, 500);
}

function fallbackPlan(context: AgentPlanningContext, replanning: boolean) {
  const version = context.currentVersion + 1;
  const searchDependency = replanning && context.failedTool?.name === "get_search_strategy"
    ? []
    : ["inspect_strategy"];
  const steps = [
    ...(
      replanning && context.failedTool?.name === "get_search_strategy"
        ? []
        : [{
            key: "inspect_strategy",
            title: "Inspect the current search strategy",
            objective: "Use the user's saved strategy as context without changing confirmed facts.",
            toolName: "get_search_strategy",
            input: {},
            dependsOn: [],
            maxAttempts: 2,
          }]
    ),
    {
      key: "search_index",
      title: "Search the canonical job index",
      objective: "Find a bounded set of real indexed listings relevant to the user's goal.",
      toolName: "search_jobs",
      input: { query: boundedGoalQuery(context.goal), limit: 30 },
      dependsOn: searchDependency,
      maxAttempts: 2,
    },
    {
      key: "inspect_coverage",
      title: "Inspect search coverage",
      objective: "Identify coverage limitations without claiming the whole market was searched.",
      toolName: "get_search_coverage",
      input: {},
      dependsOn: ["search_index"],
      maxAttempts: 2,
    },
    {
      key: "analyze_shortlist",
      title: "Analyze the strongest candidates in parallel",
      objective: "Delegate independent, evidence-bound analysis while respecting the run's concurrency and tool budgets.",
      toolName: "analyze_jobs_parallel",
      input: {
        jobIds: {
          $from: "search_index.jobIds",
          $take: 5,
        },
      },
      dependsOn: ["search_index"],
      maxAttempts: 2,
    },
    {
      key: "compare_shortlist",
      title: "Compare the strongest available shortlist",
      objective: "Compare only listings returned by the canonical search and preserve eligibility uncertainty.",
      toolName: "compare_jobs",
      input: {
        jobIds: {
          $from: "search_index.jobIds",
          $take: 5,
        },
      },
      dependsOn: ["search_index", "analyze_shortlist"],
      maxAttempts: 1,
    },
    {
      key: "recommend_next_actions",
      title: "Recommend the next useful actions",
      objective: "Summarize evidence, uncertainty, and safe next actions without applying or contacting anyone.",
      input: {},
      dependsOn: ["inspect_coverage", "analyze_shortlist", "compare_shortlist"],
      maxAttempts: 1,
    },
  ];
  return AgentPlanSchema.parse({
    version,
    rationale: replanning
      ? `The deterministic planner revised the route after ${context.failedTool?.name ?? "a tool"} failed. Existing evidence remains available.`
      : "Start with saved strategy context, search the existing index immediately, inspect honest coverage, delegate bounded shortlist analysis, and compare only persisted candidates.",
    steps,
  });
}

export class DeterministicAgentPlanner implements AgentPlanner {
  readonly provider = "deterministic";
  readonly model = "roleatlas-policy-planner-v1";

  async createPlan(context: AgentPlanningContext) {
    return fallbackPlan(context, false);
  }

  async revisePlan(context: AgentPlanningContext) {
    return fallbackPlan(context, true);
  }
}

type Reference = {
  $from: string;
  $take?: number;
};

function isReference(value: unknown): value is Reference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.$from === "string"
    && Object.keys(record).every((key) => key === "$from" || key === "$take")
    && (record.$take === undefined || Number.isInteger(record.$take));
}

function valueAtPath(observations: Record<string, unknown>, path: string) {
  const [stepKey, ...segments] = path.split(".");
  let current: unknown = observations[stepKey];
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function resolvePlanInput(
  input: Record<string, unknown>,
  observations: Record<string, unknown>,
): Record<string, unknown> {
  const resolve = (value: unknown): unknown => {
    if (isReference(value)) {
      const observed = valueAtPath(observations, value.$from);
      if (Array.isArray(observed) && value.$take !== undefined) {
        return observed.slice(0, Math.max(0, Math.min(value.$take, 100)));
      }
      return observed;
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, resolve(nested)]),
      );
    }
    return value;
  };
  return resolve(input) as Record<string, unknown>;
}
