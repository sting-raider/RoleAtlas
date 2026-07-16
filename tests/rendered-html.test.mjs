import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  process.env.ROLEATLAS_DEMO_MODE = "true";
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the RoleAtlas daily home experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>RoleAtlas/);
  assert.match(html, /What deserves your attention/);
  assert.match(html, /new matches, active searches, and application follow-ups/i);
  assert.match(html, /Home/);
  assert.match(html, /Discover/);
  assert.match(html, /Searches/);
  assert.match(html, /Applications/);
  assert.match(html, /NVIDIA NIM/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("ships the resumable onboarding and daily-use workspaces", async () => {
  const [app, onboarding, workspaces, dailyProduct, css, workspaceRoute] = await Promise.all([
    readFile(new URL("../app/FirstRungApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OnboardingFlow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/DailyWorkspaces.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dailyProduct.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(onboarding, /Use my resume/);
  assert.match(onboarding, /Create it manually/);
  assert.match(onboarding, /Review the search strategy/);
  assert.match(onboarding, /inferred/i);
  assert.match(workspaces, /CandidateFacts/);
  assert.match(workspaces, /Revision history/);
  assert.match(workspaces, /Existing index searched/);
  assert.match(workspaces, /Source job status/);
  assert.match(workspaces, /AI activity history/);
  assert.match(app, /Wrong seniority/);
  assert.match(dailyProduct, /resetLearnedPreferences/);
  assert.match(app, /AiActionPreviewModal/);
  assert.match(app, /Why am I seeing this/);
  assert.match(app, /Undo/);
  assert.match(workspaceRoute, /SCOUT_API_URL/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(onboarding, /autoFocus|focus\(/);
});

test("keeps the automated resume-first workflow and unselected filters in source", async () => {
  const [layout, app, packageJson, compose, seeds, matchRoute, resumeRoute, scoutDockerfile] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/FirstRungApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../docker-compose.yml", import.meta.url), "utf8"),
    readFile(new URL("../services/scout/default_seeds.txt", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/match/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/resume/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../services/scout/Dockerfile", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /RoleAtlas — Find work that fits your life/);
  assert.match(layout, /openGraph/);
  assert.match(app, /Experience ceiling/);
  assert.match(app, /Education not required/);
  assert.match(app, /Visa support stated/);
  assert.match(app, /type="file" accept="application\/pdf,\.pdf"/);
  assert.match(app, /onClick=\{findMyFit\}/);
  assert.match(app, /firstrung-resume-session/);
  assert.match(app, /runAiMatching/);
  assert.match(app, /!resumeProfile && candidateProfile && searchPlan/);
  assert.match(matchRoute, /jobs\.slice\(0, 40\)/);
  assert.match(matchRoute, /infer realistic role families and search terms/);
  assert.match(resumeRoute, /extractText/);
  assert.equal(seeds.split(/\r?\n/).filter((line) => line.trim()).length, 16);
  assert.doesNotMatch(packageJson, /site-creator|react-loading-skeleton/);
  assert.match(app, /maxExperience: null/);
  assert.match(app, /Every country/);
  assert.match(app, /Choose country first/);
  assert.match(app, /Scout control center/);
  assert.match(app, /Geographic eligibility evidence/);
  assert.match(app, /Countries where you already have work authorization/);
  assert.match(app, /never infers citizenship, visas, or work authorization/i);
  assert.match(compose, /SCOUT_API_URL: http:\/\/api:8080/);
  assert.match(compose, /RECRAWL_INTERVAL_SECS/);
  assert.match(scoutDockerfile, /COPY services\/scout\/default_seeds\.txt/);
});

test("ships polished controls without placeholder account actions", async () => {
  const [app, matchRoute] = await Promise.all([
    readFile(new URL("../app/FirstRungApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/match/route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(app, /Alex Morgan|Open account menu|aria-label="Notifications"|Weekly review/);
  assert.doesNotMatch(app, /<select/);
  assert.match(app, /function SelectMenu/);
  assert.match(matchRoute, /chunk/);
});

test("ships a Career Ops application workspace backed by the full listing", async () => {
  const [app, prepareRoute, jobs, liveJobs, extractor, seeds] = await Promise.all([
    readFile(new URL("../app/FirstRungApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/prepare/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/jobs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/liveJobs.ts", import.meta.url), "utf8"),
    readFile(new URL("../services/scout/src/extract.rs", import.meta.url), "utf8"),
    readFile(new URL("../services/scout/default_seeds.txt", import.meta.url), "utf8"),
  ]);
  assert.match(jobs, /description\?: string/);
  assert.match(liveJobs, /description,\s*\n\s*};/);
  assert.match(app, /Application workspace/);
  assert.match(app, /firstrung-dossiers/);
  assert.match(app, /Truthful bullet rewrites/);
  assert.match(app, /Recruiter message/);
  assert.match(app, /Questions they may ask/);
  assert.match(prepareRoute, /complete, honest career-operations dossier/i);
  assert.match(prepareRoute, /Never invent experience/);
  assert.match(prepareRoute, /coverLetter/);
  assert.match(extractor, /extract_provider_json/);
  assert.match(extractor, /normalize_lever_job/);
  assert.match(seeds, /boards-api\.greenhouse\.io/);
  assert.match(seeds, /api\.ashbyhq\.com\/posting-api\/job-board/);
});
