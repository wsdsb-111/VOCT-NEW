"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BranchRegistry } = require("../resources/app/out/main/worldline/branch-registry");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v871-copy-"));
try {
  const registry = new BranchRegistry({ root });
  const source = { campaignToken: "copy-campaign", sourcePath: "C:\\saves\\source.ck3", fingerprint: "a".repeat(64), gameDate: "1175.1.1" };
  const original = registry.observe(source);
  const copied = registry.observe({ ...source, sourcePath: "C:\\saves\\copied.ck3" });
  assert.equal(copied.state, "BRANCH_FORK_DETECTED");
  assert.notEqual(copied.branchId, original.branchId);
  console.log("V8.7.1 copied save isolation PASS");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
