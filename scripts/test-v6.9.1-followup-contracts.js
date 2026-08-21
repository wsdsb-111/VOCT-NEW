"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const checks = [
  "test-v6.9.1-followup-conversation-di.js",
  "test-v6.9.1-followup-runtime-ownership.js",
  "test-v6.9.1-followup-trace-dedup.js"
];

for (const check of checks) {
  const result = spawnSync(process.execPath, [path.join(__dirname, check)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("VOTC v6.9.1 follow-up contracts: PASS (3 checks)");
