"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { actionChecks: scripts } = require("./test-manifest");

for (const script of scripts) {
  console.log(`\n[action-regression] ${script}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit"
  });
  if (result.status !== 0) {
    console.error(`[action-regression] FAILED: ${script}`);
    process.exit(result.status || 1);
  }
}

console.log(`\nVOTC v6.9 action regression: PASS (${scripts.length} scripts)`);
