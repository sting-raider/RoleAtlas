import { postgres } from "../../../../lib/postgres.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../../lib/session.ts";

export async function GET(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  const result = await postgres.query(
    `SELECT id, action, provider, model, endpoint,
            started_at AS "startedAt", completed_at AS "completedAt", outcome,
            data_sent AS "dataSent", usage, message
       FROM ai_activity
      WHERE user_id = $1
      ORDER BY completed_at DESC
      LIMIT 100`,
    [principal.userId],
  );
  return Response.json({ activities: result.rows }, { headers: { "Cache-Control": "private, no-store" } });
}
