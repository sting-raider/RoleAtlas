"use client";

import {
  ArrowRight,
  Activity,
  Bookmark,
  BookmarkCheck,
  BriefcaseBusiness,
  Check,
  ClipboardCheck,
  ChevronDown,
  CircleUserRound,
  Clock3,
  Code2,
  Database,
  ExternalLink,
  FileText,
  Filter,
  GraduationCap,
  Globe2,
  LayoutDashboard,
  Link2,
  ListFilter,
  LocateFixed,
  MapPin,
  Menu,
  Radar,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { deduplicateJobs } from "./jobIdentity";
import { buildCandidateProfile, buildSearchPlan, emptyCandidateMobility, type CandidateProfile, type EvidenceField, type SearchPlan } from "./candidateProfile";
import {
  COUNTRIES,
  REGIONS,
  SUBDIVISIONS,
  countryByCodeValue,
  normalizeGeographicLocation,
  resolveCountry,
} from "../shared/geography";

type View = "discover" | "saved" | "applications" | "profile";

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

const AI_ACTIVITY_KEY = "roleatlas-ai-activity";

function loadAiActivity(): AiActivity[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(AI_ACTIVITY_KEY) ?? "[]") as AiActivity[];
  } catch {
    return [];
  }
}

function recordAiActivity(activity?: AiActivity) {
  if (!activity || typeof window === "undefined") return;
  const next = [activity, ...loadAiActivity().filter((item) => item.id !== activity.id)].slice(0, 25);
  window.localStorage.setItem(AI_ACTIVITY_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("roleatlas-ai-activity", { detail: next }));
}

type ScoutStats = {
  queued: number;
  fetched: number;
  failed: number;
  jobs: number;
};

