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
  const value = (job.sourceJobId === undefined ? job.id : job.sourceJobId ?? "").trim();
  return value ? `${normalizedText(job.source)}:${value}` : null;
}

export function jobFingerprint(job: Job) {
  const postedDate = job.postedAt?.slice(0, 10)
    ?? (job.postedDays === null ? "unknown" : `relative-${job.postedDays}`);
  return [job.company, job.title, job.location, job.type, postedDate]
    .map((value) => normalizedText(String(value)))
    .join("|");
}

function requisitionIdentity(job: Job) {
  const domain = job.companyDomain?.trim();
  const requisition = job.requisitionId?.trim();
  return domain && requisition ? `${normalizedText(domain)}:${normalizedText(requisition)}` : null;
}

/**
 * Deduplicates only when at least one strong identity signal agrees. Unlike the
 * legacy company/title Map, location and posting date remain part of the
 * fallback identity so distinct openings survive.
 */
export function deduplicateJobs(jobs: Job[]) {
  const output: Job[] = [];
  const bySourceId = new Map<string, number>();
  const byApplyUrl = new Map<string, number>();
  const byListingUrl = new Map<string, number>();
  const byRequisition = new Map<string, number>();
  const byFingerprint = new Map<string, number>();

  for (const job of jobs) {
    const sourceId = sourceScopedJobId(job);
    const applyUrl = canonicalizeJobUrl(job.applyUrl ?? job.url);
    const listingUrl = canonicalizeJobUrl(job.canonicalUrl ?? job.url);
    const requisition = requisitionIdentity(job);
    const fingerprint = jobFingerprint(job);
    const mayUseFingerprint = !job.sourceJobId?.trim() && !requisition;
    const existing = (sourceId ? bySourceId.get(sourceId) : undefined)
      ?? (applyUrl ? byApplyUrl.get(applyUrl) : undefined)
      ?? (listingUrl ? byListingUrl.get(listingUrl) : undefined)
      ?? (requisition ? byRequisition.get(requisition) : undefined)
      ?? (mayUseFingerprint ? byFingerprint.get(fingerprint) : undefined);

    if (existing === undefined) {
      const index = output.push({ ...job, url: listingUrl || applyUrl, canonicalUrl: listingUrl, applyUrl: applyUrl || null }) - 1;
      if (sourceId) bySourceId.set(sourceId, index);
      if (applyUrl) byApplyUrl.set(applyUrl, index);
      if (listingUrl) byListingUrl.set(listingUrl, index);
      if (requisition) byRequisition.set(requisition, index);
      byFingerprint.set(fingerprint, index);
      continue;
    }

    const current = output[existing];
    // Keep the richer record while retaining the canonical URL.
    const replacement = (job.description?.length ?? 0) > (current.description?.length ?? 0)
      ? { ...job, url: listingUrl || applyUrl, canonicalUrl: listingUrl, applyUrl: applyUrl || null }
      : current;
    output[existing] = replacement;
    if (sourceId) bySourceId.set(sourceId, existing);
    if (applyUrl) byApplyUrl.set(applyUrl, existing);
    if (listingUrl) byListingUrl.set(listingUrl, existing);
    if (requisition) byRequisition.set(requisition, existing);
    byFingerprint.set(fingerprint, existing);
  }

  return output;
}
