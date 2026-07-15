export async function POST(request: Request) {
  try {
    const base = process.env.SCOUT_API_URL;
    if (!base) throw new Error("The persistent RoleAtlas service is not configured.");
    const response = await fetch(`${base.replace(/\/$/, "")}/api/search-feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: await request.text() });
    return new Response(await response.text(), { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Search feedback could not be saved." }, { status: 503 });
  }
}
