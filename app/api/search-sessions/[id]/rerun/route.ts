import {
  fetchScout,
  forwardScoutResponse,
  LOOPBACK_SCOUT_URL,
  scoutProxyError,
} from "../../../scoutProxy.ts";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid search session." }, { status: 400 });
    const response = await fetchScout(
      `/api/search-sessions/${id}/rerun`,
      { method: "POST", headers: { Accept: "application/json" } },
      { fallbackBaseUrl: LOOPBACK_SCOUT_URL },
    );
    return forwardScoutResponse(response, { buffered: false });
  } catch (error) {
    return scoutProxyError(error, "The search could not be rerun.");
  }
}
