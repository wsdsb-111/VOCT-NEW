"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const presentationPath = path.join(root, "resources", "app", "out", "renderer", "worldline-player-presentation.js");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const { create } = require(presentationPath);
const ui = create("zh-CN");
const renderer = fs.readFileSync(rendererPath, "utf8");
const worldlineSource = renderer.slice(renderer.indexOf("function WorldlineView()"), renderer.indexOf("function ConfigPanel"));

const runtimeNative = ui.promptSummary({
  query: "赵思昭",
  available: true,
  queryAnalysis: {
    entityResolutions: [{
      subjectName: "赵思昭",
      identityKind: "RUNTIME_NATIVE",
      resolutionStatus: "RESOLVED",
      candidateTotal: 1,
      sourceComplete: true
    }],
    identityResolution: { status: "NO_MATCH", reason: "NAME_INDEX_MISS", candidateTotal: 0 },
    historicalCoverage: [{ status: "NAME_INDEX_MISS", reason: "NAME_INDEX_MISS" }]
  },
  supplemental: [],
  gameTruth: { characters: [], titles: [] }
});
assert.equal(runtimeNative.identity, "已确认当前存档角色");
assert.equal(runtimeNative.candidateCount, 1, "additive entity DTO must drive the player candidate count");
assert.equal(runtimeNative.conclusion, "已确认查询对象，但当前没有可展示的存档事实");
assert.equal(runtimeNative.reason, null, "historical index miss must not override a resolved Runtime-native entity");
assert.equal(runtimeNative.historical.detailsAvailable, false, "Runtime-native-only queries must not show a historical failure panel");

const sourceIncomplete = ui.promptSummary({
  query: "赵思昭、岳飞",
  available: true,
  queryAnalysis: {
    entityResolutions: [
      { subjectName: "赵思昭", identityKind: "RUNTIME_NATIVE", resolutionStatus: "RESOLVED", candidateTotal: 1, sourceComplete: true },
      { subjectName: "岳飞", identityKind: "HISTORICAL", resolutionStatus: "source_incomplete", candidateTotal: 0, sourceComplete: false }
    ],
    identityResolution: { status: "RESOLVED", candidateTotal: 1 },
    historicalCoverage: [
      { status: "NAME_INDEX_MISS", reason: "NAME_INDEX_MISS" },
      { status: "REJECTED_BY_CONFLICT", reason: "ALL_CANDIDATES_CONFLICT" },
      { status: "source_incomplete", reason: "SOURCE_INCOMPLETE" }
    ]
  },
  supplemental: [],
  gameTruth: { characters: [{ id: "1" }], titles: [] }
});
assert.equal(sourceIncomplete.historical.status, "SOURCE_INCOMPLETE", "coverage priority must be normalized and order-independent");
assert.equal(sourceIncomplete.conclusion, "历史人物来源仍在读取，当前不能下结论", "SOURCE_INCOMPLETE must outrank partial resolved facts");

const rejectedConflict = ui.historicalExplanation({
  queryAnalysis: {
    historicalCoverage: [
      { status: "NAME_INDEX_MISS", reason: "NAME_INDEX_MISS" },
      { status: "REJECTED_BY_CONFLICT", reason: "ALL_CANDIDATES_CONFLICT" }
    ]
  }
});
assert.equal(rejectedConflict.status, "REJECTED_BY_CONFLICT");
assert.equal(rejectedConflict.statusLabel, "证据冲突或不足，未确认");

const legacy = ui.promptSummary({
  query: "旧 DTO 人物",
  available: true,
  queryAnalysis: {
    resolvedCharacters: [{ displayName: "旧 DTO 人物" }],
    identityResolution: { status: "NO_MATCH", reason: "NAME_INDEX_MISS", candidateTotal: 0 },
    historicalCoverage: [{ status: "NAME_INDEX_MISS", reason: "NAME_INDEX_MISS" }]
  },
  supplemental: [],
  gameTruth: { characters: [{ id: "1" }], titles: [] }
});
assert.equal(legacy.recognizedObject, "旧 DTO 人物");
assert.equal(legacy.identity, "已确认身份");
assert.equal(legacy.candidateCount, 1);
assert.equal(legacy.conclusion, "已找到与查询相关的存档事实");
assert.equal(legacy.reason, null);
assert.equal(legacy.historical.detailsAvailable, true, "legacy DTO must keep its historical explanation fallback");

const adversarial = ui.entityResolution({
  subjectName: "Fei_name11",
  alias: "nansong_yue_085",
  figureName: "96895",
  identityKind: "HISTORICAL",
  resolutionStatus: "RESOLVED",
  candidateTotal: 1,
  sourceComplete: true,
  worldlineDifferences: [{ code: "FATHER_DIFFERENT", definitionId: "nansong_yue_085", runtimeId: "96895" }]
});
const renderedEntityFields = JSON.stringify({
  subject: adversarial.subject,
  identityKindLabel: adversarial.identityKindLabel,
  statusLabel: adversarial.statusLabel,
  candidateCount: adversarial.candidateCount,
  sourceLabel: adversarial.sourceLabel,
  differences: adversarial.differences.map(({ title, detail }) => ({ title, detail }))
});
for (const forbidden of ["Fei_name11", "nansong_yue_085", "96895", "NAME_EXACT", "FATHER_DIFFERENT"]) {
  assert.ok(!renderedEntityFields.includes(forbidden), `A/B presentation fields must not expose ${forbidden}`);
}

assert.ok(worldlineSource.includes("showEntityResolutions &&"), "per-entity cards must remain lazy-rendered");
assert.ok(worldlineSource.includes("(promptIdentityResolution?.candidates || []).slice(0, 50)"), "developer candidates must remain bounded to 50 rows");
assert.ok(!worldlineSource.includes("historical: (value) => ({ figure: display(value?.figureKey)"), "fallback mapping must not expose raw keys and IDs");
assert.ok(!worldlineSource.includes("statusLabel: display(resolutionStatus)"), "fallback entity status must not expose raw enums");

console.log("V8.5.2 Sol UI/DTO boundary: PASS");
