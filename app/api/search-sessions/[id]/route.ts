import { sessionPrincipal, unauthorizedResponse } from "../../../../lib/session.ts";
import { fetchScoutForUser, forwardScoutResponse, scoutProxyError } from "../../scoutProxy.ts";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid search session." }, { status: 400 });
    const response = await fetchScoutForUser(principal, `/api/search-sessions/${id}`, { cache: "no-store" });
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "Search session is unavailable.");
  }
}
