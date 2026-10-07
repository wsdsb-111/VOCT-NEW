"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const worldMemoryEditorPath = path.join(root, "resources", "app", "out", "renderer", "world-memory-editor.js");
const rendererCssPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-WtJH_nua.css");
const packagePath = path.join(root, "resources", "app", "package.json");
const renderer = fs.readFileSync(rendererPath, "utf8");
const worldMemoryEditor = fs.readFileSync(worldMemoryEditorPath, "utf8");
const rendererCss = fs.readFileSync(rendererCssPath, "utf8");
const appPackage = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const { MEMORY_ENGINE_VERSION, SUPPORTED_PERSPECTIVE_SUMMARY_ENGINE_VERSIONS } = require(path.join(root, "resources", "app", "out", "main", "version"));
const { CURRENT_SUMMARY_SCHEMA_VERSION, normalizeSummaryRecord } = require(path.join(root, "resources", "app", "out", "main", "memory-system", "memory-schema"));
const { MemoryEngine } = require(path.join(root, "resources", "app", "out", "main", "memory-system", "memory-engine"));

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const featureVersionDeclaration = /\bconst\s+VOTC_FEATURE_VERSION\s*=\s*["']V8\.15\.2["']/.test(renderer);
check(featureVersionDeclaration, "Renderer must define VOTC_FEATURE_VERSION = \"V8.15.2\"");
check((renderer.match(/\bVOTC_FEATURE_VERSION\b/g) || []).length >= 2, "Renderer must display the feature version constant");
check(renderer.includes("window.electronAPI.getAppVersion()"), "footer must continue reading the package version through getAppVersion()");
const footerStart = renderer.indexOf('className: "app-version"');
check(footerStart >= 0 && /appVersion/.test(renderer.slice(footerStart, footerStart + 180)), "footer must display the getAppVersion() result");
check(appPackage.version === "2.0.4", "the Electron package version must remain 2.0.4");

check(renderer.includes("Memory Engine 4.0"), "the current memory overview must identify Memory Engine 4.0");
const footerRule = rendererCss.match(/\.config-panel-container \.app-version\s*\{([^}]*)\}/)?.[1] || "";
check(/position:\s*static\s*;/.test(footerRule) && /align-self:\s*flex-end\s*;/.test(footerRule) && /flex-shrink:\s*0\s*;/.test(footerRule), "footer must reserve flex layout space instead of overlaying page content");
check(/margin-top:\s*6px\s*;/.test(footerRule) && /max-width:\s*100%\s*;/.test(footerRule) && /white-space:\s*nowrap\s*;/.test(footerRule), "footer must remain bounded and legible in narrow windows");
const oldStageLabels = [
  [renderer, "V8.7 世界书"],
  [worldMemoryEditor, "V8.7.2"],
  [renderer, "Memory Engine 3.0 · V8.12 Part 3"],
  [renderer, "V8.12 Part 3 使用 Memory Engine 3.0"],
  [renderer, "Memory Engine 3.0 · CK3 Official Recollection"],
  [renderer, "查看 V7.10 适配状态"],
  [renderer, "View V7.10 integration status"],
  [renderer, "V8.12 Temporal Archive · Historical Retrieval"],
  [renderer, "Phase A 只读诊断"],
  [renderer, "通过 Memory Engine 3.0 搜索人物视角摘要目录"]
];
for (const [source, label] of oldStageLabels) check(!source.includes(label), `obsolete UI label remains: ${label}`);
check(/world-memory-version[\s\S]{0,220}"当前分支"/.test(worldMemoryEditor), "WorldMemoryEditor must use the unversioned 当前分支 label");
check(renderer.includes("只读诊断"), "subjective-world diagnostics must retain the read-only label");

const experimentIndex = renderer.indexOf("actionExperiments?.overlayRequested");
const experimentLabel = experimentIndex < 0 ? "" : renderer.slice(Math.max(0, experimentIndex - 1000), experimentIndex + 260);
check(experimentIndex >= 0 && /历史/.test(experimentLabel) && /已退役|已停用/.test(experimentLabel), "legacy action experiment metrics must be marked historical and retired");
check(!renderer.includes("RC5 分阶段动作请求"), "retired RC5 action experiment copy must not imply a current experiment");

