import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the RoleAtlas discovery experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>RoleAtlas/);
  assert.match(html, /Good jobs shouldn.t hide behind/);
  assert.match(html, /qualification-first job finder/i);
  assert.match(html, /DeepSeek/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
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
  assert.match(matchRoute, /jobs\.slice\(0, 40\)/);
  assert.match(matchRoute, /infer realistic role families and search terms/);
  assert.match(resumeRoute, /extractText/);
  assert.ok(seeds.split(/\r?\n/).filter((line) => line.trim()).length >= 20);
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
  assert.match(seeds, /api\.lever\.co\/v0\/postings/);
  assert.match(seeds, /boards-api\.greenhouse\.io/);
});
