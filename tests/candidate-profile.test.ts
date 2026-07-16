import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidateProfile, buildSearchPlan } from "../app/candidateProfile.ts";

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

test("does not invent a location when the résumé has none", () => {
  const profile = buildCandidateProfile({ fileName: "resume.pdf", name: "Candidate", location: null, skills: [], suggestedRoles: ["Entry-level opportunities"], text: "Project portfolio and coursework." });
  assert.equal(profile.location, null);
  assert.deepEqual(buildSearchPlan(profile).locations, []);
});
