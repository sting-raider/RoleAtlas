import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const schema = readJson(process.env.ROLEATLAS_REGISTRY_SCHEMA ?? "sources/schema/source.schema.json");
const registry = readJson(process.env.ROLEATLAS_REGISTRY_PATH ?? "sources/registry/global.json");
const countries = readJson("shared/geography/countries.json");
const regions = readJson("shared/geography/regions.json");
const countryCodes = new Set(countries.map((country) => country.code));
const regionCodes = new Set(regions.map((region) => region.code));
const errors = [];

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(registry)) {
  for (const error of validate.errors ?? []) errors.push(`${error.instancePath || "/"} ${error.message}`);
}

const unique = (label, value, source, seen) => {
  if (seen.has(value)) errors.push(`${source}: duplicate ${label} ${value}`);
  seen.add(value);
};
const ids = new Set();
const domains = new Set();
const endpoints = new Set();
const boards = new Set();
const adapterPatterns = {
  greenhouse: (url, source) => url.hostname === "boards-api.greenhouse.io" && url.pathname === `/v1/boards/${source.boardId}/jobs`,
  lever: (url, source) => ["api.lever.co", "api.eu.lever.co"].includes(url.hostname) && url.pathname === `/v0/postings/${source.boardId}` && url.searchParams.get("mode") === "json",
  ashby: (url, source) => url.hostname === "api.ashbyhq.com" && url.pathname === `/posting-api/job-board/${source.boardId}`,
};

for (const source of registry) {
  const label = source.id ?? "unknown source";
  unique("id", source.id, label, ids);
  unique("company domain", source.company?.domain, label, domains);
  unique("endpoint", source.endpointUrl, label, endpoints);
  unique("adapter board", `${source.adapter}:${source.boardId}`, label, boards);
  if (source.id !== `${source.adapter}:${source.boardId}`) errors.push(`${label}: id must equal adapter:boardId`);
  for (const field of ["careersUrl", "endpointUrl"]) {
    try {
      const url = new URL(source[field]);
      if (url.protocol !== "https:") errors.push(`${label}: ${field} must use HTTPS`);
    } catch { errors.push(`${label}: ${field} is not a valid URL`); }
  }
  try {
    const endpoint = new URL(source.endpointUrl);
    if (!adapterPatterns[source.adapter]?.(endpoint, source)) errors.push(`${label}: endpoint does not match the supported ${source.adapter} public-board shape`);
  } catch { /* The schema/url error above is clearer. */ }
  for (const code of [...source.hiringCountryCodes, source.headquartersCountryCode].filter(Boolean)) {
    if (!countryCodes.has(code)) errors.push(`${label}: unknown country code ${code}`);
  }
  for (const code of source.hiringRegionCodes) if (!regionCodes.has(code)) errors.push(`${label}: unknown region code ${code}`);
  if (source.status === "verified" && (source.verification.result !== "success" || source.verification.observedJobs < 1)) {
    errors.push(`${label}: verified sources require a successful scan with at least one observed job`);
  }
  if (source.status !== "verified" && source.autoEnqueue) errors.push(`${label}: only verified sources may auto-enqueue`);
  if (source.proposedBy === "ai" && (source.status === "verified" || source.autoEnqueue)) {
    errors.push(`${label}: AI-proposed sources cannot enter the trusted registry or auto-enqueue`);
  }
}

const maintainedSeeds = readFileSync(process.env.ROLEATLAS_SEEDS_PATH ?? "services/scout/default_seeds.txt", "utf8").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
const expectedSeeds = registry.filter((source) => source.status === "verified" && source.autoEnqueue).map((source) => source.endpointUrl);
if (JSON.stringify(maintainedSeeds) !== JSON.stringify(expectedSeeds)) {
  errors.push("services/scout/default_seeds.txt must exactly mirror verified auto-enqueued registry endpoints in registry order");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const adapters = Object.fromEntries([...new Set(registry.map((source) => source.adapter))].sort().map((adapter) => [adapter, registry.filter((source) => source.adapter === adapter).length]));
console.log(`Validated ${registry.length} global sources (${expectedSeeds.length} enabled): ${JSON.stringify(adapters)}.`);
