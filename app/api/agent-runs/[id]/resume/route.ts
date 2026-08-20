import { agentRuntime } from "../../../../../lib/agent/service.ts";
import { getPersistentAgentRun } from "../../../../../lib/agent/postgres-store.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../../../lib/session.ts";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { transitionLimit?: unknown };
  const transitionLimit = typeof body.transitionLimit === "number"
    ? Math.max(1, Math.min(Math.trunc(body.transitionLimit), 50))
    : 12;
  const execution = await agentRuntime.resume(principal, id, transitionLimit);
  if (execution.outcome === "not_found") {
    return Response.json(
      { error: { code: "agent_run_not_found", message: "The agent run was not found." } },
      { status: 404 },
    );
  }
  if (execution.outcome === "busy") {
    return Response.json(
      { error: { code: "agent_run_busy", message: "Another worker is already advancing this run." } },
      { status: 409 },
    );
  }
  return Response.json({ execution, run: await getPersistentAgentRun(principal.userId, id) });
}
