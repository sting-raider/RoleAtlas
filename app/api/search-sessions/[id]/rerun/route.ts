function baseUrl() {
  return (process.env.SCOUT_API_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
}

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid search session." }, { status: 400 });
    const response = await fetch(`${baseUrl()}/api/search-sessions/${id}/rerun`, { method: "POST", headers: { Accept: "application/json" } });
    return new Response(response.body, { status: response.status, headers: { "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The search could not be rerun." }, { status: 503 });
  }
}
