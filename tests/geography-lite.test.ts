import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { LITE_COUNTRIES, liteCountryByCode, resolveLiteCountry } from "../shared/geography-lite.ts";

test("lite country dataset covers every ISO code with a display name", () => {
  assert.equal(LITE_COUNTRIES.length, 249);
  for (const country of LITE_COUNTRIES) {
    assert.match(country.code, /^[A-Z]{2}$/);
    assert.ok(country.name.length > 0);
  }
});

test("resolves exact names, codes, and romanized aliases; rejects free text", () => {
  assert.equal(resolveLiteCountry("United States")?.code, "US");
  assert.equal(resolveLiteCountry("usa")?.code, "US");
  assert.equal(resolveLiteCountry("IND")?.code, "IN");
  assert.equal(resolveLiteCountry("Bharat")?.code, "IN");
  // Diacritic folding matches the server key() shape.
  assert.equal(resolveLiteCountry("BHĀRAT")?.code, "IN");
  // Free-text phrase resolution stays a server capability.
  assert.equal(resolveLiteCountry("Bengaluru, India"), null);
  assert.equal(resolveLiteCountry("Somewhere entirely unknown"), null);
  assert.equal(resolveLiteCountry(null), null);
});

test("round-trips codes to display names", () => {
  assert.equal(liteCountryByCode("gb")?.name, "United Kingdom");
  assert.equal(liteCountryByCode("ZZ"), null);
  assert.equal(liteCountryByCode(null), null);
});

test("client components never import the heavy geography barrel", async () => {
  const heavy = await readFile("shared/geography.ts", "utf8");
  const heavyImports = ["countries.json", "cities.json", "regions.json", "subdivisions.json"].filter((dataset) => heavy.includes(dataset));
  assert.equal(heavyImports.length, 4);
  const offenders: string[] = [];
  for (const file of [
    "app/RoleAtlasApp.tsx",
    "app/DailyWorkspaces.tsx",
    "app/OnboardingFlow.tsx",
    "app/candidateProfile.ts",
    "app/jobRanking.ts",
    "app/scoutIndex.ts",
    "app/workspaceUrl.ts",
    "app/components/ui.tsx",
    "app/components/JobCard.tsx",
    "app/components/FilterPanel.tsx",
    "app/components/JobDrawer.tsx",
    "app/components/navItems.tsx",
  ]) {
    const source = (await readFile(file, "utf8"))
      // Type-only references are erased at compile time and cost nothing in
      // the bundle; value imports are what would drag the JSON corpora in.
      .replace(/^\s*import\s+type\s[^;]+;/gm, "")
      .replace(/import\("\.\.\/shared\/geography"\)/g, "");
    if (/from "\.\.\/(\.\/)?shared\/geography"/.test(source)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
