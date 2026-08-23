"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { releaseChecks: checks } = require("./test-manifest");
const root = path.resolve(__dirname, "..");

for (const check of checks) {
  console.log(`\n[release-regression] ${check.group}`);
  const args = check.args || [path.join(__dirname, check.script)];
  const result = spawnSync(process.execPath, args.map((arg) => path.isAbsolute(arg) ? arg : arg.startsWith("resources/") ? path.join(root, ...arg.split("/")) : arg), { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[release-regression] FAILED: ${check.group}`);
    process.exit(result.status || 1);
  }
}

console.log(`\nVOTC v7.6 Release Regression: PASS (${checks.length} groups)`);
