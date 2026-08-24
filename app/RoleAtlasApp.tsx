"use client";

import {
  ArrowRight,
  Check,
  Database,
  FileText,
  Filter,
  Globe2,
  ListFilter,
  LogOut,
  MapPin,
  Menu,
  Radar,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authClient } from "../lib/auth-client.ts";
import { ACCOUNT_STORAGE_KEYS, accountStorageKey, loadAiActivity, recordAiActivity } from "./accountStorage.ts";
import { PROVIDERS, type ApplicationStage, type Job } from "./jobs";
import { salaryUsdEquivalent } from "./jobData";
import { EmptyState } from "./components/EmptyState";
import { FilterPanel } from "./components/FilterPanel";
import { JobCard } from "./components/JobCard.tsx";
import { JobDrawer } from "./components/JobDrawer";
import { NAV_ITEMS } from "./components/navItems";
import { AiActionPreviewModal, ProviderModal } from "./components/ProviderModal.tsx";
import { ProfileReviewModal } from "./components/ProfileReviewModal";
import { PipelinePanel } from "./components/PipelinePanel";
import { ResumeModal, type ResumeProfile } from "./components/ResumeModal";
import {
  SelectMenu,
  cx,
} from "./components/ui.tsx";
import {
  normalizeCountryLabel,
  normalizeScoutJob,
  rankJobsLocally,
  DEFAULT_FILTERS,
  type ScoutJob,
} from "./jobRanking";
import { fetchRemainingSessionResults, fetchScoutIndex } from "./scoutIndex";
import type { LiveJobsPayload } from "./liveJobs";
import type { CareerDossier } from "./careerOps";
import { providerIsConfigured, verificationIsCurrent, type AiActivity, type ProviderConfig } from "./aiProvider";
import { deduplicateJobs, mergeImportedJobs } from "./jobIdentity";
import { buildCandidateProfile, buildSearchPlan, emptyCandidateMobility, type CandidateProfile, type SearchPlan } from "./candidateProfile";
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
  type AiRequestPreview,
  type DailyWorkspace,
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
} from "./DailyWorkspaces";
import {
  LITE_COUNTRIES,
  resolveLiteCountry,
} from "../shared/geography-lite";
import {
  readInitialWorkspaceState,
  syncWorkspaceUrl,
  type View,
} from "./workspaceUrl";

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
  coverage?: { state?: "complete" | "partial" | "expanding" | "checked"; configured_sources?: number; selected_sources?: number; successful_sources?: number; incomplete_sources?: number; index_scope?: string; eligibility_counts?: Record<string, number>; source_selection?: { selected_sources?: number; states?: Record<string, number>; observed_jobs_in_completed_runs?: number; claim?: string } };
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

