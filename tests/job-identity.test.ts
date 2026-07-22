import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeJobUrl, deduplicateJobs, mergeImportedJobs, mergeSearchResultJobs } from "../app/jobIdentity.ts";
import { getLiveJobs } from "../app/liveJobs.ts";
import type { Job } from "../app/jobs.ts";

function job(overrides: Partial<Job>): Job {
  return {
    id: "source-1", title: "Software Intern", company: "Example", initials: "E", location: "Bengaluru, India",
    country: "India", workMode: "On-site", type: "Internship", category: "Engineering", experience: 0,
    experienceLabel: "No experience", salaryMin: 0, salaryMax: 0, currency: "", salaryPeriod: "year",
    postedDays: 1, degreeRequired: null, visaSupport: false, source: "Lever", url: "https://jobs.example.test/1",
    verified: true, score: 0, accent: "mint", skills: [], reasons: [], gap: "", summary: "", ...overrides,
  };
}

test("canonicalizes tracking variants to one listing URL", () => {
  assert.equal(
    canonicalizeJobUrl("https://www.example.test/jobs/7/?utm_source=newsletter&gh_jid=7#apply"),
    "https://example.test/jobs/7?gh_jid=7",
  );
  assert.equal(deduplicateJobs([
    job({ id: "a", url: "https://example.test/jobs/7?utm_source=a" }),
    job({ id: "b", source: "Other feed", url: "https://example.test/jobs/7?utm_source=b" }),
  ]).length, 1);
});

test("preserves legitimate same-title openings in different locations", () => {
  const jobs = deduplicateJobs([
    job({ id: "one", location: "Bengaluru, India", url: "https://example.test/jobs/1" }),
    job({ id: "two", location: "Pune, India", url: "https://example.test/jobs/2" }),
  ]);
  assert.equal(jobs.length, 2);
});

test("preserves same-title openings with different requisition IDs", () => {
  const jobs = deduplicateJobs([
    job({ id: "one", sourceJobId: null, requisitionId: "REQ-101", companyDomain: "example.test", url: "https://example.test/jobs/101", postedAt: "2026-07-10T00:00:00Z" }),
    job({ id: "two", sourceJobId: null, requisitionId: "REQ-102", companyDomain: "example.test", url: "https://example.test/jobs/102", postedAt: "2026-07-10T00:00:00Z" }),
  ]);
  assert.equal(jobs.length, 2);
});

test("merges one listing exposed through canonical URL variants", () => {
  const jobs = deduplicateJobs([
    job({ id: "feed-a", source: "Feed A", sourceJobId: "a", canonicalUrl: "https://example.test/jobs/7?utm_source=a", url: "https://example.test/jobs/7?utm_source=a" }),
    job({ id: "feed-b", source: "Feed B", sourceJobId: "b", canonicalUrl: "https://www.example.test/jobs/7?utm_source=b#apply", url: "https://www.example.test/jobs/7?utm_source=b#apply" }),
  ]);
  assert.equal(jobs.length, 1);
});

test("keeps rich listing content without losing persisted search evidence", () => {
  const searchResult = job({
    id: "scout-search",
    url: "https://example.test/jobs/7?utm_source=session",
    description: "Short indexed copy.",
    score: 86,
    scoreKind: "search",
    reasons: ["Matched your confirmed search query: Research Analyst."],
    eligibilityStatus: "unclear",
    eligibilityEvidence: ["The listing does not state its remote scope."],
  });
  const richFeedCopy = job({
    id: "feed-copy",
    source: "Public feed",
    url: "https://www.example.test/jobs/7?utm_source=feed",
    description: "A much longer public listing description with full responsibilities and requirements.",
    score: 94,
    scoreKind: "estimate",
    reasons: ["Preliminary feed estimate."],
  });

  const [merged] = mergeSearchResultJobs([richFeedCopy], [searchResult]);
  assert.equal(merged.id, "scout-search");
  assert.equal(merged.description, richFeedCopy.description);
  assert.equal(merged.score, 86);
  assert.equal(merged.scoreKind, "search");
  assert.deepEqual(merged.reasons, searchResult.reasons);
  assert.equal(merged.eligibilityStatus, "unclear");
});

test("later feed refreshes cannot replace active search-session evidence", () => {
  const searchResult = job({
    id: "scout-search",
    url: "https://example.test/jobs/7",
    score: 86,
    scoreKind: "search",
    reasons: ["Matched the active strategy."],
    eligibilityStatus: "likely",
  });
  const refreshedFeed = job({
    id: "scout-search",
    url: "https://example.test/jobs/7",
    score: 94,
    scoreKind: "estimate",
    reasons: ["Generic feed estimate."],
    description: "A newer and more complete feed description.",
  });

  const [merged] = mergeImportedJobs([searchResult], [refreshedFeed]);
  assert.equal(merged.description, refreshedFeed.description);
  assert.equal(merged.score, 86);
  assert.equal(merged.scoreKind, "search");
  assert.deepEqual(merged.reasons, searchResult.reasons);
  assert.equal(merged.eligibilityStatus, "likely");
});

test("returns an explicit unavailable state instead of fictional jobs when all feeds fail", async () => {
  const payload = await getLiveJobs({
    fetchers: [["Unavailable fixture", async () => { throw new Error("offline"); }]],
    exchangeRateLoader: async () => ({}),
  });
  assert.equal(payload.sourceStatus, "unavailable");
  assert.deepEqual(payload.jobs, []);
  assert.deepEqual(payload.failedSources, ["Unavailable fixture"]);
});

test("does not block discovery when a supplemental feed never responds", async () => {
  const startedAt = Date.now();
  const payload = await getLiveJobs({
    fetchers: [["Hanging fixture", () => new Promise(() => {})]],
    exchangeRateLoader: () => new Promise(() => {}),
    timeoutMs: 5,
  });
  assert.equal(payload.sourceStatus, "unavailable");
  assert.deepEqual(payload.failedSources, ["Hanging fixture"]);
  assert.ok(Date.now() - startedAt < 250);
});

test("can render the complete Scout stack without waiting on supplemental feeds", async () => {
  let called = false;
  const payload = await getLiveJobs({
    publicFeedsDisabled: true,
    fetchers: [["Should not run", async () => { called = true; return []; }]],
    exchangeRateLoader: async () => { called = true; return {}; },
  });
  assert.equal(called, false);
  assert.equal(payload.sourceStatus, "unavailable");
  assert.deepEqual(payload.jobs, []);
});

test("loads visibly unverified demo records only in explicit demo mode", async () => {
  const payload = await getLiveJobs({
    demoMode: true,
    fetchers: [["Unavailable fixture", async () => { throw new Error("offline"); }]],
    exchangeRateLoader: async () => ({}),
  });
  assert.equal(payload.sourceStatus, "demo");
  assert.ok(payload.jobs.length > 0);
  assert.ok(payload.jobs.every((listing) => listing.isDemo && !listing.verified));
});
