import { z } from "zod";

export const agentEffectLevels = [
  "read_only",
  "internal_write",
  "approval_required",
] as const;

export type AgentEffectLevel = (typeof agentEffectLevels)[number];

export const agentRunStatuses = [
  "queued",
  "planning",
  "running",
  "waiting_for_approval",
  "waiting_for_tool",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AgentRunStatus = (typeof agentRunStatuses)[number];

export const AgentBudgetSchema = z.object({
  maxSteps: z.number().int().min(1).max(100).default(24),
  maxToolCalls: z.number().int().min(1).max(200).default(32),
  maxTokens: z.number().int().min(0).max(1_000_000).default(80_000),
  maxCostMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(2_000_000),
  maxWallTimeMs: z.number().int().min(1_000).max(604_800_000).default(900_000),
  maxConcurrency: z.number().int().min(1).max(16).default(3),
}).strict();

export type AgentBudget = z.infer<typeof AgentBudgetSchema>;

export const AgentRunRequestSchema = z.object({
  goal: z.string().trim().min(3).max(10_000),
  autonomy: z.enum(["guided", "autonomous"]).default("guided"),
  budget: AgentBudgetSchema.partial().optional(),
  provider: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().min(1).max(200).optional(),
}).strict();

export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const AgentPlanStepSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  title: z.string().trim().min(1).max(240),
  objective: z.string().trim().min(1).max(2_000),
  toolName: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
  input: z.record(z.string(), z.unknown()).default({}),
  dependsOn: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(20).default([]),
  maxAttempts: z.number().int().min(1).max(10).default(2),
}).strict();

export const AgentPlanSchema = z.object({
  version: z.number().int().min(1),
  rationale: z.string().trim().max(4_000).default(""),
  steps: z.array(AgentPlanStepSchema).min(1).max(50),
}).strict().superRefine((plan, context) => {
  const keys = new Set<string>();
  for (const step of plan.steps) {
    if (keys.has(step.key)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate plan step key: ${step.key}`,
        path: ["steps"],
      });
    }
    for (const dependency of step.dependsOn) {
      if (!keys.has(dependency)) {
        context.addIssue({
          code: "custom",
          message: `Step ${step.key} depends on an unknown or later step: ${dependency}`,
          path: ["steps"],
        });
      }
    }
    keys.add(step.key);
  }
});

export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export const AgentToolProposalSchema = z.object({
  toolName: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  arguments: z.record(z.string(), z.unknown()),
  reason: z.string().trim().min(1).max(2_000),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export type AgentToolProposal = z.infer<typeof AgentToolProposalSchema>;

export type AgentUsage = {
  steps: number;
  toolCalls: number;
  tokens: number;
  costMicros: number;
  elapsedMs: number;
  concurrentWorkers: number;
};

export type AgentBudgetViolation =
  | "step_limit"
  | "tool_call_limit"
  | "token_limit"
  | "cost_limit"
  | "time_limit"
  | "concurrency_limit";

export function budgetViolation(
  budgetInput: Partial<AgentBudget>,
  usage: AgentUsage,
): AgentBudgetViolation | null {
  const budget = AgentBudgetSchema.parse(budgetInput);
  if (usage.steps >= budget.maxSteps) return "step_limit";
  if (usage.toolCalls >= budget.maxToolCalls) return "tool_call_limit";
  if (budget.maxTokens > 0 && usage.tokens >= budget.maxTokens) return "token_limit";
  if (budget.maxCostMicros > 0 && usage.costMicros >= budget.maxCostMicros) return "cost_limit";
  if (usage.elapsedMs >= budget.maxWallTimeMs) return "time_limit";
  if (usage.concurrentWorkers >= budget.maxConcurrency) return "concurrency_limit";
  return null;
}

export const AgentEvidenceSchema = z.object({
  source: z.string().trim().min(1).max(200),
  authority: z.literal("data_only"),
  content: z.string().max(50_000),
  observedAt: z.string().datetime(),
}).strict();

export type AgentEvidence = z.infer<typeof AgentEvidenceSchema>;

export function untrustedEvidence(source: string, content: string): AgentEvidence {
  return AgentEvidenceSchema.parse({
    source,
    authority: "data_only",
    content: content.slice(0, 50_000),
    observedAt: new Date().toISOString(),
  });
}
