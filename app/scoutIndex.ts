import type { ScoutJob } from "./jobRanking";

type ScoutJobsPage = {
  jobs?: ScoutJob[];
  count?: number;
  returned?: number;
  has_more?: boolean;
  next_cursor?: string | null;
  coverage?: {
    sources_searched: number;
    sources_successful: number;
    complete: boolean;
  };
};

export { type ScoutJobsPage };

/** Cursor-paginates the scout index so a bounded job budget never truncates silently. */
export async function fetchScoutIndex(
  filters: URLSearchParams,
  signal: AbortSignal,
  maxJobs = 400,
) {
  const jobs = new Map<string, ScoutJob>();
  let cursor: string | null = null;
  let latest: ScoutJobsPage | null = null;
  const pageCount = Math.ceil(Math.min(Math.max(maxJobs, 1), 400) / 100);
  for (let page = 0; page < pageCount; page += 1) {
    const params = new URLSearchParams(filters);
    params.set("action", "jobs");
    params.set("limit", String(Math.min(100, maxJobs - jobs.size)));
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/local-scout?${params.toString()}`, {
      cache: "no-store",
      signal,
    });
    if (!response.ok) return latest ? { ...latest, jobs: [...jobs.values()], returned: jobs.size } : null;
    latest = await response.json() as ScoutJobsPage;
    for (const job of latest.jobs ?? []) jobs.set(job.id, job);
    cursor = latest.next_cursor ?? null;
    if (!latest.has_more || !cursor || jobs.size >= maxJobs) break;
  }
  return latest ? { ...latest, jobs: [...jobs.values()], returned: jobs.size } : null;
}

type SessionPageLike = {
  session?: { id: string };
  jobs?: Array<{ id: string }>;
  results_page?: {
    has_more: boolean;
    next_cursor: number | null;
  };
};

/** Drains the remaining cursor pages of a search session so a bounded job
 * budget never truncates results silently. */
export async function fetchRemainingSessionResults<T extends SessionPageLike>(
  initial: T,
  signal?: AbortSignal,
  maxJobs = 400,
): Promise<T> {
  const sessionId = initial.session?.id;
  const jobs = new Map((initial.jobs ?? []).map((job) => [job.id, job]));
  let latest = initial;
  let cursor = initial.results_page?.next_cursor ?? null;
  while (
    sessionId
    && latest.results_page?.has_more
    && cursor !== null
    && jobs.size < maxJobs
  ) {
    const params = new URLSearchParams({
      cursor: String(cursor),
      limit: String(Math.min(100, maxJobs - jobs.size)),
    });
    const response = await fetch(`/api/search-sessions/${sessionId}?${params.toString()}`, {
      cache: "no-store",
      signal,
    });
    if (!response.ok) break;
    latest = await response.json() as T;
    for (const job of latest.jobs ?? []) jobs.set(job.id, job);
    cursor = latest.results_page?.next_cursor ?? null;
  }
  return { ...latest, jobs: [...jobs.values()] } as T;
}
