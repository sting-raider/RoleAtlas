function upstream(path = "") {
  const base = process.env.SCOUT_API_URL;
  if (!base) throw new Error("The persistent RoleAtlas service is not configured.");
  return `${base.replace(/\/$/, "")}/api/search-sessions${path}`;
}

async function forward(response: Response) {
  return new Response(await response.text(), { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function GET() {
  try { return forward(await fetch(upstream(), { cache: "no-store" })); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Search history is unavailable." }, { status: 503 }); }
}

export async function POST(request: Request) {
  try { return forward(await fetch(upstream(), { method: "POST", headers: { "Content-Type": "application/json" }, body: await request.text() })); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Search session could not run." }, { status: 503 }); }
}
