import { z } from "zod";
import type { AgentEffectLevel } from "./contracts.ts";

export type AgentPrincipal = {
  userId: string;
  role: "user" | "admin";
};

export type AgentPolicyContext = {
  principal: AgentPrincipal;
  runId: string;
  approvedToolCallId?: string;
  approvalExpiresAt?: string;
};

export type AgentToolDefinition<
  InputSchema extends z.ZodType = z.ZodType,
  OutputSchema extends z.ZodType = z.ZodType,
> = {
  name: string;
  description: string;
  effect: AgentEffectLevel;
  input: InputSchema;
  output: OutputSchema;
  adminOnly?: boolean;
  idempotent: boolean;
};

export type AgentPolicyDecision =
  | { outcome: "allow"; effect: AgentEffectLevel; reason: string }
  | { outcome: "approval_required"; effect: AgentEffectLevel; reason: string }
  | { outcome: "deny"; effect?: AgentEffectLevel; reason: string };

export class AgentToolRegistry {
  readonly #tools = new Map<string, AgentToolDefinition>();

  register(definition: AgentToolDefinition) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(definition.name)) {
      throw new Error(`Invalid tool name: ${definition.name}`);
    }
    if (this.#tools.has(definition.name)) {
      throw new Error(`Duplicate tool registration: ${definition.name}`);
    }
    this.#tools.set(definition.name, definition);
    return this;
  }

  get(name: string) {
    return this.#tools.get(name);
  }

  list() {
    return [...this.#tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      effect: tool.effect,
      adminOnly: Boolean(tool.adminOnly),
      idempotent: tool.idempotent,
    }));
  }

  parseInput(name: string, input: unknown) {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`Unknown agent tool: ${name}`);
    return tool.input.parse(input);
  }

  parseOutput(name: string, output: unknown) {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`Unknown agent tool: ${name}`);
    return tool.output.parse(output);
  }
}

export function evaluateAgentToolPolicy(
  registry: AgentToolRegistry,
  toolName: string,
  input: unknown,
  context: AgentPolicyContext,
): AgentPolicyDecision {
  const tool = registry.get(toolName);
  if (!tool) return { outcome: "deny", reason: "The requested tool is not registered." };
  if (tool.adminOnly && context.principal.role !== "admin") {
    return { outcome: "deny", effect: tool.effect, reason: "This tool requires an administrator role." };
  }
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) {
    return { outcome: "deny", effect: tool.effect, reason: "Tool arguments failed the registered schema." };
  }
  if (tool.effect === "approval_required") {
    const expiry = context.approvalExpiresAt ? Date.parse(context.approvalExpiresAt) : Number.NaN;
    if (!context.approvedToolCallId || !Number.isFinite(expiry) || expiry <= Date.now()) {
      return {
        outcome: "approval_required",
        effect: tool.effect,
        reason: "This external or irreversible action needs fresh human approval.",
      };
    }
  }
  return {
    outcome: "allow",
    effect: tool.effect,
    reason: tool.effect === "read_only"
      ? "Authenticated read-only tool."
      : tool.effect === "internal_write"
        ? "Authenticated, auditable user-scoped change."
        : "A fresh approval record authorizes this exact tool call.",
  };
}

const jobId = z.string().uuid();
const sourceId = z.string().regex(/^[a-z0-9][a-z0-9:_-]{1,199}$/);

