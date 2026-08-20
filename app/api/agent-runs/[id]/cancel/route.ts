import { requestAgentCancellation } from "../../../../../lib/agent/postgres-store.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../../../lib/session.ts";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  const { id } = await context.params;
  const requested = await requestAgentCancellation(principal.userId, id);
  if (!requested) {
    return Response.json(
      { error: { code: "agent_run_not_cancellable", message: "The run was not found or is already finished." } },
      { status: 404 },
    );
  }
  return Response.json({ cancellationRequested: true }, { status: 202 });
}
