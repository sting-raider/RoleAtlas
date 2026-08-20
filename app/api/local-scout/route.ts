import {
  fetchScoutForUser,
  forwardScoutResponse,
  scoutApiUrl,
  scoutProxyError,
} from "../scoutProxy.ts";
import {
  forbiddenResponse,
  sessionPrincipal,
  unauthorizedResponse,
} from "../../../lib/session.ts";

const ACTION_PATHS = {
  health: "/health",
  stats: "/api/stats",
  jobs: "/api/jobs",
  metrics: "/api/metrics",
  sources: "/api/source-health",
} as const;

const SCOUT_OPTIONS = {
  missingMessage: "The local scout is not configured. Start RoleAtlas with Docker Compose.",
};

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const action = requestUrl.searchParams.get("action") as keyof typeof ACTION_PATHS | null;
    if (!action || !(action in ACTION_PATHS)) {
      return Response.json({ error: "Unknown scout action." }, { status: 400 });
    }

    const upstreamUrl = scoutApiUrl(ACTION_PATHS[action], SCOUT_OPTIONS);
    if (action === "jobs") {
      for (const key of ["q", "location", "max_experience", "remote", "no_degree", "posted_days", "limit"]) {
        const value = requestUrl.searchParams.get(key);
        if (value) upstreamUrl.searchParams.set(key, value);
      }
    }
    if (action === "health" || action === "jobs") {
      return forwardScoutResponse(await fetch(upstreamUrl, { headers: { Accept: "application/json" }, cache: "no-store" }));
    }
    const principal = await sessionPrincipal(request.headers);
    if (!principal) return unauthorizedResponse();
    return forwardScoutResponse(await fetchScoutForUser(
      principal,
      ACTION_PATHS[action],
      { headers: { Accept: "application/json" }, cache: "no-store" },
      { ...SCOUT_OPTIONS, search: upstreamUrl.search },
    ));
  } catch (error) {
    return scoutProxyError(error, "The local scout is unavailable.");
  }
}

export async function POST(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  if (principal.role !== "admin") return forbiddenResponse();
  try {
    const body = await request.json() as { url?: string };
    if (!body.url) return Response.json({ error: "A careers-page URL is required." }, { status: 400 });
    const url = new URL(body.url);
    if (!/^https?:$/.test(url.protocol)) return Response.json({ error: "Only HTTP and HTTPS URLs are accepted." }, { status: 400 });

    const response = await fetchScoutForUser(principal, "/api/seeds", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ url: url.toString() }),
    }, SCOUT_OPTIONS);
    return forwardScoutResponse(response);
  } catch (error) {
    return scoutProxyError(error, "The seed could not be queued.");
  }
}
