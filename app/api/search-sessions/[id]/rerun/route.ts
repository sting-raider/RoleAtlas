import {
  fetchScoutForUser,
  forwardScoutResponse,
  LOOPBACK_SCOUT_URL,
  scoutProxyError,
} from "../../../scoutProxy.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../../../lib/session.ts";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid search session." }, { status: 400 });
    const response = await fetchScoutForUser(
      principal,
      `/api/search-sessions/${id}/rerun`,
      { method: "POST", headers: { Accept: "application/json" } },
      { fallbackBaseUrl: LOOPBACK_SCOUT_URL },
    );
    return forwardScoutResponse(response, { buffered: false });
  } catch (error) {
    return scoutProxyError(error, "The search could not be rerun.");
  }
}
