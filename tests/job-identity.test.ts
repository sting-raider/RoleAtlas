import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeJobUrl, deduplicateJobs } from "../app/jobIdentity.ts";
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

test.todo("successful source reconciliation removes listings missing from a complete run");
test.todo("resume-derived role queries execute against the server-side job index");
test.todo("a zero-result response reports source and query coverage");
