import { fetchScout, forwardScoutResponse, scoutProxyError } from "../scoutProxy.ts";

export async function GET() {
  try {
    const response = await fetchScout(
      "/api/candidate-profile",
      { cache: "no-store", headers: { Accept: "application/json" } },
    );
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "Candidate profile is unavailable.");
  }
}

export async function POST(request: Request) {
  try {
    const response = await fetchScout("/api/candidate-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: await request.text(),
    });
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "Candidate profile could not be saved.");
  }
}
