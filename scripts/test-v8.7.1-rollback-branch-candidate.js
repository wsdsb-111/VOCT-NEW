"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BranchRegistry } = require("../resources/app/out/main/worldline/branch-registry");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v871-rollback-"));
try {
  const registry = new BranchRegistry({ root });
  const current = { campaignToken: "rollback-campaign", sourcePath: "C:\\saves\\autosave.ck3", fingerprint: "a".repeat(64), gameDate: "1175.1.3" };
  registry.observe(current);
  const rollback = registry.observe({ ...current, fingerprint: "b".repeat(64), gameDate: "1175.1.2" });
  assert.equal(rollback.state, "ROLLBACK_CANDIDATE");
  assert.equal(rollback.branchId, null);
  assert.equal(registry.load().branches.filter((item) => item.archived !== true).length, 1);
  console.log("V8.7.1 rollback branch candidate PASS");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
