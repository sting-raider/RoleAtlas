import {
  fetchScout,
  forwardScoutResponse,
  LOOPBACK_SCOUT_URL,
  scoutProxyError,
} from "../scoutProxy.ts";

export async function GET() {
  try {
    const response = await fetchScout(
      "/api/workspace",
      { cache: "no-store", headers: { Accept: "application/json" } },
      { fallbackBaseUrl: LOOPBACK_SCOUT_URL },
    );
    return forwardScoutResponse(response, { buffered: false });
  } catch (error) {
    return scoutProxyError(error, "Daily workspace is unavailable.");
  }
}

export async function PUT(request: Request) {
  try {
    const response = await fetchScout("/api/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: await request.text(),
    }, { fallbackBaseUrl: LOOPBACK_SCOUT_URL });
    return forwardScoutResponse(response, { buffered: false });
  } catch (error) {
    return scoutProxyError(error, "Daily workspace could not be saved.");
  }
}
