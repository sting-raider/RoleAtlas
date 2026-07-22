import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../site/app.js", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");

test("the public showcase distinguishes samples from live coverage", () => {
  assert.match(page, /illustrative data/i);
  assert.match(page, /ILLUSTRATIVE SAMPLE/);
  assert.match(page, /Unknown stays unknown/);
  assert.doesNotMatch(page, /complete global coverage/i);
});

test("the public product sample exposes keyboard-navigable views", () => {
  assert.match(page, /role="tablist"/);
  assert.match(page, /data-view="home"/);
  assert.match(page, /data-view="discover"/);
  assert.match(page, /data-view="searches"/);
  assert.match(script, /ArrowLeft/);
  assert.match(script, /ArrowRight/);
});

test("GitHub Pages deploys the static showcase only from master", () => {
  assert.match(workflow, /branches: \[master\]/);
  assert.match(workflow, /path: site/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
});
