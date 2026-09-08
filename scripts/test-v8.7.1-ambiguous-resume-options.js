"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BranchRegistry } = require("../resources/app/out/main/worldline/branch-registry");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v871-ambiguous-resume-"));
try {
  const registry = new BranchRegistry({ root });
  const input = { campaignToken: "ambiguous-resume", sourcePath: "C:\\saves\\autosave.ck3", fingerprint: "a".repeat(64), gameDate: "1175.1.1" };
  const identity = registry.identity(input);
  const branch = (id, fingerprint, gameDate, archived) => ({ ...identity, branchId: `branch_${id}`, fingerprint, currentFingerprint: fingerprint, fingerprintHistory: [fingerprint], gameDate, latestGameDate: gameDate, status: archived ? "ARCHIVED" : "ACTIVE", archived, parentBranchId: null, forkedAt: null, archivedAt: archived ? "2026-09-08T00:00:00.000Z" : null, lastSeenAt: "2026-09-08T00:00:00.000Z" });
  const archivedOne = branch("11111111-1111-1111-1111-111111111111", input.fingerprint, input.gameDate, true);
  const archivedTwo = branch("22222222-2222-2222-2222-222222222222", input.fingerprint, input.gameDate, true);
  const active = branch("33333333-3333-3333-3333-333333333333", "b".repeat(64), "1175.1.3", false);
  registry.save({ schemaVersion: 2, branches: [archivedOne, archivedTwo, active] });
  const ambiguous = registry.observe(input);
  assert.equal(ambiguous.state, "BRANCH_RESUME_AMBIGUOUS");
  assert.deepEqual(ambiguous.resumeCandidates.map((item) => Object.keys(item).sort()), [["branchId", "gameDate", "sourcePath"], ["branchId", "gameDate", "sourcePath"]]);
  assert.deepEqual(ambiguous.resumeCandidates.map((item) => item.branchId), [archivedOne.branchId, archivedTwo.branchId]);

  registry.save({ schemaVersion: 2, branches: [archivedOne, archivedTwo, { ...active, fingerprint: input.fingerprint, currentFingerprint: input.fingerprint, fingerprintHistory: [input.fingerprint], gameDate: input.gameDate, latestGameDate: input.gameDate }] });
  const currentWins = registry.observe(input);
  assert.equal(currentWins.state, "SAME_BRANCH");
  assert.equal(currentWins.branchId, active.branchId);
  console.log("V8.7.1 ambiguous resume options PASS");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
