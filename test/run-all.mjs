/**
 * Runs every verification harness in one process and fails if any of them does.
 *
 * Each harness is a standalone script that loads the real `client.js` through a
 * stubbed `window.__ModuleLoader__` and a stubbed `react`, then asserts one
 * property of the bundle. They are separate processes by design: a harness that
 * leaks a timer or patches a global cannot affect the next one.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const suites = ["manifest.test.mjs", "wiring.test.mjs", "render.test.mjs", "persist.test.mjs", "robust.test.mjs"];

const failed = [];
for (const suite of suites) {
  process.stdout.write("\n\u2500\u2500 " + suite + " " + "\u2500".repeat(Math.max(0, 58 - suite.length)) + "\n");
  const run = spawnSync(process.execPath, [path.join(here, suite)], { stdio: "inherit" });
  if (run.status !== 0) failed.push(suite);
}

console.log("\n" + "=".repeat(64));
if (failed.length === 0) {
  console.log("ALL SUITES PASSED (" + suites.length + "/" + suites.length + ")");
  process.exit(0);
}
console.log("FAILED: " + failed.join(", "));
process.exit(1);
