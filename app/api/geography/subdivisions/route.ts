import { SUBDIVISIONS, countryByCodeValue } from "../../../../shared/geography.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../../lib/session.ts";

/**
 * Subdivision names for one country. Keeps the ~950 KB subdivisions dataset
 * server-side: the browser asks for the handful of names it needs instead of
 * shipping every world subdivision in the client bundle.
 */
export async function GET(request: Request) {
  if (!(await sessionPrincipal(request.headers))) return unauthorizedResponse();
  const countryCode = new URL(request.url).searchParams.get("countryCode")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return Response.json({ error: "Provide a two-letter country code." }, { status: 400 });
  }
  if (!countryByCodeValue(countryCode)) {
    return Response.json({ error: "Unknown country code." }, { status: 404 });
  }
  const names = SUBDIVISIONS
    .filter((subdivision) => subdivision.countryCode === countryCode)
    .map((subdivision) => subdivision.name)
    .sort((a, b) => a.localeCompare(b));
  return Response.json(
    { countryCode, names },
    { headers: { "Cache-Control": "private, max-age=86400" } },
  );
}
