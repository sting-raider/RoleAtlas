import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { readdirSync } from "node:fs";
import test from "node:test";

// The web CI job runs without PostgreSQL, and every route funnels through the
// Better Auth session lookup, so no page can server-render in that job.
// Instead this suite pins the deployment contract: the exact artifacts
// Dockerfile.web copies must exist after `next build` with output:
// "standalone", and the emitted client bundle must actually carry the daily
// workspace experience. The live SSR proof (auth redirect + sign-in render)
// runs in the compose-smoke CI job, where the full stack with a database is
// already up.

test("builds the standalone server that Dockerfile.web deploys", async () => {
  const standaloneRoot = new URL("../.next/standalone/", import.meta.url);
  const [serverJs, buildId] = await Promise.all([
    stat(new URL("server.js", standaloneRoot)),
    readFile(new URL(".next/BUILD_ID", standaloneRoot), "utf8"),
  ]);
  assert.ok(serverJs.isFile(), ".next/standalone/server.js is missing; run npm run build");
  assert.match(
    buildId.trim(),
    /^[A-Za-z0-9_-]{10,}$/,
    "BUILD_ID must be present for the runtime to serve built pages",
  );

  // Dockerfile.web copies .next/static over the standalone tree; both halves
  // of the runtime payload must exist side by side.
  const staticDir = await stat(new URL("../.next/static/", import.meta.url));
  assert.ok(staticDir.isDirectory(), ".next/static is missing; run npm run build");
});

test("ships the daily-workspace experience inside the emitted client bundle", async () => {
  const staticChunks = new URL("../.next/static/chunks/", import.meta.url);
  await access(staticChunks);
  let foundCopy = false;
  let foundNav = false;
  for (const entry of readdirSync(staticChunks)) {
    if (!entry.endsWith(".js")) continue;
    const source = await readFile(new URL(entry, staticChunks), "utf8");
    if (/Your next credible move/.test(source) && /Strong matches, active searches/i.test(source)) {
      foundCopy = true;
    }
    if (/Home/.test(source) && /Discover/.test(source) && /"Applications"/.test(source)) {
      foundNav = true;
    }
  }
  assert.ok(foundCopy, "daily-workspace copy missing from the client bundle");
  assert.ok(foundNav, "workspace navigation labels missing from the client bundle");
});

