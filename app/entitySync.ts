/**
 * Incremental persistence for the product entities that moved off the
 * whole-workspace PUT. Every call mirrors an optimistic local update; a
 * failure surfaces as a status message and never blocks the interaction.
 */

export type EntityWriteOutcome = { ok: true } | { ok: false; message: string };

const JSON_HEADERS = { "Content-Type": "application/json" };

function degraded(action: string): EntityWriteOutcome {
  return {
    ok: false,
    message: `${action} is kept in this browser for now, but the server copy could not be updated. Retrying usually fixes it.`,
  };
}

/** POST /api/saves — re-saving preserves the original savedAt server-side. */
export async function persistSave(jobId: string, snapshot: unknown): Promise<EntityWriteOutcome> {
  try {
    const response = await fetch("/api/saves", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ jobRef: jobId, snapshot }),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return { ok: true };
  } catch {
    return degraded("This job");
  }
}

/** DELETE /api/saves/{ref} — deleting an already-deleted row is a no-op. */
export async function persistUnsave(jobId: string): Promise<EntityWriteOutcome> {
  try {
    const response = await fetch(`/api/saves/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return { ok: true };
  } catch {
    return degraded("Removing this save");
  }
}

export type ApplicationPatchBody = {
  stage?: string;
  applicationDate?: string | null;
  followUpDate?: string | null;
  nextAction?: string;
  notes?: string;
  tailoredResumeReference?: string;
  coverLetterReference?: string;
  interviewPreparation?: string;
  sourceJobStatus?: string;
  contacts?: Array<{ name: string; detail: string }>;
};

/**
 * PUT /api/applications/{ref} with only the changed fields. Absent keys keep
 * stored values; explicit nulls clear dates. The response is the server's
 * canonical record including its auto-generated activities.
 *
 * Calls are coalesced per job (400ms trailing debounce): typing in the
 * application form produces one request per pause, and only the latest patch
 * wins because each field is sent with its current local value.
 */
const APPLICATION_DEBOUNCE_MS = 400;
const pendingApplications = new Map<string, ReturnType<typeof setTimeout>>();

export function persistApplication(
  jobId: string,
  patch: ApplicationPatchBody,
): Promise<{ ok: true; record: unknown } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const existing = pendingApplications.get(jobId);
    if (existing) window.clearTimeout(existing);
    const timer = setTimeout(() => {
      pendingApplications.delete(jobId);
      putApplication(jobId, patch).then(resolve);
    }, APPLICATION_DEBOUNCE_MS);
    pendingApplications.set(jobId, timer);
  });
}

async function putApplication(
  jobId: string,
  patch: ApplicationPatchBody,
): Promise<{ ok: true; record: unknown } | { ok: false; message: string }> {
  try {
    const response = await fetch(`/api/applications/${encodeURIComponent(jobId)}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== "object" || !("jobId" in payload)) {
      throw new Error(`status ${response.status}`);
    }
    return { ok: true, record: payload };
  } catch {
    return {
      ok: false,
      message: "Application changes are kept in this browser for now, but the server copy could not be updated. Retrying usually fixes it.",
    };
  }
}

/** POST /api/notifications/ack for one notification. */
export async function persistNotificationAck(
  ids: string[],
  action: "read" | "dismiss",
): Promise<EntityWriteOutcome> {
  try {
    const response = await fetch("/api/notifications/ack", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ ids, action }),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return { ok: true };
  } catch {
    return degraded("Acknowledging this notification");
  }
}
