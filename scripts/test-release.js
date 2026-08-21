"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const checks = [
  { group: "syntax", args: ["--check", path.join(root, "resources", "app", "out", "main", "main.js")] },
  { group: "action-semantic-binding-runtime-conversation-approval-registry", args: [path.join(__dirname, "test-action-regression.js")] },
  { group: "character-game-facts", args: [path.join(__dirname, "test-character-game-facts.js")] }
];

for (const check of checks) {
  console.log(`\n[release-regression] ${check.group}`);
  const result = spawnSync(process.execPath, check.args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[release-regression] FAILED: ${check.group}`);
    process.exit(result.status || 1);
  }
}

console.log(`\nVOTC v6.9 Release Regression: PASS (${checks.length} groups)`);
