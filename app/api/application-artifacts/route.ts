import { z } from "zod";
import { postgres } from "../../../lib/postgres.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../lib/session.ts";

const saveSchema = z.object({
  jobId: z.string().trim().min(1).max(512),
  dossier: z.record(z.string(), z.unknown()),
  model: z.string().max(300).optional(),
}).strict();

export async function GET(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  const result = await postgres.query(
    `SELECT DISTINCT ON (job_ref) job_ref, content
       FROM generated_application_artifacts
      WHERE user_id=$1 AND artifact_type='evaluation' AND deleted_at IS NULL
      ORDER BY job_ref, created_at DESC`,
    [principal.userId],
  );
  return Response.json({
    dossiers: Object.fromEntries(result.rows.map((row) => [row.job_ref, row.content])),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || JSON.stringify(parsed.data?.dossier ?? {}).length > 500_000) {
    return Response.json({ error: { code: "invalid_artifact", message: "The generated artifact is invalid or too large." } }, { status: 400 });
  }
  const provider = typeof parsed.data.dossier.provider === "string" ? parsed.data.dossier.provider.slice(0, 200) : null;
  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    const application = await client.query(
      "SELECT id FROM applications WHERE user_id=$1 AND job_ref=$2",
      [principal.userId, parsed.data.jobId],
    );
    await client.query(
      "UPDATE generated_application_artifacts SET deleted_at=NOW() WHERE user_id=$1 AND job_ref=$2 AND artifact_type='evaluation' AND deleted_at IS NULL",
      [principal.userId, parsed.data.jobId],
    );
    const saved = await client.query(
      `INSERT INTO generated_application_artifacts
        (user_id,application_id,job_ref,artifact_type,content,provider,model)
       VALUES ($1,$2,$3,'evaluation',$4,$5,$6)
       RETURNING id,created_at`,
      [principal.userId, application.rows[0]?.id ?? null, parsed.data.jobId, JSON.stringify(parsed.data.dossier), provider, parsed.data.model ?? null],
    );
    await client.query("COMMIT");
    return Response.json({ saved: true, artifactId: saved.rows[0].id, createdAt: saved.rows[0].created_at });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
