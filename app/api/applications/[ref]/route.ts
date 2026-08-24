import { sessionPrincipal, unauthorizedResponse } from "../../../../lib/session.ts";
import { fetchScoutForUser, forwardScoutResponse, scoutProxyError } from "../../scoutProxy.ts";

// Job refs are opaque strings up to 512 chars; only forbid control characters,
// which break URL paths and would be rejected by the Scout validator anyway.
function safeJobRef(value: string): boolean {
  const hasControlChars = [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  return value.length > 0 && value.length <= 512 && !hasControlChars;
}

export async function GET(request: Request, context: { params: Promise<{ ref: string }> }) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  try {
    const { ref } = await context.params;
    const jobRef = decodeURIComponent(ref);
    if (!safeJobRef(jobRef)) {
      return Response.json({ error: "Invalid job reference." }, { status: 400 });
    }
    const response = await fetchScoutForUser(
      principal,
      `/api/applications/${encodeURIComponent(jobRef)}`,
      { cache: "no-store" },
    );
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "The application record is unavailable.");
  }
}

export async function PUT(request: Request, context: { params: Promise<{ ref: string }> }) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  try {
    const { ref } = await context.params;
    const jobRef = decodeURIComponent(ref);
    if (!safeJobRef(jobRef)) {
      return Response.json({ error: "Invalid job reference." }, { status: 400 });
    }
    const response = await fetchScoutForUser(
      principal,
      `/api/applications/${encodeURIComponent(jobRef)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: await request.text(),
      },
    );
    return forwardScoutResponse(response, { contentType: "application/json" });
  } catch (error) {
    return scoutProxyError(error, "The application could not be updated.");
  }
}
