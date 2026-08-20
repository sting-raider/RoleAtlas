import { sessionPrincipal, unauthorizedResponse } from "../../../lib/session.ts";
import { fetchScoutForUser, forwardScoutResponse, scoutProxyError } from "../scoutProxy.ts";

export async function GET(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  try {
    const response = await fetchScoutForUser(
      principal,
      "/api/candidate-profile",
      { cache: "no-store", headers: { Accept: "application/json" } },
    );
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "Candidate profile is unavailable.");
  }
}

export async function POST(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  try {
    const response = await fetchScoutForUser(principal, "/api/candidate-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: await request.text(),
    });
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "Candidate profile could not be saved.");
  }
}