export default function RoleAtlasApp({ initialPayload, currentUser }: { initialPayload: LiveJobsPayload; currentUser: { id: string; name: string; email: string } }) {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [jobs, setJobs] = useState(() => deduplicateJobs(initialPayload.jobs).slice(0, 400));
  const [sourceMeta, setSourceMeta] = useState(() => ({
    sources: initialPayload.sources,
    failedSources: initialPayload.failedSources,
    fetchedAt: initialPayload.fetchedAt,
    fallback: initialPayload.fallback,
    sourceStatus: initialPayload.sourceStatus,
  }));
  // The workspace is URL-addressable: ?view= picks the panel and ?job= reopens
  // a drawer after reload. The address bar is adopted after hydration because
  // the server always renders home.
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [specificLocation, setSpecificLocation] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  // Progressive disclosure: the desktop filter panel stays collapsed until
  // asked for, so Discover opens with search, results, and one sort control.
  const [filtersExpanded, setFiltersExpanded] = useState(false);
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
    return ["Worldwide", ...LITE_COUNTRIES.map((candidate) => candidate.name)].sort((a, b) => a.localeCompare(b));
  }, []);

  // Subdivision names arrive from the server per selected country so the
  // world subdivisions dataset never ships in the client bundle. Names are
  // tagged with their country so a slow response for a previous selection
  // never bleeds into the current one.
  const [serverSubdivisions, setServerSubdivisions] = useState<{ country: string; names: string[] }>({ country: "", names: [] });
  useEffect(() => {
    if (!country) return;
    const countryCode = resolveLiteCountry(country)?.code;
    if (!countryCode) return;
    const controller = new AbortController();
    void fetch(`/api/geography/subdivisions?countryCode=${countryCode}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { names?: string[] } | null) => setServerSubdivisions({ country, names: payload?.names ?? [] }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [country]);

  const locationOptions = useMemo(() => {
    if (!country) return [];
    const indexed = jobs
      .filter((job) => normalizeCountryLabel(job.country, job.location)?.toLowerCase() === country.toLowerCase())
      .map((job) => job.location)
      .filter((value) => Boolean(value) && value.length < 80);
    const subdivisions = serverSubdivisions.country === country ? serverSubdivisions.names : [];
    return [...new Set([...indexed, ...subdivisions])].sort((a, b) => a.localeCompare(b));
  }, [country, jobs, serverSubdivisions]);

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

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.maxExperience !== null) count += 1;
    if (filters.jobTypes.length > 0) count += 1;
    if (filters.workModes.length > 0) count += 1;
    if (filters.noDegree) count += 1;
    if (filters.visaSupport) count += 1;
    if (filters.minSalary > 0) count += 1;
    if (filters.postedWithin > 0) count += 1;
    return count;
  }, [filters]);

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
  }, [selectedJob?.descriptionIsPreview, selectedJob?.id, selectedJob?.recordKind]);

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
        const selectedCountry = resolveLiteCountry(country);
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
    selectView("home");
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
    selectView("discover");
  };

  // The drawer is URL-addressable so an open job survives reloads. The ?job=
  // id is adopted once on mount and resolved against loaded jobs afterwards.
  const linkedJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    const linked = readInitialWorkspaceState();
    linkedJobIdRef.current = linked.jobId;
    if (linked.view !== "home") queueMicrotask(() => setView(linked.view));
  }, []);

  useEffect(() => {
    const requestedJobId = linkedJobIdRef.current;
    if (!requestedJobId || jobs.length === 0) return;
    linkedJobIdRef.current = null;
    const requested = jobs.find((job) => job.id === requestedJobId || job.id === `scout-${requestedJobId}`);
    if (requested && !selectedJob) setSelectedJob(requested);
  }, [jobs, selectedJob]);

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

  // Every navigation surface funnels through here so the address bar and the
  // rendered workspace can never disagree.
  const selectView = useCallback((next: View) => {
    setView(next);
    setMobileNav(false);
  }, []);

  // Single writer for the address bar. The first render already matches the
  // URL (state was parsed from it), so syncing arms after that pass and only
  // user-driven state changes touch history.
  const urlSyncArmedRef = useRef(false);
  useEffect(() => {
    if (!urlSyncArmedRef.current) {
      urlSyncArmedRef.current = true;
      return;
    }
    syncWorkspaceUrl(view, selectedJob?.id ?? null);
  }, [selectedJob?.id, view]);

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
              <section className="results-panel">
                <div className="results-head">
                  <div><span className="eyebrow">{resumeProfile ? "Ranked from your résumé" : candidateProfile ? "Ranked from your confirmed profile" : "Live opportunity index"}</span><h2>{resumeProfile || candidateProfile ? "Your strongest matches" : "Explore open roles"}</h2><p>{filteredJobs.length} loaded matches · showing {Math.min(visibleCount, filteredJobs.length)}{serverIndex ? ` · ${serverIndex.count} matching crawler records · ${serverIndex.coverage.successful}/${serverIndex.coverage.sources} sources healthy` : ` · ${sourceMeta.sources.length} live feeds`}</p></div>
                  <div className="sort-control">
                    <button
                      type="button"
                      className="filter-toggle"
                      aria-expanded={filtersExpanded}
                      onClick={() => setFiltersExpanded((value) => !value)}
                    >
                      <ListFilter size={15} /> Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
                    </button>
                    <SelectMenu compact ariaLabel="Sort jobs" value={sort} onChange={(value) => setSort(value as typeof sort)} placeholder="Sort jobs" options={[{ value: "match", label: "Best fit first" }, { value: "newest", label: "Newest first" }, { value: "salary", label: "Highest salary" }]} />
                  </div>
                </div>
                {filtersExpanded && (
                  <FilterPanel jobs={discoverJobs} filters={filters} setFilters={setFilters} />
                )}
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
