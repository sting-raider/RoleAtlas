import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const roots = ["app", "docs", "scripts", "services/scout/src", "services/scout/tests", "tests"];
const checkedExtensions = new Set([".css", ".js", ".json", ".md", ".mjs", ".rs", ".sql", ".ts", ".tsx", ".yml", ".yaml"]);
const ignoredDirectories = new Set([".git", ".next", "dist", "node_modules", "target"]);
const errors = [];

function check(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) check(child);
    else if (checkedExtensions.has(extname(entry.name))) {
      const text = readFileSync(child, "utf8");
      if (!text.endsWith("\n")) errors.push(`${child}: missing final newline`);
      text.split(/\r?\n/).forEach((line, index) => {
        if (/[ \t]+$/.test(line)) errors.push(`${child}:${index + 1}: trailing whitespace`);
      });
    }
  }
}

roots.forEach(check);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Formatting hygiene passed.");
