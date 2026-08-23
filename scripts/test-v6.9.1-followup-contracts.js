"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { followupChecks: checks } = require("./test-manifest");

for (const check of checks) {
  const result = spawnSync(process.execPath, [path.join(__dirname, check)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("VOTC v6.9.1 follow-up contracts: PASS (3 checks)");
