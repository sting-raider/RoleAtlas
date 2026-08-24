import { normalizeGeographicLocation } from "../../../../shared/geography.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../../lib/session.ts";

/**
 * Full-corpus geographic resolution for one free-text location. Keeps the
 * multilingual alias corpus, subdivisions, cities, and timezones server-side;
 * the browser sends only the raw string it cannot resolve with the bounded
 * lite dataset.
 */
export async function GET(request: Request) {
  if (!(await sessionPrincipal(request.headers))) return unauthorizedResponse();
  const raw = new URL(request.url).searchParams.get("raw")?.trim().slice(0, 200) ?? "";
  if (!raw) {
    return Response.json({ error: "Provide a raw location string." }, { status: 400 });
  }
  const resolved = normalizeGeographicLocation(raw);
  return Response.json(
    { ...resolved },
    { headers: { "Cache-Control": "private, max-age=86400" } },
  );
}