type ScoutJob = {
  id: string;
  source_url: string;
  source_name: string;
  title: string;
  company: string;
  location: string | null;
  country: string | null;
  remote: boolean;
  geographic_locations?: import("../shared/geography").GeographicLocation[];
  remote_policy?: RemotePolicy;
  eligibility_status?: EligibilityStatus;
  eligibility?: { status: EligibilityStatus; confidence: number; evidence: string[] };
  opportunity_classification?: import("../shared/opportunityTaxonomy").OpportunityClassification;
  employment_type: string | null;
  experience_years: number | null;
  degree_required: boolean | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  date_posted: string | null;
  description: string;
  skills: unknown;
  lifecycle_status: "active" | "possibly_closed" | "closed";
  last_verified_at: string | null;
};

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
  status: string;
  stage?: "searching_index" | "evaluating_geographic_coverage" | "identifying_source_gaps" | "scanning_sources" | "normalizing_jobs" | "evaluating_eligibility" | "reranking" | "completed" | "partial";
  query_count: number;
  result_count: number;
  started_at: string;
  coverage?: { state?: "complete" | "partial" | "expanding" | "checked"; configured_sources?: number; selected_sources?: number; successful_sources?: number; incomplete_sources?: number; index_scope?: string; eligibility_counts?: Partial<Record<EligibilityStatus, number>>; source_selection?: { selected_sources?: number; states?: Record<string, number>; observed_jobs_in_completed_runs?: number; claim?: string } };
};

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
  const employment = raw.employment_type ?? "";
  const experience = raw.experience_years;
  const classifiedType = raw.opportunity_classification?.jobType ?? classifyJobType(raw.title, employment);
  const type: JobType = classifiedType === "Full-time" && experience !== null && experience <= 1 ? "Entry-level" : classifiedType;
  const workMode: WorkMode = raw.remote ? "Remote" : /hybrid/i.test(`${raw.location} ${raw.description.slice(0, 500)}`) ? "Hybrid" : "On-site";
  const skills = Array.isArray(raw.skills) ? raw.skills.filter((item): item is string => typeof item === "string").slice(0, 5) : [];
  const currency = normalizeCurrency(raw.salary_currency);
  const postedDays = raw.date_posted ? Math.max(0, Math.floor((Date.now() - Date.parse(raw.date_posted)) / 86_400_000)) : null;
  const initials = raw.company.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "FR";
  const accent: Job["accent"] = ["mint", "lilac", "coral", "amber"][[...raw.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4] as Job["accent"];
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
    visaSupport: /visa sponsorship|sponsorship available/i.test(raw.description),
    source: raw.source_name || "Local NATS scout",
    url: raw.source_url,
    verified: true,
    score: Math.min(82, 45 + (experience === 0 ? 12 : experience === null ? 5 : experience <= 1 ? 8 : 3) + (raw.remote ? 7 : 2) + (raw.degree_required !== true ? 5 : 0)),
    scoreKind: "estimate",
    accent,
    skills: skills.length ? skills : [workMode, type],
    reasons: [
      experience === null ? "The listing does not state a minimum number of years." : `The crawler extracted an experience signal of ${experience} year${experience === 1 ? "" : "s"} or less.`,
      raw.degree_required === true ? "A degree requirement was detected; check whether equivalent evidence is accepted." : "No mandatory degree requirement was detected.",
      `This listing came directly through your local NATS scout from ${raw.source_name || "the source page"}.`,
    ],
    gap: raw.salary_min ? "Confirm compensation and eligibility details with the employer." : "No salary was extracted, so ask for the range early in the process.",
    summary: raw.description.slice(0, 280) || "Open the original listing for the complete description.",
    description: raw.description,
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
  { id: "discover", label: "Discover", icon: Radar },
  { id: "saved", label: "Saved roles", icon: Bookmark },
  { id: "applications", label: "Applications", icon: BriefcaseBusiness },
  { id: "profile", label: "Career profile", icon: CircleUserRound },
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
  saved,
  stage,
  onSave,
  onOpen,
  onApply,
  onResume,
}: {
  job: Job;
  hasResume: boolean;
  saved: boolean;
  stage?: ApplicationStage;
  onSave: () => void;
  onOpen: () => void;
  onApply: () => void;
  onResume: () => void;
}) {
  return (
    <article className={cx("job-card", `accent-${job.accent}`)}>
      <div className="job-card-main">
        <div className="company-mark">{job.initials}</div>
        <div className="job-copy">
          <div className="job-title-row">
            <div>
              <div className="company-line">
                <span>{job.company}</span>
                {job.verified && <span className="verified"><ShieldCheck size={12} /> Verified source</span>}
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
          </div>

          <div className="why-fit">
            <div className="why-icon"><Sparkles size={14} /></div>
            <div>
              <span>{job.eligibilityStatus ? "Geographic eligibility evidence" : hasResume ? "Why this matches your résumé" : "Preliminary eligibility signal"}</span>
              <p>{job.eligibilityEvidence?.[0] ?? job.reasons[0]}</p>
            </div>
          </div>

          <div className="job-footer">
            <span className="source-label">Found via {job.source}</span>
            <div className="card-actions">
              <button type="button" className="secondary-button small" onClick={onOpen}>See match</button>
              <button type="button" className="primary-button small" onClick={onApply}>
                Prepare<Sparkles size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="job-score">
        {hasResume ? <><MatchRing score={job.score} /><span className="score-label">Résumé match</span><span className="confidence">{job.scoreKind === "ai" ? "AI + evidence" : "Keyword evidence"}</span></> : <button type="button" className="resume-score-cta" onClick={onResume}><FileText size={19} /><strong>Match me</strong><span>Upload résumé</span></button>}
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
      <section className="resume-modal" role="dialog" aria-modal="true" aria-labelledby="resume-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-wrap"><div className="modal-icon mint"><FileText size={20} /></div><div><span className="eyebrow">One-time setup</span><h2 id="resume-title">Let your résumé drive the search</h2></div></div>
          <button type="button" className="icon-button" aria-label="Close résumé upload" onClick={onClose}><X size={19} /></button>
        </div>
        <p className="modal-intro">Upload a text-based PDF. RoleAtlas extracts your skills and evidence, finds relevant role families, and ranks opportunities. A written self-description is optional.</p>
        <label className={cx("resume-dropzone", file && "has-file")}>
          <input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <UploadCloud size={28} />
          <strong>{file ? file.name : "Choose your résumé PDF"}</strong>
          <span>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB · ready to read` : "PDF up to 8 MB · text is processed for this session"}</span>
        </label>
        {error && <p className="resume-error">{error}</p>}
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
      <section className="resume-modal profile-review-modal" role="dialog" aria-modal="true" aria-labelledby="profile-review-title" onMouseDown={(event) => event.stopPropagation()}>
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
        {error && <p className="resume-error">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Review later</button><button type="button" className="primary-button" disabled={saving || values(roles).length === 0} onClick={() => void confirm()}>{saving ? "Saving profile…" : "Confirm and find roles"}<ArrowRight size={15} /></button></div>
      </section>
    </div>
  );
}

function ProviderModal({
  config,
  setConfig,
  onClose,
}: {
  config: ProviderConfig;
  setConfig: (config: ProviderConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config);
  const [status, setStatus] = useState<"idle" | "testing" | "verified" | "failed" | "saved">(verificationIsCurrent(config) ? "verified" : "idle");
  const [message, setMessage] = useState(config.verification?.message ?? "");
  const [activities, setActivities] = useState<AiActivity[]>(loadAiActivity);

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
      recordAiActivity(payload.activity);
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
    setConfig(draft);
    window.localStorage.setItem("roleatlas-ai-provider", JSON.stringify(draft.rememberKey ? draft : { ...draft, apiKey: "" }));
    window.localStorage.removeItem("firstrung-ai-provider");
    setStatus("saved");
    window.setTimeout(onClose, 550);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="provider-title" onMouseDown={(event) => event.stopPropagation()}>
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
        <label className="remember-provider-key"><input type="checkbox" checked={draft.rememberKey ?? false} onChange={(event) => setDraft({ ...draft, rememberKey: event.target.checked })} /><span>Remember this API key in browser storage on this device</span></label>
        <label className="full-field">
          <span>Optional note or hard constraints</span>
          <textarea rows={3} value={draft.profile} onChange={(event) => setDraft({ ...draft, profile: event.target.value })} placeholder="Optional: work authorization, schedule, industries to avoid, or anything the résumé does not explain…" />
        </label>

        <div className="privacy-note">
          <ShieldCheck size={17} />
          <p><strong>AI is optional and separate from crawling.</strong> Your key is sent through this RoleAtlas instance only for a connection test or AI action you trigger, and saved in browser storage only when you choose “Remember.” Search, NATS crawling, and deterministic eligibility work without AI.</p>
        </div>

        <div className="ai-request-preview">
          <div><span className="eyebrow">Request preview</span><strong>{draft.provider} · {draft.model || "No model selected"}</strong><small>{draft.baseUrl || "No endpoint selected"}</small></div>
          <p>Ranking sends résumé text, optional constraints, and up to 40 job summaries. Application preparation sends the résumé, constraints, and one job description. API keys are never written to the activity log.</p>
          {message && <p className={`provider-test-message ${status}`}>{message}</p>}
        </div>

        <div className="ai-activity-log">
          <span className="eyebrow">Recent AI activity on this browser</span>
          {activities.length === 0 ? <p>No model requests recorded yet.</p> : activities.slice(0, 5).map((activity) => <div key={activity.id}><span className={activity.outcome}>{activity.outcome}</span><strong>{activity.action.replaceAll("_", " ")}</strong><small>{activity.provider} · {activity.model} · {new Date(activity.completedAt).toLocaleString()}</small><p>Sent: {activity.dataSent.join(", ")}</p></div>)}
        </div>

        <div className="modal-actions">
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

function ScoutConsole({ onClose, onImport }: { onClose: () => void; onImport: (jobs: Job[]) => void }) {
  const [connection, setConnection] = useState<"checking" | "online" | "offline">("checking");
  const [stats, setStats] = useState<ScoutStats>({ queued: 0, fetched: 0, failed: 0, jobs: 0 });
  const [seedUrl, setSeedUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"seed" | "import" | null>(null);

  const refresh = async () => {
    try {
      const [healthResponse, statsResponse] = await Promise.all([
        fetch("/api/local-scout?action=health", { cache: "no-store" }),
        fetch("/api/local-scout?action=stats", { cache: "no-store" }),
      ]);
      if (!healthResponse.ok || !statsResponse.ok) throw new Error("offline");
      setStats(await statsResponse.json() as ScoutStats);
      setConnection("online");
    } catch {
      setConnection("offline");
    }
  };

  useEffect(() => {
    const firstRefresh = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => { window.clearTimeout(firstRefresh); window.clearInterval(timer); };
  }, []);

  const addSeed = async () => {
    setBusy("seed");
    setMessage("");
    try {
      const response = await fetch("/api/local-scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: seedUrl }),
      });
      const payload = await response.json() as { queued?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "The URL could not be queued.");
      setMessage(payload.queued ? "Careers page queued. The worker will discover job pages from it." : "This page is already in the crawl frontier.");
      setSeedUrl("");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The URL could not be queued.");
    } finally {
      setBusy(null);
    }
  };

  const importJobs = async () => {
    setBusy("import");
    setMessage("");
    try {
      const response = await fetch("/api/local-scout?action=jobs&max_experience=3&no_degree=true&limit=1000", { cache: "no-store" });
      const payload = await response.json() as { jobs?: ScoutJob[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Indexed jobs could not be loaded.");
      const imported = (payload.jobs ?? []).map(normalizeScoutJob);
      onImport(imported);
      setMessage(imported.length ? `${imported.length} crawler job${imported.length === 1 ? "" : "s"} added to Discover.` : "The crawler has not extracted a matching job yet. Try a specific careers or ATS board URL.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Indexed jobs could not be loaded.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="scout-modal" role="dialog" aria-modal="true" aria-labelledby="scout-console-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-wrap">
            <div className="modal-icon mint"><Radar size={20} /></div>
            <div><span className="eyebrow">Local crawler</span><h2 id="scout-console-title">Scout control center</h2></div>
          </div>
          <button type="button" className="icon-button" aria-label="Close scout controls" onClick={onClose}><X size={19} /></button>
        </div>

        <div className={cx("scout-connection", connection)}>
          <span className="connection-dot" />
          <div><strong>{connection === "online" ? "Crawler stack online" : connection === "checking" ? "Checking local services…" : "Crawler stack offline"}</strong><p>{connection === "online" ? "NATS, the worker, coordinator, database, and API are responding." : "Start the complete stack with Docker Compose, then refresh this panel."}</p></div>
          <button type="button" className="icon-button compact" aria-label="Refresh crawler status" onClick={() => void refresh()}><RefreshCw size={15} /></button>
        </div>

        <div className="scout-stat-grid">
          <div><Link2 size={16} /><strong>{stats.queued}</strong><span>Queued pages</span></div>
          <div><Globe2 size={16} /><strong>{stats.fetched}</strong><span>Fetched pages</span></div>
          <div><Database size={16} /><strong>{stats.jobs}</strong><span>Indexed jobs</span></div>
          <div><Activity size={16} /><strong>{stats.failed}</strong><span>Failed pages</span></div>
        </div>

        <section className="seed-section">
          <div><span className="eyebrow">Advanced source override</span><h3>Add another company careers page</h3><p>The NATS scout automatically monitors a maintained catalog of public ATS feeds and career sites every six hours. Add a URL only for a company outside that catalog.</p></div>
          <div className="seed-input-row">
            <input type="url" value={seedUrl} onChange={(event) => setSeedUrl(event.target.value)} placeholder="https://company.com/careers" aria-label="Careers page URL" />
            <button type="button" className="primary-button" disabled={!seedUrl || connection !== "online" || busy === "seed"} onClick={addSeed}>{busy === "seed" ? "Queuing…" : "Queue source"}<ArrowRight size={15} /></button>
          </div>
          <p className="seed-guidance"><ShieldCheck size={14} /> Only add pages whose terms and robots rules allow crawling.</p>
        </section>

        {message && <div className="scout-message">{message}</div>}

        <div className="scout-modal-actions">
          <p>Indexed jobs are loaded into Discover automatically every 30 seconds and remain in PostgreSQL between restarts. This button forces an immediate refresh.</p>
          <button type="button" className="secondary-button" disabled={connection !== "online" || busy === "import"} onClick={importJobs}><Server size={15} />{busy === "import" ? "Loading…" : "Refresh Discover now"}</button>
        </div>
      </section>
    </div>
  );
}

function JobDrawer({
  job,
  hasResume,
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
}: {
  job: Job;
  hasResume: boolean;
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
}) {
  const [activeTab, setActiveTab] = useState<DossierTab>("evaluation");
  const [prepareState, setPrepareState] = useState<"idle" | "loading" | "error">("idle");
  const [prepareError, setPrepareError] = useState("");
  const [copied, setCopied] = useState("");
  const canPrepare = Boolean(providerIsConfigured(providerConfig) && resume);

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
      recordAiActivity(payload.activity);
      if (!response.ok || !payload.dossier) throw new Error(payload.error || "The model could not prepare this application.");
      onDossier(payload.dossier);
      onStageChange("Preparing");
      setPrepareState("idle");
    } catch (error) {
      setPrepareError(error instanceof Error ? error.message : "Application preparation failed.");
      setPrepareState("error");
    }
  };

  const copyText = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1400);
  };

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="job-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onMouseDown={(event) => event.stopPropagation()}>
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

        {hasResume ? <div className="drawer-score-card"><MatchRing score={job.score} /><div><span className="eyebrow">Résumé evidence</span><h3>{job.scoreKind === "ai" ? "AI-assisted evidence match" : "Deterministic résumé match"}</h3><p>This percentage compares evidence in your résumé with this listing. It is not a hiring probability.</p></div></div> : <button type="button" className="drawer-resume-prompt" onClick={onResume}><UploadCloud size={20} /><div><span className="eyebrow">Match not calculated</span><h3>Upload your résumé for an evidence-based score</h3><p>Until then, RoleAtlas shows listings without pretending to know your suitability.</p></div><ArrowRight size={17} /></button>}

        <section className="drawer-section">
          <h3>Why you could qualify</h3>
          <div className="reason-list">
            {job.reasons.map((reason) => <div key={reason}><Check size={15} /><p>{reason}</p></div>)}
          </div>
        </section>
        <section className="drawer-section gap-section">
          <h3>One honest gap</h3>
          <p>{job.gap}</p>
        </section>
        <section className="drawer-section">
          <h3>Skills in this listing</h3>
          <div className="tag-row drawer-tags">{job.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
        </section>

        <section className="drawer-section dossier-section">
          <div className="analysis-heading">
            <div><span className="eyebrow">Career operations</span><h3>{dossier ? "Application workspace" : "Build the full application"}</h3></div>
            <button type="button" className="primary-button compact-action" onClick={prepare} disabled={prepareState === "loading"}>
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

function ApplicationsView({
  jobs,
  applications,
  dossiers,
  onOpen,
}: {
  jobs: Job[];
  applications: Record<string, ApplicationStage>;
  dossiers: Record<string, CareerDossier>;
  onOpen: (job: Job) => void;
}) {
  const stages: ApplicationStage[] = ["Preparing", "Applied", "Interview", "Offer"];
  return (
    <div className="board-view">
      <div className="view-heading">
        <div><span className="eyebrow">Your next moves</span><h1>Application trail</h1><p>Stay intentional. Every role here earned your time.</p></div>
      </div>
      <div className="kanban-board">
        {stages.map((stage) => {
          const stageJobs = Object.entries(applications)
            .filter(([, value]) => value === stage)
            .map(([id]) => jobs.find((job) => job.id === id))
            .filter((job): job is Job => Boolean(job));
          return (
            <section className="kanban-column" key={stage}>
              <div className="kanban-head"><span>{stage}</span><strong>{stageJobs.length}</strong></div>
              {stageJobs.map((job) => (
                <button type="button" className="kanban-card" key={job.id} onClick={() => onOpen(job)}>
                  <div className="company-mark small-mark">{job.initials}</div>
                  <div><span>{job.company}</span><h3>{job.title}</h3><p>{dossiers[job.id] ? `Grade ${dossiers[job.id].grade} · ${dossiers[job.id].verdict}` : `${postedLabel(job.postedDays)} · not prepared yet`}</p></div>
                  <ArrowRight size={15} />
                </button>
              ))}
              {stageJobs.length === 0 && <div className="kanban-empty">Roles will move here when you update their status.</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ProfileView({ openProvider, resume, candidate, plan, sessions, openResume, openReview }: { openProvider: () => void; resume: ResumeProfile | null; candidate: CandidateProfile | null; plan: SearchPlan | null; sessions: SearchSessionSummary[]; openResume: () => void; openReview: () => void }) {
  return (
    <div className="profile-view">
      <div className="view-heading">
        <div><span className="eyebrow">The evidence behind your matches</span><h1>Career profile</h1><p>Your résumé is the primary source. Add a short note only for constraints the document cannot explain.</p></div>
        <button type="button" className="primary-button" onClick={openResume}><UploadCloud size={16} />{resume ? "Replace résumé" : "Upload résumé"}</button>
      </div>
      <div className="profile-grid">
        <section className="profile-card profile-main-card">
          <div className="profile-card-head"><div className="modal-icon mint"><FileText size={20} /></div><div><span className="eyebrow">Primary evidence</span><h2>{resume?.fileName ?? "No résumé uploaded"}</h2></div></div>
          <p>{resume?.headline ?? (resume ? `RoleAtlas extracted ${resume.skills.length} skills and ${resume.suggestedRoles.length} role families from ${resume.totalPages} page${resume.totalPages === 1 ? "" : "s"}.` : "Upload a text-based PDF to activate evidence-based matching and automated role discovery.")}</p>
          <div className="preference-grid">
            <div><span>Confirmed searches</span><strong>{plan?.roleQueries.slice(0, 3).join(" · ") || resume?.suggestedRoles.slice(0, 3).join(" · ") || "Waiting for résumé"}</strong></div>
            <div><span>Location evidence</span><strong>{candidate?.location?.value ?? resume?.location ?? "Not inferred"}</strong></div>
            <div><span>Extracted skills</span><strong>{candidate?.skills.slice(0, 5).map((item) => item.value).join(" · ") || resume?.skills.slice(0, 5).join(" · ") || "Not available"}</strong></div>
            <div><span>Privacy</span><strong>Structured profile persisted; résumé text stays session-only</strong></div>
          </div>
          <button type="button" className="secondary-button" onClick={candidate && plan ? openReview : openResume}><Settings2 size={16} /> {candidate && plan ? "Edit profile and search plan" : "Add résumé"}</button>
        </section>
        <section className="profile-card">
          <div className="profile-card-head"><div className="modal-icon coral"><GraduationCap size={20} /></div><div><span className="eyebrow">Extracted evidence</span><h2>What the matcher can use</h2></div></div>
          <ul className="evidence-list">
            {(candidate?.skills.slice(0, 7) ?? []).map((skill) => <li key={skill.value}><Check size={14} /> {skill.value} · {Math.round(skill.confidence * 100)}%</li>)}
            {!candidate && (resume?.skills.slice(0, 7) ?? []).map((skill) => <li key={skill}><Check size={14} /> {skill}</li>)}
            {!candidate && !resume && <li className="muted"><span /> Upload a résumé to extract evidence</li>}
          </ul>
        </section>
        <section className="profile-card provider-profile-card">
          <div className="profile-card-head"><div className="modal-icon lilac"><Code2 size={20} /></div><div><span className="eyebrow">AI provider</span><h2>Bring your own model</h2></div></div>
          <p>Use NVIDIA NIM, DeepSeek, or another compatible provider for semantic search expansion, batch ranking, requirement interpretation, and application preparation.</p>
          <button type="button" className="secondary-button" onClick={openProvider}>Configure provider<ArrowRight size={15} /></button>
        </section>
        <section className="profile-card">
          <div className="profile-card-head"><div className="modal-icon mint"><Radar size={20} /></div><div><span className="eyebrow">Persistent discovery</span><h2>Search history</h2></div></div>
          <div className="stage-list">{sessions.slice(0, 5).map((session) => <div key={session.id}><span>{new Date(session.started_at).toLocaleString()} · {session.query_count} queries · {session.coverage?.successful_sources ?? 0}/{session.coverage?.configured_sources ?? 0} sources with successful coverage{session.coverage?.state === "partial" ? " · partial" : ""}</span><strong>{session.result_count} roles</strong></div>)}{sessions.length === 0 && <p>No confirmed search session yet.</p>}</div>
        </section>
      </div>
    </div>
  );
}

export default function FirstRungApp({ initialPayload }: { initialPayload: LiveJobsPayload }) {
  const [jobs, setJobs] = useState(initialPayload.jobs);
  const [sourceMeta, setSourceMeta] = useState(() => ({
    sources: initialPayload.sources,
    failedSources: initialPayload.failedSources,
    fetchedAt: initialPayload.fetchedAt,
    fallback: initialPayload.fallback,
    sourceStatus: initialPayload.sourceStatus,
  }));
  const [view, setView] = useState<View>("discover");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [specificLocation, setSpecificLocation] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [saved, setSaved] = useState<string[]>([]);
  const [applications, setApplications] = useState<Record<string, ApplicationStage>>({});
  const [dossiers, setDossiers] = useState<Record<string, CareerDossier>>({});
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showProvider, setShowProvider] = useState(false);
  const [showScout, setShowScout] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [showProfileReview, setShowProfileReview] = useState(false);
  const [resumeProfile, setResumeProfile] = useState<ResumeProfile | null>(null);
  const [pendingResume, setPendingResume] = useState<ResumeProfile | null>(null);
  const [candidateProfile, setCandidateProfile] = useState<CandidateProfile | null>(null);
  const [searchPlan, setSearchPlan] = useState<SearchPlan | null>(null);
  const [matchingState, setMatchingState] = useState<"idle" | "local" | "ai" | "error">("idle");
  const [matchMessage, setMatchMessage] = useState("");
  const [visibleCount, setVisibleCount] = useState(30);
  const [mobileNav, setMobileNav] = useState(false);
  const [sort, setSort] = useState<"match" | "newest" | "salary">("newest");
  const [serverIndex, setServerIndex] = useState<{ count: number; returned: number; coverage: { sources: number; successful: number; complete: boolean } } | null>(null);
  const [searchSessions, setSearchSessions] = useState<SearchSessionSummary[]>([]);
  const [activeSearchSession, setActiveSearchSession] = useState<SearchSessionSummary | null>(null);
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
    queueMicrotask(() => {
      const savedJobs = window.localStorage.getItem("firstrung-saved-jobs");
      const storedProvider = window.localStorage.getItem("roleatlas-ai-provider") ?? window.localStorage.getItem("firstrung-ai-provider");
      const storedApplications = window.localStorage.getItem("firstrung-applications");
      const storedDossiers = window.localStorage.getItem("firstrung-dossiers");
      const storedResume = window.sessionStorage.getItem("firstrung-resume-session");
      if (savedJobs) setSaved(JSON.parse(savedJobs) as string[]);
      if (storedProvider) setProviderConfig((current) => ({ ...current, ...(JSON.parse(storedProvider) as Partial<ProviderConfig>) }));
      if (storedApplications) setApplications(JSON.parse(storedApplications) as Record<string, ApplicationStage>);
      if (storedDossiers) setDossiers(JSON.parse(storedDossiers) as Record<string, CareerDossier>);
      if (storedResume) {
        const parsed = JSON.parse(storedResume) as ResumeProfile;
        setResumeProfile(parsed);
        setJobs((current) => rankJobsLocally(current, parsed));
        setSort("match");
        setMatchingState("local");
      } else {
        window.setTimeout(() => setShowResume(true), 350);
      }
    });
  }, []);

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
    };
    void loadPersistentProfile();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/search-sessions", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { sessions?: SearchSessionSummary[] } | null) => { if (!cancelled && payload?.sessions) setSearchSessions(payload.sessions); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("firstrung-saved-jobs", JSON.stringify(saved));
  }, [saved]);

  useEffect(() => {
    window.localStorage.setItem("firstrung-applications", JSON.stringify(applications));
  }, [applications]);

  useEffect(() => {
    window.localStorage.setItem("firstrung-dossiers", JSON.stringify(dossiers));
  }, [dossiers]);

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

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedCountry = country.toLowerCase();
    const normalizedLocation = specificLocation.toLowerCase();
    const matches = jobs.filter((job) => {
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
        (view !== "saved" || saved.includes(job.id))
      );
    });
    return matches.sort((a, b) => {
      if (sort === "newest") return (a.postedDays ?? 999) - (b.postedDays ?? 999);
      if (sort === "salary") return (salaryUsdEquivalent(b, exchangeRates) ?? -1) - (salaryUsdEquivalent(a, exchangeRates) ?? -1);
      return b.score - a.score;
    });
  }, [country, exchangeRates, filters, jobs, query, saved, sort, specificLocation, view]);

  const sendSearchFeedback = (jobId: string, action: "viewed" | "saved" | "dismissed" | "applied") => {
    if (!activeSearchSession || !jobId.startsWith("scout-")) return;
    void fetch("/api/search-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: activeSearchSession.id, job_id: jobId.slice("scout-".length), action }) });
  };

  const toggleSaved = (id: string) => {
    const saving = !saved.includes(id);
    setSaved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    if (saving) sendSearchFeedback(id, "saved");
  };

  const advanceApplication = (job: Job) => {
    sendSearchFeedback(job.id, "viewed");
    setSelectedJob(job);
  };

  const setApplicationStage = (jobId: string, stage: ApplicationStage) => {
    setApplications((current) => ({ ...current, [jobId]: stage }));
    if (stage === "Applied") sendSearchFeedback(jobId, "applied");
  };

  const saveDossier = (jobId: string, dossier: CareerDossier) => {
    setDossiers((current) => ({ ...current, [jobId]: dossier }));
  };

  const importScoutJobs = useCallback((imported: Job[]) => {
    setJobs((current) => {
      const merged = deduplicateJobs([...imported, ...current]);
      return resumeProfile ? rankJobsLocally(merged, resumeProfile) : merged;
    });
    setSourceMeta((current) => ({ ...current, sources: [...new Set([...current.sources, "Local NATS scout"])], fallback: false, sourceStatus: current.failedSources.length ? "partial" as const : "live" as const }));
  }, [resumeProfile]);

  const executeSearchPlan = async (profile: CandidateProfile, plan: SearchPlan) => {
    setMatchingState("local");
    setMatchMessage(`Searching the full local index with ${plan.roleQueries.length} confirmed quer${plan.roleQueries.length === 1 ? "y" : "ies"}…`);
    const response = await fetch("/api/search-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profile.id, plan_id: plan.id, search_plan: plan }),
    });
    const payload = await response.json() as { session?: SearchSessionSummary; jobs?: ScoutJob[]; error?: string };
    if (!response.ok || !payload.session || !payload.jobs) throw new Error(payload.error || "The search plan could not be executed.");
    const imported = payload.jobs.map(normalizeScoutJob);
    importScoutJobs(imported);
    setActiveSearchSession(payload.session);
    setSearchSessions((current) => [payload.session!, ...current.filter((session) => session.id !== payload.session!.id)].slice(0, 30));
    const coverage = payload.session.coverage;
    const confirmed = (coverage?.eligibility_counts?.confirmed ?? 0) + (coverage?.eligibility_counts?.likely ?? 0);
    const unclear = coverage?.eligibility_counts?.unclear ?? 0;
    setMatchMessage(`Search session found ${payload.session.result_count} roles across ${payload.session.query_count} queries: ${confirmed} geographically eligible and ${unclear} unclear. ${coverage?.successful_sources ?? 0} of ${coverage?.configured_sources ?? 0} configured sources have successful coverage${coverage?.state === "partial" ? "; coverage is partial." : "."}`);
    return imported;
  };

  useEffect(() => {
    const sessionId = activeSearchSession?.id;
    if (!sessionId || !["scanning_sources", "reranking", "normalizing_jobs", "evaluating_eligibility"].includes(activeSearchSession.stage ?? "")) return;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/search-sessions/${sessionId}`, { cache: "no-store" });
        const payload = await response.json() as { session?: SearchSessionSummary; jobs?: ScoutJob[] };
        if (!response.ok || !payload.session) return;
        setActiveSearchSession(payload.session);
        setSearchSessions((current) => [payload.session!, ...current.filter((session) => session.id !== payload.session!.id)].slice(0, 30));
        if (payload.jobs?.length) importScoutJobs(payload.jobs.map(normalizeScoutJob));
      } catch {
        // Existing indexed results remain usable while progress polling is unavailable.
      }
    };
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [activeSearchSession?.id, activeSearchSession?.stage, importScoutJobs]);

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
      recordAiActivity(payload.activity);
      if (!response.ok || !payload.matches) throw new Error(payload.error || "AI matching did not return usable results.");
      const matchMap = new Map(payload.matches.map((match) => [match.id, match]));
      setJobs((current) => current.map((job) => {
        const match = matchMap.get(job.id);
        return match ? { ...job, score: match.score, scoreKind: "ai" as const, reasons: match.reasons.length ? match.reasons : job.reasons, gap: match.gap } : job;
      }).sort((a, b) => b.score - a.score));
      const enriched = { ...resume, headline: payload.profile?.headline ?? resume.headline, skills: payload.profile?.skills?.length ? payload.profile.skills : resume.skills, suggestedRoles: payload.profile?.roleQueries?.length ? payload.profile.roleQueries : resume.suggestedRoles };
      setResumeProfile(enriched);
      window.sessionStorage.setItem("firstrung-resume-session", JSON.stringify(enriched));
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

  const confirmCandidateProfile = async (profile: CandidateProfile, plan: SearchPlan) => {
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
    const discovered = await executeSearchPlan(savedProfile, savedPlan);
    if (pendingResume) {
      setResumeProfile(pendingResume);
      window.sessionStorage.setItem("firstrung-resume-session", JSON.stringify(pendingResume));
      const ranked = rankJobsLocally(deduplicateJobs([...discovered, ...jobs]), pendingResume);
      setJobs(ranked);
      setSort("match");
      setMatchingState("local");
      setVisibleCount(30);
      setMatchMessage(`Profile confirmed. ${savedPlan.roleQueries.length} role queries are ready; matching now uses the evidence in ${pendingResume.fileName}.`);
      void runAiMatching(pendingResume, ranked, savedProfile, savedPlan);
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
    setJobs(ranked);
    setSort("match");
    setVisibleCount(30);
    setMatchingState("local");
    setMatchMessage(`Ranked ${ranked.length} jobs against evidence in ${resumeProfile.fileName}.`);
    void runAiMatching(resumeProfile, ranked, candidateProfile, searchPlan);
  };

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const response = await fetch("/api/local-scout?action=jobs&limit=400", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { jobs?: ScoutJob[]; count?: number; returned?: number; coverage?: { sources_searched: number; sources_successful: number; complete: boolean } };
        if (!cancelled) {
          setServerIndex({ count: payload.count ?? 0, returned: payload.returned ?? payload.jobs?.length ?? 0, coverage: { sources: payload.coverage?.sources_searched ?? 0, successful: payload.coverage?.sources_successful ?? 0, complete: payload.coverage?.complete ?? false } });
          if (payload.jobs?.length) importScoutJobs(payload.jobs.map(normalizeScoutJob));
        }
      } catch { /* The hosted site has no local scout; public feeds remain active. */ }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [importScoutJobs]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2 && !country) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ action: "jobs", limit: "400" });
      if (normalizedQuery.length >= 2) params.set("q", normalizedQuery);
      if (country && country !== "Worldwide") params.set("location", country);
      try {
        const response = await fetch(`/api/local-scout?${params.toString()}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { jobs?: ScoutJob[]; count?: number; returned?: number; coverage?: { sources_searched: number; sources_successful: number; complete: boolean } };
        if (!cancelled) {
          setServerIndex({ count: payload.count ?? 0, returned: payload.returned ?? payload.jobs?.length ?? 0, coverage: { sources: payload.coverage?.sources_searched ?? 0, successful: payload.coverage?.sources_successful ?? 0, complete: payload.coverage?.complete ?? false } });
          if (payload.jobs?.length) importScoutJobs(payload.jobs.map(normalizeScoutJob));
        }
      } catch { /* Keep the already loaded index if the local scout is unavailable. */ }
    }, 450);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [country, importScoutJobs, query]);

  const selectView = (next: View) => {
    setView(next);
    setMobileNav(false);
  };

  return (
    <div className="app-shell">
      <aside className={cx("sidebar", mobileNav && "mobile-open")}>
        <div className="brand-row">
          <div className="brand-mark">F</div>
          <div><strong>RoleAtlas</strong><span>Career discovery agent</span></div>
          <button type="button" className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={18} /></button>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          <span className="nav-label">Workspace</span>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const count = item.id === "saved" ? saved.length : item.id === "applications" ? Object.values(applications).filter((stage) => stage !== "Closed" && stage !== "Saved").length : undefined;
            return (
              <button type="button" key={item.id} className={cx(view === item.id && "active")} onClick={() => selectView(item.id)}>
                <Icon size={17} /><span>{item.label}</span>{typeof count === "number" && <em>{count}</em>}
              </button>
            );
          })}
        </nav>

        <div className="scout-card">
          <div className="scout-live"><span /> Automated local scout</div>
          <strong>NATS scout is always on</strong>
          <p>Public ATS feeds and company sites refresh in the background. No manual crawl is required.</p>
          <button type="button" onClick={() => setShowScout(true)}>
            <Server size={14} /> View crawl health
          </button>
        </div>

      </aside>

      {mobileNav && <button type="button" className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button type="button" className="icon-button menu-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
          <div className="source-status"><span className="live-dot" /> {sourceMeta.sourceStatus === "unavailable" ? "Public sources unavailable" : sourceMeta.sourceStatus === "demo" ? "Explicit demo mode" : sourceMeta.sourceStatus === "partial" ? "Partial live index" : "Live job index"} <span>· {jobs.filter((job) => !job.isDemo).length} live roles</span></div>
          <div className="topbar-actions">
            <button type="button" className={cx("resume-pill", resumeProfile && "ready")} onClick={() => setShowResume(true)}><FileText size={15} />{resumeProfile ? resumeProfile.fileName : "Add résumé"}<span>{resumeProfile ? "Ready" : "Required for matching"}</span></button>
            <button type="button" className="provider-pill" onClick={() => setShowProvider(true)}><Sparkles size={15} />{providerConfig.provider}<span>{verificationIsCurrent(providerConfig) ? "Verified" : providerIsConfigured(providerConfig) ? "Untested" : "Set up"}</span></button>
          </div>
        </header>

        {sourceMeta.sourceStatus === "unavailable" && <div className="match-status-bar error" role="status"><div><Server size={16} /></div><p><strong>Public job feeds are temporarily unavailable.</strong> No fictional listings were added. Previously indexed crawler results remain available when the local scout is online.</p></div>}
        {sourceMeta.sourceStatus === "demo" && <div className="match-status-bar" role="status"><div><Database size={16} /></div><p><strong>Development demo mode is enabled.</strong> Demo listings are unverified and excluded from live counts and persistent search sessions.</p></div>}

        {view === "applications" ? (
          <ApplicationsView jobs={jobs} applications={applications} dossiers={dossiers} onOpen={setSelectedJob} />
        ) : view === "profile" ? (
          <ProfileView openProvider={() => setShowProvider(true)} resume={resumeProfile} candidate={candidateProfile} plan={searchPlan} sessions={searchSessions} openResume={() => setShowResume(true)} openReview={() => setShowProfileReview(true)} />
        ) : (
          <>
            <section className="hero-section">
              <div className="hero-copy">
                <span className="eyebrow">Your opportunity radar</span>
                <h1>Good jobs shouldn’t hide behind <em>experience you don’t have.</em></h1>
                <p>RoleAtlas reads the fine print, removes fake entry barriers, and shows why a role is worth your time.</p>
              </div>
              <div className="hero-stat"><strong>{jobs.length}</strong><span>live roles ready to evaluate</span></div>
            </section>

            <section className="search-panel" aria-label="Search jobs">
              <div className="search-field main-search"><Search size={19} /><label><span>Role, skill, interest, or company</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Product design, data, climate, writing…" /></label></div>
              <div className="search-field country-search"><Globe2 size={18} /><div className="search-choice"><span>Country</span><SelectMenu value={country} onChange={(value) => { setCountry(value); setSpecificLocation(""); }} placeholder="Every country" ariaLabel="Country" searchable options={[{ value: "", label: "Every country" }, ...countryOptions.map((option) => ({ value: option, label: option }))]} /></div></div>
              <div className="search-field location-search"><MapPin size={18} /><div className="search-choice"><span>City or region</span><SelectMenu value={specificLocation} disabled={!country} onChange={setSpecificLocation} placeholder={country ? `Anywhere in ${country}` : "Choose country first"} ariaLabel="City or region" searchable options={[{ value: "", label: country ? `Anywhere in ${country}` : "Choose country first" }, ...locationOptions.map((option) => ({ value: option, label: option }))]} /></div></div>
              <button type="button" className="search-submit" onClick={findMyFit} disabled={matchingState === "ai"}>{matchingState === "ai" ? "Ranking jobs…" : resumeProfile || (candidateProfile && searchPlan) ? "Update matches" : "Find matches"}<ArrowRight size={16} /></button>
            </section>

            {(matchingState === "ai" || matchingState === "error") && <div className={cx("match-status-bar", matchingState === "error" && "error")}>
              <div>{matchingState === "ai" ? <Sparkles size={16} /> : <FileText size={16} />}</div>
              <p>{matchMessage}</p>
              {matchingState === "error" && <button type="button" onClick={findMyFit}>Try again<ArrowRight size={13} /></button>}
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
              <FilterPanel jobs={jobs} filters={filters} setFilters={setFilters} />

              <section className="results-panel">
                <div className="results-head">
                  <div><span className="eyebrow">{view === "saved" ? "Your shortlist" : resumeProfile ? "Ranked from your résumé" : "Live opportunity index"}</span><h2>{view === "saved" ? "Saved roles" : resumeProfile ? "Your strongest matches" : "Explore open roles"}</h2><p>{filteredJobs.length} loaded matches · showing {Math.min(visibleCount, filteredJobs.length)}{serverIndex ? ` · ${serverIndex.count} matching crawler records · ${serverIndex.coverage.successful}/${serverIndex.coverage.sources} sources healthy` : ` · ${sourceMeta.sources.length} live feeds`}</p></div>
                  <div className="sort-control"><ListFilter size={15} /><SelectMenu compact ariaLabel="Sort jobs" value={sort} onChange={(value) => setSort(value as typeof sort)} placeholder="Sort jobs" options={[{ value: "match", label: "Best fit first" }, { value: "newest", label: "Newest first" }, { value: "salary", label: "Highest salary" }]} /></div>
                </div>
                <div className="job-list">
                  {filteredJobs.slice(0, visibleCount).map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      hasResume={Boolean(resumeProfile)}
                      saved={saved.includes(job.id)}
                      stage={applications[job.id]}
                      onSave={() => toggleSaved(job.id)}
                      onOpen={() => { sendSearchFeedback(job.id, "viewed"); setSelectedJob(job); }}
                      onApply={() => advanceApplication(job)}
                      onResume={() => setShowResume(true)}
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
                    <div><span className="source-dot direct" /><span>Live listings</span><strong>{jobs.length}</strong></div>
                    <div><span className="source-dot ats" /><span>Active feeds</span><strong>{sourceMeta.sources.length}</strong></div>
                    <div><span className="source-dot fresh" /><span>Feed status</span><strong>{sourceMeta.sourceStatus === "unavailable" ? "Unavailable" : sourceMeta.sourceStatus === "demo" ? "Demo" : sourceMeta.sourceStatus === "partial" ? "Partial" : "Fresh"}</strong></div>
                  </div>
                  <p className="source-footnote">Crawler jobs are deduplicated, source-linked, and checked for stated experience, education, work mode, and expiry metadata before matching.</p>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>

      {showFilters && (
        <div className="mobile-filter-drawer"><button type="button" className="drawer-screen" aria-label="Close filters" onClick={() => setShowFilters(false)} /><FilterPanel jobs={jobs} filters={filters} setFilters={setFilters} onClose={() => setShowFilters(false)} /></div>
      )}
      {showProvider && <ProviderModal config={providerConfig} setConfig={setProviderConfig} onClose={() => setShowProvider(false)} />}
      {showResume && <ResumeModal onClose={() => setShowResume(false)} onComplete={applyResume} />}
      {showProfileReview && candidateProfile && searchPlan && <ProfileReviewModal profile={candidateProfile} plan={searchPlan} onClose={() => setShowProfileReview(false)} onConfirm={confirmCandidateProfile} />}
      {showScout && <ScoutConsole onClose={() => setShowScout(false)} onImport={importScoutJobs} />}
      {selectedJob && (
        <JobDrawer
          key={selectedJob.id}
          job={selectedJob}
          hasResume={Boolean(resumeProfile)}
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
          onResume={() => { setSelectedJob(null); setShowResume(true); }}
        />
      )}
    </div>
  );
}
