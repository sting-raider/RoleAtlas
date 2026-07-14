"use client";

import {
  ArrowRight,
  Bell,
  Bookmark,
  BookmarkCheck,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleUserRound,
  Clock3,
  Code2,
  ExternalLink,
  Filter,
  GraduationCap,
  HeartHandshake,
  LayoutDashboard,
  ListFilter,
  LocateFixed,
  MapPin,
  Menu,
  MessageCircleMore,
  Radar,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  JOBS,
  PROVIDERS,
  type ApplicationStage,
  type Job,
  type JobType,
  type ProviderName,
  type WorkMode,
} from "./jobs";

type View = "discover" | "saved" | "applications" | "profile";

type Filters = {
  maxExperience: number;
  jobTypes: JobType[];
  workModes: WorkMode[];
  noDegree: boolean;
  visaSupport: boolean;
  minSalary: number;
  postedWithin: number;
};

type ProviderConfig = {
  provider: ProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
};

const DEFAULT_FILTERS: Filters = {
  maxExperience: 1,
  jobTypes: ["Internship", "Entry-level", "Apprenticeship"],
  workModes: ["Remote", "Hybrid"],
  noDegree: true,
  visaSupport: false,
  minSalary: 0,
  postedWithin: 7,
};

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

const APPLICATION_SEED: Record<string, ApplicationStage> = {
  "sparrow-growth-intern": "Applied",
  "northmetric-data-ops": "Interview",
  "civicthread-research": "Preparing",
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatSalary(job: Job) {
  const compact = new Intl.NumberFormat("en", {
    style: "currency",
    currency: job.currency,
    notation: "compact",
    maximumFractionDigits: job.currency === "INR" ? 1 : 0,
  });
  return `${compact.format(job.salaryMin)}–${compact.format(job.salaryMax)}/${
    job.salaryPeriod === "year" ? "yr" : "mo"
  }`;
}

function postedLabel(days: number) {
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
  filters,
  setFilters,
  onClose,
}: {
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
          {[0, 1, 2, 3].map((value) => (
            <button
              type="button"
              key={value}
              className={filters.maxExperience === value ? "active" : ""}
              onClick={() => setFilters({ ...filters, maxExperience: value })}
            >
              {value === 3 ? "3+" : value}
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
        {(["Internship", "Entry-level", "Apprenticeship", "Contract"] as JobType[]).map((type) => (
          <Checkbox
            key={type}
            label={type}
            count={JOBS.filter((job) => job.type === type).length}
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
            count={JOBS.filter((job) => job.workMode === mode).length}
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
          count={JOBS.filter((job) => !job.degreeRequired).length}
          checked={filters.noDegree}
          onChange={() => setFilters({ ...filters, noDegree: !filters.noDegree })}
        />
        <Checkbox
          label="Visa support stated"
          count={JOBS.filter((job) => job.visaSupport).length}
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
        <label className="filter-label" htmlFor="posted-within">Posted within</label>
        <div className="select-wrap">
          <select
            id="posted-within"
            value={filters.postedWithin}
            onChange={(event) => setFilters({ ...filters, postedWithin: Number(event.target.value) })}
          >
            <option value={1}>24 hours</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
          <ChevronDown size={15} />
        </div>
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

function JobCard({
  job,
  saved,
  stage,
  onSave,
  onOpen,
  onApply,
}: {
  job: Job;
  saved: boolean;
  stage?: ApplicationStage;
  onSave: () => void;
  onOpen: () => void;
  onApply: () => void;
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
            {!job.degreeRequired && <span>No degree needed</span>}
            {job.visaSupport && <span>Visa support</span>}
          </div>

          <div className="why-fit">
            <div className="why-icon"><Sparkles size={14} /></div>
            <div>
              <span>Why this could fit</span>
              <p>{job.reasons[0]}</p>
            </div>
          </div>

          <div className="job-footer">
            <span className="source-label">Found via {job.source}</span>
            <div className="card-actions">
              <button type="button" className="secondary-button small" onClick={onOpen}>See match</button>
              <button type="button" className="primary-button small" onClick={onApply}>
                {stage ? stage : "Prepare"}<ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="job-score">
        <MatchRing score={job.score} />
        <span className="score-label">Suitability</span>
        <span className="confidence">High confidence</span>
      </div>
    </article>
  );
}

function EmptyState({ view, reset }: { view: View; reset: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Search size={24} /></div>
      <h3>{view === "saved" ? "No saved roles match these filters" : "No strong matches yet"}</h3>
      <p>Broaden one or two filters and FirstRung will show you the closest honest fits.</p>
      <button type="button" className="secondary-button" onClick={reset}>Reset filters</button>
    </div>
  );
}

function PipelinePanel({ applications }: { applications: Record<string, ApplicationStage> }) {
  const stages: ApplicationStage[] = ["Saved", "Preparing", "Applied", "Interview"];
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
        <strong>{Object.keys(applications).length}</strong>
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
  const [status, setStatus] = useState<"idle" | "ready" | "saved">("idle");

  const updateProvider = (provider: ProviderName) => {
    const defaults = PROVIDERS[provider];
    setDraft({ ...draft, provider, baseUrl: defaults.baseUrl, model: defaults.model });
    setStatus("idle");
  };

  const validate = () => {
    setStatus(draft.baseUrl && draft.model && (draft.apiKey || draft.provider === "Ollama") ? "ready" : "idle");
  };

  const save = () => {
    setConfig(draft);
    window.localStorage.setItem("firstrung-ai-provider", JSON.stringify(draft));
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
        <p className="modal-intro">Use AI to decode vague requirements, explain fit, and tailor a truthful application. FirstRung stays provider-neutral.</p>

        <div className="provider-grid">
          <label>
            <span>Provider</span>
            <div className="select-wrap field-select">
              <select value={draft.provider} onChange={(event) => updateProvider(event.target.value as ProviderName)}>
                {Object.keys(PROVIDERS).map((provider) => <option key={provider}>{provider}</option>)}
              </select>
              <ChevronDown size={15} />
            </div>
          </label>
          <label>
            <span>Model</span>
            <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="Model name" />
          </label>
        </div>
        <label className="full-field">
          <span>API base URL</span>
          <input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
        </label>
        <label className="full-field">
          <span>API key</span>
          <input type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={draft.provider === "Ollama" ? "Not required for local Ollama" : "Paste your key"} />
        </label>

        <div className="privacy-note">
          <ShieldCheck size={17} />
          <p><strong>Local by default.</strong> This prototype stores your configuration only in this browser. The key is never included in job listings or crawler messages.</p>
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={validate}>
            {status === "ready" ? <><Check size={15} /> Configuration ready</> : "Check configuration"}
          </button>
          <button type="button" className="primary-button" onClick={save} disabled={!draft.baseUrl || !draft.model}>
            {status === "saved" ? <><Check size={15} /> Saved</> : "Save provider"}
          </button>
        </div>
      </section>
    </div>
  );
}

function JobDrawer({
  job,
  saved,
  stage,
  onClose,
  onSave,
  onApply,
}: {
  job: Job;
  saved: boolean;
  stage?: ApplicationStage;
  onClose: () => void;
  onSave: () => void;
  onApply: () => void;
}) {
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
        </div>
        <p className="drawer-summary">{job.summary}</p>

        <div className="drawer-score-card">
          <MatchRing score={job.score} />
          <div><span className="eyebrow">Fit, explained</span><h3>A strong first-rung match</h3><p>We found evidence for the important requirements and separated genuine blockers from wish-list language.</p></div>
        </div>

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

        <div className="drawer-actions">
          <button type="button" className={cx("secondary-button", saved && "is-saved")} onClick={onSave}>
            {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}{saved ? "Saved" : "Save role"}
          </button>
          <button type="button" className="primary-button" onClick={onApply}>{stage ?? "Prepare application"}<ArrowRight size={15} /></button>
        </div>
      </aside>
    </div>
  );
}

function ApplicationsView({
  applications,
  onOpen,
}: {
  applications: Record<string, ApplicationStage>;
  onOpen: (job: Job) => void;
}) {
  const stages: ApplicationStage[] = ["Preparing", "Applied", "Interview"];
  return (
    <div className="board-view">
      <div className="view-heading">
        <div><span className="eyebrow">Your next moves</span><h1>Application trail</h1><p>Stay intentional. Every role here earned your time.</p></div>
        <button type="button" className="primary-button"><Sparkles size={16} /> Weekly review</button>
      </div>
      <div className="kanban-board">
        {stages.map((stage) => {
          const jobs = Object.entries(applications)
            .filter(([, value]) => value === stage)
            .map(([id]) => JOBS.find((job) => job.id === id))
            .filter((job): job is Job => Boolean(job));
          return (
            <section className="kanban-column" key={stage}>
              <div className="kanban-head"><span>{stage}</span><strong>{jobs.length}</strong></div>
              {jobs.map((job) => (
                <button type="button" className="kanban-card" key={job.id} onClick={() => onOpen(job)}>
                  <div className="company-mark small-mark">{job.initials}</div>
                  <div><span>{job.company}</span><h3>{job.title}</h3><p>{postedLabel(job.postedDays)} · {job.score}% match</p></div>
                  <ArrowRight size={15} />
                </button>
              ))}
              {jobs.length === 0 && <div className="kanban-empty">Roles will move here when you update their status.</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ProfileView({ openProvider }: { openProvider: () => void }) {
  return (
    <div className="profile-view">
      <div className="view-heading">
        <div><span className="eyebrow">The signal behind your matches</span><h1>Career profile</h1><p>Tell FirstRung what counts as a good next step—not just what job title you want.</p></div>
        <button type="button" className="primary-button"><Check size={16} /> Profile 78%</button>
      </div>
      <div className="profile-grid">
        <section className="profile-card profile-main-card">
          <div className="profile-card-head"><div className="modal-icon mint"><Target size={20} /></div><div><span className="eyebrow">North star</span><h2>Your first role should build proof</h2></div></div>
          <p>Prioritize real mentorship, portfolio-worthy outcomes, transparent pay, and work that does not use “entry-level” as a disguise for three years of experience.</p>
          <div className="preference-grid">
            <div><span>Fields</span><strong>Product · Data · Marketing</strong></div>
            <div><span>Experience ceiling</span><strong>0–1 years</strong></div>
            <div><span>Work style</span><strong>Remote or hybrid</strong></div>
            <div><span>Hard boundary</span><strong>No unpaid roles</strong></div>
          </div>
          <button type="button" className="secondary-button"><Settings2 size={16} /> Edit preferences</button>
        </section>
        <section className="profile-card">
          <div className="profile-card-head"><div className="modal-icon coral"><GraduationCap size={20} /></div><div><span className="eyebrow">Evidence bank</span><h2>What already counts</h2></div></div>
          <ul className="evidence-list">
            <li><Check size={14} /> 2 personal projects</li>
            <li><Check size={14} /> Coursework outcomes</li>
            <li><Check size={14} /> Volunteer experience</li>
            <li className="muted"><span /> Add writing or presentation sample</li>
          </ul>
        </section>
        <section className="profile-card provider-profile-card">
          <div className="profile-card-head"><div className="modal-icon lilac"><Code2 size={20} /></div><div><span className="eyebrow">AI provider</span><h2>Bring your own model</h2></div></div>
          <p>DeepSeek, OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, Ollama, or any OpenAI-compatible endpoint.</p>
          <button type="button" className="secondary-button" onClick={openProvider}>Configure provider<ArrowRight size={15} /></button>
        </section>
      </div>
    </div>
  );
}

export default function FirstRungApp() {
  const [view, setView] = useState<View>("discover");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [saved, setSaved] = useState<string[]>(["tandem-product-design", "civicthread-research"]);
  const [applications, setApplications] = useState<Record<string, ApplicationStage>>(APPLICATION_SEED);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showProvider, setShowProvider] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [sort, setSort] = useState<"match" | "newest" | "salary">("match");
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done">("idle");
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({
    provider: "DeepSeek",
    apiKey: "",
    baseUrl: PROVIDERS.DeepSeek.baseUrl,
    model: PROVIDERS.DeepSeek.model,
  });

  useEffect(() => {
    const savedJobs = window.localStorage.getItem("firstrung-saved-jobs");
    const storedProvider = window.localStorage.getItem("firstrung-ai-provider");
    if (savedJobs) setSaved(JSON.parse(savedJobs) as string[]);
    if (storedProvider) setProviderConfig(JSON.parse(storedProvider) as ProviderConfig);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("firstrung-saved-jobs", JSON.stringify(saved));
  }, [saved]);

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLocation = location.trim().toLowerCase();
    const jobs = JOBS.filter((job) => {
      const haystack = [job.title, job.company, job.category, job.skills.join(" ")].join(" ").toLowerCase();
      const locationHaystack = [job.location, job.country, job.workMode].join(" ").toLowerCase();
      const salaryUsdComparable = job.currency === "USD" ? job.salaryMin : job.currency === "GBP" ? job.salaryMin * 1.25 : job.currency === "EUR" ? job.salaryMin * 1.1 : job.salaryMin / 84;
      return (
        (!normalizedQuery || haystack.includes(normalizedQuery)) &&
        (!normalizedLocation || locationHaystack.includes(normalizedLocation)) &&
        job.experience <= filters.maxExperience &&
        filters.jobTypes.includes(job.type) &&
        filters.workModes.includes(job.workMode) &&
        (!filters.noDegree || !job.degreeRequired) &&
        (!filters.visaSupport || job.visaSupport) &&
        salaryUsdComparable >= filters.minSalary &&
        job.postedDays <= filters.postedWithin &&
        (view !== "saved" || saved.includes(job.id))
      );
    });
    return jobs.sort((a, b) => sort === "newest" ? a.postedDays - b.postedDays : sort === "salary" ? b.salaryMax - a.salaryMax : b.score - a.score);
  }, [filters, location, query, saved, sort, view]);

  const toggleSaved = (id: string) => setSaved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const advanceApplication = (job: Job) => {
    const current = applications[job.id];
    const next: ApplicationStage = !current ? "Preparing" : current === "Preparing" ? "Applied" : current === "Applied" ? "Interview" : "Interview";
    setApplications({ ...applications, [job.id]: next });
    setSelectedJob(job);
  };

  const runScan = () => {
    if (scanState === "scanning") return;
    setScanState("scanning");
    window.setTimeout(() => setScanState("done"), 1100);
  };

  const selectView = (next: View) => {
    setView(next);
    setMobileNav(false);
  };

  return (
    <div className="app-shell">
      <aside className={cx("sidebar", mobileNav && "mobile-open")}>
        <div className="brand-row">
          <div className="brand-mark">F</div>
          <div><strong>FirstRung</strong><span>Opportunity scout</span></div>
          <button type="button" className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={18} /></button>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          <span className="nav-label">Workspace</span>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const count = item.id === "saved" ? saved.length : item.id === "applications" ? Object.keys(applications).length : undefined;
            return (
              <button type="button" key={item.id} className={cx(view === item.id && "active")} onClick={() => selectView(item.id)}>
                <Icon size={17} /><span>{item.label}</span>{typeof count === "number" && <em>{count}</em>}
              </button>
            );
          })}
        </nav>

        <div className="scout-card">
          <div className="scout-live"><span className={scanState === "scanning" ? "pulse" : ""} /> Scout {scanState === "scanning" ? "scanning" : "ready"}</div>
          <strong>24 sources connected</strong>
          <p>{scanState === "done" ? "Fresh sample matches ranked just now." : "Company pages and job boards are checked, cleaned, and ranked."}</p>
          <button type="button" onClick={runScan} disabled={scanState === "scanning"}>
            <RefreshCw size={14} className={scanState === "scanning" ? "spin" : ""} />
            {scanState === "scanning" ? "Scanning…" : "Run scout now"}
          </button>
        </div>

        <div className="sidebar-foot">
          <div className="avatar">AM</div>
          <div><strong>Alex Morgan</strong><span>Open to first roles</span></div>
          <Settings2 size={16} />
        </div>
      </aside>

      {mobileNav && <button type="button" className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button type="button" className="icon-button menu-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
          <div className="source-status"><span className="live-dot" /> Demo index <span>· connect NATS scout to go live</span></div>
          <div className="topbar-actions">
            <button type="button" className="provider-pill" onClick={() => setShowProvider(true)}><Sparkles size={15} />{providerConfig.provider}<span>{providerConfig.apiKey || providerConfig.provider === "Ollama" ? "Connected" : "Set up"}</span></button>
            <button type="button" className="icon-button" aria-label="Notifications"><Bell size={18} /></button>
            <button type="button" className="avatar-button" aria-label="Open account menu">AM</button>
          </div>
        </header>

        {view === "applications" ? (
          <ApplicationsView applications={applications} onOpen={setSelectedJob} />
        ) : view === "profile" ? (
          <ProfileView openProvider={() => setShowProvider(true)} />
        ) : (
          <>
            <section className="hero-section">
              <div className="hero-copy">
                <span className="eyebrow">Your opportunity radar</span>
                <h1>Good jobs shouldn’t hide behind <em>experience you don’t have.</em></h1>
                <p>FirstRung reads the fine print, removes fake entry barriers, and shows why a role is worth your time.</p>
              </div>
              <div className="hero-stat"><strong>1,284</strong><span>beginner-friendly roles found today</span></div>
            </section>

            <section className="search-panel" aria-label="Search jobs">
              <div className="search-field main-search"><Search size={19} /><label><span>Role, skill, interest, or company</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Product design, data, climate, writing…" /></label></div>
              <div className="search-field location-search"><MapPin size={18} /><label><span>Location</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Anywhere · Remote" /></label></div>
              <button type="button" className="search-submit">Find my fit<ArrowRight size={16} /></button>
            </section>

            <div className="active-filter-row">
              <button type="button" className="mobile-filter-button" onClick={() => setShowFilters(true)}><Filter size={15} /> Filters</button>
              <span><Check size={13} /> 0–{filters.maxExperience} years</span>
              <span><Check size={13} /> {filters.jobTypes.length} role types</span>
              <span><Check size={13} /> {filters.workModes.join(" + ")}</span>
              {filters.noDegree && <span><Check size={13} /> Education not required</span>}
              <span><Check size={13} /> Posted within {filters.postedWithin} days</span>
            </div>

            <div className="dashboard-grid">
              <FilterPanel filters={filters} setFilters={setFilters} />

              <section className="results-panel">
                <div className="results-head">
                  <div><span className="eyebrow">{view === "saved" ? "Your shortlist" : "Ranked for you"}</span><h2>{view === "saved" ? "Saved roles" : "Strongest matches"}</h2><p>{filteredJobs.length} roles shown · eligibility checked before ranking</p></div>
                  <div className="sort-control"><ListFilter size={15} /><select aria-label="Sort jobs" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="match">Best fit first</option><option value="newest">Newest first</option><option value="salary">Highest salary</option></select><ChevronDown size={14} /></div>
                </div>
                <div className="job-list">
                  {filteredJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      saved={saved.includes(job.id)}
                      stage={applications[job.id]}
                      onSave={() => toggleSaved(job.id)}
                      onOpen={() => setSelectedJob(job)}
                      onApply={() => advanceApplication(job)}
                    />
                  ))}
                  {filteredJobs.length === 0 && <EmptyState view={view} reset={() => setFilters(DEFAULT_FILTERS)} />}
                </div>
              </section>

              <aside className="right-rail">
                <PipelinePanel applications={applications} />
                <section className="utility-card ai-card">
                  <div className="ai-orb"><Sparkles size={18} /></div>
                  <span className="eyebrow">Application coach</span>
                  <h3>Tailor your story, not your personality.</h3>
                  <p>Compare a role with your proof, spot honest gaps, and draft a focused application.</p>
                  <button type="button" onClick={() => setShowProvider(true)}>Configure {providerConfig.provider}<ArrowRight size={14} /></button>
                  <div className="ai-provider-line"><span /> OpenAI-compatible provider layer</div>
                </section>
                <section className="utility-card source-card">
                  <div className="utility-head"><div><span className="eyebrow">Source confidence</span><h3>Cleaner than a job board</h3></div><ShieldCheck size={19} /></div>
                  <div className="source-list">
                    <div><span className="source-dot direct" /><span>Direct company pages</span><strong>116</strong></div>
                    <div><span className="source-dot ats" /><span>Verified ATS feeds</span><strong>24</strong></div>
                    <div><span className="source-dot fresh" /><span>Checked in 24 hours</span><strong>93%</strong></div>
                  </div>
                  <p className="source-footnote">Duplicates, reposts, expired roles, and hidden seniority are flagged before matching.</p>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>

      {showFilters && (
        <div className="mobile-filter-drawer"><button type="button" className="drawer-screen" aria-label="Close filters" onClick={() => setShowFilters(false)} /><FilterPanel filters={filters} setFilters={setFilters} onClose={() => setShowFilters(false)} /></div>
      )}
      {showProvider && <ProviderModal config={providerConfig} setConfig={setProviderConfig} onClose={() => setShowProvider(false)} />}
      {selectedJob && (
        <JobDrawer
          job={selectedJob}
          saved={saved.includes(selectedJob.id)}
          stage={applications[selectedJob.id]}
          onClose={() => setSelectedJob(null)}
          onSave={() => toggleSaved(selectedJob.id)}
          onApply={() => advanceApplication(selectedJob)}
        />
      )}
    </div>
  );
}
