"use client";

import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  BriefcaseBusiness,
  Check,
  ClipboardCheck,
  ChevronDown,
  CircleUserRound,
  CircleAlert,
  Clock3,
  Database,
  ExternalLink,
  FileText,
  Filter,
  Globe2,
  LayoutDashboard,
  ListFilter,
  LocateFixed,
  LogOut,
  MapPin,
  Menu,
  Radar,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Moon,
  Sun,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { authClient } from "../lib/auth-client.ts";
import { ACCOUNT_STORAGE_KEYS, accountStorageKey, providerMetadataForStorage } from "./accountStorage.ts";
import {
  PROVIDERS,
  type ApplicationStage,
  type Job,
  type JobType,
  type ProviderName,
  type RemotePolicy,
  type EligibilityStatus,
  type WorkMode,
} from "./jobs";
import { classifyJobType, formatSalary, normalizeCurrency, salaryUsdEquivalent } from "./jobData";
import type { LiveJobsPayload } from "./liveJobs";
import type { CareerDossier } from "./careerOps";
import { providerIsConfigured, verificationIsCurrent, type AiActivity, type ProviderConfig } from "./aiProvider";
import { deduplicateJobs, mergeImportedJobs } from "./jobIdentity";
import { buildCandidateProfile, buildSearchPlan, emptyCandidateMobility, type CandidateProfile, type EvidenceField, type SearchPlan } from "./candidateProfile";
import { OnboardingFlow } from "./OnboardingFlow";
import { OpportunitySignal, SignalGlyph } from "./SignalGlyph";
import { useDialogFocus } from "./useDialogFocus";
import {
  addNotification,
  addFeedback,
  aiRequestPreview,
  createWorkspace,
  duplicateStrategy,
  markStrategyRun,
  jobsForActiveSearch,
  normalizeWorkspace,
  rememberView,
  resetLearnedPreferences,
  saveJob,
  saveStrategy,
  setStrategyStatus,
  syncApplicationNotifications,
  syncSavedJobNotifications,
  unsaveJob,
  undoFeedback,
  updateApplication,
  updateNotification,
  type DailyWorkspace,
  type AiRequestPreview,
  type ServiceStatus,
  type FeedbackReason,
  type StrategyRecord,
} from "./dailyProduct";
import {
  ApplicationsWorkspace,
  HomeWorkspace,
  ProfileWorkspace,
  SavedWorkspace,
  SearchesWorkspace,
  SettingsWorkspace,
  SourcesWorkspace,
  type DailyView,
} from "./DailyWorkspaces";
import {
  COUNTRIES,
  REGIONS,
  SUBDIVISIONS,
  countryByCodeValue,
  normalizeGeographicLocation,
  resolveCountry,
} from "../shared/geography";

type View = DailyView;

type Filters = {
  maxExperience: number | null;
  jobTypes: JobType[];
  workModes: WorkMode[];
  noDegree: boolean;
  visaSupport: boolean;
  minSalary: number;
  postedWithin: number;
};

type DossierTab = "evaluation" | "resume" | "letter" | "interview";

function loadAiActivity(userId: string): AiActivity[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(accountStorageKey(userId, ACCOUNT_STORAGE_KEYS.aiActivity)) ?? "[]") as AiActivity[];
  } catch {
    return [];
  }
}

function recordAiActivity(userId: string, activity?: AiActivity) {
  if (!activity || typeof window === "undefined") return;
  const next = [activity, ...loadAiActivity(userId).filter((item) => item.id !== activity.id)].slice(0, 25);
  window.localStorage.setItem(accountStorageKey(userId, ACCOUNT_STORAGE_KEYS.aiActivity), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("roleatlas-ai-activity", { detail: next }));
}

type ScoutJob = {
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

async function fetchScoutIndex(
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

type ResumeProfile = {
  fileName: string;
  totalPages: number;
  text: string;
  name: string;
  skills: string[];
  suggestedRoles: string[];
  location: string | null;
  headline?: string;
};

type SearchSessionSummary = {
  id: string;
  profile_id?: string | null;
  plan_id?: string | null;
  status: string;
  stage?: "searching_index" | "evaluating_geographic_coverage" | "identifying_source_gaps" | "scanning_sources" | "normalizing_jobs" | "evaluating_eligibility" | "reranking" | "completed" | "partial";
  query_count: number;
  result_count: number;
  started_at: string;
  completed_at?: string | null;
  updated_at?: string;
  plan?: SearchPlan;
  coverage?: { state?: "complete" | "partial" | "expanding" | "checked"; configured_sources?: number; selected_sources?: number; successful_sources?: number; incomplete_sources?: number; index_scope?: string; eligibility_counts?: Partial<Record<EligibilityStatus, number>>; source_selection?: { selected_sources?: number; states?: Record<string, number>; observed_jobs_in_completed_runs?: number; claim?: string } };
};

type SearchSessionPayload = {
  session?: SearchSessionSummary;
  jobs?: ScoutJob[];
  results_page?: {
    cursor: number;
    limit: number;
    has_more: boolean;
    next_cursor: number | null;
  };
  error?: string;
};

async function fetchRemainingSessionResults(
  initial: SearchSessionPayload,
  signal?: AbortSignal,
  maxJobs = 400,
): Promise<SearchSessionPayload> {
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
    latest = await response.json() as SearchSessionPayload;
    for (const job of latest.jobs ?? []) jobs.set(job.id, job);
    cursor = latest.results_page?.next_cursor ?? null;
  }
  return { ...latest, jobs: [...jobs.values()] };
}

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "your", "you", "our", "are", "will", "have", "has", "job", "role", "work", "years", "skills", "using", "about", "into", "who", "but", "not", "all", "can", "their", "they"]);

function keywords(value: string) {
  return [...new Set(value.toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) ?? [])].filter((word) => !STOP_WORDS.has(word));
}

