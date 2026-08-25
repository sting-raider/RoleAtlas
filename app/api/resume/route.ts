import { readBoundedBody } from "../../../lib/boundedBody.ts";
import {
  MAX_RESUME_BYTES,
  detectResumeKind,
  extractResume,
} from "../../../lib/resumeExtract.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../lib/session.ts";
import { normalizeGeographicLocation } from "../../../shared/geography.ts";
import { inferProfile } from "../../resumeProfile.ts";

export async function POST(request: Request) {
  if (!(await sessionPrincipal(request.headers))) return unauthorizedResponse();
  // Route handlers have no framework body cap, and formData() buffers the
  // whole multipart transfer, so the ceiling is enforced on the wire first:
  // declared oversizes are rejected unread and lying/absent lengths are cut
  // off mid-stream once the limit is crossed.
  const bounded = await readBoundedBody(request, MAX_RESUME_BYTES);
  if (!bounded) {
    return Response.json(
      { error: "The résumé must be smaller than 8 MB." },
      { status: 413 },
    );
  }
  let file: File;
  try {
    // The bytes are already capped, so this parse can never buffer more than
    // one upload ceiling; only the boundary header is needed to decode it.
    const form = await new Request("http://roleatlas.local/upload", {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: bounded,
    }).formData();
    const candidate = form.get("resume");
    if (!(candidate instanceof File)) {
      return Response.json({ error: "Choose a PDF or DOCX résumé to upload." }, { status: 400 });
    }
    file = candidate;
  } catch {
    return Response.json({ error: "The upload could not be read." }, { status: 400 });
  }

  // Identity comes from the bytes, never from the client-supplied type or
  // extension: renamed executables and HTML wrappers must not reach parsers.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return Response.json({ error: "The file could not be read." }, { status: 400 });
  }
  if (bytes.length === 0) {
    return Response.json({ error: "That file is empty." }, { status: 400 });
  }
  const kind = detectResumeKind(bytes);
  if (!kind) {
    return Response.json(
      { error: "This file is not a PDF or DOCX document. Export your résumé in one of those formats." },
      { status: 400 },
    );
  }

  const extraction = await extractResume(kind, bytes);
  if (!extraction.ok) {
    return Response.json({ error: extraction.message }, { status: 422 });
  }

  const profile = inferProfile(extraction.text);
  // The full geography corpus stays server-side: resolve the extracted
  // location here and hand the client the code/timezone so profile building
  // never needs the heavy dataset in the browser bundle.
  const resolved = profile.location ? normalizeGeographicLocation(profile.location) : null;
  return Response.json({
    fileName: file.name,
    kind: extraction.kind,
    totalPages: extraction.totalPages,
    text: extraction.text,
    ...profile,
    locationCountryCode: resolved?.countryCode ?? null,
    locationTimezone: resolved?.timezone ?? null,
  });
}
