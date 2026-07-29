import { fetchScout, forwardScoutResponse, scoutProxyError } from "../scoutProxy.ts";

export async function GET(request: Request) {
  try {
    const response = await fetchScout(
      "/api/registry",
      { cache: "no-store" },
      { search: new URL(request.url).search },
    );
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "Source registry is unavailable.");
  }
}
