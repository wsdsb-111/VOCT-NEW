"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { HistoricalEntityBindingCache } = require("../resources/app/out/main/worldline/historical-entity-binding");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

const snapshot = {
  playthroughId: "campaign_luna_fixture",
  gameDate: "1175.9.2",
  totalDays: 430000,
  contentFingerprint: "luna-fixture",
  playerId: "1",
  characters: {
    "1": { id: 1, firstName: "思昭", fullName: "思昭", alive: true, parents: { father: 2 } },
    "2": { id: 2, firstName: "中间人", fullName: "中间人", alive: true, parents: { father: 3 } },
    "3": { id: 3, firstName: "岳飞", fullName: "岳飞", alive: true, gender: "male" }
  },
  definitionToRuntime: { yue_fei_001: "3" },
  runtimeToDefinitions: { "3": ["yue_fei_001"] }
};

const inspector = WorldlineService.prototype.getEntityKinshipInspector.call({
  currentCheckpoint: { id: "checkpoint-luna", snapshot },
  canon: { branch: () => ({ campaignId: "campaign_luna_fixture", branchId: "branch_00000000-0000-4000-8000-000000000001" }) },
  historicalDefinitionIndex: { status: "UNCONFIGURED", meta: null },
  historicalBindingCache: new HistoricalEntityBindingCache()
}, { query: "岳飞", responderId: "1", targetId: "3" });

assert.equal(inspector.available, true);
assert.equal(inspector.identity.resolvedRuntimeId, "3");
assert.deepEqual(inspector.identity.historicalDefinitionIds, ["yue_fei_001"]);
assert.equal(inspector.state.lifeStatus, "ALIVE");
assert.equal(inspector.state.gender, "male");
assert.equal(inspector.relation.status, "DERIVED");
assert.equal(inspector.relation.distance, 2);
assert.deepEqual(inspector.relation.path.map(step => step.type), ["PARENT_OF", "PARENT_OF"]);
assert.equal(inspector.relation.type, inspector.familyFact.relation, "relation and family panels must use the same target-to-responder direction");
assert.equal(inspector.familyFact.relation, "GRANDPARENT_OF");
assert.equal(inspector.difference.bindings[0].status, "RESOLVED_RUNTIME");
assert.equal(typeof inspector.profiling.entityLatencyMs, "number");
assert.equal(typeof inspector.profiling.relationLatencyMs, "number");
assert.equal(inspector.profiling.kinshipCacheScope, "REVISION_SCOPED_TARGETED");

const ambiguousInspector = WorldlineService.prototype.getEntityKinshipInspector.call({
  currentCheckpoint: {
    id: "checkpoint-luna-ambiguous",
    snapshot: {
      ...snapshot,
      characters: {
        "1": { id: 1, fullName: "回应角色", alive: true, children: [2, 3] },
        "2": { id: 2, fullName: "长子", alive: true, gender: "male" },
        "3": { id: 3, fullName: "次子", alive: true, gender: "male" }
      },
      definitionToRuntime: {},
      runtimeToDefinitions: {}
    }
  },
  canon: { branch: () => ({ campaignId: "campaign_luna_fixture", branchId: "branch_00000000-0000-4000-8000-000000000001" }) },
  historicalDefinitionIndex: { status: "UNCONFIGURED", meta: null },
  historicalBindingCache: new HistoricalEntityBindingCache()
}, { query: "你儿子近日如何", responderId: "1" });
assert.equal(ambiguousInspector.relation.status, "RELATION_AMBIGUOUS");
assert.deepEqual(ambiguousInspector.relation.candidates.map(candidate => candidate.runtimeId), ["2", "3"]);

const root = path.resolve(__dirname, "..");
const preload = fs.readFileSync(path.join(root, "resources", "app", "out", "preload", "preload.js"), "utf8");
const ipc = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
const renderer = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
assert(preload.includes("getEntityKinshipInspector"));
assert(ipc.includes("worldline:getEntityKinshipInspector"));
for (const marker of ["Entity & Kinship Inspector", "身份依据", "当前世界状态", "亲属关系", "历史差异", "Relation Path", "同名候选", "Entity latency", "Binding cache"]) assert(renderer.includes(marker), `Luna inspector marker missing: ${marker}`);
assert(renderer.includes('["historical", text("历史身份"'), "historical shadow page must be reachable");
assert(renderer.includes("developerMode && /* @__PURE__ */ jsxRuntimeExports.jsxs(\"details\""), "raw historical data must remain developer-only");

console.log("V8.8 Luna Entity & Kinship Inspector: PASS (four panels, derived path, binding scope, IPC, raw-data gate)");
