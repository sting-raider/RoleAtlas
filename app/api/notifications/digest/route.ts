import { postgres } from "../../../../lib/postgres.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../../lib/session.ts";
import { SmtpTransport } from "../../../../lib/notifications/email.ts";
import { buildWeeklyDigest } from "../../../../lib/notifications/digest.ts";

export async function POST(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();

  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    // Outbox gate: one digest per interval, claimed atomically by the update's
    // row lock so two tabs cannot double-send.
    const pref = await client.query(
      `SELECT p.weekly_digest, p.last_digest_sent_at, u.email
       FROM user_notification_preferences p
       JOIN roleatlas_users u ON u.id = p.user_id
       WHERE p.user_id = $1
       FOR UPDATE OF p`,
      [principal.userId],
    );
    if (pref.rowCount === 0) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Notification preferences are not initialized." }, { status: 409 });
    }
    const row = pref.rows[0];
    if (!row.weekly_digest) {
      await client.query("ROLLBACK");
      return Response.json({ error: "The weekly digest is turned off in your notification preferences." }, { status: 409 });
    }
    const lastSentAt: string | null = row.last_digest_sent_at ?? null;
    if (lastSentAt && Date.now() - Date.parse(lastSentAt) < 6.5 * 24 * 3600 * 1000) {
      await client.query("ROLLBACK");
      return Response.json({ sent: false, reason: "already_sent", lastDigestSentAt: lastSentAt });
    }

    const followUps = await client.query(
      `SELECT COALESCE(j.title, a.job_ref) AS title,
              COALESCE(NULLIF(a.next_action, ''), 'Check the current status.') AS next_action
       FROM applications a LEFT JOIN jobs j ON j.id = a.canonical_job_id
       WHERE a.user_id = $1 AND a.follow_up_date IS NOT NULL AND a.follow_up_date <= CURRENT_DATE
         AND a.stage NOT IN ('Rejected', 'Withdrawn', 'Closed before application', 'Archived')
       ORDER BY a.follow_up_date LIMIT 20`,
      [principal.userId],
    );
    const closures = await client.query(
      `SELECT COALESCE(j.title, s.job_ref) AS title, j.lifecycle_status = 'closed' AS closed
       FROM saved_jobs s JOIN jobs j ON j.id = s.canonical_job_id
       WHERE s.user_id = $1 AND s.archived_at IS NULL AND j.lifecycle_status IN ('possibly_closed', 'closed')
       ORDER BY s.updated_at DESC LIMIT 20`,
      [principal.userId],
    );
    const strongMatches = await client.query(
      `SELECT COUNT(DISTINCT r.job_id)::int AS unseen
       FROM search_sessions ss
       JOIN search_session_results r ON r.session_id = ss.id AND r.rank <= 3
       LEFT JOIN recently_viewed_jobs v ON v.user_id = ss.user_id AND v.canonical_job_id = r.job_id
       WHERE ss.user_id = $1 AND ss.status = 'success' AND ss.completed_at > NOW() - INTERVAL '7 days'
         AND v.canonical_job_id IS NULL`,
      [principal.userId],
    );

    const digest = buildWeeklyDigest({
      generatedAt: new Date().toISOString(),
      followUpsDue: followUps.rows.map((item) => ({ title: item.title as string, nextAction: item.next_action as string })),
      savedJobClosures: closures.rows.map((item) => ({ title: item.title as string, closed: item.closed === true })),
      unseenStrongMatches: Number(strongMatches.rows[0]?.unseen ?? 0),
    });

    // Delivery happens only after every read succeeds; the sent-marker write is
    // part of the same transaction, so a failed SMTP call leaves the gate open
    // for retry while a successful one closes it for the week.
    const transport = SmtpTransport.fromEnv();
    if (!transport) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Email delivery is not configured on this deployment." }, { status: 503 });
    }
    const result = await transport.send({ to: String(row.email), subject: digest.subject, text: digest.text });
    if (!result.delivered) {
      await client.query("ROLLBACK");
      return Response.json({ error: "The digest could not be delivered.", detail: result.error }, { status: 502 });
    }

    await client.query(
      "UPDATE user_notification_preferences SET last_digest_sent_at = NOW() WHERE user_id = $1",
      [principal.userId],
    );
    await client.query("COMMIT");
    return Response.json({ sent: true, subject: digest.subject });
  } catch {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection already gone
    }
    return Response.json({ error: "The digest could not be prepared." }, { status: 500 });
  } finally {
    client.release();
  }
}
