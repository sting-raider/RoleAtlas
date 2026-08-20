import { decideAgentApproval } from "../../../../../../lib/agent/postgres-store.ts";
import { agentRuntime } from "../../../../../../lib/agent/service.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../../../../lib/session.ts";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; approvalId: string }> },
) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  const { id, approvalId } = await context.params;
  const body = await request.json().catch(() => null) as {
    decision?: unknown;
    note?: unknown;
  } | null;
  if (!body || (body.decision !== "approve" && body.decision !== "reject")) {
    return Response.json(
      { error: { code: "invalid_approval_decision", message: "Choose approve or reject." } },
      { status: 400 },
    );
  }
  const result = await decideAgentApproval(
    principal.userId,
    id,
    approvalId,
    body.decision,
    typeof body.note === "string" ? body.note.slice(0, 2_000) : "",
  );
  if (result === "not_found") {
    return Response.json(
      { error: { code: "approval_not_found", message: "The pending approval was not found." } },
      { status: 404 },
    );
  }
  if (result === "expired") {
    return Response.json(
      { error: { code: "approval_expired", message: "This approval expired; ask the agent to propose the action again." } },
      { status: 409 },
    );
  }
  const execution = result === "approved"
    ? await agentRuntime.resume(principal, id, 1)
    : { outcome: "paused" as const };
  return Response.json({ decision: result, execution });
}