test("ships the resumable onboarding and daily-use workspaces", async () => {
  const [app, onboarding, workspaces, dailyProduct, tokens, baseCss, structureCss, appCss, signalGlyph, scoutProxy, scoutClient, jobCardComponent, jobDrawerComponent, jobRankingSource] = await Promise.all([
    readFile(new URL("../app/RoleAtlasApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OnboardingFlow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/DailyWorkspaces.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dailyProduct.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/base.css", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/structure.css", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/app.css", import.meta.url), "utf8"),
    readFile(new URL("../app/SignalGlyph.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/scoutProxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/scout-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/JobCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/JobDrawer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/jobRanking.ts", import.meta.url), "utf8"),
  ]);
  assert.match(onboarding, /Use my resume/);
  assert.match(onboarding, /Create it manually/);
  assert.match(onboarding, /Review the search strategy/);
  assert.match(onboarding, /goWith\(\{ strategy: next \}, "strategy-preview"\)/);
  assert.match(onboarding, /inferred/i);
  assert.match(onboarding, /<nav className="onboarding-step-list" aria-label="Setup steps">/);
  assert.doesNotMatch(onboarding, /role="listitem"/);
  assert.doesNotMatch(onboarding, /<ol>|<li/);
  assert.match(structureCss, /\.onboarding-step-list > div::marker \{[^}]*content: none !important/);
  assert.match(workspaces, /CandidateFacts/);
  assert.match(workspaces, /Revision history/);
  assert.match(workspaces, /Existing index searched/);
  assert.match(workspaces, /Source job status/);
  assert.match(workspaces, /AI activity history/);
  assert.match(jobCardComponent, /Wrong seniority/);
  assert.match(dailyProduct, /resetLearnedPreferences/);
  assert.match(app, /AiActionPreviewModal/);
  assert.match(jobDrawerComponent, /Why am I seeing this/);
  assert.match(app, /activeSearchJobIds/);
  assert.match(app, /setSort\("match"\)/);
  assert.match(jobRankingSource, /raw\.search_score/);
  assert.match(jobCardComponent, /Strategy match/);
  assert.match(app, /Undo/);
  assert.match(scoutProxy, /lib\/scout-client/);
  assert.match(scoutClient, /SCOUT_API_URL/);
  assert.match(structureCss, /@media \(max-width: 760px\)/);
  assert.match(baseCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(tokens, /--accent: #9c3a1b/, "editorial oxblood accent replaces the signal red");
  assert.match(tokens, /--f-display: var\(--font-newsreader\)/, "headlines use the serif display voice");
  assert.doesNotMatch(tokens, /font-doto/, "the dot-matrix display font is retired");
  assert.match(tokens, /:root \{/, "light paper theme is the root default");
  assert.match(tokens, /\[data-theme="dark"\]/);
  assert.match(appCss, /side-nav button\.active/);
  assert.match(appCss, /background: var\(--display\)/);
  assert.match(signalGlyph, /const GLYPHS/);
  assert.match(signalGlyph, /OpportunitySignal/);
  assert.match(onboarding, /autoFocus|focus\(/);
});

test("keeps the automated resume-first workflow and unselected filters in source", async () => {
  const [layout, app, packageJson, compose, seeds, matchRoute, resumeRoute, resumeExtract, scoutDockerfile, jobCardComponent, filterPanel, resumeModal, profileReviewModal, jobRankingSource] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/RoleAtlasApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../docker-compose.yml", import.meta.url), "utf8"),
    readFile(new URL("../services/scout/default_seeds.txt", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/match/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/resume/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/resumeExtract.ts", import.meta.url), "utf8"),
    readFile(new URL("../services/scout/Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../app/components/JobCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/FilterPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ResumeModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ProfileReviewModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/jobRanking.ts", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /RoleAtlas .* Find work that fits your life/);
  assert.match(layout, /openGraph/);
  assert.match(filterPanel, /Experience ceiling/);
  assert.match(app, /Education not required/);
  assert.match(filterPanel, /Visa support stated/);
  assert.match(resumeModal, /type="file" accept="application\/pdf,\.pdf,\.docx"/);
  assert.match(app, /onClick=\{findMyFit\}/);
  assert.match(app, /accountStorageKey\(currentUser\.id, ACCOUNT_STORAGE_KEYS\.resumeSession\)/);
  assert.match(app, /runAiMatching/);
  assert.match(app, /!resumeProfile && candidateProfile && searchPlan/);
  assert.match(matchRoute, /jobs\.slice\(0, 40\)/);
  assert.match(matchRoute, /infer realistic role families and search terms/);
  assert.match(resumeRoute, /detectResumeKind/, "route must identify files by magic bytes");
  assert.match(resumeRoute, /extractResume/, "route must use the bounded extraction layer");
  assert.match(
    resumeRoute,
    /readBoundedBody[\s\S]*formData/,
    "the upload ceiling is enforced on the stream before any buffering",
  );
  assert.match(resumeExtract, /MAX_RESUME_BYTES/, "the upload ceiling is a shared named constant");
  assert.match(resumeExtract, /extractText/, "the extraction layer owns PDF parsing");
  assert.match(resumeExtract, /MAX_RESUME_PAGES/, "page caps are enforced structurally");
  assert.equal(seeds.split(/\r?\n/).filter((line) => line.trim()).length, 16);
  assert.doesNotMatch(packageJson, /site-creator|react-loading-skeleton/);
  assert.match(jobRankingSource, /maxExperience: null/);
  assert.match(app, /Every country/);
  assert.match(app, /Choose country first/);
  assert.doesNotMatch(app, /Scout control center/);
  assert.match(jobCardComponent, /Why this is in your search/);
  assert.match(profileReviewModal, /Countries where you already have work authorization/);
  assert.match(profileReviewModal, /never infers citizenship, visas, or work authorization/i);
  assert.match(compose, /SCOUT_API_URL: http:\/\/api:8080/);
  assert.match(compose, /RECRAWL_INTERVAL_SECS/);
  assert.match(scoutDockerfile, /COPY services\/scout\/default_seeds\.txt/);
});

test("ships polished controls without placeholder account actions", async () => {
  const [app, matchRoute, uiComponents] = await Promise.all([
    readFile(new URL("../app/RoleAtlasApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/match/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ui.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(app, /Alex Morgan|Open account menu|aria-label="Notifications"|Weekly review/);
  assert.doesNotMatch(app, /<select/);
  assert.match(uiComponents, /export function SelectMenu/);
  assert.match(matchRoute, /chunk/);
});

test("ships a Career Ops application workspace backed by the full listing", async () => {
  const [app, prepareRoute, jobs, liveJobs, extractor, seeds, jobDrawerComponent] = await Promise.all([
    readFile(new URL("../app/RoleAtlasApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/prepare/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/jobs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/liveJobs.ts", import.meta.url), "utf8"),
    readFile(new URL("../services/scout/src/extract.rs", import.meta.url), "utf8"),
    readFile(new URL("../services/scout/default_seeds.txt", import.meta.url), "utf8"),
    readFile(new URL("../app/components/JobDrawer.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(jobs, /description\?: string/);
  assert.match(liveJobs, /description,\s*\n\s*};/);
  assert.match(jobDrawerComponent, /Application workspace/);
  assert.match(app, /accountStorageKey\(currentUser\.id, ACCOUNT_STORAGE_KEYS\.dossiers\)/);
  assert.match(jobDrawerComponent, /Truthful bullet rewrites/);
  assert.match(jobDrawerComponent, /Recruiter message/);
  assert.match(jobDrawerComponent, /Questions they may ask/);
  assert.match(prepareRoute, /complete, honest career-operations dossier/i);
  assert.match(prepareRoute, /Never invent experience/);
  assert.match(prepareRoute, /coverLetter/);
  assert.match(extractor, /extract_provider_json/);
  assert.match(extractor, /normalize_lever_job/);
  assert.match(seeds, /boards-api\.greenhouse\.io/);
  assert.match(seeds, /api\.ashbyhq\.com\/posting-api\/job-board/);
});
