import { fetchScout, forwardScoutResponse, scoutProxyError } from "../scoutProxy.ts";

export async function GET() {
  try {
    const response = await fetchScout("/api/search-sessions", { cache: "no-store" });
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "Search history is unavailable.");
  }
}

export async function POST(request: Request) {
  try {
    const response = await fetchScout("/api/search-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
    });
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "Search session could not run.");
  }
}
