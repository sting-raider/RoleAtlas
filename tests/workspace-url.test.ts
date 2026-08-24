import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The URL vocabulary lives in app/workspaceUrl.ts, a dependency-free module so
// these tests can execute it directly under --experimental-strip-types.
const { parseWorkspaceView, serializeWorkspaceView, VIEW_IDS } = await import("../app/workspaceUrl.ts");

const navItemsSource = await readFile(new URL("../app/components/navItems.tsx", import.meta.url), "utf8");

test("every navigation item id round-trips through the workspace URL helpers", () => {
  // NAV_ITEMS is pinned textually because importing it would pull lucide-react
  // icons into this test process.
  const declared = [...navItemsSource.matchAll(/id: "([a-z]+)"/g)].map((match) => match[1]);
  assert.ok(declared.length >= 8, "all eight workspaces must appear in NAV_ITEMS");
  for (const id of declared) {
    assert.equal(parseWorkspaceView(serializeWorkspaceView(id as never)), id);
  }
  assert.deepEqual([...VIEW_IDS].sort(), [...new Set(declared)].sort());
});

test("unknown or missing view values fall back to home", () => {
  assert.equal(parseWorkspaceView(null), "home");
  assert.equal(parseWorkspaceView(undefined), "home");
  assert.equal(parseWorkspaceView(""), "home");
  assert.equal(parseWorkspaceView("exploits"), "home");
  assert.equal(parseWorkspaceView("Home"), "home");
  assert.equal(parseWorkspaceView("../../admin"), "home");
  assert.equal(parseWorkspaceView("discover"), "discover");
});

test("the app parses its initial view and job from the address bar once", async () => {
  const app = await readFile(new URL("../app/RoleAtlasApp.tsx", import.meta.url), "utf8");
  assert.match(app, /readInitialWorkspaceState\(\)/);
  assert.match(app, /syncWorkspaceUrl\(/);
  // replaceState keeps the SSR auth route intact: no client navigation is used.
  assert.doesNotMatch(app, /useSearchParams|useRouter|router\.push/);
});
