import type {
  CandidateConstraints,
  CandidateFacts,
  CandidateGoals,
  CandidateMobility,
  CandidatePreferences,
  CandidateProfile,
  EvidenceField,
  SearchPlan,
} from "./candidateProfile.ts";
import type { Job, JobType, WorkMode } from "./jobs.ts";

export const ONBOARDING_STEPS = [
  "welcome",
  "profile-source",
  "review-facts",
  "career-goals",
  "location-eligibility",
  "hard-constraints",
  "strategy-preview",
  "run-search",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type ProfileSource = "resume" | "manual" | null;
export type StrategyStatus = "draft" | "active" | "paused" | "archived";

export type OnboardingDraft = {
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  profileSource: ProfileSource;
  profile: CandidateProfile | null;
  strategy: SearchPlan | null;
  completedAt: string | null;
  updatedAt: string;
};

export type StrategyRevision = {
  id: string;
  version: number;
  createdAt: string;
  reason: "created" | "edited" | "regenerated" | "duplicated";
  plan: SearchPlan;
};

export type StrategyRecord = {
  id: string;
  name: string;
  status: StrategyStatus;
  profileId: string | null;
  activeRevisionId: string;
  revisions: StrategyRevision[];
  lastRunAt: string | null;
  lastSessionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const FEEDBACK_REASONS = [
  "relevant",
  "not_relevant",
  "wrong_role",
  "wrong_seniority",
  "wrong_location",
  "not_eligible",
  "compensation_too_low",
  "not_interested_in_company",
  "duplicate",
  "already_applied",
  "closed",
  "show_fewer_like_this",
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export type FeedbackRecord = {
  id: string;
  jobId: string;
  sessionId: string | null;
  reason: FeedbackReason;
  createdAt: string;
  undoneAt: string | null;
  suggestedStrategyChange: string | null;
};

export const APPLICATION_STAGES = [
  "Saved",
  "Preparing",
  "Applied",
  "Recruiter screen",
  "Assessment",
  "Technical interview",
  "Final interview",
  "Offer",
  "Rejected",
  "Withdrawn",
  "Closed before application",
] as const;

export type DailyApplicationStage = (typeof APPLICATION_STAGES)[number];

export type ApplicationActivity = {
  id: string;
  at: string;
  type: "created" | "stage_changed" | "note" | "follow_up" | "artifact" | "contact";
  summary: string;
};

export type ApplicationRecord = {
  jobId: string;
  stage: DailyApplicationStage;
  applicationDate: string | null;
  nextAction: string;
  followUpDate: string | null;
  notes: string;
  contacts: Array<{ name: string; detail: string }>;
  tailoredResumeReference: string;
  coverLetterReference: string;
  interviewPreparation: string;
  sourceJobStatus: "active" | "possibly_closed" | "closed" | "unknown";
  activity: ApplicationActivity[];
  updatedAt: string;
};

export type SavedJobRecord = {
  jobId: string;
  savedAt: string;
  snapshot: Pick<Job, "id" | "title" | "company" | "location" | "url" | "source" | "lifecycleStatus">;
};

export type NotificationType =
  | "new_strong_matches"
  | "source_expansion_completed"
  | "coverage_degraded"
  | "saved_job_possibly_closing"
  | "saved_job_closed"
  | "follow_up_due"
  | "application_action";

export type DailyNotification = {
  id: string;
  dedupeKey: string;
  type: NotificationType;
  title: string;
  detail: string;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
  targetView: "home" | "discover" | "searches" | "saved" | "applications" | "sources";
};

export type RecentView = { jobId: string; viewedAt: string };

export type LearnedPreferences = {
  fewerRoleTerms: string[];
  fewerCompanies: string[];
  fewerLocations: string[];
  updatedAt: string | null;
};

export type DailyWorkspace = {
  schemaVersion: 1;
  onboarding: OnboardingDraft;
  strategies: StrategyRecord[];
  savedJobs: Record<string, SavedJobRecord>;
  dismissedJobIds: string[];
  feedback: FeedbackRecord[];
  applications: Record<string, ApplicationRecord>;
  notifications: DailyNotification[];
  recentViews: RecentView[];
  learnedPreferences: LearnedPreferences;
  lastVisitAt: string | null;
  updatedAt: string;
};

export type SearchSessionLike = {
  id: string;
  status: string;
  stage?: string;
  result_count: number;
  started_at: string;
  completed_at?: string | null;
  coverage?: {
    state?: string;
    selected_sources?: number;
    successful_sources?: number;
    incomplete_sources?: number;
    source_selection?: { observed_jobs_in_completed_runs?: number; states?: Record<string, number> };
  };
};

export type DashboardSummary = {
  strongMatches: number;
  newSinceLastVisit: number;
  expansionAdded: number;
  activeSearches: number;
  coverageIssues: number;
  savedJobsClosed: number;
  applicationsNeedingAction: number;
  recentViews: number;
  unreadNotifications: number;
};

export type AiRequestPreview = {
  provider: string;
  model: string;
  purpose: string;
  dataCategories: string[];
  location: "local" | "external";
  passesThroughRoleAtlas: boolean;
  estimatedInputCharacters: number;
};

export type ServiceState = "available" | "degraded" | "unavailable" | "checking";
export type ServiceStatus = {
  web: ServiceState;
  database: ServiceState;
  nats: ServiceState;
  scout: ServiceState;
  crawler: ServiceState;
  ai: ServiceState;
  checkedAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function blankEvidence(value = "", origin: EvidenceField["origin"] = "manual"): EvidenceField {
  return { value, confidence: origin === "manual" ? 1 : 0, evidence: origin === "manual" ? "Provided by the candidate." : "Not provided.", confirmed: origin === "manual", origin };
}

export function createManualProfile(): CandidateProfile {
  const name = blankEvidence();
  const experienceLevel = blankEvidence("Experience level not confirmed", "system");
  const facts: CandidateFacts = { name, location: null, skills: [], experienceLevel, education: [], certifications: [], graduationDate: null, leadershipScope: null };
  const goals: CandidateGoals = { primaryRoleFamilies: [], adjacentRoleFamilies: [], opportunityTypes: [], targetIndustries: [] };
  const constraints: CandidateConstraints = { excludedTerms: [], excludedCompanies: [], maximumExperienceYears: null, minimumCompensation: null, degreeRequiredAllowed: true };
  const preferences: CandidatePreferences = { workModes: [], freshnessDays: 30, rankingPriorities: ["eligibility", "role_fit", "skills", "freshness"], preferredIndustries: [], avoidedIndustries: [] };
  const mobility: CandidateMobility = {
    residenceCountryCode: null,
    citizenshipCountryCodes: [],
    workAuthorizedCountryCodes: [],
    requiresSponsorshipCountryCodes: [],
    preferredCountryCodes: [],
    excludedCountryCodes: [],
    preferredCities: [],
    willingToRelocate: false,
    relocationCountryCodes: [],
    preferredTimezones: [],
    maximumTimezoneDifferenceHours: null,
    inferredFields: [],
    confirmedFields: [],
  };
  return { name, location: null, skills: [], targetRoles: [], experienceLevel, mobility, facts, goals, constraints, preferences, sourceFile: "manual-profile", updatedAt: nowIso() };
}

export function createWorkspace(at = nowIso()): DailyWorkspace {
  return {
    schemaVersion: 1,
    onboarding: { currentStep: "welcome", completedSteps: [], profileSource: null, profile: null, strategy: null, completedAt: null, updatedAt: at },
    strategies: [],
    savedJobs: {},
    dismissedJobIds: [],
    feedback: [],
    applications: {},
    notifications: [],
    recentViews: [],
    learnedPreferences: { fewerRoleTerms: [], fewerCompanies: [], fewerLocations: [], updatedAt: null },
    lastVisitAt: null,
    updatedAt: at,
  };
}

export function normalizeWorkspace(value: unknown): DailyWorkspace {
  const fallback = createWorkspace();
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<DailyWorkspace>;
  return {
    ...fallback,
    ...candidate,
    schemaVersion: 1,
    onboarding: { ...fallback.onboarding, ...(candidate.onboarding ?? {}) },
    strategies: Array.isArray(candidate.strategies) ? candidate.strategies : [],
    savedJobs: candidate.savedJobs && typeof candidate.savedJobs === "object" ? candidate.savedJobs : {},
    dismissedJobIds: Array.isArray(candidate.dismissedJobIds) ? candidate.dismissedJobIds : [],
    feedback: Array.isArray(candidate.feedback) ? candidate.feedback : [],
    applications: candidate.applications && typeof candidate.applications === "object" ? candidate.applications : {},
    notifications: Array.isArray(candidate.notifications) ? candidate.notifications : [],
    recentViews: Array.isArray(candidate.recentViews) ? candidate.recentViews : [],
    learnedPreferences: { ...fallback.learnedPreferences, ...(candidate.learnedPreferences ?? {}) },
  };
}

export function moveOnboarding(workspace: DailyWorkspace, step: OnboardingStep, profile?: CandidateProfile | null, strategy?: SearchPlan | null): DailyWorkspace {
  const current = workspace.onboarding.currentStep;
  const completedSteps = current === step ? workspace.onboarding.completedSteps : [...new Set([...workspace.onboarding.completedSteps, current])];
  const at = nowIso();
  return {
    ...workspace,
    onboarding: { ...workspace.onboarding, currentStep: step, completedSteps, profile: profile === undefined ? workspace.onboarding.profile : profile, strategy: strategy === undefined ? workspace.onboarding.strategy : strategy, updatedAt: at },
    updatedAt: at,
  };
}

export function adaptiveProfileQuestions(profile: CandidateProfile, plan: SearchPlan | null): string[] {
  const questions: string[] = [];
  const text = `${profile.experienceLevel.value} ${profile.targetRoles.map((role) => role.value).join(" ")}`.toLowerCase();
  if (/student|graduate|intern|early career/.test(text)) questions.push("Confirm expected graduation and whether internships are a goal.");
  if (/senior|lead|manager|director|head|principal/.test(text)) questions.push("Confirm the scale of teams, programmes, or decisions you have led.");
  if (plan?.workModes.includes("Remote")) questions.push("Confirm preferred timezones and maximum working-hour difference.");
  if (profile.mobility.willingToRelocate) questions.push("Confirm target relocation countries and where sponsorship is required.");
  if (profile.facts?.certifications.length || /nurs|doctor|physician|lawyer|architect|pilot|teacher/.test(text)) questions.push("Confirm licenses or certifications required in the target location.");
  return questions;
}

export function saveStrategy(workspace: DailyWorkspace, plan: SearchPlan, reason: StrategyRevision["reason"] = "created", strategyId?: string): DailyWorkspace {
  const at = nowIso();
  const existing = strategyId ? workspace.strategies.find((strategy) => strategy.id === strategyId) : undefined;
  const version = existing ? Math.max(...existing.revisions.map((revision) => revision.version), 0) + 1 : 1;
  const revision: StrategyRevision = { id: id("revision"), version, createdAt: at, reason, plan: { ...plan, strategyVersion: version } };
  const strategy: StrategyRecord = existing
    ? { ...existing, name: plan.strategyName || existing.name, status: plan.strategyStatus ?? existing.status, activeRevisionId: revision.id, revisions: [...existing.revisions, revision], updatedAt: at }
    : { id: strategyId ?? id("strategy"), name: plan.strategyName || "My search", status: plan.strategyStatus ?? "draft", profileId: plan.profileId ?? null, activeRevisionId: revision.id, revisions: [revision], lastRunAt: null, lastSessionId: null, createdAt: at, updatedAt: at };
  return { ...workspace, strategies: existing ? workspace.strategies.map((item) => (item.id === strategy.id ? strategy : item)) : [strategy, ...workspace.strategies], updatedAt: at };
}

export function duplicateStrategy(workspace: DailyWorkspace, strategyId: string): DailyWorkspace {
  const strategy = workspace.strategies.find((item) => item.id === strategyId);
  if (!strategy) return workspace;
  const active = strategy.revisions.find((revision) => revision.id === strategy.activeRevisionId) ?? strategy.revisions.at(-1);
  if (!active) return workspace;
  return saveStrategy(workspace, { ...active.plan, id: undefined, strategyName: `${strategy.name} copy`, strategyStatus: "draft" }, "duplicated");
}

export function setStrategyStatus(workspace: DailyWorkspace, strategyId: string, status: StrategyStatus): DailyWorkspace {
  const at = nowIso();
  return { ...workspace, strategies: workspace.strategies.map((strategy) => (strategy.id === strategyId ? { ...strategy, status, updatedAt: at } : strategy)), updatedAt: at };
}

export function markStrategyRun(workspace: DailyWorkspace, strategyId: string, sessionId: string, at = nowIso()): DailyWorkspace {
  return { ...workspace, strategies: workspace.strategies.map((strategy) => (strategy.id === strategyId ? { ...strategy, status: "active", lastRunAt: at, lastSessionId: sessionId, updatedAt: at } : strategy)), updatedAt: at };
}

function strategySuggestion(reason: FeedbackReason) {
  if (reason === "wrong_role" || reason === "show_fewer_like_this") return "Review role families, title synonyms, and excluded terms.";
  if (reason === "wrong_seniority") return "Review the experience boundary before changing it.";
  if (reason === "wrong_location") return "Review target geography and remote scope.";
  if (reason === "not_eligible") return "Review authorization and sponsorship constraints; candidate facts will not be changed automatically.";
  if (reason === "compensation_too_low") return "Consider adding or raising a minimum compensation preference.";
  if (reason === "not_interested_in_company") return "Consider adding this company to exclusions.";
  return null;
}

export function addFeedback(workspace: DailyWorkspace, jobId: string, reason: FeedbackReason, sessionId: string | null = null): DailyWorkspace {
  const at = nowIso();
  const record: FeedbackRecord = { id: id("feedback"), jobId, sessionId, reason, createdAt: at, undoneAt: null, suggestedStrategyChange: strategySuggestion(reason) };
  const dismissed = !["relevant", "already_applied"].includes(reason);
  return { ...workspace, feedback: [record, ...workspace.feedback], dismissedJobIds: dismissed ? [...new Set([...workspace.dismissedJobIds, jobId])] : workspace.dismissedJobIds, updatedAt: at };
}

export function undoFeedback(workspace: DailyWorkspace, feedbackId: string): DailyWorkspace {
  const at = nowIso();
  const target = workspace.feedback.find((record) => record.id === feedbackId && !record.undoneAt);
  if (!target) return workspace;
  const remainingDismissal = workspace.feedback.some((record) => record.id !== feedbackId && record.jobId === target.jobId && !record.undoneAt && !["relevant", "already_applied"].includes(record.reason));
  return { ...workspace, feedback: workspace.feedback.map((record) => (record.id === feedbackId ? { ...record, undoneAt: at } : record)), dismissedJobIds: remainingDismissal ? workspace.dismissedJobIds : workspace.dismissedJobIds.filter((jobId) => jobId !== target.jobId), updatedAt: at };
}

export function resetLearnedPreferences(workspace: DailyWorkspace): DailyWorkspace {
  const at = nowIso();
  return { ...workspace, learnedPreferences: { fewerRoleTerms: [], fewerCompanies: [], fewerLocations: [], updatedAt: at }, updatedAt: at };
}

export function saveJob(workspace: DailyWorkspace, job: Job): DailyWorkspace {
  const at = nowIso();
  const snapshot = { id: job.id, title: job.title, company: job.company, location: job.location, url: job.url, source: job.source, lifecycleStatus: job.lifecycleStatus };
  return { ...workspace, savedJobs: { ...workspace.savedJobs, [job.id]: { jobId: job.id, savedAt: workspace.savedJobs[job.id]?.savedAt ?? at, snapshot } }, updatedAt: at };
}

export function unsaveJob(workspace: DailyWorkspace, jobId: string): DailyWorkspace {
  const savedJobs = { ...workspace.savedJobs };
  delete savedJobs[jobId];
  return { ...workspace, savedJobs, updatedAt: nowIso() };
}

export function updateApplication(workspace: DailyWorkspace, jobId: string, patch: Partial<Omit<ApplicationRecord, "jobId" | "activity">>, summary?: string): DailyWorkspace {
  const at = nowIso();
  const existing = workspace.applications[jobId] ?? {
    jobId,
    stage: "Saved" as const,
    applicationDate: null,
    nextAction: "",
    followUpDate: null,
    notes: "",
    contacts: [],
    tailoredResumeReference: "",
    coverLetterReference: "",
    interviewPreparation: "",
    sourceJobStatus: "unknown" as const,
    activity: [],
    updatedAt: at,
  };
  const stageChanged = patch.stage && patch.stage !== existing.stage;
  const activity = summary || stageChanged ? [{ id: id("activity"), at, type: stageChanged ? "stage_changed" as const : "note" as const, summary: summary ?? `Moved to ${patch.stage}.` }, ...existing.activity] : existing.activity;
  return { ...workspace, applications: { ...workspace.applications, [jobId]: { ...existing, ...patch, activity, updatedAt: at } }, updatedAt: at };
}

export function addNotification(workspace: DailyWorkspace, notification: Omit<DailyNotification, "id" | "createdAt" | "readAt" | "dismissedAt">): DailyWorkspace {
  const duplicate = workspace.notifications.find((item) => item.dedupeKey === notification.dedupeKey && !item.dismissedAt);
  if (duplicate) return workspace;
  const at = nowIso();
  return { ...workspace, notifications: [{ ...notification, id: id("notification"), createdAt: at, readAt: null, dismissedAt: null }, ...workspace.notifications].slice(0, 100), updatedAt: at };
}

export function updateNotification(workspace: DailyWorkspace, notificationId: string, action: "read" | "dismiss"): DailyWorkspace {
  const at = nowIso();
  return { ...workspace, notifications: workspace.notifications.map((notification) => notification.id === notificationId ? { ...notification, readAt: notification.readAt ?? (action === "read" ? at : notification.readAt), dismissedAt: action === "dismiss" ? at : notification.dismissedAt } : notification), updatedAt: at };
}

export function rememberView(workspace: DailyWorkspace, jobId: string): DailyWorkspace {
  const viewedAt = nowIso();
  return { ...workspace, recentViews: [{ jobId, viewedAt }, ...workspace.recentViews.filter((item) => item.jobId !== jobId)].slice(0, 20), updatedAt: viewedAt };
}

export function dashboardSummary(workspace: DailyWorkspace, sessions: SearchSessionLike[], jobs: Job[], at = new Date()): DashboardSummary {
  const lastVisit = workspace.lastVisitAt ? new Date(workspace.lastVisitAt).getTime() : 0;
  const due = at.toISOString().slice(0, 10);
  const savedIds = new Set(Object.keys(workspace.savedJobs));
  return {
    strongMatches: jobs.filter((job) => job.score >= 75 && !workspace.dismissedJobIds.includes(job.id) && job.eligibilityStatus !== "excluded" && job.eligibilityStatus !== "timezone_mismatch").length,
    newSinceLastVisit: jobs.filter((job) => new Date(job.lastVerifiedAt ?? 0).getTime() > lastVisit).length,
    expansionAdded: sessions.reduce((sum, session) => sum + (session.coverage?.source_selection?.observed_jobs_in_completed_runs ?? 0), 0),
    activeSearches: workspace.strategies.filter((strategy) => strategy.status === "active").length,
    coverageIssues: sessions.filter((session) => ["partial", "degraded"].includes(session.coverage?.state ?? "") || (session.coverage?.incomplete_sources ?? 0) > 0).length,
    savedJobsClosed: jobs.filter((job) => savedIds.has(job.id) && job.lifecycleStatus === "closed").length + Object.values(workspace.savedJobs).filter((saved) => saved.snapshot.lifecycleStatus === "closed" && !jobs.some((job) => job.id === saved.jobId)).length,
    applicationsNeedingAction: Object.values(workspace.applications).filter((application) => Boolean(application.nextAction) || Boolean(application.followUpDate && application.followUpDate <= due)).length,
    recentViews: workspace.recentViews.length,
    unreadNotifications: workspace.notifications.filter((notification) => !notification.readAt && !notification.dismissedAt).length,
  };
}

export function aiRequestPreview(input: {
  provider: string;
  model: string;
  baseUrl: string;
  purpose: string;
  dataCategories: string[];
  estimatedInputCharacters: number;
}): AiRequestPreview {
  let local = false;
  try {
    const hostname = new URL(input.baseUrl).hostname.toLowerCase();
    local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    local = false;
  }
  return { provider: input.provider, model: input.model, purpose: input.purpose, dataCategories: input.dataCategories, location: local ? "local" : "external", passesThroughRoleAtlas: true, estimatedInputCharacters: Math.max(0, Math.round(input.estimatedInputCharacters)) };
}

export function serviceMode(status: ServiceStatus): "complete" | "degraded" | "web-only" {
  if (status.database === "available" && status.scout === "available" && status.nats === "available" && status.crawler === "available") return "complete";
  if (status.database === "available" || status.scout === "available") return "degraded";
  return "web-only";
}

export function manualStrategy(profile: CandidateProfile, values: {
  primaryRoles: string[];
  adjacentRoles?: string[];
  titleSynonyms?: string[];
  excludedTerms?: string[];
  opportunityTypes?: JobType[];
  workModes?: WorkMode[];
  maxExperience?: number | null;
  locations?: string[];
  freshnessDays?: number;
}): SearchPlan {
  const now = nowIso();
  return {
    roleQueries: [...new Set([...values.primaryRoles, ...(values.adjacentRoles ?? []), ...(values.titleSynonyms ?? [])].map((value) => value.trim()).filter(Boolean))],
    locations: values.locations ?? [],
    jobTypes: values.opportunityTypes ?? [],
    workModes: values.workModes ?? [],
    maxExperience: values.maxExperience ?? null,
    noDegreeRequired: false,
    mobility: profile.mobility,
    primaryRoleFamilies: values.primaryRoles,
    adjacentRoleFamilies: values.adjacentRoles ?? [],
    titleSynonyms: values.titleSynonyms ?? [],
    excludedTerms: values.excludedTerms ?? [],
    targetCountryCodes: profile.mobility.preferredCountryCodes,
    targetRegionCodes: [],
    freshnessDays: values.freshnessDays ?? 30,
    rankingPriorities: profile.preferences?.rankingPriorities ?? ["eligibility", "role_fit", "skills", "freshness"],
    strategyName: values.primaryRoles[0] ? `${values.primaryRoles[0]} search` : "My search",
    strategyStatus: "draft",
    strategyVersion: 1,
    generatedAt: now,
    confirmedAt: null,
  };
}