export function createCoreAgentToolRegistry() {
  const registry = new AgentToolRegistry();
  const tools: AgentToolDefinition[] = [
    {
      name: "search_jobs",
      description: "Search the canonical index using bounded structured criteria.",
      effect: "read_only",
      idempotent: true,
      input: z.object({
        query: z.string().trim().min(1).max(500),
        location: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(100).default(30),
      }).strict(),
      output: z.object({ jobIds: z.array(jobId).max(100), total: z.number().int().min(0) }).passthrough(),
    },
    {
      name: "get_job",
      description: "Read one canonical listing and its provenance.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ jobId }).strict(),
      output: z.object({ job: z.record(z.string(), z.unknown()) }).strict(),
    },
    {
      name: "compare_jobs",
      description: "Compare a bounded shortlist without changing eligibility evidence.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ jobIds: z.array(jobId).min(2).max(10) }).strict(),
      output: z.object({ comparisons: z.array(z.record(z.string(), z.unknown())).max(10) }).strict(),
    },
    {
      name: "get_search_strategy",
      description: "Read the authenticated user's strategy and revision history.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ strategyId: z.string().trim().min(1).max(512).optional() }).strict(),
      output: z.object({ strategies: z.array(z.record(z.string(), z.unknown())) }).strict(),
    },
    {
      name: "create_search_strategy",
      description: "Create an auditable strategy inside the authenticated user's account.",
      effect: "internal_write",
      idempotent: true,
      input: z.object({ name: z.string().trim().min(1).max(200), plan: z.record(z.string(), z.unknown()) }).strict(),
      output: z.object({ strategyId: z.string(), revisionId: z.string() }).strict(),
    },
    {
      name: "revise_search_strategy",
      description: "Append an auditable strategy revision without changing confirmed profile facts.",
      effect: "internal_write",
      idempotent: true,
      input: z.object({ strategyId: z.string().trim().min(1).max(512), plan: z.record(z.string(), z.unknown()), reason: z.string().trim().min(1).max(500) }).strict(),
      output: z.object({ revisionId: z.string(), version: z.number().int().positive() }).strict(),
    },
    {
      name: "get_search_coverage",
      description: "Read persisted coverage evidence for a search or configured source set.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ searchSessionId: z.string().uuid().optional() }).strict(),
      output: z.object({ coverage: z.record(z.string(), z.unknown()) }).strict(),
    },
    {
      name: "request_source_scan",
      description: "Request a scan by stable approved source ID; arbitrary URLs are not accepted.",
      effect: "internal_write",
      idempotent: true,
      input: z.object({ sourceId }).strict(),
      output: z.object({ requestId: z.string(), status: z.string() }).strict(),
    },
    {
      name: "get_source_scan_status",
      description: "Read the status of an already authorized source scan.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ requestId: z.string().trim().min(1).max(200) }).strict(),
      output: z.object({ status: z.string() }).passthrough(),
    },
    {
      name: "rank_jobs",
      description: "Apply deterministic ranking features to a bounded set of canonical jobs.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ jobIds: z.array(jobId).min(1).max(100) }).strict(),
      output: z.object({ rankedJobIds: z.array(jobId).max(100) }).passthrough(),
    },
    {
      name: "analyze_job",
      description: "Create an evidence-bound analysis while preserving deterministic eligibility.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ jobId }).strict(),
      output: z.object({ analysis: z.record(z.string(), z.unknown()) }).strict(),
    },
    {
      name: "research_company",
      description: "Research a company through configured controlled research providers.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ company: z.string().trim().min(1).max(300) }).strict(),
      output: z.object({ findings: z.array(z.record(z.string(), z.unknown())), unavailableReason: z.string().optional() }).strict(),
    },
    {
      name: "research_compensation",
      description: "Research compensation through configured controlled data providers.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ title: z.string().trim().min(1).max(300), countryCode: z.string().regex(/^[A-Z]{2}$/).optional() }).strict(),
      output: z.object({ findings: z.array(z.record(z.string(), z.unknown())), unavailableReason: z.string().optional() }).strict(),
    },
    {
      name: "find_contact",
      description: "Find public professional contact context through a controlled provider.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ company: z.string().trim().min(1).max(300), role: z.string().trim().max(300).optional() }).strict(),
      output: z.object({ contacts: z.array(z.record(z.string(), z.unknown())), unavailableReason: z.string().optional() }).strict(),
    },
    {
      name: "prepare_application",
      description: "Generate truthful draft artifacts inside the authenticated user's account.",
      effect: "internal_write",
      idempotent: true,
      input: z.object({ jobId, artifactTypes: z.array(z.enum(["evaluation", "resume", "cover_letter", "recruiter_message"])).min(1).max(4) }).strict(),
      output: z.object({ artifactIds: z.array(z.string().uuid()).max(4) }).strict(),
    },
    {
      name: "prepare_interview",
      description: "Generate evidence-bound interview preparation inside the user's account.",
      effect: "internal_write",
      idempotent: true,
      input: z.object({ jobId }).strict(),
      output: z.object({ artifactId: z.string().uuid() }).strict(),
    },
    {
      name: "get_application_state",
      description: "Read an owned application and its timeline.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ applicationId: z.string().uuid() }).strict(),
      output: z.object({ application: z.record(z.string(), z.unknown()) }).strict(),
    },
    {
      name: "update_application_state",
      description: "Update an owned application with an auditable internal activity.",
      effect: "internal_write",
      idempotent: true,
      input: z.object({ applicationId: z.string().uuid(), stage: z.string().trim().min(1).max(100), note: z.string().trim().max(2_000).optional() }).strict(),
      output: z.object({ updated: z.literal(true), activityId: z.string() }).strict(),
    },
    {
      name: "get_followups",
      description: "Read due follow-ups for the authenticated user.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ through: z.string().date().optional() }).strict(),
      output: z.object({ followups: z.array(z.record(z.string(), z.unknown())) }).strict(),
    },
    {
      name: "get_notifications",
      description: "Read durable notifications for the authenticated user.",
      effect: "read_only",
      idempotent: true,
      input: z.object({ unreadOnly: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(30) }).strict(),
      output: z.object({ notifications: z.array(z.record(z.string(), z.unknown())).max(100) }).strict(),
    },
    {
      name: "send_external_message",
      description: "Reserved external communication boundary; no delivery implementation is registered.",
      effect: "approval_required",
      idempotent: false,
      input: z.object({ channel: z.enum(["email", "recruiter_message"]), recipient: z.string().trim().min(1).max(500), draftArtifactId: z.string().uuid() }).strict(),
      output: z.object({ delivered: z.boolean(), receiptId: z.string().optional() }).strict(),
    },
  ];
  for (const tool of tools) registry.register(tool);
  return registry;
}