function rankJobsLocally(jobs: Job[], resume: ResumeProfile) {
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

function normalizeScoutJob(raw: ScoutJob): Job {
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
    country: normalizeCountryLabel(raw.country ?? "", raw.location ?? "") ?? (raw.remote ? "Worldwide" : "Not stated"),
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

const DEFAULT_FILTERS: Filters = {
  maxExperience: null,
  jobTypes: [],
  workModes: [],
  noDegree: false,
  visaSupport: false,
  minSalary: 0,
  postedWithin: 0,
};

function normalizeCountryLabel(value: string, location = "") {
  const normalized = normalizeGeographicLocation(`${value} ${location}`.trim());
  const matchedCountry = countryByCodeValue(normalized.countryCode);
  if (matchedCountry) return matchedCountry.name;
  const matchedRegion = REGIONS.find((region) => normalized.regionCodes.includes(region.code));
  return matchedRegion?.code === "WORLDWIDE" ? "Worldwide" : matchedRegion?.name ?? null;
}

const NAV_ITEMS: Array<{
  id: View;
  label: string;
  icon: typeof Radar;
}> = [
  { id: "home", label: "Home", icon: LayoutDashboard },
  { id: "discover", label: "Discover", icon: Radar },
  { id: "searches", label: "Searches", icon: Search },
  { id: "saved", label: "Saved", icon: Bookmark },
  { id: "applications", label: "Applications", icon: BriefcaseBusiness },
  { id: "profile", label: "Profile", icon: CircleUserRound },
  { id: "sources", label: "Sources", icon: Globe2 },
  { id: "settings", label: "Settings", icon: Settings2 },
];

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type SelectOption = { value: string; label: string };

function SelectMenu({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  searchable = false,
  disabled = false,
  compact = false,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  searchable?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const visible = options.filter((option) => option.label.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  return (
    <div ref={root} className={cx("select-menu", open && "open", compact && "compact") }>
      <button type="button" className="select-trigger" role="combobox" aria-controls={listboxId} aria-expanded={open} aria-label={ariaLabel} disabled={disabled} onClick={() => { setOpen((current) => !current); setSearch(""); }}>
        <span>{selected?.label ?? placeholder}</span><ChevronDown size={14} />
      </button>
      {open && (
        <div id={listboxId} className="select-popover" role="listbox">
          {searchable && <div className="select-search"><Search size={14} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search places…" /></div>}
          <div className="select-options">
            {visible.map((option) => (
              <button type="button" key={option.value || "all"} role="option" aria-selected={option.value === value} onClick={() => { onChange(option.value); setOpen(false); setSearch(""); }}>
                <span>{option.label}</span>{option.value === value && <Check size={14} />}
              </button>
            ))}
            {visible.length === 0 && <p>No matching places</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function postedLabel(days: number | null) {
  if (days === null) return "Date not stated";
  if (days === 0) return "Posted today";
  if (days === 1) return "Posted yesterday";
  return `Posted ${days} days ago`;
}

function Checkbox({
  checked,
  label,
  count,
  onChange,
}: {
  checked: boolean;
  label: string;
  count?: number;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      className="filter-check"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
    >
      <span className={cx("check-box", checked && "checked")}>
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <span>{label}</span>
      {typeof count === "number" && <span className="filter-count">{count}</span>}
    </button>
  );
}

function FilterPanel({
  jobs,
  filters,
  setFilters,
  onClose,
}: {
  jobs: Job[];
  filters: Filters;
  setFilters: (filters: Filters) => void;
  onClose?: () => void;
}) {
  const toggleList = <T,>(key: "jobTypes" | "workModes", value: T) => {
    const current = filters[key] as T[];
    setFilters({
      ...filters,
      [key]: current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    });
  };

  return (
    <aside className="filter-panel" aria-label="Job filters">
      <div className="filter-panel-head">
        <div>
          <span className="eyebrow">Make it yours</span>
          <h2>Filters</h2>
        </div>
        <div className="filter-actions">
          <button type="button" className="text-button" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Reset
          </button>
          {onClose && (
            <button type="button" className="icon-button compact" aria-label="Close filters" onClick={onClose}>
              <X size={17} />
            </button>
          )}
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">
          <Clock3 size={15} />
          <span>Experience ceiling</span>
        </div>
        <div className="segmented-control" aria-label="Maximum experience">
          {([null, 0, 1, 2, 3] as Array<number | null>).map((value) => (
            <button
              type="button"
              key={value ?? "any"}
              className={filters.maxExperience === value ? "active" : ""}
              onClick={() => setFilters({ ...filters, maxExperience: value })}
            >
              {value === null ? "Any" : value === 3 ? "3+" : value}
            </button>
          ))}
        </div>
        <p className="filter-help">Maximum years requested by the listing.</p>
      </div>

      <div className="filter-section">
        <div className="filter-label">
          <BriefcaseBusiness size={15} />
          <span>Opportunity type</span>
        </div>
        {(["Internship", "Entry-level", "Apprenticeship", "Full-time", "Part-time", "Contract", "Unknown"] as JobType[]).map((type) => (
          <Checkbox
            key={type}
            label={type}
            count={jobs.filter((job) => job.type === type).length}
            checked={filters.jobTypes.includes(type)}
            onChange={() => toggleList("jobTypes", type)}
          />
        ))}
      </div>

      <div className="filter-section">
        <div className="filter-label">
          <LocateFixed size={15} />
          <span>Where you’ll work</span>
        </div>
        {(["Remote", "Hybrid", "On-site"] as WorkMode[]).map((mode) => (
          <Checkbox
            key={mode}
            label={mode}
            count={jobs.filter((job) => job.workMode === mode).length}
            checked={filters.workModes.includes(mode)}
            onChange={() => toggleList("workModes", mode)}
          />
        ))}
      </div>

      <div className="filter-section">
        <div className="filter-label">
          <ShieldCheck size={15} />
          <span>Eligibility</span>
        </div>
        <Checkbox
          label="Education not required"
          count={jobs.filter((job) => !job.degreeRequired).length}
          checked={filters.noDegree}
          onChange={() => setFilters({ ...filters, noDegree: !filters.noDegree })}
        />
        <Checkbox
          label="Visa support stated"
          count={jobs.filter((job) => job.visaSupport).length}
          checked={filters.visaSupport}
          onChange={() => setFilters({ ...filters, visaSupport: !filters.visaSupport })}
        />
      </div>

      <div className="filter-section">
        <div className="filter-label filter-label-spread">
          <span>Minimum salary</span>
          <strong>{filters.minSalary === 0 ? "Any" : `$${filters.minSalary / 1000}k+`}</strong>
        </div>
        <input
          className="range-input"
          type="range"
          min="0"
          max="80000"
          step="10000"
          value={filters.minSalary}
          onChange={(event) => setFilters({ ...filters, minSalary: Number(event.target.value) })}
          aria-label="Minimum annual salary in US dollars"
        />
        <div className="range-scale"><span>Any</span><span>$80k+</span></div>
      </div>

      <div className="filter-section last-filter">
        <div className="filter-label">Posted within</div>
        <SelectMenu
          value={String(filters.postedWithin)}
          onChange={(value) => setFilters({ ...filters, postedWithin: Number(value) })}
          placeholder="Any time"
          ariaLabel="Posted within"
          options={[["0", "Any time"], ["1", "24 hours"], ["3", "3 days"], ["7", "7 days"], ["14", "14 days"], ["30", "30 days"]].map(([value, label]) => ({ value, label }))}
        />
      </div>
    </aside>
  );
}

function MatchRing({ score }: { score: number }) {
  return (
    <div className="match-ring" style={{ "--score": score } as React.CSSProperties} aria-label={`${score}% suitability`}>
      <div><strong>{score}%</strong><span>match</span></div>
    </div>
  );
}

function eligibilityLabel(status: EligibilityStatus) {
  return ({
    confirmed: "Eligible location",
    likely: "Likely location fit",
    unclear: "Location eligibility unclear",
    excluded: "Location excluded",
    requires_sponsorship: "Sponsorship required",
    requires_relocation: "Relocation required",
    requires_office_attendance: "Office attendance required",
    timezone_mismatch: "Timezone mismatch",
  } satisfies Record<EligibilityStatus, string>)[status];
}

function JobCard({
  job,
  hasResume,
  hasProfile,
  saved,
  stage,
  onSave,
  onOpen,
  onApply,
  onResume,
  onFeedback,
}: {
  job: Job;
  hasResume: boolean;
  hasProfile: boolean;
  saved: boolean;
  stage?: ApplicationStage;
  onSave: () => void;
  onOpen: () => void;
  onApply: () => void;
  onResume: () => void;
  onFeedback: (reason: FeedbackReason) => void;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const disqualified = job.eligibilityStatus === "excluded" || job.eligibilityStatus === "timezone_mismatch";
  const feedbackOptions: Array<[FeedbackReason, string]> = [["not_relevant", "Not relevant"], ["wrong_role", "Wrong role"], ["wrong_seniority", "Wrong seniority"], ["wrong_location", "Wrong location"], ["not_eligible", "Not eligible"], ["compensation_too_low", "Compensation too low"], ["not_interested_in_company", "Not interested in company"], ["duplicate", "Duplicate"], ["already_applied", "Already applied"], ["closed", "Closed"], ["show_fewer_like_this", "Show fewer like this"]];
  return (
    <article className={cx("job-card", disqualified && "hard-disqualified", job.lifecycleStatus === "closed" && "closed-job")}>
      <div className="job-card-main">
        <div className="company-mark">{job.initials}</div>
        <div className="job-copy">
          <div className="job-title-row">
            <div>
              <div className="company-line">
                <span>{job.company}</span>
                {job.recordKind === "canonical" && job.verified && <span className="verified"><ShieldCheck size={12} /> Verified source</span>}
                {job.recordKind === "feed" && <span className="feed-badge" title="Syndicated aggregator copy — not employer-verified and excluded from saved-search sessions">Aggregator feed · unverified</span>}
              </div>
              <h3>{job.title}</h3>
            </div>
            <button
              type="button"
              className={cx("save-button", saved && "saved")}
              aria-label={saved ? `Remove ${job.title} from saved roles` : `Save ${job.title}`}
              onClick={onSave}
            >
              {saved ? <BookmarkCheck size={19} /> : <Bookmark size={19} />}
            </button>
          </div>

          <div className="job-meta">
            <span><MapPin size={13} />{job.location}</span>
            <span>{formatSalary(job)}</span>
            <span>{postedLabel(job.postedDays)}</span>
          </div>

          <div className="tag-row">
            <span>{job.type}</span>
            <span>{job.experienceLabel}</span>
            <span>{job.workMode}</span>
            {job.degreeRequired !== true && <span>{job.degreeRequired === false ? "No degree required" : "Degree not stated"}</span>}
            {job.visaSupport && <span>Visa support</span>}
            {job.eligibilityStatus && <span className={`eligibility-${job.eligibilityStatus}`}>{eligibilityLabel(job.eligibilityStatus)}</span>}
            {stage && <span>Application: {stage}</span>}
            {job.lifecycleStatus === "possibly_closed" && <span>Source is rechecking availability</span>}
            {job.lifecycleStatus === "closed" && <span className="closed-label">Closed listing</span>}
          </div>

          <div className="why-fit">
            <div className="why-icon"><Sparkles size={14} /></div>
            <div>
              <span>{job.eligibilityStatus ? "Why this is in your search" : hasResume ? "Why this matches your résumé" : "Preliminary eligibility signal"}</span>
              <p>{job.reasons[0]}</p>
              {(job.eligibilityEvidence?.[0] ?? job.reasons[1]) && <p>{job.eligibilityEvidence?.[0] ?? job.reasons[1]}</p>}
            </div>
          </div>

          <div className="card-uncertainty"><CircleAlert size={13} /><span><strong>Important uncertainty:</strong> {job.gap || "The listing does not state every requirement clearly."}</span></div>

          <div className="job-footer">
            <span className="source-label">{job.recordKind === "feed" ? `${job.source} · syndicated copy · never employer-verified` : `${job.source} · verified ${verifiedLabel(job.lastVerifiedAt)}`}</span>
            <div className="card-actions">
              <button type="button" className="secondary-button small" onClick={() => onFeedback("relevant")}>Relevant</button>
              <div className="feedback-menu-wrap"><button type="button" className="secondary-button small" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen((open) => !open)}>Dismiss</button>{feedbackOpen && <div className="feedback-menu" role="menu">{feedbackOptions.map(([reason, label]) => <button type="button" role="menuitem" key={reason} onClick={() => { onFeedback(reason); setFeedbackOpen(false); }}>{label}</button>)}</div>}</div>
              <button type="button" className="secondary-button small" onClick={onOpen}>Open</button>
              <button type="button" className="primary-button small" onClick={onApply}>
                Prepare<Sparkles size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="job-score">
        {disqualified ? <div className="disqualified-score"><X size={20} /><strong>Not eligible</strong><span>Hard constraint</span></div> : hasResume ? <><MatchRing score={job.score} /><span className="score-label">Résumé match</span><span className="confidence">{job.scoreKind === "ai" ? "AI + evidence" : "Keyword evidence"}</span></> : hasProfile && job.scoreKind === "search" ? <><MatchRing score={job.score} /><span className="score-label">Strategy match</span><span className="confidence">Deterministic evidence</span></> : <button type="button" className="resume-score-cta" onClick={onResume}><FileText size={19} /><strong>Match me</strong><span>Upload résumé</span></button>}
      </div>
    </article>
  );
}

function EmptyState({ view, reset, coverage }: { view: View; reset: () => void; coverage?: { sources: number; successful: number; complete: boolean } | null }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Search size={24} /></div>
      <h3>{view === "saved" ? "No saved roles match these filters" : "No strong matches yet"}</h3>
      <p>{coverage ? `No indexed match for this query. ${coverage.successful} of ${coverage.sources} configured sources have completed successfully${coverage.complete ? "." : "; coverage is still incomplete."}` : "Broaden one or two filters and RoleAtlas will show you the closest honest fits."}</p>
      <button type="button" className="secondary-button" onClick={reset}>Reset filters</button>
    </div>
  );
}

function PipelinePanel({ applications }: { applications: Record<string, ApplicationStage> }) {
  const stages: ApplicationStage[] = ["Preparing", "Applied", "Interview", "Offer"];
  const activeCount = Object.values(applications).filter((stage) => stage !== "Closed" && stage !== "Saved").length;
  return (
    <section className="utility-card pipeline-card">
      <div className="utility-head">
        <div>
          <span className="eyebrow">Application trail</span>
          <h3>Keep momentum visible</h3>
        </div>
        <LayoutDashboard size={18} />
      </div>
      <div className="pipeline-total">
        <strong>{activeCount}</strong>
        <span>active roles</span>
      </div>
      <div className="pipeline-bar">
        <span className="bar-mint" />
        <span className="bar-lilac" />
        <span className="bar-coral" />
      </div>
      <div className="stage-list">
        {stages.map((stage) => (
          <div key={stage}>
            <span>{stage}</span>
            <strong>{Object.values(applications).filter((value) => value === stage).length}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResumeModal({ onClose, onComplete }: { onClose: () => void; onComplete: (profile: ResumeProfile) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "reading" | "error">("idle");
  const [error, setError] = useState("");
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);

  const upload = async () => {
    if (!file) return;
    setStatus("reading");
    setError("");
    try {
      const form = new FormData();
      form.set("resume", file);
      const response = await fetch("/api/resume", { method: "POST", body: form });
      const payload = await response.json() as ResumeProfile & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The résumé could not be read.");
      onComplete(payload);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The résumé could not be read.");
      setStatus("error");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} tabIndex={-1} className="resume-modal" role="dialog" aria-modal="true" aria-labelledby="resume-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-wrap"><div className="modal-icon mint"><FileText size={20} /></div><div><span className="eyebrow">One-time setup</span><h2 id="resume-title">Let your résumé drive the search</h2></div></div>
          <button type="button" className="icon-button" aria-label="Close résumé upload" onClick={onClose}><X size={19} /></button>
        </div>
        <p className="modal-intro">Upload a text-based PDF. RoleAtlas extracts your skills and evidence, finds relevant role families, and ranks opportunities. A written self-description is optional.</p>
        <label className={cx("resume-dropzone", file && "has-file")}>
          <input type="file" accept="application/pdf,.pdf" aria-describedby={error ? "resume-upload-error" : undefined} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <UploadCloud size={28} />
          <strong>{file ? file.name : "Choose your résumé PDF"}</strong>
          <span>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB · ready to read` : "PDF up to 8 MB · text is processed for this session"}</span>
        </label>
        {error && <p id="resume-upload-error" className="resume-error" role="alert">{error}</p>}
        <div className="resume-privacy"><ShieldCheck size={16} /><p><strong>No résumé database.</strong> The file is converted to text for matching and is not written to RoleAtlas&apos;s job database. Only explicit AI actions send extracted text to your chosen model provider.</p></div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Browse without matching</button><button type="button" className="primary-button" disabled={!file || status === "reading"} onClick={upload}>{status === "reading" ? "Reading résumé…" : "Build my job search"}<ArrowRight size={15} /></button></div>
      </section>
    </div>
  );
}

function ProfileReviewModal({ profile, plan, onClose, onConfirm }: { profile: CandidateProfile; plan: SearchPlan; onClose: () => void; onConfirm: (profile: CandidateProfile, plan: SearchPlan) => Promise<void> }) {
  const [name, setName] = useState(profile.name.value);
  const [location, setLocation] = useState(profile.location?.value ?? "");
  const [skills, setSkills] = useState(profile.skills.map((item) => item.value).join(", "));
  const [roles, setRoles] = useState(plan.roleQueries.join(", "));
  const [jobTypes, setJobTypes] = useState(plan.jobTypes);
  const [maxExperience, setMaxExperience] = useState(plan.maxExperience === null ? "" : String(plan.maxExperience));
  const [workAuthorization, setWorkAuthorization] = useState((profile.mobility?.workAuthorizedCountryCodes ?? []).map((code) => countryByCodeValue(code)?.name ?? code).join(", "));
  const [sponsorshipNeeded, setSponsorshipNeeded] = useState((profile.mobility?.requiresSponsorshipCountryCodes ?? []).map((code) => countryByCodeValue(code)?.name ?? code).join(", "));
  const [willingToRelocate, setWillingToRelocate] = useState(profile.mobility?.willingToRelocate ?? false);
  const [relocationCountries, setRelocationCountries] = useState((profile.mobility?.relocationCountryCodes ?? []).map((code) => countryByCodeValue(code)?.name ?? code).join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);

  const values = (input: string) => [...new Set(input.split(",").map((value) => value.trim()).filter(Boolean))];
  const countryCodes = (input: string) => values(input).map((value) => resolveCountry(value)?.code ?? value.toUpperCase()).filter((code) => countryByCodeValue(code));
  const confirmedField = (value: string, original?: EvidenceField): EvidenceField => ({ value, confidence: original?.value === value ? original.confidence : 1, evidence: original?.value === value ? original.evidence : "Edited and confirmed by you.", confirmed: true });
  const confirm = async () => {
    setSaving(true);
    setError("");
    try {
      const normalizedLocation = location ? normalizeGeographicLocation(location) : null;
      const confirmedMobilityFields = ["residenceCountryCode", "preferredCountryCodes", "preferredCities", ...(normalizedLocation?.timezone ? ["preferredTimezones"] : [])];
      const mobility = {
        ...(profile.mobility ?? plan.mobility ?? emptyCandidateMobility()),
        residenceCountryCode: normalizedLocation?.countryCode ?? null,
        preferredCountryCodes: normalizedLocation?.countryCode ? [normalizedLocation.countryCode] : [],
        preferredCities: normalizedLocation ? [normalizedLocation] : [],
        preferredTimezones: normalizedLocation?.timezone ? [normalizedLocation.timezone] : [],
        workAuthorizedCountryCodes: countryCodes(workAuthorization),
        requiresSponsorshipCountryCodes: countryCodes(sponsorshipNeeded),
        willingToRelocate,
        relocationCountryCodes: willingToRelocate ? countryCodes(relocationCountries) : [],
        inferredFields: (profile.mobility?.inferredFields ?? []).filter((field) => !confirmedMobilityFields.includes(field)),
        confirmedFields: [...new Set([...(profile.mobility?.confirmedFields ?? []), ...confirmedMobilityFields, "workAuthorizedCountryCodes", "requiresSponsorshipCountryCodes", "willingToRelocate", "relocationCountryCodes"])],
      };
      const nextProfile: CandidateProfile = {
        ...profile,
        name: confirmedField(name, profile.name),
        location: location ? confirmedField(location, profile.location ?? undefined) : null,
        skills: values(skills).map((value) => confirmedField(value, profile.skills.find((item) => item.value === value))),
        targetRoles: values(roles).map((value) => confirmedField(value, profile.targetRoles.find((item) => item.value === value))),
        experienceLevel: { ...profile.experienceLevel, confirmed: true },
        mobility,
        updatedAt: new Date().toISOString(),
      };
      const nextPlan: SearchPlan = { ...plan, roleQueries: values(roles), locations: location ? [location] : [], jobTypes, maxExperience: maxExperience === "" ? null : Number(maxExperience), mobility, confirmedAt: new Date().toISOString() };
      await onConfirm(nextProfile, nextPlan);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The profile could not be saved.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} tabIndex={-1} className="resume-modal profile-review-modal" role="dialog" aria-modal="true" aria-labelledby="profile-review-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><div className="modal-title-wrap"><div className="modal-icon mint"><ClipboardCheck size={20} /></div><div><span className="eyebrow">Review before search</span><h2 id="profile-review-title">Confirm what RoleAtlas found</h2></div></div><button type="button" className="icon-button" aria-label="Close profile review" onClick={onClose}><X size={19} /></button></div>
        <p className="modal-intro">Every inferred field is editable. Confidence describes extraction certainty, not your ability.</p>
        <div className="provider-grid">
          <label><span>Name · {Math.round(profile.name.confidence * 100)}% extraction confidence</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>Preferred location · {Math.round((profile.location?.confidence ?? 0) * 100)}% confidence</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Add only if you want a location constraint" /></label>
        </div>
        <label className="profile-text-field"><span>Skills (comma separated)</span><input value={skills} onChange={(event) => setSkills(event.target.value)} /></label>
        <label className="profile-text-field"><span>Role searches (comma separated)</span><input value={roles} onChange={(event) => setRoles(event.target.value)} /></label>
        <div className="provider-grid">
          <label><span>Countries where you already have work authorization</span><input value={workAuthorization} onChange={(event) => setWorkAuthorization(event.target.value)} placeholder="For example: India, Canada" /></label>
          <label><span>Countries where you would need sponsorship</span><input value={sponsorshipNeeded} onChange={(event) => setSponsorshipNeeded(event.target.value)} placeholder="Leave blank when not applicable" /></label>
        </div>
        <div className="profile-plan-row"><div><span className="eyebrow">Relocation</span><label><input type="checkbox" checked={willingToRelocate} onChange={(event) => setWillingToRelocate(event.target.checked)} />I am willing to relocate</label></div>{willingToRelocate && <label><span>Relocation countries</span><input value={relocationCountries} onChange={(event) => setRelocationCountries(event.target.value)} placeholder="Any, or list countries" /></label>}</div>
        <p className="modal-intro">RoleAtlas never infers citizenship, visas, or work authorization from your résumé. These answers are used only for geographic eligibility.</p>
        <div className="profile-evidence-list">{[...profile.skills.slice(0, 3), ...profile.targetRoles.slice(0, 2)].map((item) => <div key={`${item.value}-${item.evidence}`}><strong>{item.value} · {Math.round(item.confidence * 100)}%</strong><p>{item.evidence}</p></div>)}</div>
        <div className="profile-plan-row"><div><span className="eyebrow">Opportunity types</span>{(["Internship", "Entry-level", "Apprenticeship", "Full-time", "Part-time", "Contract", "Unknown"] as JobType[]).map((type) => <label key={type}><input type="checkbox" checked={jobTypes.includes(type)} onChange={() => setJobTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type])} />{type}</label>)}</div><label><span>Maximum experience requested</span><input type="number" min="0" max="20" value={maxExperience} onChange={(event) => setMaxExperience(event.target.value)} placeholder="No ceiling" /></label></div>
        {error && <p className="resume-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Review later</button><button type="button" className="primary-button" disabled={saving || values(roles).length === 0} onClick={() => void confirm()}>{saving ? "Saving profile…" : "Confirm and find roles"}<ArrowRight size={15} /></button></div>
      </section>
    </div>
  );
}

function ProviderModal({
  userId,
  config,
  setConfig,
  onClose,
}: {
  userId: string;
  config: ProviderConfig;
  setConfig: (config: ProviderConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config);
  const [status, setStatus] = useState<"idle" | "testing" | "verified" | "failed" | "saved">(verificationIsCurrent(config) ? "verified" : "idle");
  const [message, setMessage] = useState(config.verification?.message ?? "");
  const [activities, setActivities] = useState<AiActivity[]>(() => loadAiActivity(userId));
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const connectionPreview = aiRequestPreview({ provider: draft.provider, model: draft.model, baseUrl: draft.baseUrl, purpose: "Verify provider credentials and model availability", dataCategories: ["API credential in an authorization header", "configured model name"], estimatedInputCharacters: draft.model.length + draft.baseUrl.length });

  useEffect(() => {
    const update = (event: Event) => setActivities((event as CustomEvent<AiActivity[]>).detail);
    window.addEventListener("roleatlas-ai-activity", update);
    return () => window.removeEventListener("roleatlas-ai-activity", update);
  }, []);

  const updateDraft = (changes: Partial<ProviderConfig>) => {
    setDraft((current) => ({ ...current, ...changes, verification: { status: "untested" } }));
    setStatus("idle");
    setMessage("");
  };

  const updateProvider = (provider: ProviderName) => {
    const defaults = PROVIDERS[provider];
    updateDraft({ provider, baseUrl: defaults.baseUrl, model: defaults.model });
  };

  const testConnection = async () => {
    if (!providerIsConfigured(draft)) {
      setStatus("failed");
      setMessage("Add the provider URL, model, and required API key first.");
      return;
    }
    setStatus("testing");
    setMessage("Checking credentials and model availability…");
    try {
      const response = await fetch("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const payload = await response.json() as { verified?: boolean; message?: string; error?: string; activity?: AiActivity };
      recordAiActivity(userId, payload.activity);
      const verification = { status: payload.verified ? "verified" as const : "failed" as const, testedAt: new Date().toISOString(), baseUrl: draft.baseUrl, model: draft.model, message: payload.message ?? payload.error ?? "Connection test failed." };
      setDraft((current) => ({ ...current, verification }));
      setStatus(payload.verified ? "verified" : "failed");
      setMessage(verification.message);
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Connection test failed.");
    }
  };

  const save = () => {
    const active = { ...draft, rememberKey: false };
    const metadata = providerMetadataForStorage(active);
    setConfig(active);
    window.localStorage.setItem(accountStorageKey(userId, ACCOUNT_STORAGE_KEYS.provider), JSON.stringify(metadata));
    void fetch("/api/ai/provider-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: metadata.provider, model: metadata.model, baseUrl: metadata.baseUrl, profile: metadata.profile, verification: metadata.verification }),
    }).catch(() => undefined);
    setStatus("saved");
    window.setTimeout(onClose, 550);
  };

  const clearKey = () => {
    const cleared = { ...draft, apiKey: "", rememberKey: false, verification: { status: "untested" as const } };
    setDraft(cleared);
    setConfig(cleared);
    window.localStorage.setItem(accountStorageKey(userId, ACCOUNT_STORAGE_KEYS.provider), JSON.stringify(cleared));
    void fetch("/api/ai/provider-config", { method: "DELETE" }).catch(() => undefined);
    setStatus("idle");
    setMessage("The in-memory API key and saved verification state were cleared.");
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} tabIndex={-1} className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="provider-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-wrap">
            <div className="modal-icon"><WandSparkles size={20} /></div>
            <div>
              <span className="eyebrow">Your AI, your choice</span>
              <h2 id="provider-title">Connect a model provider</h2>
            </div>
          </div>
          <button type="button" className="icon-button" aria-label="Close provider settings" onClick={onClose}><X size={19} /></button>
        </div>
        <p className="modal-intro">AI can expand confirmed searches, rank résumé evidence, interpret unclear requirements, and prepare truthful application material. It never decides geographic eligibility or adds crawler sources.</p>

        <div className="provider-grid">
          <label>
            <span>Provider</span>
            <SelectMenu value={draft.provider} onChange={(value) => updateProvider(value as ProviderName)} placeholder="Choose provider" ariaLabel="AI provider" options={Object.keys(PROVIDERS).map((provider) => ({ value: provider, label: provider }))} />
          </label>
          <label>
            <span>Model</span>
            <input value={draft.model} onChange={(event) => updateDraft({ model: event.target.value })} placeholder="Model name" />
          </label>
        </div>
        <label className="full-field">
          <span>API base URL</span>
          <input value={draft.baseUrl} onChange={(event) => updateDraft({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
        </label>
        <label className="full-field">
          <span>API key</span>
          <input type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => updateDraft({ apiKey: event.target.value })} placeholder={draft.provider === "Ollama" ? "Not required for local Ollama" : draft.provider === "NVIDIA NIM" ? "NVIDIA key (optional for loopback NIM)" : "Paste your key"} />
        </label>
        <p className="provider-key-policy"><ShieldCheck size={15} /> API keys remain only in memory for this page session and are never written to normal browser storage. Refreshing or signing out requires the key again.</p>
        <label className="full-field">
          <span>Optional note or hard constraints</span>
          <textarea rows={3} value={draft.profile} onChange={(event) => setDraft({ ...draft, profile: event.target.value })} placeholder="Optional: work authorization, schedule, industries to avoid, or anything the résumé does not explain…" />
        </label>

        <div className="privacy-note">
          <ShieldCheck size={17} />
          <p><strong>AI is optional and separate from crawling.</strong> Your key is sent through this RoleAtlas instance only for a connection test or AI action you trigger, remains in memory for this page session, and is not persisted in browser storage. Search, NATS crawling, and deterministic eligibility work without AI.</p>
        </div>

        <div className="ai-request-preview">
          <div><span className="eyebrow">Connection-test preview</span><strong>{connectionPreview.provider} · {connectionPreview.model || "No model selected"}</strong><small>{connectionPreview.purpose} · {connectionPreview.location} · Browser → this RoleAtlas instance → provider · about {connectionPreview.estimatedInputCharacters} input characters</small><small>Data: {connectionPreview.dataCategories.join(", ")}</small></div>
          <p>Ranking and application preparation show their own confirmation previews before any request. API keys are never written to the activity log.</p>
          {message && <p className={`provider-test-message ${status}`}>{message}</p>}
        </div>

        <div className="ai-activity-log">
          <span className="eyebrow">Recent AI activity on this browser</span>
          {activities.length === 0 ? <p>No model requests recorded yet.</p> : activities.slice(0, 5).map((activity) => <div key={activity.id}><span className={activity.outcome}>{activity.outcome}</span><strong>{activity.action.replaceAll("_", " ")}</strong><small>{activity.provider} · {activity.model} · {new Date(activity.completedAt).toLocaleString()}</small><p>Sent: {activity.dataSent.join(", ")}</p></div>)}
        </div>

        <div className="modal-actions">
          <button type="button" className="text-button" onClick={clearKey} disabled={!draft.apiKey}>Clear session key</button>
          <button type="button" className="secondary-button" onClick={() => void testConnection()} disabled={status === "testing"}>
            {status === "testing" ? "Testing provider…" : status === "verified" || (status === "saved" && verificationIsCurrent(draft)) ? <><Check size={15} /> Connection verified</> : "Test real connection"}
          </button>
          <button type="button" className="primary-button" onClick={save} disabled={!providerIsConfigured(draft)}>
            {status === "saved" ? <><Check size={15} /> Saved</> : "Save provider"}
          </button>
        </div>
      </section>
    </div>
  );
}

function AiActionPreviewModal({ preview, onCancel, onConfirm }: { preview: AiRequestPreview; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onCancel);
  return <div className="workspace-dialog-backdrop" role="presentation"><section ref={dialogRef} tabIndex={-1} className="workspace-dialog ai-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-preview-title"><header><div><span className="eyebrow">Explicit model request</span><h2 id="ai-preview-title">Review before sending</h2></div><button type="button" className="icon-button" aria-label="Cancel AI request" onClick={onCancel}><X size={17} /></button></header><div className="ai-request-preview"><dl><div><dt>Provider</dt><dd>{preview.provider}</dd></div><div><dt>Model</dt><dd>{preview.model}</dd></div><div><dt>Purpose</dt><dd>{preview.purpose}</dd></div><div><dt>Request location</dt><dd>{preview.location === "local" ? "Local provider" : "External provider"}</dd></div><div><dt>Network path</dt><dd>{preview.passesThroughRoleAtlas ? "Browser → this RoleAtlas instance → provider" : "Direct"}</dd></div><div><dt>Estimated input</dt><dd>About {preview.estimatedInputCharacters.toLocaleString()} characters</dd></div></dl><div><strong>Data categories being sent</strong><ul>{preview.dataCategories.map((category) => <li key={category}>{category}</li>)}</ul></div><p><ShieldCheck size={15} /> No request has been made yet. Cancel keeps the deterministic result unchanged.</p></div><footer><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="button" className="primary-button" onClick={onConfirm}><Sparkles size={15} /> Send this request</button></footer></section></div>;
}

function verifiedLabel(value?: string | null) {
  if (!value) return "time unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "time unknown" : parsed.toISOString().slice(0, 10);
}

function JobDrawer({
  userId,
  job,
  hasResume,
  hasProfile,
  resume,
  providerConfig,
  saved,
  stage,
  onClose,
  onSave,
  dossier,
  onDossier,
  onStageChange,
  onOpenProvider,
  onResume,
  onConfirmAi,
  similarJobs,
  onOpenSimilar,
}: {
  userId: string;
  job: Job;
  hasResume: boolean;
  hasProfile: boolean;
  resume: ResumeProfile | null;
  providerConfig: ProviderConfig;
  saved: boolean;
  stage?: ApplicationStage;
  onClose: () => void;
  onSave: () => void;
  dossier?: CareerDossier;
  onDossier: (dossier: CareerDossier) => void;
  onStageChange: (stage: ApplicationStage) => void;
  onOpenProvider: () => void;
  onResume: () => void;
  onConfirmAi: (preview: AiRequestPreview, action: () => Promise<void>) => void;
  similarJobs: Job[];
  onOpenSimilar: (job: Job) => void;
}) {
  const [activeTab, setActiveTab] = useState<DossierTab>("evaluation");
  const [prepareState, setPrepareState] = useState<"idle" | "loading" | "error">("idle");
  const [prepareError, setPrepareError] = useState("");
  const [copied, setCopied] = useState("");
  const canPrepare = Boolean(providerIsConfigured(providerConfig) && resume);
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);

  const prepare = async () => {
    if (!resume) { onResume(); return; }
    if (!canPrepare) { onOpenProvider(); return; }
    setPrepareState("loading");
    setPrepareError("");
    try {
      const response = await fetch("/api/ai/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...providerConfig, resumeText: resume.text, job }),
      });
      const payload = await response.json() as { dossier?: CareerDossier; error?: string; activity?: AiActivity };
      recordAiActivity(userId, payload.activity);
      if (!response.ok || !payload.dossier) throw new Error(payload.error || "The model could not prepare this application.");
      onDossier(payload.dossier);
      onStageChange("Preparing");
      setPrepareState("idle");
    } catch (error) {
      setPrepareError(error instanceof Error ? error.message : "Application preparation failed.");
      setPrepareState("error");
    }
  };

  const previewPreparation = () => {
    if (!resume) { onResume(); return; }
    if (!canPrepare) { onOpenProvider(); return; }
    onConfirmAi(aiRequestPreview({ provider: providerConfig.provider, model: providerConfig.model, baseUrl: providerConfig.baseUrl, purpose: dossier ? "Regenerate the application dossier" : "Prepare an application dossier", dataCategories: ["resume text", "optional candidate constraints", "selected job description and metadata"], estimatedInputCharacters: resume.text.length + (job.description?.length ?? job.summary.length) + providerConfig.profile.length }), prepare);
  };

  const copyText = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1400);
  };

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside ref={dialogRef} tabIndex={-1} className="job-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-top">
          <span className="live-pill"><span /> Verified listing</span>
          <button type="button" className="icon-button" aria-label="Close job details" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="drawer-company">
          <div className="company-mark large">{job.initials}</div>
          <div><span>{job.company}</span><h2 id="drawer-title">{job.title}</h2></div>
        </div>
        <div className="drawer-meta">
          <span><MapPin size={14} />{job.location}</span>
          <span>{formatSalary(job)}</span>
          <span>{job.type}</span>
          {stage && <span>Application: {stage}</span>}
        </div>
        <p className="drawer-summary">{job.summary}</p>

        <section className="drawer-section score-breakdown-section">
          <h3>Score and constraint breakdown</h3>
          <div className="drawer-breakdown"><div><span>Evidence match</span><strong>{hasResume || (hasProfile && job.scoreKind === "search") ? `${job.score}/100` : "Not calculated"}</strong></div><div><span>Eligibility</span><strong>{job.eligibilityStatus ? eligibilityLabel(job.eligibilityStatus) : "Unclear"}</strong></div><div><span>Source freshness</span><strong>{verifiedLabel(job.lastVerifiedAt)}</strong></div><div><span>Listing status</span><strong>{job.lifecycleStatus ?? "Unknown"}</strong></div></div>
          {(job.eligibilityStatus === "excluded" || job.eligibilityStatus === "timezone_mismatch") && <div className="hard-disqualifier-callout"><X size={16} /><p><strong>Hard disqualifier:</strong> this job is not ranked as a strong match. Review the listing evidence before taking action.</p></div>}
        </section>

        {hasResume ? <div className="drawer-score-card"><MatchRing score={job.score} /><div><span className="eyebrow">Résumé evidence</span><h3>{job.scoreKind === "ai" ? "AI-assisted evidence match" : "Deterministic résumé match"}</h3><p>This percentage compares evidence in your résumé with this listing. It is not a hiring probability.</p></div></div> : hasProfile && job.scoreKind === "search" ? <div className="drawer-score-card"><MatchRing score={job.score} /><div><span className="eyebrow">Confirmed search strategy</span><h3>Deterministic strategy match</h3><p>This score combines title-query evidence and eligibility status. It is not a hiring probability.</p></div></div> : <button type="button" className="drawer-resume-prompt" onClick={onResume}><UploadCloud size={20} /><div><span className="eyebrow">Match not calculated</span><h3>Upload your résumé for an evidence-based score</h3><p>Until then, RoleAtlas shows listings without pretending to know your suitability.</p></div><ArrowRight size={17} /></button>}

        <section className="drawer-section">
          <h3>Why am I seeing this?</h3>
          <p className="drawer-section-intro">This listing matched a confirmed role query or evidence term. Eligibility remains a separate decision.</p>
          <div className="reason-list">
            {job.reasons.map((reason) => <div key={reason}><Check size={15} /><p>{reason}</p></div>)}
          </div>
        </section>
        <section className="drawer-section gap-section">
          <h3>One honest gap</h3>
          <p>{job.gap}</p>
        </section>
        <section className="drawer-section">
          <h3>Location and authorization evidence</h3>
          <div className="reason-list">{(job.eligibilityEvidence?.length ? job.eligibilityEvidence : ["The listing does not provide enough evidence to confirm individual geographic eligibility."]).map((evidence) => <div key={evidence}><MapPin size={14} /><p>{evidence}</p></div>)}</div>
        </section>
        <section className="drawer-section">
          <h3>Source and original wording</h3>
          <dl className="drawer-source-details"><div><dt>Source</dt><dd>{job.source}</dd></div><div><dt>Canonical URL</dt><dd>{job.canonicalUrl ?? job.url}</dd></div><div><dt>Last verified</dt><dd>{job.lastVerifiedAt ?? "Not available"}</dd></div><div><dt>Original employment label</dt><dd>{job.opportunityClassification?.originalLabel ?? "Not supplied"}</dd></div><div><dt>Classification confidence</dt><dd>{job.opportunityClassification ? `${Math.round(job.opportunityClassification.confidence * 100)}% · ${job.opportunityClassification.evidenceSource}` : "Unknown"}</dd></div><div><dt>Compensation</dt><dd>{formatSalary(job)}</dd></div></dl>
        </section>
        <section className="drawer-section">
          <h3>Skills in this listing</h3>
          <div className="tag-row drawer-tags">{job.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
        </section>

        {similarJobs.length > 0 && <section className="drawer-section"><h3>Similar jobs</h3><div className="similar-job-list">{similarJobs.slice(0, 3).map((similar) => <button type="button" key={similar.id} onClick={() => onOpenSimilar(similar)}><span><strong>{similar.title}</strong><small>{similar.company} · {similar.location}</small></span><ArrowRight size={14} /></button>)}</div></section>}

        <section className="drawer-section dossier-section">
          <div className="analysis-heading">
            <div><span className="eyebrow">Career operations</span><h3>{dossier ? "Application workspace" : "Build the full application"}</h3></div>
            <button type="button" className="primary-button compact-action" onClick={previewPreparation} disabled={prepareState === "loading"}>
              <Sparkles size={15} />{prepareState === "loading" ? `${providerConfig.provider} is preparing…` : dossier ? "Regenerate" : canPrepare ? "Prepare everything" : !resume ? "Upload résumé" : "Connect a model"}
            </button>
          </div>
          {!dossier && prepareState !== "error" && <div className="dossier-promise"><p>One action creates a structured evaluation, legitimacy check, truthful résumé tailoring, cover letter, recruiter message, interview plan, and next-action checklist.</p><div><span>Evaluate</span><span>Tailor</span><span>Write</span><span>Prepare</span></div></div>}
          {prepareState === "error" && <p className="analysis-error">{prepareError}</p>}
          {dossier && (
            <div className="dossier-workspace">
              <div className="dossier-verdict"><div className={`grade-badge grade-${dossier.grade.toLowerCase()}`}>{dossier.grade}</div><div><span>{dossier.score}/100 · {dossier.legitimacy.rating}</span><strong>{dossier.verdict}</strong><p>{dossier.roleSummary}</p></div></div>
              <div className="dossier-tabs" role="tablist">{([["evaluation", "Evaluation"], ["resume", "Résumé"], ["letter", "Messages"], ["interview", "Interview"]] as Array<[DossierTab, string]>).map(([id, label]) => <button type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "active" : ""} key={id} onClick={() => setActiveTab(id)}>{label}</button>)}</div>
              {activeTab === "evaluation" && <div className="dossier-panel">
                <p className="dossier-lead">{dossier.whyThisRole}</p>
                <div className="dimension-list">{dossier.dimensions.map((item) => <div key={item.name}><div><strong>{item.name}</strong><span>{item.score}/5</span></div><p>{item.evidence}</p></div>)}</div>
                <div className="dossier-columns"><div><strong>Evidence in your favor</strong><ul>{dossier.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div><div><strong>Gaps to handle honestly</strong><ul>{dossier.gaps.map((item) => <li key={item}>{item}</li>)}</ul></div></div>
                <div className="legitimacy-card"><ShieldCheck size={16} /><div><strong>Posting legitimacy: {dossier.legitimacy.rating}</strong>{dossier.legitimacy.signals.map((item) => <p key={item}>{item}</p>)}</div></div>
              </div>}
              {activeTab === "resume" && <div className="dossier-panel copy-panel">
                <div className="copy-block"><div><strong>Target headline</strong><button type="button" onClick={() => void copyText("headline", dossier.resume.headline)}>{copied === "headline" ? <ClipboardCheck size={14} /> : "Copy"}</button></div><p>{dossier.resume.headline}</p></div>
                <div className="copy-block"><div><strong>Tailored summary</strong><button type="button" onClick={() => void copyText("summary", dossier.resume.summary)}>{copied === "summary" ? <ClipboardCheck size={14} /> : "Copy"}</button></div><p>{dossier.resume.summary}</p></div>
                <div><strong>Truthful bullet rewrites</strong><ul>{dossier.resume.bulletRewrites.map((item) => <li key={item}>{item}</li>)}</ul></div>
                {dossier.resume.missingEvidence.length > 0 && <div className="missing-evidence"><strong>Do not claim without evidence</strong><ul>{dossier.resume.missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul></div>}
                <div className="keyword-row">{dossier.keywords.map((item) => <span key={item}>{item}</span>)}</div>
              </div>}
              {activeTab === "letter" && <div className="dossier-panel copy-panel">
                <div className="copy-block long-copy"><div><strong>Cover letter</strong><button type="button" onClick={() => void copyText("letter", dossier.coverLetter)}>{copied === "letter" ? <ClipboardCheck size={14} /> : "Copy"}</button></div><p>{dossier.coverLetter}</p></div>
                <div className="copy-block"><div><strong>Recruiter message</strong><button type="button" onClick={() => void copyText("message", dossier.recruiterMessage)}>{copied === "message" ? <ClipboardCheck size={14} /> : "Copy"}</button></div><p>{dossier.recruiterMessage}</p></div>
              </div>}
              {activeTab === "interview" && <div className="dossier-panel interview-grid">
                <div><strong>Questions they may ask</strong><ol>{dossier.interview.likelyQuestions.map((item) => <li key={item}>{item}</li>)}</ol></div>
                <div><strong>Stories to prepare</strong><ul>{dossier.interview.storiesToPrepare.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><strong>Questions worth asking</strong><ul>{dossier.interview.questionsToAsk.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div className="next-actions"><strong>Next actions</strong>{dossier.nextActions.map((item, index) => <p key={item}><span>{index + 1}</span>{item}</p>)}</div>
              </div>}
            </div>
          )}
        </section>

        <div className="drawer-actions dossier-actions">
          <SelectMenu compact ariaLabel="Application status" value={stage ?? ""} onChange={(value) => onStageChange(value as ApplicationStage)} placeholder="Set status" options={["Preparing", "Applied", "Interview", "Offer", "Closed"].map((value) => ({ value, label: value }))} />
          <button type="button" className={cx("secondary-button", saved && "is-saved")} onClick={onSave}>{saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}{saved ? "Saved" : "Save"}</button>
          <a className="primary-button" href={job.url} target="_blank" rel="noreferrer">Original listing<ExternalLink size={15} /></a>
        </div>
      </aside>
    </div>
  );
}

export default function RoleAtlasApp({ initialPayload, currentUser }: { initialPayload: LiveJobsPayload; currentUser: { id: string; name: string; email: string } }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [jobs, setJobs] = useState(() => deduplicateJobs(initialPayload.jobs).slice(0, 400));
  const [sourceMeta, setSourceMeta] = useState(() => ({
    sources: initialPayload.sources,
    failedSources: initialPayload.failedSources,
    fetchedAt: initialPayload.fetchedAt,
    fallback: initialPayload.fallback,
    sourceStatus: initialPayload.sourceStatus,
  }));
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [specificLocation, setSpecificLocation] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [dossiers, setDossiers] = useState<Record<string, CareerDossier>>({});
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showProvider, setShowProvider] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [showProfileReview, setShowProfileReview] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [workspace, setWorkspace] = useState<DailyWorkspace>(() => createWorkspace());
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const workspaceRevisionRef = useRef(0);
  const workspaceSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastPersistedWorkspaceRef = useRef("");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileReconciled, setProfileReconciled] = useState(false);
  const [searchSessionsLoaded, setSearchSessionsLoaded] = useState(false);
  const [activeSearchRestored, setActiveSearchRestored] = useState(false);
  const [aiActivities, setAiActivities] = useState<AiActivity[]>([]);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>(() => ({ web: "available", database: "checking", nats: "checking", scout: "checking", crawler: "checking", ai: "unavailable", checkedAt: new Date().toISOString() }));
  const [pendingAiAction, setPendingAiAction] = useState<{ preview: AiRequestPreview; action: () => Promise<void> } | null>(null);
  const [undoFeedbackNotice, setUndoFeedbackNotice] = useState<{ id: string; message: string } | null>(null);
  const saved = useMemo(() => Object.keys(workspace.savedJobs), [workspace.savedJobs]);
  const applications = useMemo<Record<string, ApplicationStage>>(() => Object.fromEntries(Object.values(workspace.applications).map((application) => {
    const stage: ApplicationStage = application.stage === "Technical interview" || application.stage === "Final interview" || application.stage === "Recruiter screen" || application.stage === "Assessment" ? "Interview" : application.stage === "Rejected" || application.stage === "Withdrawn" || application.stage === "Closed before application" ? "Closed" : application.stage;
    return [application.jobId, stage];
  })), [workspace.applications]);
  const [resumeProfile, setResumeProfile] = useState<ResumeProfile | null>(null);
  const [pendingResume, setPendingResume] = useState<ResumeProfile | null>(null);
  const [candidateProfile, setCandidateProfile] = useState<CandidateProfile | null>(null);
  const [searchPlan, setSearchPlan] = useState<SearchPlan | null>(null);
  const [matchingState, setMatchingState] = useState<"idle" | "local" | "ai" | "error">("idle");
  const [matchMessage, setMatchMessage] = useState("");
  const [visibleCount, setVisibleCount] = useState(30);
  const [mobileNav, setMobileNav] = useState(false);
  const mobileNavRef = useDialogFocus<HTMLElement>(mobileNav, () => setMobileNav(false));
  useEffect(() => {
    if (!mobileNav) return;
    const timer = window.setTimeout(() => mobileNavRef.current?.querySelector<HTMLButtonElement>(".mobile-close")?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [mobileNav, mobileNavRef]);
  const [sort, setSort] = useState<"match" | "newest" | "salary">("newest");
  const [serverIndex, setServerIndex] = useState<{ count: number; returned: number; coverage: { sources: number; successful: number; complete: boolean } } | null>(null);
  const [searchSessions, setSearchSessions] = useState<SearchSessionSummary[]>([]);
  const [activeSearchSession, setActiveSearchSession] = useState<SearchSessionSummary | null>(null);
  const [activeSearchJobIds, setActiveSearchJobIds] = useState<string[]>([]);
  const exchangeRates = initialPayload.exchangeRates;
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({
    provider: "NVIDIA NIM",
    apiKey: "",
    baseUrl: PROVIDERS["NVIDIA NIM"].baseUrl,
    model: PROVIDERS["NVIDIA NIM"].model,
    profile: "",
    rememberKey: false,
    verification: { status: "untested" },
  });

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("roleatlas-theme");
    const nextTheme = storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    document.documentElement.dataset.theme = nextTheme;
    queueMicrotask(() => setTheme(nextTheme));
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("roleatlas-theme", nextTheme);
  };

  const refreshServiceStatus = useCallback(async () => {
    const checkedAt = new Date().toISOString();
    try {
      const [health, stats] = await Promise.all([
        fetch("/api/local-scout?action=health", { cache: "no-store" }),
        fetch("/api/local-scout?action=stats", { cache: "no-store" }),
      ]);
      const healthPayload = health.ok ? await health.json() as { crawler_queue?: string } : null;
      setServiceStatus({
        web: "available",
        database: health.ok ? "available" : "unavailable",
        nats: healthPayload?.crawler_queue === "available" ? "available" : "unavailable",
        scout: health.ok ? "available" : "unavailable",
        crawler: stats.ok ? "available" : "unavailable",
        ai: verificationIsCurrent(providerConfig) ? "available" : providerIsConfigured(providerConfig) ? "degraded" : "unavailable",
        checkedAt,
      });
    } catch {
      setServiceStatus({ web: "available", database: "unavailable", nats: "unavailable", scout: "unavailable", crawler: "unavailable", ai: verificationIsCurrent(providerConfig) ? "available" : providerIsConfigured(providerConfig) ? "degraded" : "unavailable", checkedAt });
    }
  }, [providerConfig]);

  useEffect(() => {
    queueMicrotask(() => void refreshServiceStatus());
  }, [refreshServiceStatus]);

  useEffect(() => {
    queueMicrotask(() => {
      const storedProvider = window.localStorage.getItem(accountStorageKey(currentUser.id, ACCOUNT_STORAGE_KEYS.provider));
      const storedDossiers = window.localStorage.getItem(accountStorageKey(currentUser.id, ACCOUNT_STORAGE_KEYS.dossiers));
      const storedResume = window.sessionStorage.getItem(accountStorageKey(currentUser.id, ACCOUNT_STORAGE_KEYS.resumeSession));
      if (storedProvider) setProviderConfig((current) => ({ ...current, ...(JSON.parse(storedProvider) as Partial<ProviderConfig>) }));
      void fetch("/api/ai/provider-config", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((payload: { config?: Partial<ProviderConfig> | null } | null) => {
          if (payload?.config) setProviderConfig((current) => ({ ...current, ...payload.config, apiKey: "", rememberKey: false }));
        })
        .catch(() => undefined);
      if (storedDossiers) setDossiers(JSON.parse(storedDossiers) as Record<string, CareerDossier>);
      void fetch("/api/application-artifacts", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((payload: { dossiers?: Record<string, CareerDossier> } | null) => {
          if (payload?.dossiers) setDossiers((current) => ({ ...current, ...payload.dossiers }));
        })
        .catch(() => undefined);
      if (storedResume) {
        const parsed = JSON.parse(storedResume) as ResumeProfile;
        setResumeProfile(parsed);
        setJobs((current) => rankJobsLocally(current, parsed));
        setSort("match");
        setMatchingState("local");
      }
      const localActivities = loadAiActivity(currentUser.id);
      setAiActivities(localActivities);
      void fetch("/api/ai/activity", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((payload: { activities?: AiActivity[] } | null) => {
          if (!payload?.activities) return;
          const combined = [...payload.activities, ...localActivities]
            .filter((activity, index, all) => all.findIndex((candidate) => candidate.id === activity.id) === index)
            .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
            .slice(0, 100);
          setAiActivities(combined);
          window.localStorage.setItem(accountStorageKey(currentUser.id, ACCOUNT_STORAGE_KEYS.aiActivity), JSON.stringify(combined.slice(0, 25)));
        })
        .catch(() => undefined);
    });
  }, [currentUser.id]);

  useEffect(() => {
    let cancelled = false;
    const loadWorkspace = async () => {
      let next = createWorkspace();
      try {
        next = normalizeWorkspace(JSON.parse(window.localStorage.getItem(accountStorageKey(currentUser.id, ACCOUNT_STORAGE_KEYS.workspace)) ?? "null"));
      } catch { /* A malformed local fallback must not block the server copy. */ }
      try {
        const response = await fetch("/api/workspace", { cache: "no-store" });
        const payload = await response.json() as { workspace?: unknown; revision?: number };
        if (response.ok) {
          workspaceRevisionRef.current = Number.isInteger(payload.revision) ? Number(payload.revision) : 0;
          if (payload.workspace) next = normalizeWorkspace(payload.workspace);
        }
      } catch { /* Local fallback remains usable when PostgreSQL is unavailable. */ }
      if (cancelled) return;
      lastPersistedWorkspaceRef.current = JSON.stringify(next);
      setWorkspace(next);
      setWorkspaceLoaded(true);
      if (!next.onboarding.completedAt) window.setTimeout(() => { if (!cancelled) setShowOnboarding(true); }, 250);
    };
    void loadWorkspace();
    return () => { cancelled = true; };
  }, [currentUser.id]);

  useEffect(() => {
    if (!workspaceLoaded) return;
    const serialized = JSON.stringify(workspace);
    window.localStorage.setItem(accountStorageKey(currentUser.id, ACCOUNT_STORAGE_KEYS.workspace), serialized);
    if (serialized === lastPersistedWorkspaceRef.current) return;
    const timer = window.setTimeout(() => {
      const snapshot = workspace;
      workspaceSaveQueueRef.current = workspaceSaveQueueRef.current.catch(() => undefined).then(async () => {
        const response = await fetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile_id: candidateProfile?.id ?? null, state: snapshot, expected_revision: workspaceRevisionRef.current }),
        });
        const payload = await response.json().catch(() => ({})) as { workspace?: unknown; revision?: number; error?: string };
        if (response.status === 409) {
          const latest = await fetch("/api/workspace", { cache: "no-store" });
          const latestPayload = await latest.json() as { workspace?: unknown; revision?: number };
          if (latest.ok && latestPayload.workspace) {
            const serverWorkspace = normalizeWorkspace(latestPayload.workspace);
            workspaceRevisionRef.current = Number(latestPayload.revision ?? 0);
            lastPersistedWorkspaceRef.current = JSON.stringify(serverWorkspace);
            setWorkspace(serverWorkspace);
            setMatchMessage("This workspace changed in another tab. The latest saved revision was restored instead of overwriting it.");
          }
          return;
        }
        if (!response.ok) throw new Error(payload.error || "Workspace persistence failed.");
        workspaceRevisionRef.current = Number(payload.revision ?? workspaceRevisionRef.current + 1);
        lastPersistedWorkspaceRef.current = JSON.stringify(snapshot);
      }).catch(() => {
        setMatchMessage("Workspace changes remain in this account's browser storage while server persistence is unavailable.");
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [candidateProfile?.id, currentUser.id, workspace, workspaceLoaded]);

  useEffect(() => {
    const update = () => setAiActivities(loadAiActivity(currentUser.id));
    window.addEventListener("roleatlas-ai-activity", update);
    return () => window.removeEventListener("roleatlas-ai-activity", update);
  }, [currentUser.id]);

  useEffect(() => {
    let cancelled = false;
    const loadPersistentProfile = async () => {
      try {
        const response = await fetch("/api/candidate-profile", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { profile_id?: string; plan_id?: string; profile?: CandidateProfile | null; search_plan?: SearchPlan | null };
        if (!cancelled && payload.profile) {
          const mobility = payload.profile.mobility ?? payload.search_plan?.mobility ?? emptyCandidateMobility();
          setCandidateProfile({ ...payload.profile, mobility, id: payload.profile_id });
          if (payload.search_plan) setSearchPlan({ ...payload.search_plan, mobility, id: payload.plan_id, profileId: payload.profile_id });
        }
      } catch { /* The public-feed-only fallback remains usable without the local persistence service. */ }
      finally { if (!cancelled) setProfileLoaded(true); }
    };
    void loadPersistentProfile();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/search-sessions", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { sessions?: SearchSessionSummary[] } | null) => { if (!cancelled && payload?.sessions) setSearchSessions(payload.sessions); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setSearchSessionsLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(accountStorageKey(currentUser.id, ACCOUNT_STORAGE_KEYS.dossiers), JSON.stringify(dossiers));
  }, [currentUser.id, dossiers]);

  useEffect(() => {
    if (!workspaceLoaded || !profileLoaded) return;
    queueMicrotask(() => {
      if (candidateProfile) {
        setWorkspace((current) => {
          let next = current;
          if (!current.onboarding.profile) next = { ...next, onboarding: { ...next.onboarding, profile: candidateProfile, strategy: searchPlan ?? next.onboarding.strategy } };
          if (searchPlan && current.strategies.length === 0) next = saveStrategy(next, searchPlan);
          return next;
        });
      }
      setProfileReconciled(true);
    });
  }, [candidateProfile, profileLoaded, searchPlan, workspaceLoaded]);

  const countryOptions = useMemo(() => {
    return ["Worldwide", ...COUNTRIES.map((candidate) => candidate.name)].sort((a, b) => a.localeCompare(b));
  }, []);

  const locationOptions = useMemo(() => {
    if (!country) return [];
    const countryRecord = resolveCountry(country);
    const indexed = jobs
      .filter((job) => normalizeCountryLabel(job.country, job.location)?.toLowerCase() === country.toLowerCase())
      .map((job) => job.location)
      .filter((value) => Boolean(value) && value.length < 80);
    const subdivisions = countryRecord
      ? SUBDIVISIONS.filter((subdivision) => subdivision.countryCode === countryRecord.code).map((subdivision) => subdivision.name)
      : [];
    return [...new Set([...indexed, ...subdivisions])].sort((a, b) => a.localeCompare(b));
  }, [country, jobs]);

  const discoverJobs = useMemo(() => jobsForActiveSearch(jobs, Boolean(activeSearchSession), activeSearchJobIds), [activeSearchJobIds, activeSearchSession, jobs]);

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedCountry = country.toLowerCase();
    const normalizedLocation = specificLocation.toLowerCase();
    const matches = discoverJobs.filter((job) => {
      const haystack = [job.title, job.company, job.category, job.skills.join(" ")].join(" ").toLowerCase();
      const locationHaystack = [job.location, normalizeCountryLabel(job.country), job.workMode].join(" ").toLowerCase();
      const countryMatches = !normalizedCountry || locationHaystack.includes(normalizedCountry) || /\bworldwide\b|\banywhere\b/.test(locationHaystack);
      const specificMatches = !normalizedLocation || locationHaystack.includes(normalizedLocation);
      const salaryUsdComparable = salaryUsdEquivalent(job, exchangeRates, "min");
      return (
        (!normalizedQuery || haystack.includes(normalizedQuery)) &&
        countryMatches &&
        specificMatches &&
        (filters.maxExperience === null || job.experience === null || job.experience <= filters.maxExperience) &&
        (filters.jobTypes.length === 0 || filters.jobTypes.includes(job.type)) &&
        (filters.workModes.length === 0 || filters.workModes.includes(job.workMode)) &&
        (!filters.noDegree || !job.degreeRequired) &&
        (!filters.visaSupport || job.visaSupport) &&
        (filters.minSalary === 0 || (salaryUsdComparable !== null && salaryUsdComparable >= filters.minSalary)) &&
        (filters.postedWithin === 0 || job.postedDays === null || job.postedDays <= filters.postedWithin) &&
        (view === "saved" ? saved.includes(job.id) : !workspace.dismissedJobIds.includes(job.id))
      );
    });
    return matches.sort((a, b) => {
      if (sort === "newest") return (a.postedDays ?? 999) - (b.postedDays ?? 999);
      if (sort === "salary") return (salaryUsdEquivalent(b, exchangeRates) ?? -1) - (salaryUsdEquivalent(a, exchangeRates) ?? -1);
      return b.score - a.score;
    });
  }, [country, discoverJobs, exchangeRates, filters, query, saved, sort, specificLocation, view, workspace.dismissedJobIds]);

  const sendSearchFeedback = (jobId: string, action: "viewed" | "saved" | "dismissed" | "applied") => {
    const job = jobs.find((candidate) => candidate.id === jobId);
    // Only crawler-reconciled canonical rows exist in persisted sessions;
    // aggregator feed and demo rows must never leak into session feedback.
    if (!activeSearchSession || job?.recordKind !== "canonical") return;
    void fetch("/api/search-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: activeSearchSession.id, job_id: jobId.slice("scout-".length), action }) });
  };

  const toggleSaved = (id: string) => {
    const saving = !saved.includes(id);
    const job = jobs.find((candidate) => candidate.id === id);
    if (job) setWorkspace((current) => saving ? saveJob(current, job) : unsaveJob(current, id));
    if (saving) sendSearchFeedback(id, "saved");
  };

  const advanceApplication = (job: Job) => {
    sendSearchFeedback(job.id, "viewed");
    setWorkspace((current) => rememberView(updateApplication(current, job.id, { stage: current.applications[job.id]?.stage ?? "Preparing", sourceJobStatus: job.lifecycleStatus ?? "unknown" }, current.applications[job.id] ? undefined : "Started preparing this application."), job.id));
    setSelectedJob(job);
  };

  const setApplicationStage = (jobId: string, stage: ApplicationStage) => {
    const mapped = stage === "Interview" ? "Technical interview" : stage === "Closed" ? "Closed before application" : stage;
    setWorkspace((current) => updateApplication(current, jobId, { stage: mapped }));
    if (stage === "Applied") sendSearchFeedback(jobId, "applied");
  };

  const saveDossier = (jobId: string, dossier: CareerDossier) => {
    setDossiers((current) => ({ ...current, [jobId]: dossier }));
    void fetch("/api/application-artifacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, dossier, model: providerConfig.model }),
    }).catch(() => undefined);
  };

  const importScoutJobs = useCallback((imported: Job[]) => {
    setJobs((current) => {
      const merged = mergeImportedJobs(current, imported).slice(0, 600);
      return resumeProfile ? rankJobsLocally(merged, resumeProfile).slice(0, 600) : merged;
    });
    setSourceMeta((current) => ({ ...current, sources: [...new Set([...current.sources, "Local NATS scout"])], fallback: false, sourceStatus: current.failedSources.length ? "partial" as const : "live" as const }));
  }, [resumeProfile]);

  useEffect(() => {
    if (!selectedJob?.descriptionIsPreview || selectedJob.recordKind !== "canonical") return;
    const rawId = selectedJob.id.slice("scout-".length);
    const controller = new AbortController();
    void fetch(`/api/local-scout?action=job&id=${encodeURIComponent(rawId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { job?: ScoutJob } | null) => {
        if (!payload?.job) return;
        const detailed = normalizeScoutJob(payload.job);
        const mergeDetail = (current: Job): Job => ({
          ...detailed,
          score: current.score,
          scoreKind: current.scoreKind,
          reasons: current.reasons,
          gap: current.gap,
          eligibilityStatus: current.eligibilityStatus ?? detailed.eligibilityStatus,
          eligibilityEvidence: current.eligibilityEvidence ?? detailed.eligibilityEvidence,
          descriptionIsPreview: false,
        });
        setSelectedJob((current) => current?.id === detailed.id ? mergeDetail(current) : current);
        setJobs((current) => current.map((job) => job.id === detailed.id ? mergeDetail(job) : job));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selectedJob?.descriptionIsPreview, selectedJob?.id]);

  const executeSearchPlan = async (profile: CandidateProfile, plan: SearchPlan) => {
    setMatchingState("local");
    setMatchMessage(`Searching the full local index with ${plan.roleQueries.length} confirmed quer${plan.roleQueries.length === 1 ? "y" : "ies"}…`);
    const response = await fetch("/api/search-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profile.id, plan_id: plan.id, search_plan: plan }),
    });
    const initialPayload = await response.json() as SearchSessionPayload;
    if (!response.ok || !initialPayload.session || !initialPayload.jobs) throw new Error(initialPayload.error || "The search plan could not be executed.");
    const payload = await fetchRemainingSessionResults(initialPayload);
    const session = payload.session ?? initialPayload.session;
    const imported = (payload.jobs ?? initialPayload.jobs).map(normalizeScoutJob);
    importScoutJobs(imported);
    setActiveSearchJobIds(imported.map((job) => job.id));
    setActiveSearchSession(session);
    setSort("match");
    setSearchSessions((current) => [session, ...current.filter((item) => item.id !== session.id)].slice(0, 30));
    setWorkspace((current) => {
      const strategy = current.strategies.find((item) => item.revisions.some((revision) => revision.plan.id === plan.id)) ?? current.strategies.find((item) => item.name === plan.strategyName);
      let next = strategy ? markStrategyRun(current, strategy.id, session.id, session.started_at) : current;
      next = addNotification(next, { dedupeKey: `search-${session.id}-results`, type: "new_strong_matches", title: `${session.result_count} search results ready`, detail: "Existing indexed matches are available while selected sources continue in the background.", targetView: "discover" });
      return next;
    });
    const coverage = session.coverage;
    const confirmed = (coverage?.eligibility_counts?.confirmed ?? 0) + (coverage?.eligibility_counts?.likely ?? 0);
    const unclear = coverage?.eligibility_counts?.unclear ?? 0;
    setMatchMessage(`Search session found ${session.result_count} roles across ${session.query_count} queries: ${confirmed} geographically eligible and ${unclear} unclear. ${coverage?.successful_sources ?? 0} of ${coverage?.configured_sources ?? 0} configured sources have successful coverage${coverage?.state === "partial" ? "; coverage is partial." : "."}`);
    return imported;
  };

  useEffect(() => {
    const sessionId = activeSearchSession?.id;
    if (!sessionId || !["scanning_sources", "reranking", "normalizing_jobs", "evaluating_eligibility"].includes(activeSearchSession.stage ?? "")) return;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/search-sessions/${sessionId}`, { cache: "no-store" });
        const initialPayload = await response.json() as SearchSessionPayload;
        const payload = response.ok ? await fetchRemainingSessionResults(initialPayload) : initialPayload;
        if (!response.ok || !payload.session) return;
        setActiveSearchSession(payload.session);
        setSearchSessions((current) => [payload.session!, ...current.filter((session) => session.id !== payload.session!.id)].slice(0, 30));
        if (payload.jobs) {
          const refreshedJobs = payload.jobs.map(normalizeScoutJob);
          importScoutJobs(refreshedJobs);
          setActiveSearchJobIds(refreshedJobs.map((job) => job.id));
        }
        if (["completed", "partial"].includes(payload.session.stage ?? "")) {
          setWorkspace((current) => addNotification(current, { dedupeKey: `search-${payload.session!.id}-expansion-${payload.session!.stage}`, type: payload.session!.stage === "partial" ? "coverage_degraded" : "source_expansion_completed", title: payload.session!.stage === "partial" ? "Search coverage is partial" : "Source expansion completed", detail: payload.session!.stage === "partial" ? "Some selected sources could not be checked; existing results remain available." : "Selected sources were checked and the session was reranked.", targetView: "searches" }));
        }
      } catch {
        // Existing indexed results remain usable while progress polling is unavailable.
      }
    };
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [activeSearchSession?.id, activeSearchSession?.stage, importScoutJobs]);

  useEffect(() => {
    if (!workspaceLoaded || !searchSessionsLoaded || activeSearchRestored) return;
    if (activeSearchSession) {
      queueMicrotask(() => setActiveSearchRestored(true));
      return;
    }
    const rememberedSessionId = workspace.strategies.find((strategy) => strategy.status === "active" && strategy.lastSessionId)?.lastSessionId ?? searchSessions[0]?.id;
    if (!rememberedSessionId) {
      queueMicrotask(() => setActiveSearchRestored(true));
      return;
    }
    let cancelled = false;
    fetch(`/api/search-sessions/${rememberedSessionId}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: SearchSessionPayload | null) => payload ? fetchRemainingSessionResults(payload) : null)
      .then((payload: SearchSessionPayload | null) => {
        if (cancelled || !payload?.session || !payload.jobs) return;
        const restoredJobs = payload.jobs.map(normalizeScoutJob);
        importScoutJobs(restoredJobs);
        setActiveSearchJobIds(restoredJobs.map((job) => job.id));
        setActiveSearchSession(payload.session);
        setSort("match");
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setActiveSearchRestored(true); });
    return () => { cancelled = true; };
  }, [activeSearchRestored, activeSearchSession, importScoutJobs, searchSessions, searchSessionsLoaded, workspace.strategies, workspaceLoaded]);

  const runAiMatching = async (resume: ResumeProfile, rankedJobs: Job[], profileRecord = candidateProfile, planRecord = searchPlan) => {
    if (!providerIsConfigured(providerConfig)) return;
    setMatchingState("ai");
    setMatchMessage(`${providerConfig.provider} is ranking the strongest jobs in small, reliable batches…`);
    try {
      const response = await fetch("/api/ai/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...providerConfig, resumeText: resume.text, jobs: rankedJobs.slice(0, 40) }),
      });
      const payload = await response.json() as { profile?: { headline?: string; skills?: string[]; roleQueries?: string[]; experienceLevel?: string; locationHints?: string[] }; matches?: Array<{ id: string; score: number; reasons: string[]; gap: string }>; error?: string; activity?: AiActivity };
      recordAiActivity(currentUser.id, payload.activity);
      if (!response.ok || !payload.matches) throw new Error(payload.error || "AI matching did not return usable results.");
      const matchMap = new Map(payload.matches.map((match) => [match.id, match]));
      setJobs((current) => current.map((job) => {
        const match = matchMap.get(job.id);
        return match ? { ...job, score: match.score, scoreKind: "ai" as const, reasons: match.reasons.length ? match.reasons : job.reasons, gap: match.gap } : job;
      }).sort((a, b) => b.score - a.score).slice(0, 600));
      const enriched = { ...resume, headline: payload.profile?.headline ?? resume.headline, skills: payload.profile?.skills?.length ? payload.profile.skills : resume.skills, suggestedRoles: payload.profile?.roleQueries?.length ? payload.profile.roleQueries : resume.suggestedRoles };
      setResumeProfile(enriched);
      window.sessionStorage.setItem(accountStorageKey(currentUser.id, ACCOUNT_STORAGE_KEYS.resumeSession), JSON.stringify(enriched));
      if (profileRecord && planRecord && payload.profile?.roleQueries?.length) {
        const expandedPlan = { ...planRecord, roleQueries: [...new Set([...planRecord.roleQueries, ...payload.profile.roleQueries])], generatedAt: new Date().toISOString(), confirmedAt: new Date().toISOString() };
        const saveResponse = await fetch("/api/candidate-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile_id: profileRecord.id, plan_id: expandedPlan.id, source_file: profileRecord.sourceFile, profile: profileRecord, search_plan: expandedPlan }) });
        if (saveResponse.ok) {
          setSearchPlan(expandedPlan);
          await executeSearchPlan(profileRecord, expandedPlan);
        }
      }
      setMatchingState("local");
      setMatchMessage(`${providerConfig.provider} reviewed ${payload.matches.length} jobs using résumé evidence and role constraints.`);
    } catch {
      setMatchingState("error");
      setMatchMessage("AI ranking paused before it finished. Your local résumé matches are still available.");
    }
  };

  const applyResume = (resume: ResumeProfile) => {
    const profile = buildCandidateProfile(resume);
    setPendingResume(resume);
    setCandidateProfile(profile);
    setSearchPlan(buildSearchPlan(profile));
    setShowResume(false);
    setShowProfileReview(true);
    setMatchMessage(`Résumé read locally. Review ${resume.skills.length} extracted skills and the proposed searches before anything is saved or sent to a model.`);
  };

  const confirmCandidateProfile = async (profile: CandidateProfile, plan: SearchPlan, resumeOverride?: ResumeProfile | null) => {
    const response = await fetch("/api/candidate-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profile.id, plan_id: plan.id, source_file: profile.sourceFile, profile, search_plan: plan }),
    });
    const payload = await response.json() as { profile_id?: string; plan_id?: string; error?: string };
    if (!response.ok || !payload.profile_id || !payload.plan_id) throw new Error(payload.error || "The candidate profile could not be persisted.");
    const savedProfile = { ...profile, id: payload.profile_id };
    const savedPlan = { ...plan, id: payload.plan_id, profileId: payload.profile_id };
    setCandidateProfile(savedProfile);
    setSearchPlan(savedPlan);
    setShowProfileReview(false);
    setWorkspace((current) => {
      const withStrategy = saveStrategy(current, savedPlan, current.strategies.length ? "edited" : "created", current.strategies[0]?.id);
      return { ...withStrategy, onboarding: { ...withStrategy.onboarding, profile: savedProfile, strategy: savedPlan, completedAt: withStrategy.onboarding.completedAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() } };
    });
    const discovered = await executeSearchPlan(savedProfile, savedPlan);
    const acceptedResume = resumeOverride === undefined ? pendingResume : resumeOverride;
    if (acceptedResume) {
      setResumeProfile(acceptedResume);
      window.sessionStorage.setItem(accountStorageKey(currentUser.id, ACCOUNT_STORAGE_KEYS.resumeSession), JSON.stringify(acceptedResume));
      const ranked = rankJobsLocally(deduplicateJobs([...discovered, ...jobs]), acceptedResume);
      setJobs(ranked.slice(0, 600));
      setSort("match");
      setMatchingState("local");
      setVisibleCount(30);
      setMatchMessage(`Profile confirmed. ${savedPlan.roleQueries.length} role queries are ready; matching now uses the evidence in ${acceptedResume.fileName}.`);
      setPendingResume(null);
    } else {
      setMatchMessage("Candidate profile and search plan updated.");
    }
  };

  const findMyFit = async () => {
    if (!resumeProfile && candidateProfile && searchPlan) {
      await executeSearchPlan(candidateProfile, searchPlan);
      setSort("match");
      setVisibleCount(30);
      return;
    }
    if (!resumeProfile) { setShowResume(true); return; }
    const discovered = candidateProfile && searchPlan ? await executeSearchPlan(candidateProfile, searchPlan) : [];
    const ranked = rankJobsLocally(deduplicateJobs([...discovered, ...jobs]), resumeProfile);
    setJobs(ranked.slice(0, 600));
    setSort("match");
    setVisibleCount(30);
    setMatchingState("local");
    setMatchMessage(`Ranked ${ranked.length} jobs against evidence in ${resumeProfile.fileName}.`);
    setMatchMessage(`Ranked ${ranked.length} jobs locally from confirmed evidence. Optional AI reranking is available only after reviewing its request.`);
  };

  useEffect(() => {
    let cancelled = false;
    let controller = new AbortController();
    const sync = async () => {
      try {
        controller.abort();
        controller = new AbortController();
        const payload = await fetchScoutIndex(new URLSearchParams(), controller.signal);
        if (!payload) return;
        if (!cancelled) {
          setServerIndex({ count: payload.count ?? 0, returned: payload.returned ?? payload.jobs?.length ?? 0, coverage: { sources: payload.coverage?.sources_searched ?? 0, successful: payload.coverage?.sources_successful ?? 0, complete: payload.coverage?.complete ?? false } });
          if (payload.jobs?.length) importScoutJobs(payload.jobs.map(normalizeScoutJob));
        }
      } catch { /* The hosted site has no local scout; public feeds remain active. */ }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 120_000);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); };
  }, [importScoutJobs]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2 && !country) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams();
      if (normalizedQuery.length >= 2) params.set("q", normalizedQuery);
      if (country && country !== "Worldwide") {
        const selectedCountry = resolveCountry(country);
        if (selectedCountry) params.set("country_code", selectedCountry.code);
        else params.set("location", country);
      }
      try {
        const payload = await fetchScoutIndex(params, controller.signal);
        if (!payload) return;
        if (!cancelled) {
          setServerIndex({ count: payload.count ?? 0, returned: payload.returned ?? payload.jobs?.length ?? 0, coverage: { sources: payload.coverage?.sources_searched ?? 0, successful: payload.coverage?.sources_successful ?? 0, complete: payload.coverage?.complete ?? false } });
          if (payload.jobs?.length) importScoutJobs(payload.jobs.map(normalizeScoutJob));
        }
      } catch { /* Keep the already loaded index if the local scout is unavailable. */ }
    }, 450);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [country, importScoutJobs, query]);

  useEffect(() => {
    if (!workspaceLoaded) return;
    const recordVisit = () => {
      if (document.visibilityState === "hidden") setWorkspace((current) => ({ ...current, lastVisitAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    };
    document.addEventListener("visibilitychange", recordVisit);
    return () => document.removeEventListener("visibilitychange", recordVisit);
  }, [workspaceLoaded]);

  useEffect(() => {
    if (!workspaceLoaded) return;
    if (!jobs.some((job) => workspace.savedJobs[job.id] && ["possibly_closed", "closed"].includes(job.lifecycleStatus ?? ""))) return;
    queueMicrotask(() => setWorkspace((current) => syncSavedJobNotifications(current, jobs)));
  }, [jobs, workspace.savedJobs, workspaceLoaded]);

  useEffect(() => {
    if (!workspaceLoaded) return;
    const actionable = Object.values(workspace.applications).filter((application) => !["Rejected", "Withdrawn", "Closed before application"].includes(application.stage));
    if (!actionable.length) return;
    queueMicrotask(() => setWorkspace((current) => syncApplicationNotifications(current, jobs)));
  }, [jobs, workspace.applications, workspace.savedJobs, workspaceLoaded]);

  const openOnboarding = () => {
    setWorkspace((current) => ({ ...current, onboarding: { ...current.onboarding, profile: current.onboarding.profile ?? candidateProfile, strategy: current.onboarding.strategy ?? searchPlan, currentStep: current.onboarding.profile || candidateProfile ? "review-facts" : "welcome", updatedAt: new Date().toISOString() } }));
    setShowOnboarding(true);
  };

  const completeOnboarding = async (profile: CandidateProfile, plan: SearchPlan, resume: ResumeProfile | null) => {
    await confirmCandidateProfile(profile, plan, resume);
    setShowOnboarding(false);
    setView("home");
  };

  const saveStrategyRevision = async (plan: SearchPlan, strategyId?: string) => {
    if (!candidateProfile) return;
    const persistedPlan = { ...plan, id: crypto.randomUUID(), profileId: candidateProfile.id, confirmedAt: new Date().toISOString(), strategyStatus: plan.strategyStatus ?? "active" };
    const response = await fetch("/api/candidate-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile_id: candidateProfile.id, plan_id: persistedPlan.id, source_file: candidateProfile.sourceFile, profile: candidateProfile, search_plan: persistedPlan }) });
    const payload = await response.json() as { plan_id?: string; error?: string };
    if (!response.ok || !payload.plan_id) {
      setMatchMessage(payload.error ?? "The search strategy could not be saved.");
      setMatchingState("error");
      return;
    }
    setSearchPlan(persistedPlan);
    setWorkspace((current) => saveStrategy(current, persistedPlan, "edited", strategyId));
  };

  const rerunStrategy = async (strategy: StrategyRecord) => {
    const revision = strategy.revisions.find((item) => item.id === strategy.activeRevisionId) ?? strategy.revisions.at(-1);
    if (!revision || !candidateProfile) return;
    if (strategy.lastSessionId) {
      const response = await fetch(`/api/search-sessions/${strategy.lastSessionId}/rerun`, { method: "POST" });
      const initialPayload = await response.json() as SearchSessionPayload;
      if (!response.ok || !initialPayload.session) throw new Error(initialPayload.error ?? "The search could not be rerun.");
      const payload = await fetchRemainingSessionResults(initialPayload);
      const session = payload.session ?? initialPayload.session;
      if (payload.jobs?.length) {
        const rerunJobs = payload.jobs.map(normalizeScoutJob);
        importScoutJobs(rerunJobs);
        setActiveSearchJobIds(rerunJobs.map((job) => job.id));
      }
      setActiveSearchSession(session);
      setSort("match");
      setSearchSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      setWorkspace((current) => markStrategyRun(current, strategy.id, session.id, session.started_at));
    } else {
      await executeSearchPlan(candidateProfile, revision.plan);
    }
    setView("discover");
  };

  const openDailyJob = (job: Job) => {
    sendSearchFeedback(job.id, "viewed");
    setWorkspace((current) => rememberView(current, job.id));
    setSelectedJob(job);
  };

  const recordJobFeedback = (jobId: string, reason: FeedbackReason) => {
    const next = addFeedback(workspace, jobId, reason, activeSearchSession?.id ?? null);
    setWorkspace(next);
    setUndoFeedbackNotice({ id: next.feedback[0].id, message: reason === "relevant" ? "Marked relevant." : "Job dismissed. RoleAtlas will suggest, not silently apply, any strategy change." });
    if (reason !== "relevant" && reason !== "already_applied") sendSearchFeedback(jobId, "dismissed");
  };

  const previewAiRanking = () => {
    if (!resumeProfile) { openOnboarding(); return; }
    if (!providerIsConfigured(providerConfig)) { setShowProvider(true); return; }
    const ranked = jobs.slice(0, 40);
    setPendingAiAction({ preview: aiRequestPreview({ provider: providerConfig.provider, model: providerConfig.model, baseUrl: providerConfig.baseUrl, purpose: "Rerank current jobs using resume evidence", dataCategories: ["resume text", "optional candidate constraints", `summaries for ${ranked.length} current jobs`], estimatedInputCharacters: resumeProfile.text.length + ranked.reduce((sum, job) => sum + job.title.length + job.company.length + job.summary.length, 0) + providerConfig.profile.length }), action: () => runAiMatching(resumeProfile, ranked, candidateProfile, searchPlan) });
  };

  const selectView = (next: View) => {
    setView(next);
    setMobileNav(false);
  };

  const homeRestoring = !workspaceLoaded || !profileLoaded || !profileReconciled || !searchSessionsLoaded || !activeSearchRestored;

  return (
    <div className="app-shell">
      <aside ref={mobileNavRef} tabIndex={-1} className={cx("sidebar", mobileNav && "mobile-open")} onTransitionEnd={(event) => { if (mobileNav && event.propertyName === "transform") mobileNavRef.current?.querySelector<HTMLButtonElement>(".mobile-close")?.focus(); }}>
        <div className="brand-row">
          <div className="brand-mark"><SignalGlyph name="atlas" size="sm" /></div>
          <div><strong>RoleAtlas</strong><span>Opportunity signal</span></div>
          <button type="button" className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={18} /></button>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          <span className="nav-label">Workspace</span>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const count = !workspaceLoaded ? undefined : item.id === "home" ? workspace.notifications.filter((notification) => !notification.readAt && !notification.dismissedAt).length : item.id === "saved" ? Object.keys(workspace.savedJobs).length : item.id === "applications" ? Object.values(workspace.applications).filter((application) => !["Saved", "Rejected", "Withdrawn", "Closed before application"].includes(application.stage)).length : undefined;
            return (
              <button type="button" key={item.id} className={cx(view === item.id && "active")} onClick={() => selectView(item.id)}>
                <Icon size={17} /><span>{item.label}</span>{typeof count === "number" && <em>{count}</em>}
              </button>
            );
          })}
        </nav>

        <div className="scout-card">
          <div className="scout-live"><span /> Local discovery services</div>
          <strong>{serviceStatus.scout === "available" ? "Source expansion available" : "Running in reduced mode"}</strong>
          <p>Existing results stay useful while verified sources refresh. Coverage details live in Sources.</p>
          <button type="button" onClick={() => selectView("sources")}>
            <Server size={14} /> View sources and coverage
          </button>
        </div>

      </aside>

      {mobileNav && <button type="button" className="nav-backdrop" aria-label="Dismiss navigation overlay" onClick={() => setMobileNav(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button type="button" className="icon-button menu-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
          <div className="source-status"><span className="live-dot" /> <b>System / index</b> {sourceMeta.sourceStatus === "unavailable" ? "Public sources unavailable" : sourceMeta.sourceStatus === "demo" ? "Explicit demo mode" : sourceMeta.sourceStatus === "partial" ? "Partial live index" : "Live job index"} <span>· {jobs.filter((job) => job.recordKind === "canonical").length} indexed roles{jobs.filter((job) => job.recordKind === "feed").length > 0 ? ` · ${jobs.filter((job) => job.recordKind === "feed").length} feed listings (unverified)` : ""}</span></div>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-button theme-toggle"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button type="button" className={cx("resume-pill", (resumeProfile || candidateProfile) && "ready")} onClick={openOnboarding}><FileText size={15} />{resumeProfile ? resumeProfile.fileName : candidateProfile ? "Profile ready" : "Set up profile"}<span>{resumeProfile ? "Resume evidence" : candidateProfile ? "Manual or structured" : "Resume or manual"}</span></button>
            <button type="button" className="provider-pill" onClick={() => setShowProvider(true)}><Sparkles size={15} />{providerConfig.provider}<span>{verificationIsCurrent(providerConfig) ? "Verified" : providerIsConfigured(providerConfig) ? "Untested" : "Set up"}</span></button>
            <button type="button" className="account-pill" title={`Signed in as ${currentUser.email}`} onClick={() => void authClient.signOut({ fetchOptions: { onSuccess: () => { window.location.assign("/sign-in"); } } })}><span>{currentUser.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || currentUser.email[0].toUpperCase()}</span><span className="account-copy"><strong>{currentUser.name}</strong><small>{currentUser.email}</small></span><LogOut size={15} aria-hidden="true" /></button>
          </div>
        </header>

        {sourceMeta.sourceStatus === "unavailable" && <div className="match-status-bar error" role="status"><div><Server size={16} /></div><p><strong>Public job feeds are temporarily unavailable.</strong> No fictional listings were added. Previously indexed crawler results remain available when the local scout is online.</p></div>}
        {sourceMeta.sourceStatus === "demo" && <div className="match-status-bar" role="status"><div><Database size={16} /></div><p><strong>Development demo mode is enabled.</strong> Demo listings are unverified and excluded from live counts and persistent search sessions.</p></div>}

        {view === "home" ? (
          <HomeWorkspace workspace={workspace} sessions={searchSessions} jobs={discoverJobs} restoring={homeRestoring} onNavigate={selectView} onOpenJob={openDailyJob} onNotification={(id, action) => setWorkspace((current) => updateNotification(current, id, action))} />
        ) : view === "searches" ? (
          <SearchesWorkspace strategies={workspace.strategies} sessions={searchSessions} onSave={(plan, strategyId) => void saveStrategyRevision(plan, strategyId)} onDuplicate={(strategyId) => setWorkspace((current) => duplicateStrategy(current, strategyId))} onStatus={(strategyId, status) => setWorkspace((current) => setStrategyStatus(current, strategyId, status))} onRerun={rerunStrategy} />
        ) : view === "saved" ? (
          <SavedWorkspace workspace={workspace} jobs={jobs} onOpen={openDailyJob} onUnsave={(jobId) => setWorkspace((current) => unsaveJob(current, jobId))} />
        ) : view === "applications" ? (
          <ApplicationsWorkspace workspace={workspace} jobs={jobs} onChange={(jobId, patch, summary) => setWorkspace((current) => updateApplication(current, jobId, patch, summary))} />
        ) : view === "profile" ? (
          <ProfileWorkspace candidate={candidateProfile} plan={searchPlan} onEdit={openOnboarding} onResume={() => setShowResume(true)} />
        ) : view === "sources" ? (
          <SourcesWorkspace />
        ) : view === "settings" ? (
          <SettingsWorkspace provider={providerConfig} onProvider={() => setShowProvider(true)} aiActivities={aiActivities} status={serviceStatus} onRefreshStatus={() => void refreshServiceStatus()} onStartOnboarding={openOnboarding} onResetLearned={() => setWorkspace((current) => resetLearnedPreferences(current))} currentUser={currentUser} />
        ) : (
          <>
            <section className="hero-section signal-discover-hero">
              <div className="hero-copy">
                <span className="eyebrow">Discover / evidence-first index</span>
                <h1>Find the signal.<br /><em>Skip the noise.</em></h1>
                <p>RoleAtlas reads the fine print, keeps unclear eligibility honest, and shows which role deserves your attention next.</p>
              </div>
              <OpportunitySignal count={jobs.length} label="roles ready to evaluate" state={jobs.length > 0 ? "running" : "idle"} />
            </section>

            <section className="search-panel" aria-label="Search jobs">
              <div className="search-field main-search"><Search size={19} /><label><span>Role, skill, interest, or company</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Product design, data, climate, writing…" /></label></div>
              <div className="search-field country-search"><Globe2 size={18} /><div className="search-choice"><span>Country</span><SelectMenu value={country} onChange={(value) => { setCountry(value); setSpecificLocation(""); }} placeholder="Every country" ariaLabel="Country" searchable options={[{ value: "", label: "Every country" }, ...countryOptions.map((option) => ({ value: option, label: option }))]} /></div></div>
              <div className="search-field location-search"><MapPin size={18} /><div className="search-choice"><span>City or region</span><SelectMenu value={specificLocation} disabled={!country} onChange={setSpecificLocation} placeholder={country ? `Anywhere in ${country}` : "Choose country first"} ariaLabel="City or region" searchable options={[{ value: "", label: country ? `Anywhere in ${country}` : "Choose country first" }, ...locationOptions.map((option) => ({ value: option, label: option }))]} /></div></div>
              <button type="button" className="search-submit" onClick={findMyFit} disabled={matchingState === "ai"}>{matchingState === "ai" ? "Ranking jobs…" : resumeProfile || (candidateProfile && searchPlan) ? "Update matches" : "Find matches"}<ArrowRight size={16} /></button>
            </section>

            {(matchingState === "ai" || matchingState === "error" || (matchingState === "local" && Boolean(resumeProfile))) && <div className={cx("match-status-bar", matchingState === "error" && "error")}>
              <div>{matchingState === "ai" ? <Sparkles size={16} /> : <FileText size={16} />}</div>
              <p>{matchMessage}</p>
              {matchingState === "error" && <button type="button" onClick={findMyFit}>Try again<ArrowRight size={13} /></button>}
              {matchingState === "local" && resumeProfile && <button type="button" onClick={previewAiRanking}>{providerIsConfigured(providerConfig) ? "Preview optional AI reranking" : "Connect optional AI"}<Sparkles size={13} /></button>}
            </div>}

            {activeSearchSession && <div className="source-expansion-status" role="status">
              <div><Radar size={16} /><span className="eyebrow">Search coverage</span></div>
              <strong>{activeSearchSession.stage === "scanning_sources" ? "Refreshing verified sources in the background" : activeSearchSession.stage === "reranking" ? "New jobs indexed · reranking now" : activeSearchSession.stage === "partial" ? "Indexed results ready · some source checks deferred" : "Indexed results and selected source checks ready"}</strong>
              <p>{activeSearchSession.result_count} eligible indexed roles are available now. {activeSearchSession.coverage?.selected_sources ?? 0} verified sources selected · {activeSearchSession.coverage?.successful_sources ?? 0} checked successfully · {(activeSearchSession.coverage?.source_selection?.states?.queued ?? 0) + (activeSearchSession.coverage?.source_selection?.states?.scanning ?? 0)} still scanning. This is checked-source coverage, not the whole job market.</p>
            </div>}

            <div className="active-filter-row">
              <button type="button" className="mobile-filter-button" onClick={() => setShowFilters(true)}><Filter size={15} /> Filters</button>
              {filters.maxExperience !== null && <span><Check size={13} /> 0–{filters.maxExperience} years</span>}
              {filters.jobTypes.length > 0 && <span><Check size={13} /> {filters.jobTypes.length} role types</span>}
              {filters.workModes.length > 0 && <span><Check size={13} /> {filters.workModes.join(" + ")}</span>}
              {filters.noDegree && <span><Check size={13} /> Education not required</span>}
              {filters.visaSupport && <span><Check size={13} /> Visa support</span>}
              {filters.postedWithin > 0 && <span><Check size={13} /> Posted within {filters.postedWithin} days</span>}
              {country && <span><MapPin size={13} /> {specificLocation || country}</span>}
              {filters.maxExperience === null && filters.jobTypes.length === 0 && filters.workModes.length === 0 && !filters.noDegree && !filters.visaSupport && filters.postedWithin === 0 && !country && <span className="neutral-filter">No filters selected</span>}
            </div>

            <div className="dashboard-grid">
              <FilterPanel jobs={discoverJobs} filters={filters} setFilters={setFilters} />

              <section className="results-panel">
                <div className="results-head">
                  <div><span className="eyebrow">{resumeProfile ? "Ranked from your résumé" : candidateProfile ? "Ranked from your confirmed profile" : "Live opportunity index"}</span><h2>{resumeProfile || candidateProfile ? "Your strongest matches" : "Explore open roles"}</h2><p>{filteredJobs.length} loaded matches · showing {Math.min(visibleCount, filteredJobs.length)}{serverIndex ? ` · ${serverIndex.count} matching crawler records · ${serverIndex.coverage.successful}/${serverIndex.coverage.sources} sources healthy` : ` · ${sourceMeta.sources.length} live feeds`}</p></div>
                  <div className="sort-control"><ListFilter size={15} /><SelectMenu compact ariaLabel="Sort jobs" value={sort} onChange={(value) => setSort(value as typeof sort)} placeholder="Sort jobs" options={[{ value: "match", label: "Best fit first" }, { value: "newest", label: "Newest first" }, { value: "salary", label: "Highest salary" }]} /></div>
                </div>
                <div className="job-list">
                  {filteredJobs.slice(0, visibleCount).map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      hasResume={Boolean(resumeProfile)}
                      hasProfile={Boolean(candidateProfile)}
                      saved={saved.includes(job.id)}
                      stage={applications[job.id]}
                      onSave={() => toggleSaved(job.id)}
                      onOpen={() => openDailyJob(job)}
                      onApply={() => advanceApplication(job)}
                      onResume={() => setShowResume(true)}
                      onFeedback={(reason) => recordJobFeedback(job.id, reason)}
                    />
                  ))}
                  {filteredJobs.length === 0 && <EmptyState view={view} reset={() => setFilters(DEFAULT_FILTERS)} coverage={serverIndex?.coverage} />}
                  {filteredJobs.length > visibleCount && <button type="button" className="load-more-button" onClick={() => setVisibleCount((count) => count + 30)}>Show 30 more jobs <span>{filteredJobs.length - visibleCount} remaining</span><ArrowRight size={15} /></button>}
                </div>
              </section>

              <aside className="right-rail">
                <PipelinePanel applications={applications} />
                <section className="utility-card ai-card">
                  <div className="ai-orb"><Sparkles size={18} /></div>
                  <span className="eyebrow">Career Ops agent</span>
                  <h3>One click from listing to interview plan.</h3>
                  <p>Generate the evaluation, truthful résumé rewrite, cover letter, recruiter message, and interview prep as one saved dossier.</p>
                  <button type="button" onClick={() => providerIsConfigured(providerConfig) ? selectView("applications") : setShowProvider(true)}>{providerIsConfigured(providerConfig) ? "Open application pipeline" : `Connect ${providerConfig.provider}`}<ArrowRight size={14} /></button>
                  <div className="ai-provider-line"><span /> {verificationIsCurrent(providerConfig) ? `${providerConfig.provider} verified` : providerIsConfigured(providerConfig) ? `${providerConfig.provider} untested` : "OpenAI-compatible provider layer"}</div>
                </section>
                <section className="utility-card source-card">
                  <div className="utility-head"><div><span className="eyebrow">Source confidence</span><h3>Cleaner than a job board</h3></div><ShieldCheck size={19} /></div>
                  <div className="source-list">
                    <div><span className="source-dot direct" /><span>Indexed listings</span><strong>{jobs.filter((job) => job.recordKind === "canonical").length}</strong></div>
                    <div><span className="source-dot ats" /><span>Feed listings (unverified)</span><strong>{jobs.filter((job) => job.recordKind === "feed").length}</strong></div>
                    <div><span className="source-dot fresh" /><span>Feed status</span><strong>{sourceMeta.sourceStatus === "unavailable" ? "Unavailable" : sourceMeta.sourceStatus === "demo" ? "Demo" : sourceMeta.sourceStatus === "partial" ? "Partial" : "Fresh"}</strong></div>
                  </div>
                  <p className="source-footnote">Indexed crawler jobs are deduplicated, source-linked, and checked before matching. Aggregator feed copies are labeled unverified and never enter saved-search sessions or coverage claims.</p>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>

      {undoFeedbackNotice && <div className="undo-toast" role="status"><span>{undoFeedbackNotice.message}</span><button type="button" onClick={() => { setWorkspace((current) => undoFeedback(current, undoFeedbackNotice.id)); setUndoFeedbackNotice(null); }}>Undo</button><button type="button" aria-label="Dismiss undo message" onClick={() => setUndoFeedbackNotice(null)}><X size={14} /></button></div>}

      {showFilters && (
        <div className="mobile-filter-drawer"><button type="button" className="drawer-screen" aria-label="Close filters" onClick={() => setShowFilters(false)} /><FilterPanel jobs={discoverJobs} filters={filters} setFilters={setFilters} onClose={() => setShowFilters(false)} /></div>
      )}
      {showOnboarding && workspaceLoaded && <OnboardingFlow initialDraft={workspace.onboarding} onDraftChange={(onboarding) => setWorkspace((current) => ({ ...current, onboarding, updatedAt: new Date().toISOString() }))} onComplete={completeOnboarding} onSkip={() => setShowOnboarding(false)} />}
      {showProvider && <ProviderModal userId={currentUser.id} config={providerConfig} setConfig={setProviderConfig} onClose={() => setShowProvider(false)} />}
      {showResume && <ResumeModal onClose={() => setShowResume(false)} onComplete={applyResume} />}
      {showProfileReview && candidateProfile && searchPlan && <ProfileReviewModal profile={candidateProfile} plan={searchPlan} onClose={() => setShowProfileReview(false)} onConfirm={confirmCandidateProfile} />}
      {selectedJob && (
        <JobDrawer
          key={selectedJob.id}
          userId={currentUser.id}
          job={selectedJob}
          hasResume={Boolean(resumeProfile)}
          hasProfile={Boolean(candidateProfile)}
          resume={resumeProfile}
          providerConfig={providerConfig}
          saved={saved.includes(selectedJob.id)}
          stage={applications[selectedJob.id]}
          dossier={dossiers[selectedJob.id]}
          onClose={() => setSelectedJob(null)}
          onSave={() => toggleSaved(selectedJob.id)}
          onDossier={(dossier) => saveDossier(selectedJob.id, dossier)}
          onStageChange={(stage) => setApplicationStage(selectedJob.id, stage)}
          onOpenProvider={() => setShowProvider(true)}
          onConfirmAi={(preview, action) => setPendingAiAction({ preview, action })}
          similarJobs={jobs.filter((job) => job.id !== selectedJob.id && (job.category === selectedJob.category || job.skills.some((skill) => selectedJob.skills.includes(skill)))).slice(0, 3)}
          onOpenSimilar={openDailyJob}
          onResume={() => { setSelectedJob(null); setShowResume(true); }}
        />
      )}
      {pendingAiAction && <AiActionPreviewModal preview={pendingAiAction.preview} onCancel={() => setPendingAiAction(null)} onConfirm={() => { const action = pendingAiAction.action; setPendingAiAction(null); void action(); }} />}
    </div>
  );
}
