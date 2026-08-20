import { extractText } from "unpdf";
import { sessionPrincipal, unauthorizedResponse } from "../../../lib/session.ts";
import { inferProfile } from "../../resumeProfile.ts";

export async function POST(request: Request) {
  if (!(await sessionPrincipal(request.headers))) return unauthorizedResponse();
  try {
    const form = await request.formData();
    const file = form.get("resume");
    if (!(file instanceof File)) return Response.json({ error: "Choose a PDF résumé." }, { status: 400 });
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return Response.json({ error: "The résumé must be a PDF." }, { status: 400 });
    if (file.size > 8 * 1024 * 1024) return Response.json({ error: "The PDF must be smaller than 8 MB." }, { status: 400 });

    const { text, totalPages } = await extractText(new Uint8Array(await file.arrayBuffer()), { mergePages: true });
    const cleaned = text.replace(/\0/g, "").replace(/[ \t]+/g, " ").trim();
    if (cleaned.length < 80) return Response.json({ error: "This PDF contains too little readable text. Export the résumé as a text-based PDF rather than a scanned image." }, { status: 422 });
    const limited = cleaned.slice(0, 60_000);
    return Response.json({ fileName: file.name, totalPages, text: limited, ...inferProfile(limited) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The résumé could not be read." }, { status: 400 });
  }
}
