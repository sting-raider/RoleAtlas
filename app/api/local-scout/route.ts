const ACTION_PATHS = {
  health: "/health",
  stats: "/api/stats",
  jobs: "/api/jobs",
} as const;

function scoutBaseUrl() {
  const configured = process.env.SCOUT_API_URL;
  if (!configured) throw new Error("The local scout is not configured. Start RoleAtlas with Docker Compose.");
  return configured.replace(/\/$/, "");
}

async function forward(response: Response) {
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const action = requestUrl.searchParams.get("action") as keyof typeof ACTION_PATHS | null;
    if (!action || !(action in ACTION_PATHS)) {
      return Response.json({ error: "Unknown scout action." }, { status: 400 });
    }

    const upstreamUrl = new URL(`${scoutBaseUrl()}${ACTION_PATHS[action]}`);
    if (action === "jobs") {
      for (const key of ["q", "location", "max_experience", "remote", "no_degree", "posted_days", "limit"]) {
        const value = requestUrl.searchParams.get(key);
        if (value) upstreamUrl.searchParams.set(key, value);
      }
    }
    return forward(await fetch(upstreamUrl, { headers: { Accept: "application/json" }, cache: "no-store" }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The local scout is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { url?: string };
    if (!body.url) return Response.json({ error: "A careers-page URL is required." }, { status: 400 });
    const url = new URL(body.url);
    if (!/^https?:$/.test(url.protocol)) return Response.json({ error: "Only HTTP and HTTPS URLs are accepted." }, { status: 400 });

    const response = await fetch(`${scoutBaseUrl()}/api/seeds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ url: url.toString() }),
    });
    return forward(response);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The seed could not be queued." }, { status: 503 });
  }
}
