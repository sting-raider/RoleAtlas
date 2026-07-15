export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const base = process.env.SCOUT_API_URL;
    if (!base) throw new Error("The persistent RoleAtlas service is not configured.");
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid search session." }, { status: 400 });
    const response = await fetch(`${base.replace(/\/$/, "")}/api/search-sessions/${id}`, { cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Search session is unavailable." }, { status: 503 });
  }
}
