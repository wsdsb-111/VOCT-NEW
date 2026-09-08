"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BranchRegistry } = require("../resources/app/out/main/worldline/branch-registry");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-branch-"));
try {
  const registry = new BranchRegistry({ root });
  const a = { campaignToken: "playthrough-a", sourcePath: "C:\\saves\\A.ck3", fingerprint: "a".repeat(64), gameDate: "1171.9.20" };
  assert.equal(registry.observe({ ...a, campaignToken: null }).state, "BRANCH_UNKNOWN");
  const first = registry.observe(a);
  assert.equal(first.state, "NEW_CAMPAIGN");
  assert.equal(registry.observe(a).branchId, first.branchId);
  const b = registry.observe({ ...a, sourcePath: "C:\\saves\\B.ck3" });
  assert.equal(b.state, "BRANCH_FORK_DETECTED");
  assert.notEqual(b.branchId, first.branchId);
  assert.equal(new BranchRegistry({ root }).observe(a).branchId, first.branchId);
  assert.equal(registry.observe({ ...a, gameDate: "1171.9.19", fingerprint: "b".repeat(64) }).state, "ROLLBACK_CANDIDATE");
  assert.equal(registry.observe({ ...a, fingerprint: "c".repeat(64) }).state, "BRANCH_CONFLICT");
  assert.equal(registry.observe({ ...a, gameDate: "1171.9.21", fingerprint: "d".repeat(64) }).state, "SAME_BRANCH");
  const advanced = { ...a, gameDate: "1171.9.21", fingerprint: "d".repeat(64) };
  const renamed = registry.rename(advanced, "C:\\saves\\Renamed.ck3", first.branchId);
  assert.equal(renamed.state, "BRANCH_RENAMED");
  assert.equal(registry.observe({ ...advanced, sourcePath: "C:\\saves\\Renamed.ck3" }).branchId, first.branchId);
  console.log("V8.7 Branch Identity PASS: copy isolation, restart, rollback candidate, forward continuity, explicit rename");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
