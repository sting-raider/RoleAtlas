import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findTests(path);
    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const tests = findTests("tests").sort();
if (!tests.length) throw new Error("No TypeScript tests were discovered.");

const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...tests], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
