"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const scripts = [
  "test-action-system.js",
  "test-action-phase-0.6.js",
  "test-action-participants.js",
  "test-action-participant-binding.js",
  "test-action-v6.6.js",
  "test-action-v6.6-runtime.js",
  "test-action-v6.7-baseline.js",
  "test-action-v6.7-modules.js",
  "test-action-reference-resolution.js",
  "test-action-v6.7-runtime.js",
  "test-action-v6.7-fuzz.js",
  "test-action-v6.7.1-scene-retirement.js",
  "test-action-v6.7.1-physical-outcomes.js",
  "test-action-v6.8-action-contract.js",
  "test-action-v6.8-chinese-completion.js",
  "test-action-v6.8-death-lifecycle.js",
  "test-action-v6.8.2-run-invocation-binding.js",
  "test-action-v6.8.2-approval-lifecycle.js",
  "test-action-v6.8.3-natural-injury.js",
  "test-action-v6.8.3-reference-offsets.js",
  "test-conversation-v6.8.3-turn-concurrency.js",
  "test-action-v6.8.4-bilateral-relationship.js",
  "test-action-v6.8.4-injury-runtime.js",
  "test-action-v6.8.4-intercourse-runtime.js",
  "test-action-v6.9-a-gate-parser.js",
  "test-action-v6.9-b-rule-registry.js",
  "test-conversation-v6.9-c-managers.js",
  "test-action-v6.9-d-contracts-trace.js"
];

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
