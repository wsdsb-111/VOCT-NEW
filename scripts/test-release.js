"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const checks = [
  { group: "syntax", args: ["--check", path.join(root, "resources", "app", "out", "main", "main.js")] },
  { group: "architecture-health", args: [path.join(__dirname, "test-v6.9.1-architecture-health.js")] },
  { group: "v6.9.1-followup-contracts", args: [path.join(__dirname, "test-v6.9.1-followup-contracts.js")] },
  { group: "action-semantic-binding-runtime-conversation-approval-registry", args: [path.join(__dirname, "test-action-regression.js")] },
  { group: "memory-health", args: [path.join(__dirname, "test-v7-memory-health.js")] },
  { group: "memory-regression", args: [path.join(__dirname, "test-memory-regression.js")] },
  { group: "v7.0.1-finalization-runtime", args: [path.join(__dirname, "test-v7.0.1-finalization-runtime.js")] },
  { group: "v7.0.1-action-source-runtime", args: [path.join(__dirname, "test-v7.0.1-action-source-runtime.js")] },
  { group: "v7.1-memory-editor", args: [path.join(__dirname, "test-v7.0.1-memory-editor.js")] },
  { group: "memory-ui", args: [path.join(__dirname, "test-memory-ui.js")] },
  { group: "v7.1-memory-engine", args: [path.join(__dirname, "test-v7.1-memory-engine.js")] },
  { group: "v7.2-memory-routing", args: [path.join(__dirname, "test-v7.2-memory-routing.js")] },
  { group: "v7.2-sequential-finalization", args: [path.join(__dirname, "test-v7.2-sequential-finalization.js")] },
  { group: "v7.2-action-memory-integration", args: [path.join(__dirname, "test-v7.2-action-memory-integration.js")] },
  { group: "v7.2.1-stability", args: [path.join(__dirname, "test-v7.2.1-stability.js")] },
  { group: "v7.3-identity-lifecycle", args: [path.join(__dirname, "test-v7.3-identity-lifecycle.js")] },
  { group: "release-assets", args: [path.join(__dirname, "test-release-assets.js")] },
  { group: "structured-episode-migration", args: [path.join(__dirname, "test-migrate-structured-episodes-to-summary-folders.js")] },
  { group: "window-layout", args: [path.join(__dirname, "test-window-layout.js")] },
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

console.log(`\nVOTC v7.3 Release Regression: PASS (${checks.length} groups)`);
