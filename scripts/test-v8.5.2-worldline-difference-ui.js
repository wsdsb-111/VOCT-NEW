"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const stylePath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-WtJH_nua.css");
const presentationPath = path.join(root, "resources", "app", "out", "renderer", "worldline-player-presentation.js");
const renderer = fs.readFileSync(rendererPath, "utf8");
const styles = fs.readFileSync(stylePath, "utf8");
const { create } = require(presentationPath);
const ui = create("zh-CN");
const worldlineSource = renderer.slice(renderer.indexOf("function WorldlineView()"), renderer.indexOf("function ConfigPanel"));

for (const marker of [
  "promptEntityResolutions",
  "showEntityResolutions",
  "promptEntityResolutionPanel",
  "worldline-entity-resolution-panel",
  "worldline-worldline-differences",
  "promptEntityResolutionPanel, promptHistoricalExplanationPanel",
  ".slice(0, 50)"
]) {
  assert.ok(worldlineSource.includes(marker), `Luna renderer is missing ${marker}`);
}
assert.ok(!worldlineSource.includes("coverageItems[0]"), "multi-entity UI must not use the first coverage item as the whole result");
for (const marker of [
  ".worldline-entity-resolution-panel",
  ".worldline-entity-resolution-card",
  ".worldline-worldline-differences",
  ".worldline-difference-item"
]) {
  assert.ok(styles.includes(marker), `Luna stylesheet is missing ${marker}`);
}

assert.equal(ui.identityKind("HISTORICAL", "RESOLVED"), "已确认历史人物");
assert.equal(ui.identityKind("RUNTIME_NATIVE", "RESOLVED"), "已确认当前存档角色");
assert.equal(ui.identityKind("RUNTIME_NATIVE", "AMBIGUOUS"), "当前存档存在多个同名角色");
assert.equal(ui.identityKind("HISTORICAL", "REJECTED_BY_CONFLICT"), "证据冲突或不足，未确认");

const differences = [
  { code: "AGE_WORLDLINE_SHIFT", expectedBirth: "1103.3.24", currentBirth: "1104.1.1" },
  { code: "FATHER_DIFFERENT" },
  { code: "MOTHER_DIFFERENT" },
  { code: "SIBLING_DIFFERENT" },
  { code: "SPOUSE_DIFFERENT" },
  { code: "CHILDREN_DIFFERENT" }
].map(item => ui.worldlineDifference(item));
assert.equal(differences.length, 6);
assert.equal(differences[0].detail, "当前角色出生时间与历史基准存在偏移，不影响已确认的历史身份。 1103年3月24日 → 1104年1月1日");
assert.ok(differences.every(item => ["INFO", "NOTICE"].includes(item.severity)), "worldline differences must remain non-identity informational output");

const entities = [
  { subjectName: "岳飞", identityKind: "HISTORICAL", resolutionStatus: "AMBIGUOUS", candidateTotal: 2, sourceComplete: true },
  { subjectName: "韩世忠", identityKind: "HISTORICAL", resolutionStatus: "RESOLVED", candidateTotal: 1, sourceComplete: true, worldlineDifferences: [{ code: "AGE_WORLDLINE_SHIFT" }] },
  { subjectName: "赵思昭", identityKind: "RUNTIME_NATIVE", resolutionStatus: "RESOLVED", candidateTotal: 1, sourceComplete: true }
];
const summary = ui.promptSummary({
  query: "岳飞、韩世忠、赵思昭",
  queryAnalysis: {
    entityResolutions: entities,
    identityResolution: { status: "AMBIGUOUS", candidateTotal: 2 },
    historicalCoverage: [{ status: "NAME_INDEX_MISS", reason: "NAME_INDEX_MISS" }]
  },
  available: true,
  supplemental: [],
  gameTruth: { characters: [], titles: [] }
});
assert.equal(summary.entities.length, 3, "player diagnostics must preserve every entity");
assert.equal(summary.identity, "多个对象，见逐实体判定");
assert.equal(summary.entities[0].identityKindLabel, "找到多个历史候选，未确认");
assert.equal(summary.entities[1].identityKindLabel, "已确认历史人物");
assert.equal(summary.entities[2].identityKindLabel, "已确认当前存档角色");
assert.equal(summary.entities[1].differences[0].title, "出生时间偏移");

const playerLayer = JSON.stringify({ summary, differences });
for (const forbiddenInternalValue of ["Fei_name11", "nansong_yue_085", "runtimeId", "definitionId", "NAME_EXACT", "AGE_MATCH_STRONG"]) {
  assert.ok(!playerLayer.includes(forbiddenInternalValue), `A/B player layer must not expose ${forbiddenInternalValue}`);
}

console.log("V8.5.2 Luna Worldline Difference UI: PASS");
