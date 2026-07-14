import { getLiveJobs } from "../../liveJobs";

export async function GET() {
  const payload = await getLiveJobs();
  return Response.json(payload, {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600" },
  });
}
