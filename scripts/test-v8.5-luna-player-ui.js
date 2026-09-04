"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const stylePath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-WtJH_nua.css");
const htmlPath = path.join(root, "resources", "app", "out", "renderer", "index.html");
const presentationPath = path.join(root, "resources", "app", "out", "renderer", "worldline-player-presentation.js");
const renderer = fs.readFileSync(rendererPath, "utf8");
const styles = fs.readFileSync(stylePath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8");
const presentation = require(presentationPath);
const createPresentation = presentation.create ? presentation.create : presentation.VOTCWorldlinePlayerPresentation.create;

assert.ok(renderer.includes("function WorldlineView()"), "WorldlineView must remain in the shipped renderer");
const worldlineStart = renderer.indexOf("function WorldlineView()");
const worldlineEnd = renderer.indexOf("function ConfigPanel", worldlineStart);
assert.ok(worldlineEnd > worldlineStart, "WorldlineView boundary must remain parseable");
const worldlineSource = renderer.slice(worldlineStart, worldlineEnd);
assert.ok(!worldlineSource.includes("ipcRenderer"), "Luna must use the preload boundary instead of ipcRenderer");
assert.ok(!worldlineSource.includes("require("), "Luna must not access Node modules");

const defaultTabsStart = worldlineSource.indexOf('const tabs = [');
const diagnosticsStart = worldlineSource.indexOf('activeTab === "diagnostics"');
assert.ok(defaultTabsStart >= 0 && diagnosticsStart > defaultTabsStart, "default player tabs must be structurally separated from diagnostics");
const defaultTabs = worldlineSource.slice(defaultTabsStart, diagnosticsStart);
for (const forbiddenText of [
  'children: "Game Truth"',
  'children: "Supplemental"',
  'children: "Player Supplemental"',
  'children: "DIRECT"',
  'children: "LIVE_CONFIRMED"',
  'children: "CONFLICT"',
  'children: "PUBLIC_WORLD"',
  'children: "NORMAL"'
]) {
  assert.ok(!defaultTabs.includes(forbiddenText), `default player tabs must not render ${forbiddenText}`);
}

for (const marker of [
  "V8.5 Worldline",
  "worldline-player-summary-grid",
  "showAdvancedSource",
  "player.connection",
  "player.freshness",
  "player.reference",
  "player.event",
  "player.knowledge",
  "player.historical",
  "历史人物映射",
  "worldline-semantic-binding-row",
  "worldline-advanced-details",
  "展开开发者原始数据",
  "结果摘要",
  "命中来源",
  "tokenBreakdownTotal",
  "tokenBreakdownMatches",
  "promptTokenBreakdownRows",
  "historicalCoverage",
  "historicalIndex",
  "worldline-historical-explanation",
  "展开历史人物判定依据",
  "worldline-candidate-readable",
  "trimmedItems",
  "runtimeId",
  "definitionId",
  "rawKey",
  "score",
  "evidence",
  "resolverTrace",
  "cacheHit"
]) {
  assert.ok(worldlineSource.includes(marker), `renderer is missing V8.5 Luna marker: ${marker}`);
}

assert.ok(html.indexOf('src="./worldline-player-presentation.js"') < html.indexOf('src="./assets/index-Dn3qWlAB.js"'), "player presentation helper must load before the bundle");
for (const marker of [
  ".worldline-player-summary-grid",
  ".worldline-source-advanced",
  ".worldline-advanced-details",
  ".worldline-semantic-binding-row",
  ".worldline-diagnostic-summary",
  ".worldline-diagnostic-sources"
]) {
  assert.ok(styles.includes(marker), `stylesheet is missing V8.5 Luna marker: ${marker}`);
}

const ui = createPresentation("zh-CN");
const conflict = ui.reference({
  rawKey: "h_china",
  displayName: "h_china",
  localization: {
    localizedValue: "h_china",
    confidence: "CONFLICT",
    sources: [{ value: "中华" }, { value: "华夏" }]
  }
});
assert.equal(conflict.displayName, "中华 / 华夏", "localization conflicts must expose readable candidates");
assert.equal(conflict.status, "名称来源存在冲突", "localization conflicts must use player wording");
assert.equal(ui.reference({ rawKey: "unknown_title", displayName: "unknown_title", localization: { localizedValue: "unknown_title", confidence: "NOT_FOUND" } }).displayName, "暂不可用", "unresolved raw keys must not become player-facing values");
assert.deepEqual(ui.event({ type: "WAR_NO_LONGER_ACTIVE", source: "DERIVED_GAMESTATE" }), {
  title: "战争疑似结束",
  detail: "该战争已不在当前活跃战争列表中。系统尚未确认其结束时间或最终结果。",
  status: "待核实",
  source: "系统补充"
}, "uncertain war deltas must remain uncertain in the player view");
assert.equal(ui.visibility("PUBLIC_WORLD"), "所有人可知");
assert.equal(ui.importance("HIGH"), "重要");
assert.equal(ui.identity("AMBIGUOUS_PROVENANCE"), "存在多个候选");
assert.equal(ui.coverage("DEFINITION_FOUND_RUNTIME_MISSING"), "找到历史定义，但当前存档没有对应角色");
const explanation = ui.historicalExplanation({
  queryAnalysis: {
    identityResolution: { status: "NO_MATCH", reason: "NO_RUNTIME_CANDIDATES", candidates: [] },
    historicalCoverage: [{ status: "DEFINITION_FOUND_RUNTIME_MISSING", reason: "NO_RUNTIME_CANDIDATES", definitionIds: ["han_022"] }]
  },
  historicalIndex: { status: "READY", sourceComplete: true }
});
assert.equal(explanation.statusLabel, "找到历史定义，但当前存档没有对应角色");
assert.equal(explanation.reason, "索引中的历史定义没有对应当前存档角色。");
assert.equal(ui.promptSummary({
  query: "韩世忠",
  queryAnalysis: { identityResolution: { status: "NO_MATCH", reason: "SOURCE_INCOMPLETE" }, historicalCoverage: [{ status: "SOURCE_INCOMPLETE", reason: "SOURCE_INCOMPLETE" }] },
  historicalIndex: { status: "BUILDING", sourceComplete: false },
  available: true,
  supplemental: [],
  gameTruth: { characters: [], titles: [] }
}).conclusion, "历史人物来源仍在读取，当前不能下结论");

console.log("V8.5 Luna Player Semantic UI: PASS");
