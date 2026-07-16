export async function GET() {
  return Response.json(
    { service: "roleatlas-web", status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
