import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidateProfile } from "../app/candidateProfile.ts";
import {
  adaptiveProfileQuestions,
  addFeedback,
  addNotification,
  aiRequestPreview,
  createManualProfile,
  createWorkspace,
  dashboardSummary,
  duplicateStrategy,
  manualStrategy,
  markStrategyRun,
  moveOnboarding,
  normalizeWorkspace,
  resetLearnedPreferences,
  saveStrategy,
  serviceMode,
  undoFeedback,
  updateApplication,
  updateNotification,
  type ServiceStatus,
} from "../app/dailyProduct.ts";
import type { Job } from "../app/jobs.ts";

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    title: "Policy Researcher",
    company: "Civic Lab",
    initials: "CL",
    location: "Remote — worldwide",
    country: "Worldwide",
    workMode: "Remote",
    type: "Full-time",
    category: "Research",
    experience: 1,
    experienceLabel: "0–1 years",
    salaryMin: 50_000,
    salaryMax: 65_000,
    currency: "USD",
    salaryPeriod: "year",
    postedDays: 1,
    degreeRequired: false,
    visaSupport: false,
    source: "Greenhouse",
    url: "https://example.com/job-1",
    verified: true,
    score: 88,
    accent: "mint",
    skills: ["Research"],
    reasons: ["Research evidence matches.", "Experience boundary matches."],
    gap: "Authorization wording is unclear.",
    summary: "Research public policy.",
    lifecycleStatus: "active",
    lastVerifiedAt: "2026-07-16T08:00:00.000Z",
    eligibilityStatus: "unclear",
    ...overrides,
  };
}

test("supports manual onboarding and saves resumable progress", () => {
  const profile = createManualProfile();
  const strategy = manualStrategy(profile, { primaryRoles: ["Policy Researcher"], workModes: ["Remote"] });
  let workspace = createWorkspace("2026-07-15T00:00:00.000Z");
  workspace = { ...workspace, onboarding: { ...workspace.onboarding, profileSource: "manual" } };
  workspace = moveOnboarding(workspace, "review-facts", profile);
  workspace = moveOnboarding(workspace, "strategy-preview", profile, strategy);
  assert.equal(workspace.onboarding.profileSource, "manual");
  assert.equal(workspace.onboarding.currentStep, "strategy-preview");
  assert.ok(workspace.onboarding.completedSteps.includes("review-facts"));
  assert.equal(workspace.onboarding.strategy?.roleQueries[0], "Policy Researcher");
});

test("resume onboarding keeps inferred evidence separate from confirmed facts", () => {
  const profile = buildCandidateProfile({ fileName: "resume.pdf", name: "Sam Lee", location: "Singapore", skills: ["Research"], suggestedRoles: ["Policy Researcher"], text: "Sam Lee. Singapore. Research student seeking an internship." });
  assert.equal(profile.facts?.skills[0].origin, "resume");
  assert.equal(profile.facts?.skills[0].confirmed, false);
  assert.equal(profile.mobility.residenceCountryCode, "SG");
  assert.deepEqual(profile.mobility.workAuthorizedCountryCodes, []);
  assert.deepEqual(profile.mobility.citizenshipCountryCodes, []);
  profile.facts!.skills[0] = { ...profile.facts!.skills[0], confirmed: true };
  assert.equal(profile.facts?.skills[0].confirmed, true);
});

test("adaptive questions use reusable profile signals", () => {
  const profile = buildCandidateProfile({ fileName: "resume.pdf", name: "Sam", location: null, skills: [], suggestedRoles: ["Senior Nursing Lead"], text: "Senior nursing lead and student mentor." });
  profile.mobility.willingToRelocate = true;
  const strategy = manualStrategy(profile, { primaryRoles: ["Nursing Lead"], workModes: ["Remote"] });
  const questions = adaptiveProfileQuestions(profile, strategy);
  assert.ok(questions.some((question) => /graduation/i.test(question)));
  assert.ok(questions.some((question) => /scale/i.test(question)));
  assert.ok(questions.some((question) => /timezone/i.test(question)));
  assert.ok(questions.some((question) => /sponsorship/i.test(question)));
  assert.ok(questions.some((question) => /license|certification/i.test(question)));
});

test("strategy editing, duplication, revision comparison, and rerun metadata persist", () => {
  const profile = createManualProfile();
  const initial = manualStrategy(profile, { primaryRoles: ["Researcher"], excludedTerms: ["senior"] });
  let workspace = saveStrategy(createWorkspace(), initial);
  const strategyId = workspace.strategies[0].id;
  workspace = saveStrategy(workspace, { ...initial, titleSynonyms: ["Analyst"], strategyName: "Research roles" }, "edited", strategyId);
  workspace = markStrategyRun(workspace, strategyId, "session-1", "2026-07-16T09:00:00.000Z");
  workspace = duplicateStrategy(workspace, strategyId);
  const original = workspace.strategies.find((strategy) => strategy.id === strategyId)!;
  assert.equal(original.revisions.length, 2);
  assert.deepEqual(original.revisions.map((revision) => revision.version), [1, 2]);
  assert.equal(original.lastSessionId, "session-1");
  assert.equal(workspace.strategies.length, 2);
  assert.match(workspace.strategies[0].name, /copy/i);
});

