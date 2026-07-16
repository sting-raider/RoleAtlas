function upstream(request: Request) {
  const base = process.env.SCOUT_API_URL;
  if (!base) throw new Error("The persistent RoleAtlas service is not configured.");
  const query = new URL(request.url).search;
  return `${base.replace(/\/$/, "")}/api/registry${query}`;
}

export async function GET(request: Request) {
  try {
    const response = await fetch(upstream(request), { cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Source registry is unavailable." }, { status: 503 });
  }
}