check(renderer.includes("V8.14.1 完整信件实机流程已由玩家确认") && renderer.includes("V8.14.2 信件公开功能仍待实机复测"), "Renderer must separate the passed legacy letter gate from new disclosure retesting");
const rendererStringLiterals = [
  ...renderer.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g),
  ...renderer.matchAll(/`([^`\\]*(?:\\.[^`\\]*)*)`/g)
].map(match => match[1]);
check(rendererStringLiterals.some(copy => /GLM/i.test(copy) && /前缀布局保留|prefix layout is preserved/i.test(copy)
  && /待实机验证|require in-game validation/i.test(copy)), "Renderer must distinguish preserved GLM layout from pending telemetry validation");
check(!/(?:提高|提升|保证|确保)[^"\n]{0,14}(?:缓存命中|缓存复用|命中率)|(?:缓存命中|缓存复用|命中率)[^"\n]{0,14}(?:提高|提升|保证|确保)/i.test(renderer), "Renderer must not promise cache hits or increased cache reuse");

for (const persistentKey of ["v812MemoryEngine3Enabled", "chatPromptV89Layout", "chatPromptV810ProviderAdapter"]) {
  check(renderer.includes(persistentKey), `existing persistent key must remain intact: ${persistentKey}`);
}
check(MEMORY_ENGINE_VERSION === "3.0", "the Memory Engine 3.0 protocol version must remain unchanged");
check(SUPPORTED_PERSPECTIVE_SUMMARY_ENGINE_VERSIONS.has("2.5"), "the 2.5 summary storage contract must remain supported");
check(CURRENT_SUMMARY_SCHEMA_VERSION === 2, "the summary schema version must remain unchanged");
check(normalizeSummaryRecord({ engineVersion: "2.5", schemaVersion: 2 }).engineVersion === "2.5", "normalizing a legacy summary must preserve its 2.5 engine version");

const cacheMetrics = { entries: 2, hits: 5, misses: 1 };
const store = {
  getFolderSummaryCacheMetrics: () => cacheMetrics,
  index: { memories: { first: {}, second: {} }, episodes: { episode: {} } },
  listKnowledgeCharacterIds: () => [7, 9]
};
const summaryCatalog = [
  { folderName: "7_甲", summaries: [{}, {}] },
  { folderName: "7_甲", summaries: [] },
  { folderName: "9_乙", summaries: [{}] }
];
const overview = MemoryEngine.prototype.getUiOverview.call({ store }, { summaryCatalog });
assert.deepStrictEqual(Object.keys(overview).sort(), ["boundaries", "characters", "engineVersion", "folderSummaryCache", "routingPolicy", "totals"].sort(), "overview top-level fields must remain stable");
assert.strictEqual(overview.engineVersion, "3.0", "overview engineVersion is a protocol field and must remain 3.0");
assert.strictEqual(overview.folderSummaryCache, cacheMetrics, "overview must preserve the cache metrics payload");
assert.deepStrictEqual(overview.totals, {
  structuredMemories: 2,
  episodes: 1,
  knowledgeCharacters: 2,
  summaryFolders: 2,
  summaryFiles: 3,
  summaryRecords: 3
}, "overview totals and summary catalog counting must remain stable");
assert.deepStrictEqual(overview.characters, [], "overview must not add a duplicate structured-memory tree");

const overviewCopy = [...overview.boundaries, ...Object.values(overview.routingPolicy)].join("\n");
check(/Recent\s*2|最近\s*2|最近两篇/i.test(overviewCopy), "memory overview must describe the Recent2 lane");
check(/Memory\s*4(?:\.0)?|Memory4/i.test(overviewCopy), "memory overview must describe the current Memory4 route");
check(/(?:概览|overview)[^。\n]{0,80}1/i.test(overviewCopy), "memory overview must state the one-item overview allowance");
check(/(?:细节|详情|detail)[^。\n]{0,80}2/i.test(overviewCopy), "memory overview must state the two-item detail allowance");
check(/(?:LIFE|人生)[^。\n]{0,80}1/i.test(overviewCopy), "memory overview must state the one-item life allowance");
check(/(?:<=|≤|最多|不超过)\s*1,?200|\b1200\b/i.test(overviewCopy), "memory overview must state the 1200-token hard ceiling");
check(/Owner/i.test(overviewCopy) && /Campaign|战役/i.test(overviewCopy) && /knownBy|知情名单/i.test(overviewCopy), "memory overview must explain Owner, Campaign, and knownBy scope");
check(/(?:归档|archive)[^。\n]{0,60}(?:只读|read.only)|(?:只读|read.only)[^。\n]{0,60}(?:归档|archive)/i.test(overviewCopy), "memory overview must identify archives as read-only");

if (failures.length) {
  console.error(`V8.14.1 frontend content: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("V8.14.1 frontend content: PASS (current labels, evidence boundaries, routing overview, and unchanged protocols)");
}
