import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidateProfile, buildSearchPlan, emptyCandidateMobility, searchPlanGeographyLabel, type SearchPlan } from "../app/candidateProfile.ts";
import { inferProfile } from "../app/api/resume/route.ts";

function plan(overrides: Partial<SearchPlan>): SearchPlan {
  return {
    roleQueries: ["Researcher"],
    locations: [],
    jobTypes: [],
    workModes: [],
    maxExperience: null,
    noDegreeRequired: false,
    mobility: emptyCandidateMobility(),
    generatedAt: "2026-07-17T00:00:00.000Z",
    confirmedAt: null,
    ...overrides,
  };
}

test("builds an evidence-backed editable profile and deterministic early-career plan", () => {
  const profile = buildCandidateProfile({ fileName: "resume.pdf", name: "Asha Rao", location: "Bengaluru, India", skills: ["React", "SQL"],
    suggestedRoles: ["Frontend Developer", "Data Analyst"], text: "Asha Rao Bengaluru, India. Student project using React and SQL. Seeking an internship." });
  const plan = buildSearchPlan(profile);
  assert.equal(profile.skills[0].confidence, 0.9);
  assert.match(profile.skills[0].evidence, /React/i);
  assert.deepEqual(plan.roleQueries, ["Frontend Developer", "Data Analyst"]);
  assert.deepEqual(plan.jobTypes, ["Internship", "Entry-level", "Apprenticeship"]);
  assert.equal(profile.mobility.residenceCountryCode, "IN");
  assert.deepEqual(profile.mobility.citizenshipCountryCodes, []);
  assert.deepEqual(profile.mobility.workAuthorizedCountryCodes, []);
  assert.deepEqual(profile.mobility.requiresSponsorshipCountryCodes, []);
  assert.ok(profile.mobility.inferredFields.includes("residenceCountryCode"));
  assert.equal(plan.maxExperience, 1);
  assert.equal(plan.confirmedAt, null);
});

test("resume extraction uses the global geography model instead of a country-specific city list", () => {
  assert.equal(inferProfile("Morgan Lee\nPolicy researcher based in Wellington, New Zealand with survey experience.").location, "Wellington, New Zealand");
  assert.equal(inferProfile("Amina Diallo\nOperations coordinator in Dakar, Senegal.").location, "Dakar, Senegal");
  assert.equal(inferProfile("Jordan Smith\nResearch and writing portfolio with no location supplied.").location, null);
});

test("does not invent a location when the résumé has none", () => {
  const profile = buildCandidateProfile({ fileName: "resume.pdf", name: "Candidate", location: null, skills: [], suggestedRoles: ["Entry-level opportunities"], text: "Project portfolio and coursework." });
  assert.equal(profile.location, null);
  assert.deepEqual(buildSearchPlan(profile).locations, []);
});

test("search geography prefers structured mobility countries and falls back safely", () => {
  const mobility = { ...emptyCandidateMobility(), preferredCountryCodes: ["GB", "DE"] };
  assert.equal(searchPlanGeographyLabel(plan({ locations: [], mobility })), "United Kingdom, Germany");
  assert.equal(searchPlanGeographyLabel(plan({ locations: ["APAC"] })), "APAC");
  assert.equal(searchPlanGeographyLabel(plan({ locations: ["London, UK"], mobility })), "United Kingdom, Germany");
  assert.equal(searchPlanGeographyLabel(plan({ locations: [], mobility: { ...emptyCandidateMobility(), preferredCountryCodes: ["ZZ"] } })), "ZZ");
  assert.equal(searchPlanGeographyLabel(plan({ locations: [] })), "Open geography");
});
