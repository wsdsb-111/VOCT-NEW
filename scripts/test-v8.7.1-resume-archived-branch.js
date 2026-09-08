"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BranchRegistry } = require("../resources/app/out/main/worldline/branch-registry");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v871-resume-"));
try {
  const registry = new BranchRegistry({ root });
  const original = { campaignToken: "resume-campaign", sourcePath: "C:\\saves\\autosave.ck3", fingerprint: "a".repeat(64), gameDate: "1175.1.3" };
  const first = registry.observe(original);
  const fork = registry.fork({ ...original, fingerprint: "b".repeat(64), gameDate: "1175.1.2" });
  assert.notEqual(fork.branchId, first.branchId);
  const resumed = registry.observe(original);
  assert.equal(resumed.state, "BRANCH_RESUMED");
  assert.equal(resumed.branchId, first.branchId);
  const active = registry.load().branches.filter((item) => item.archived !== true);
  assert.deepEqual(active.map((item) => item.branchId), [first.branchId]);
  console.log("V8.7.1 archived branch resume PASS");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
