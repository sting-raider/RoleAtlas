import type { Job } from "./jobs";

const TRACKING_PARAMETERS = new Set([
  "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "referrer", "source",
  "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term",
]);

function normalizedText(value: string) {
  return value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function canonicalizeJobUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function sourceScopedJobId(job: Job) {
  const value = job.id.trim();
  return value ? `${normalizedText(job.source)}:${value}` : null;
}

export function jobFingerprint(job: Job) {
  const postedBucket = job.postedDays === null ? "unknown" : String(Math.floor(job.postedDays / 7));
  return [job.company, job.title, job.location, postedBucket].map((value) => normalizedText(String(value))).join("|");
}

/**
 * Deduplicates only when at least one strong identity signal agrees. Unlike the
 * legacy company/title Map, location and posting date remain part of the
 * fallback identity so distinct openings survive.
 */
export function deduplicateJobs(jobs: Job[]) {
  const output: Job[] = [];
  const bySourceId = new Map<string, number>();
  const byUrl = new Map<string, number>();
  const byFingerprint = new Map<string, number>();

  for (const job of jobs) {
    const sourceId = sourceScopedJobId(job);
    const url = canonicalizeJobUrl(job.url);
    const fingerprint = jobFingerprint(job);
    const existing = (sourceId ? bySourceId.get(sourceId) : undefined)
      ?? byUrl.get(url)
      ?? byFingerprint.get(fingerprint);

    if (existing === undefined) {
      const index = output.push({ ...job, url }) - 1;
      if (sourceId) bySourceId.set(sourceId, index);
      byUrl.set(url, index);
      byFingerprint.set(fingerprint, index);
      continue;
    }

    const current = output[existing];
    // Keep the richer record while retaining the canonical URL.
    const replacement = (job.description?.length ?? 0) > (current.description?.length ?? 0)
      ? { ...job, url }
      : current;
    output[existing] = replacement;
    if (sourceId) bySourceId.set(sourceId, existing);
    byUrl.set(url, existing);
    byFingerprint.set(fingerprint, existing);
  }

  return output;
}
