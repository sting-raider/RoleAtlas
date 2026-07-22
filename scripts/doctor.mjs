import { spawnSync } from "node:child_process";

const scoutBase = (process.env.SCOUT_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
const targets = [
  ["Web UI", new URL("/api/health", process.env.ROLEATLAS_WEB_URL ?? "http://localhost:3000/").toString(), "web"],
  ["Scout API + crawler queue", `${scoutBase}/health`, "health"],
  ["Registry", `${scoutBase}/api/registry`, "registry"],
  ["PostgreSQL via API", `${scoutBase}/api/stats`, "stats"],
  ["NATS monitor", process.env.NATS_MONITOR_URL ?? "http://localhost:8222/varz", "nats"],
];

const results = [];
for (const [service, url, kind] of targets) {
  const started = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { Accept: "application/json,text/html" } });
    let detail = "";
    if (response.ok && kind === "health") {
      const payload = await response.clone().json().catch(() => null);
      detail = payload?.crawler_queue === "available" ? "queue available" : "crawler queue unavailable";
    }
    results.push({ service, ok: response.ok, status: response.ok ? "available" : `HTTP ${response.status}`, detail, ms: Math.round(performance.now() - started), url });
  } catch (error) {
    results.push({ service, ok: false, status: "unavailable", ms: Math.round(performance.now() - started), url, detail: error instanceof Error ? error.message : String(error) });
  }
}

console.table(results.map(({ service, status, detail, ms, url }) => ({ service, status, detail, ms, url })));

const docker = spawnSync("docker", ["compose", "ps", "--format", "json"], { encoding: "utf8", windowsHide: true });
if (docker.status === 0) {
  const lines = docker.stdout.split(/\r?\n/).filter(Boolean);
  console.log(`Docker Compose: available (${lines.length} service${lines.length === 1 ? "" : "s"} reported)`);
} else {
  console.log("Docker Compose: unavailable or Docker Desktop is not running");
}

const failed = results.filter((result) => !result.ok || result.detail === "crawler queue unavailable");
if (failed.length) {
  console.log("\nRoleAtlas can still offer transient web browsing, but durable search, source expansion, or local persistence may be reduced.");
  process.exitCode = 1;
} else {
  console.log("\nCore HTTP services are healthy. Check Settings for NATS, crawler, and optional AI status.");
}
