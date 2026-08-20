import { getPersistentAgentRun } from "../../../../lib/agent/postgres-store.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../../lib/session.ts";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  const { id } = await context.params;
  const run = await getPersistentAgentRun(principal.userId, id);
  if (!run) {
    return Response.json(
      { error: { code: "agent_run_not_found", message: "The agent run was not found." } },
      { status: 404 },
    );
  }
  return Response.json(run, { headers: { "Cache-Control": "private, no-store" } });
}
