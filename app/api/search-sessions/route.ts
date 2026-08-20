import { sessionPrincipal, unauthorizedResponse } from "../../../lib/session.ts";
import { fetchScoutForUser, forwardScoutResponse, scoutProxyError } from "../scoutProxy.ts";

export async function GET(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  try {
    const response = await fetchScoutForUser(principal, "/api/search-sessions", { cache: "no-store" });
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "Search history is unavailable.");
  }
}

export async function POST(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  try {
    const response = await fetchScoutForUser(principal, "/api/search-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
    });
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "Search session could not run.");
  }
}
