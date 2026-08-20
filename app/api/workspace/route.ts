import {
  fetchScoutForUser,
  forwardScoutResponse,
  LOOPBACK_SCOUT_URL,
  scoutProxyError,
} from "../scoutProxy.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../lib/session.ts";

export async function GET(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  try {
    const response = await fetchScoutForUser(
      principal,
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
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  try {
    const response = await fetchScoutForUser(principal, "/api/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: await request.text(),
    }, { fallbackBaseUrl: LOOPBACK_SCOUT_URL });
    return forwardScoutResponse(response, { buffered: false });
  } catch (error) {
    return scoutProxyError(error, "Daily workspace could not be saved.");
  }
}
