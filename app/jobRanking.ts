import { classifyJobType, normalizeCurrency } from "./jobData.ts";
import type { Job, JobType, RemotePolicy, EligibilityStatus, WorkMode } from "./jobs";
import type { ResumeProfile } from "./components/ResumeModal";
import { resolveLiteCountry } from "../shared/geography-lite";

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "your", "you", "our", "are", "will", "have", "has", "job", "role", "work", "years", "skills", "using", "about", "into", "who", "but", "not", "all", "can", "their", "they"]);

export function keywords(value: string) {
  return [...new Set(value.toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) ?? [])].filter((word) => !STOP_WORDS.has(word));
}

export function rankJobsLocally(jobs: Job[], resume: ResumeProfile) {
  const resumeTerms = new Set(keywords(`${resume.text} ${resume.skills.join(" ")} ${resume.suggestedRoles.join(" ")}`));
  return jobs.map((job) => {
    const jobTerms = keywords(`${job.title} ${job.category} ${job.skills.join(" ")} ${job.summary}`);
    const overlaps = jobTerms.filter((term) => resumeTerms.has(term));
    const uniqueEvidence = [...new Set(overlaps)].slice(0, 8);
    const skillCoverage = Math.min(42, uniqueEvidence.length * 7);
    const titleTerms = keywords(job.title);
    const titleCoverage = Math.min(20, titleTerms.filter((term) => resumeTerms.has(term)).length * 10);
    const accessibility = job.experience === null ? 8 : job.experience === 0 ? 15 : job.experience === 1 ? 11 : job.experience <= 3 ? 5 : -8;
    const score = Math.max(12, Math.min(92, 24 + skillCoverage + titleCoverage + accessibility + (job.degreeRequired === true ? -4 : 4)));
    const reasons = uniqueEvidence.length
      ? [`Your résumé contains ${uniqueEvidence.slice(0, 4).join(", ")}, which also appear in this listing.`, job.experience === null ? "The listing does not state a fixed years-of-experience minimum." : `The listing's experience signal is ${job.experienceLabel.toLowerCase()}.`, `This is a deterministic résumé comparison; connect AI for semantic evidence and constraint checking.`]
      : ["No direct résumé keyword evidence was found for this role yet.", "The role remains visible so you can explore adjacent opportunities.", "Connect AI to detect transferable skills beyond exact wording."];
    return { ...job, score, scoreKind: "resume" as const, reasons, gap: uniqueEvidence.length ? job.gap : "This is currently a stretch match because the résumé and listing share little explicit evidence." };
  }).sort((a, b) => b.score - a.score);
}

// Scout API payloads mirror the Rust scout contract; the client only needs the
// fields it renders or normalizes.
export type ScoutJob = {
  id: string;
  source_url: string;
  source_name: string;
  source_id?: string;
  canonical_url?: string;
  apply_url?: string;
  title: string;
  company: string;
  location: string | null;
  country: string | null;
  remote: boolean;
  geographic_locations?: import("../shared/geography").GeographicLocation[];
  remote_policy?: RemotePolicy;
  eligibility_status?: EligibilityStatus;
  eligibility?: { status: EligibilityStatus; confidence: number; evidence: string[] };
  search_score?: number;
  search_rank?: number;
  provenance?: Array<{ query?: string; title_term_hits?: number }>;
  opportunity_classification?: import("../shared/opportunityTaxonomy").OpportunityClassification;
  employment_type: string | null;
  experience_years: number | null;
  degree_required: boolean | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  date_posted: string | null;
  description?: string;
  description_preview?: string;
  skills: unknown;
  lifecycle_status: "active" | "possibly_closed" | "closed";
  last_verified_at: string | null;
};

