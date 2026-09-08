"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BranchRegistry } = require("../resources/app/out/main/worldline/branch-registry");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v871-forward-"));
try {
  const registry = new BranchRegistry({ root, clock: () => "2026-09-08T00:00:00.000Z" });
  const initial = { campaignToken: "autosave-campaign", sourcePath: "C:\\saves\\autosave.ck3", fingerprint: "a".repeat(64), gameDate: "1175.1.1" };
  const first = registry.observe(initial);
  const next = registry.observe({ ...initial, fingerprint: "b".repeat(64), gameDate: "1175.1.2" });
  const later = registry.observe({ ...initial, fingerprint: "c".repeat(64), gameDate: "1175.1.3" });
  assert.equal(next.state, "SAME_BRANCH");
  assert.equal(later.state, "SAME_BRANCH");
  assert.equal(later.branchId, first.branchId);
  const branch = registry.load().branches.find((item) => item.branchId === first.branchId);
  assert.equal(branch.latestGameDate, "1175.1.3");
  assert.deepEqual(branch.fingerprintHistory.slice(-3), ["a".repeat(64), "b".repeat(64), "c".repeat(64)]);
  console.log("V8.7.1 forward autosave continuity PASS");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
