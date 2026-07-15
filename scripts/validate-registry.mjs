import { readFileSync } from "node:fs";

// Work Order 5 initially validates the maintained seed catalog. This command
// becomes the schema validator when the catalog moves to the global registry.
const seeds = readFileSync("services/scout/default_seeds.txt", "utf8")
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter(Boolean);
const errors = [];
const seen = new Set();

for (const [index, seed] of seeds.entries()) {
  let url;
  try { url = new URL(seed); }
  catch { errors.push(`line ${index + 1}: invalid URL`); continue; }
  if (url.protocol !== "https:") errors.push(`line ${index + 1}: source must use HTTPS`);
  const canonical = url.toString();
  if (seen.has(canonical)) errors.push(`line ${index + 1}: duplicate source ${canonical}`);
  seen.add(canonical);
}

if (!seeds.length) errors.push("source catalog is empty");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Validated ${seeds.length} maintained source URLs.`);
