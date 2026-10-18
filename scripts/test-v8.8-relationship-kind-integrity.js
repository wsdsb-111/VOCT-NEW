"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildKinshipGraph: buildCurrentKinshipGraph, buildLegacyStructuralKinshipGraph: buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { currentDirectParentFilter } = require("../resources/app/out/main/worldline/kinship-graph-cache");
const { scanKinshipIntegrity } = require("../resources/app/out/main/worldline/kinship-integrity-scan");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

const CAMPAIGN = "votc8c-202610180007";
const DATE = "1175.9.2";
const TOTAL_DAYS = 430200;
function directProof(childId, parentId) {
  return { source: "CK3_DIRECT_PARENT", sourceOwnerId: childId, childId, parentId,
    relationType: "parent", sourceRelation: "parents", publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN, sourceSnapshotId: `${DATE}/${TOTAL_DAYS}` };
}
function buildCurrentGraph(characters) {
  const gameData = { characters, campaignToken: CAMPAIGN, date: DATE, totalDays: TOTAL_DAYS };
  return buildCurrentKinshipGraph(characters, { directParentEvidenceFilter: currentDirectParentFilter(gameData) });
}

const graph = buildCurrentGraph(new Map([
  [1, { id: 1, parents: { father: { id: 2, parentage: "biological", ...directProof(1, 2) },
    mother: { id: 3, parentage: "adopted", ...directProof(1, 3) } } }],
  [2, { id: 2, children: [{ id: 1, directParentEvidence: directProof(1, 2) }] }],
  [3, { id: 3, children: [{ id: 1, directParentEvidence: directProof(1, 3) }] }],
  [4, { id: 4, children: [{ id: 5, directParentEvidence: directProof(5, 4) }] }],
  [5, { id: 5, parents: [{ id: 4, ...directProof(5, 4) }] }]
]));
assert.equal(graph.relationBetween(1, 2).relation.relationshipKind, "BIOLOGICAL");
assert.equal(graph.relationBetween(1, 3).relation.relationshipKind, "ADOPTIVE");
assert.equal(graph.relationBetween(5, 4).relation.relationshipKind, "UNSPECIFIED", "unmarked source data must not be relabeled as biological");
assert.equal(scanKinshipIntegrity(graph).status, "PASS");

const lateExplicitKind = buildCurrentGraph(new Map([
  [1, { id: 1, children: [{ id: 2, directParentEvidence: directProof(2, 1) }] }],
  [2, { id: 2, parents: { father: { id: 1, parentage: "adopted", ...directProof(2, 1) } } }]
]));
assert.equal(lateExplicitKind.relationBetween(1, 2).relation.relationshipKind, "ADOPTIVE", "a later explicit source must enrich an already-seen edge");

const conflictingKinds = buildCurrentGraph(new Map([
  [1, { id: 1, children: [{ id: 2, parentage: "biological", directParentEvidence: directProof(2, 1) }] }],
  [2, { id: 2, parents: { father: { id: 1, parentage: "adopted", ...directProof(2, 1) } } }]
]));
assert.equal(conflictingKinds.relationBetween(1, 2).relation, null, "conflicting explicit kinds must fail closed");
assert(scanKinshipIntegrity(conflictingKinds).issues.some((issue) => issue.code === "RELATIONSHIP_KIND_CONFLICT"));

const missingReciprocal = buildKinshipGraph({ 1: { id: 1, children: [2] }, 2: { id: 2 } });
missingReciprocal.edges.pop();
assert.equal(scanKinshipIntegrity(missingReciprocal).status, "CONFLICT");
assert(scanKinshipIntegrity(missingReciprocal).issues.some((issue) => issue.code === "RECIPROCAL_EDGE_MISSING"));

const snapshotCharacters = new Map([
  [1, { id: 1, children: [{ id: 2, directParentEvidence: directProof(2, 1) }] }],
  [2, { id: 2, parents: [{ id: 1, ...directProof(2, 1) }] }]
]);
const snapshot = { contentFingerprint: "integrity-fixture", gameDate: DATE, date: DATE, totalDays: TOTAL_DAYS,
  campaignToken: CAMPAIGN, characters: snapshotCharacters };
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
