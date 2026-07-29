import { fetchScout, forwardScoutResponse, scoutProxyError } from "../scoutProxy.ts";

export async function POST(request: Request) {
  try {
    const response = await fetchScout("/api/search-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
    });
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "Search feedback could not be saved.");
  }
}
