import { AgentRunRequestSchema } from "../../../lib/agent/contracts.ts";
import {
  createPersistentAgentRun,
  listPersistentAgentRuns,
} from "../../../lib/agent/postgres-store.ts";
import { agentRuntime } from "../../../lib/agent/service.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../lib/session.ts";

export async function GET(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 30);
  const runs = await listPersistentAgentRuns(principal.userId, limit);
  return Response.json({ runs }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  const parsed = AgentRunRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_agent_goal", message: "Provide a bounded career goal and valid run budget." } },
      { status: 400 },
    );
  }
  const run = await createPersistentAgentRun(principal.userId, parsed.data);
  const execution = await agentRuntime.resume(principal, run.id, 1);
  return Response.json({ run, execution }, { status: 201 });
}
