function upstream() {
  const base = process.env.SCOUT_API_URL ?? "http://127.0.0.1:8080";
  return `${base.replace(/\/$/, "")}/api/workspace`;
}

function forward(response: Response) {
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
  });
}

export async function GET() {
  try {
    return forward(await fetch(upstream(), { cache: "no-store", headers: { Accept: "application/json" } }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Daily workspace is unavailable." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    return forward(await fetch(upstream(), { method: "PUT", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: await request.text() }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Daily workspace could not be saved." }, { status: 503 });
  }
}
