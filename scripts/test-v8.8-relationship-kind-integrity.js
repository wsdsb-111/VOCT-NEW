"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { scanKinshipIntegrity } = require("../resources/app/out/main/worldline/kinship-integrity-scan");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

const graph = buildKinshipGraph({
  1: { id: 1, parents: { father: { id: 2, parentage: "biological" }, mother: { id: 3, parentage: "adopted" } } },
  2: { id: 2 },
  3: { id: 3 },
  4: { id: 4, children: [5] },
  5: { id: 5 }
});
assert.equal(graph.relationBetween(1, 2).relation.relationshipKind, "BIOLOGICAL");
assert.equal(graph.relationBetween(1, 3).relation.relationshipKind, "ADOPTIVE");
assert.equal(graph.relationBetween(5, 4).relation.relationshipKind, "UNSPECIFIED", "unmarked source data must not be relabeled as biological");
assert.equal(scanKinshipIntegrity(graph).status, "PASS");

const lateExplicitKind = buildKinshipGraph({
  1: { id: 1, children: [2] },
  2: { id: 2, parents: { father: { id: 1, parentage: "adopted" } } }
});
assert.equal(lateExplicitKind.relationBetween(1, 2).relation.relationshipKind, "ADOPTIVE", "a later explicit source must enrich an already-seen edge");

const conflictingKinds = buildKinshipGraph({
  1: { id: 1, children: [{ id: 2, parentage: "biological" }] },
  2: { id: 2, parents: { father: { id: 1, parentage: "adopted" } } }
});
assert.equal(conflictingKinds.relationBetween(1, 2).relation.relationshipKind, "UNSPECIFIED", "conflicting explicit kinds must fail closed");
assert(scanKinshipIntegrity(conflictingKinds).issues.some((issue) => issue.code === "RELATIONSHIP_KIND_CONFLICT"));

const missingReciprocal = buildKinshipGraph({ 1: { id: 1, children: [2] }, 2: { id: 2 } });
missingReciprocal.edges.pop();
assert.equal(scanKinshipIntegrity(missingReciprocal).status, "CONFLICT");
assert(scanKinshipIntegrity(missingReciprocal).issues.some((issue) => issue.code === "RECIPROCAL_EDGE_MISSING"));

const snapshot = { contentFingerprint: "integrity-fixture", gameDate: "1175.9.2", characters: { 1: { id: 1, children: [2] }, 2: { id: 2 } } };
const report = WorldlineService.prototype.getKinshipIntegrityReport.call({ currentCheckpoint: { id: "integrity-checkpoint", snapshot } });
assert.equal(report.available, true);
assert.equal(report.status, "PASS");
assert.equal(report.checkpointId, "integrity-checkpoint");
const root = path.resolve(__dirname, "..");
const ipc = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "resources", "app", "out", "preload", "preload.js"), "utf8");
assert(ipc.includes("worldline:getKinshipIntegrityReport"));
assert(preload.includes("getKinshipIntegrityReport"));
console.log("VOTC v8.8 Relationship Kind & Integrity: PASS (explicit-only classification, reciprocal scan, full checkpoint route)");
