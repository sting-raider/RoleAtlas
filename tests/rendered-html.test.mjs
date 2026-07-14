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

test("server-renders the FirstRung discovery experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>FirstRung/);
  assert.match(html, /Good jobs shouldn.t hide behind/);
  assert.match(html, /qualification-first job finder/i);
  assert.match(html, /DeepSeek/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("keeps the product metadata and experience-barrier filters in source", async () => {
  const [layout, app, packageJson] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/FirstRungApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /FirstRung — Find jobs that fit where you are now/);
  assert.match(layout, /openGraph/);
  assert.match(app, /Experience ceiling/);
  assert.match(app, /Education not required/);
  assert.match(app, /Visa support stated/);
  assert.match(app, /Custom OpenAI-compatible|provider-neutral/);
  assert.doesNotMatch(packageJson, /site-creator|react-loading-skeleton/);
});
