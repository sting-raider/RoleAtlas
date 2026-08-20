import "server-only";

import type { AiActivity } from "../app/aiProvider.ts";
import { postgres } from "./postgres.ts";

export async function persistAiActivity(userId: string, activity: AiActivity) {
  try {
    await postgres.query(
      `INSERT INTO ai_activity
      (user_id,id,action,provider,model,endpoint,started_at,completed_at,outcome,data_sent,usage,message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (user_id,id) DO NOTHING`,
      [
        userId,
        activity.id,
        activity.action,
        activity.provider,
        activity.model,
        activity.endpoint,
        activity.startedAt,
        activity.completedAt,
        activity.outcome,
        JSON.stringify(activity.dataSent),
        activity.usage ? JSON.stringify(activity.usage) : null,
        activity.message ?? null,
      ],
    );
    return true;
  } catch {
    console.error("AI activity persistence is temporarily unavailable.");
    return false;
  }
}
