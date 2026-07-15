import assert from "node:assert/strict";
import test from "node:test";
import { annualSalary, classifyJobType, formatSalary, normalizeCurrency, normalizeSalaryPeriod, salaryUsdEquivalent } from "../app/jobData.ts";

test("preserves and displays JPY instead of coercing it to dollars", () => {
  assert.equal(normalizeCurrency("JPY"), "JPY");
  const label = formatSalary({ salaryMin: 10_000_000, salaryMax: 12_000_000, currency: "JPY", salaryPeriod: "year" });
  assert.match(label, /¥|JPY/);
  assert.doesNotMatch(label, /^\$/);
});

test("salary comparison annualizes periods and converts currencies", () => {
  const rates = { USD: 1, JPY: 160 };
  const japaneseRole = salaryUsdEquivalent({ salaryMin: 10_000_000, salaryMax: 12_000_000, currency: "JPY", salaryPeriod: "year" }, rates);
  const usRole = salaryUsdEquivalent({ salaryMin: 100_000, salaryMax: 100_000, currency: "USD", salaryPeriod: "year" }, rates);
  assert.equal(japaneseRole, 75_000);
  assert.equal(usRole, 100_000);
  assert.ok(usRole! > japaneseRole!);
  assert.equal(annualSalary(50, "hour"), 104_000);
  assert.equal(normalizeSalaryPeriod("HOURLY"), "hour");
});

test("crawler jobs use their title when the ATS omits employment type", () => {
  assert.equal(classifyJobType("Application Security Intern", ""), "Internship");
  assert.equal(classifyJobType("Industrial Trainee (Accounting)", ""), "Apprenticeship");
});
