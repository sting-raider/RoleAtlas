function scoutUrl() {
  const base = process.env.SCOUT_API_URL;
  if (!base) throw new Error("The persistent RoleAtlas service is not configured.");
  return `${base.replace(/\/$/, "")}/api/candidate-profile`;
}

async function forward(response: Response) {
  return new Response(await response.text(), { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    return forward(await fetch(scoutUrl(), { cache: "no-store", headers: { Accept: "application/json" } }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Candidate profile is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    return forward(await fetch(scoutUrl(), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: await request.text() }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Candidate profile could not be saved." }, { status: 503 });
  }
}