test("workspace normalization preserves daily state across refresh", () => {
  let workspace = createWorkspace();
  workspace = updateApplication(workspace, "job-1", { stage: "Applied", applicationDate: "2026-07-16", nextAction: "Follow up", followUpDate: "2026-07-23" });
  const restored = normalizeWorkspace(JSON.parse(JSON.stringify(workspace)));
  assert.equal(restored.applications["job-1"].stage, "Applied");
  assert.equal(restored.applications["job-1"].activity[0].type, "stage_changed");
});

test("dashboard uses persisted sessions, jobs, and workspace counts", () => {
  let workspace = createWorkspace("2026-07-15T00:00:00.000Z");
  workspace.lastVisitAt = "2026-07-15T00:00:00.000Z";
  workspace = saveStrategy(workspace, manualStrategy(createManualProfile(), { primaryRoles: ["Researcher"] }));
  workspace.strategies[0].status = "active";
  workspace = updateApplication(workspace, "job-1", { nextAction: "Send follow-up", followUpDate: "2026-07-16" });
  workspace.notifications = [{ id: "n1", dedupeKey: "new", type: "new_strong_matches", title: "New", detail: "One match", createdAt: "2026-07-16T00:00:00.000Z", readAt: null, dismissedAt: null, targetView: "discover" }];
  const summary = dashboardSummary(workspace, [{ id: "s1", status: "success", result_count: 1, started_at: "2026-07-16T00:00:00.000Z", coverage: { state: "partial", incomplete_sources: 1, source_selection: { observed_jobs_in_completed_runs: 7 } } }], [job()], new Date("2026-07-16T12:00:00.000Z"));
  assert.deepEqual(summary, { strongMatches: 1, newSinceLastVisit: 1, expansionAdded: 7, activeSearches: 1, coverageIssues: 1, savedJobsClosed: 0, applicationsNeedingAction: 1, recentViews: 0, unreadNotifications: 1 });
});

test("explicit hard disqualifiers never count as strong matches", () => {
  const workspace = createWorkspace();
  const summary = dashboardSummary(workspace, [], [job({ eligibilityStatus: "excluded", score: 99 }), job({ id: "job-2", eligibilityStatus: "timezone_mismatch", score: 95 })]);
  assert.equal(summary.strongMatches, 0);
});

test("dismiss feedback persists, explains a safe suggestion, and supports undo", () => {
  let workspace = addFeedback(createWorkspace(), "job-1", "not_eligible", "session-1");
  const feedbackId = workspace.feedback[0].id;
  assert.deepEqual(workspace.dismissedJobIds, ["job-1"]);
  assert.match(workspace.feedback[0].suggestedStrategyChange ?? "", /will not be changed automatically/i);
  workspace = undoFeedback(workspace, feedbackId);
  assert.equal(workspace.feedback[0].undoneAt === null, false);
  assert.deepEqual(workspace.dismissedJobIds, []);
  workspace.learnedPreferences.fewerRoleTerms = ["sales"];
  assert.deepEqual(resetLearnedPreferences(workspace).learnedPreferences.fewerRoleTerms, []);
});

test("notifications deduplicate and persist read and dismissed state", () => {
  const input = { dedupeKey: "session-1-complete", type: "source_expansion_completed" as const, title: "Expansion complete", detail: "Three sources checked", targetView: "searches" as const };
  let workspace = addNotification(createWorkspace(), input);
  workspace = addNotification(workspace, input);
  assert.equal(workspace.notifications.length, 1);
  workspace = updateNotification(workspace, workspace.notifications[0].id, "read");
  assert.ok(workspace.notifications[0].readAt);
  workspace = updateNotification(workspace, workspace.notifications[0].id, "dismiss");
  assert.ok(workspace.notifications[0].dismissedAt);
});

test("AI previews distinguish local and external requests", () => {
  const local = aiRequestPreview({ provider: "Ollama", model: "qwen3", baseUrl: "http://localhost:11434/v1", purpose: "Suggest title synonyms", dataCategories: ["confirmed role goals"], estimatedInputCharacters: 980 });
  const external = aiRequestPreview({ provider: "NVIDIA NIM", model: "llama", baseUrl: "https://integrate.api.nvidia.com/v1", purpose: "Rank jobs", dataCategories: ["resume text", "job summaries"], estimatedInputCharacters: 12_400 });
  assert.equal(local.location, "local");
  assert.equal(external.location, "external");
  assert.equal(external.passesThroughRoleAtlas, true);
});

test("service mode never implies the complete stack when dependencies are down", () => {
  const status: ServiceStatus = { web: "available", database: "unavailable", nats: "unavailable", scout: "unavailable", crawler: "unavailable", ai: "unavailable", checkedAt: "2026-07-16T00:00:00.000Z" };
  assert.equal(serviceMode(status), "web-only");
  assert.equal(serviceMode({ ...status, database: "available", scout: "available" }), "degraded");
  assert.equal(serviceMode({ ...status, database: "available", scout: "available", nats: "available", crawler: "available" }), "complete");
});
