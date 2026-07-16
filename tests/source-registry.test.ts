import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

type RegistryFixture = {
  id: string;
  company: { domain: string };
  endpointUrl: string;
  hiringCountryCodes: string[];
  status: string;
  autoEnqueue: boolean;
  proposedBy?: string;
  [key: string]: unknown;
};

const current = JSON.parse(readFileSync("sources/registry/global.json", "utf8")) as RegistryFixture[];

function validate(registry: unknown[]) {
  const directory = mkdtempSync(join(tmpdir(), "roleatlas-registry-"));
  const registryPath = join(directory, "registry.json");
  const seedsPath = join(directory, "seeds.txt");
  writeFileSync(registryPath, JSON.stringify(registry));
  const sources = registry as RegistryFixture[];
  writeFileSync(seedsPath, sources.filter((source) => source.status === "verified" && source.autoEnqueue).map((source) => source.endpointUrl).join("\n"));
  const result = spawnSync(process.execPath, ["scripts/validate-registry.mjs"], {
    encoding: "utf8",
    env: { ...process.env, ROLEATLAS_REGISTRY_PATH: registryPath, ROLEATLAS_SEEDS_PATH: seedsPath },
  });
  rmSync(directory, { recursive: true, force: true });
  return result;
}

test("accepts the maintained verified global registry", () => {
  const result = validate(current);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects duplicates, unsupported endpoints, unknown geography, and trusted AI proposals", () => {
  const invalid = structuredClone(current);
  invalid[1].id = invalid[0].id;
  invalid[1].company.domain = invalid[0].company.domain;
  invalid[2].endpointUrl = "https://example.com/invented/jobs";
  invalid[3].hiringCountryCodes = ["ZZ"];
  invalid[4].proposedBy = "ai";
  const result = validate(invalid);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate id/);
  assert.match(result.stderr, /duplicate company domain/);
  assert.match(result.stderr, /endpoint does not match/);
  assert.match(result.stderr, /unknown country code ZZ/);
  assert.match(result.stderr, /AI-proposed sources cannot enter/);
});