export function normalizeScoutJob(raw: ScoutJob): Job {
  const description = raw.description ?? raw.description_preview ?? "";
  const employment = raw.employment_type ?? "";
  const experience = raw.experience_years;
  const classifiedType = raw.opportunity_classification?.jobType ?? classifyJobType(raw.title, employment);
  const type: JobType = classifiedType === "Full-time" && experience !== null && experience <= 1 ? "Entry-level" : classifiedType;
  const workMode: WorkMode = raw.remote ? "Remote" : /hybrid/i.test(`${raw.location} ${description.slice(0, 500)}`) ? "Hybrid" : "On-site";
  const skills = Array.isArray(raw.skills) ? raw.skills.filter((item): item is string => typeof item === "string").slice(0, 5) : [];
  const currency = normalizeCurrency(raw.salary_currency);
  const postedDays = raw.date_posted ? Math.max(0, Math.floor((Date.now() - Date.parse(raw.date_posted)) / 86_400_000)) : null;
  const initials = raw.company.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "FR";
  const accent: Job["accent"] = ["mint", "lilac", "coral", "amber"][[...raw.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4] as Job["accent"];
  const searchQueries = [...new Set((raw.provenance ?? []).map((item) => item.query?.trim()).filter((value): value is string => Boolean(value)))];
  const searchScore = typeof raw.search_score === "number" && Number.isFinite(raw.search_score) ? Math.max(0, Math.min(99, Math.round(raw.search_score))) : null;
  const rankingReason = searchQueries.length ? `Matched your confirmed search ${searchQueries.length === 1 ? "query" : "queries"}: ${searchQueries.slice(0, 2).join(" and ")}.` : null;
  return {
    id: `scout-${raw.id}`,
    title: raw.title,
    company: raw.company,
    initials,
    location: raw.location ?? (raw.remote ? "Remote" : "Location not stated"),
    country: raw.country ?? normalizeCountryLabel(raw.location ?? "") ?? (raw.remote ? "Worldwide" : "Not stated"),
    workMode,
    type,
    category: skills[0] ?? "Other",
    experience,
    experienceLabel: experience === null ? "Experience not stated" : experience === 0 ? "No experience stated" : `${experience}+ years signal`,
    salaryMin: raw.salary_min ?? 0,
    salaryMax: raw.salary_max ?? raw.salary_min ?? 0,
    currency,
    salaryPeriod: "year",
    postedDays,
    degreeRequired: raw.degree_required,
    visaSupport: /visa sponsorship|sponsorship available/i.test(description),
    source: raw.source_name || "Local NATS scout",
    url: raw.apply_url || raw.canonical_url || raw.source_url,
    canonicalUrl: raw.canonical_url,
    applyUrl: raw.apply_url,
    recordKind: "canonical",
    verified: true,
    score: searchScore ?? Math.min(82, 45 + (experience === 0 ? 12 : experience === null ? 5 : experience <= 1 ? 8 : 3) + (raw.remote ? 7 : 2) + (raw.degree_required !== true ? 5 : 0)),
    scoreKind: searchScore === null ? "estimate" : "search",
    accent,
    skills: skills.length ? skills : [workMode, type],
    reasons: [
      ...(rankingReason ? [rankingReason] : []),
      experience === null ? "The listing does not state a minimum number of years." : `The crawler extracted an experience signal of ${experience} year${experience === 1 ? "" : "s"} or less.`,
      raw.degree_required === true ? "A degree requirement was detected; check whether equivalent evidence is accepted." : "No mandatory degree requirement was detected.",
      `This listing came directly through your local NATS scout from ${raw.source_name || "the source page"}.`,
    ],
    gap: raw.salary_min ? "Confirm compensation and eligibility details with the employer." : "No salary was extracted, so ask for the range early in the process.",
    summary: description.slice(0, 280) || "Open the original listing for the complete description.",
    description,
    descriptionIsPreview: raw.description === undefined && raw.description_preview !== undefined,
    lifecycleStatus: raw.lifecycle_status,
    lastVerifiedAt: raw.last_verified_at,
    geographicLocations: raw.geographic_locations,
    remotePolicy: raw.remote_policy,
    eligibilityStatus: raw.eligibility_status,
    eligibilityEvidence: raw.eligibility?.evidence,
    opportunityClassification: raw.opportunity_classification,
  };
}

export type Filters = {
  maxExperience: number | null;
  jobTypes: JobType[];
  workModes: WorkMode[];
  noDegree: boolean;
  visaSupport: boolean;
  minSalary: number;
  postedWithin: number;
};

export const DEFAULT_FILTERS: Filters = {
  maxExperience: null,
  jobTypes: [],
  workModes: [],
  noDegree: false,
  visaSupport: false,
  minSalary: 0,
  postedWithin: 0,
};

// Job payloads arrive with `country` already normalized server-side (Scout
// stores a resolved country name; feed adapters stamp through the same
// pipeline), so the client only labels with the lite dataset.
export function normalizeCountryLabel(value: string, location = "") {
  const trimmed = `${value} ${location}`.trim();
  if (!trimmed) return null;
  return resolveLiteCountry(trimmed)?.name ?? null;
}
