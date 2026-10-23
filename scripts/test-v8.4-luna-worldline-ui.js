"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const stylePath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-WtJH_nua.css");
const htmlPath = path.join(root, "resources", "app", "out", "renderer", "index.html");
const renderer = fs.readFileSync(rendererPath, "utf8");
const styles = fs.readFileSync(stylePath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8");
const worldlineStart = renderer.indexOf("function WorldlineView()");
const worldlineEnd = renderer.indexOf("function ConfigPanel", worldlineStart);
assert.ok(worldlineStart >= 0 && worldlineEnd > worldlineStart, "WorldlineView boundaries are not present");
const worldlineSource = renderer.slice(worldlineStart, worldlineEnd);
assert.ok(!worldlineSource.includes("ipcRenderer"), "Luna must not access ipcRenderer directly");
assert.ok(!worldlineSource.includes("require("), "Luna must not load filesystem or Node modules directly");

const requiredRendererMarkers = [
  "function WorldlineView()",
  "Current CK3 facts are read-only",
  "window.worldlineAPI",
  "autosave.ck3 path",
  "Open Diagnostics",
  "Checkpoint Status",
  "Annual Delta",
  "Historical Identity",
  "Historical Character Mapping",
  "历史人物映射",
  "worldline-identity-resolution",
  "identityCandidates",
  "candidateCharacters",
  "resolvedCharacters",
  "worldline-candidate-card",
  "worldline-binding-controls",
  "bindingStatusFilter",
  "actorsLabel",
  "player.event(item)",
  "VOTCWorldlinePlayerPresentation",
  "DERIVED_GAMESTATE",
  "CHECKPOINT_ONLY",
  "LIVE_VERIFIED",
  "检查点有效",
  "verificationMode",
  "filteredHistoricalBindings",
  "Supplemental Knowledge",
  "worldline-semantic-grid",
  "semanticMeta",
  "politicalContext",
  "Player Primary Title",
  "Direct Liege",
  "Top realm",
  "Top realm ruler",
  "worldlineFreshness",
  "Prompt / World Recall Diagnostics",
  "Query Analyzer Entities",
  "Matched Game Truth",
  "Matched Supplemental",
  "World Prompt Token",
  "promptTokenBreakdownRows",
  "item.label",
  "item.tokens",
  "tokenBreakdownTotal",
  "tokenBreakdownMatches",
  "tokenBreakdownMatches",
  "Localization Reverse Lookup",
  "Historical Alias Resolver",
  "Runtime Identity Resolution",
  "resolverTrace",
  "Trimmed Items",
  "Unknown / Unconfirmed",
  "confidence:",
  "raw:",
  "source:",
  "source: \"PLAYER_SUPPLEMENTAL\"",
  "gameDate: \"\"",
  "scope: \"SESSION\"",
  "checkpointScope: \"CURRENT_CHECKPOINT\"",
  "currentTab === \"worldline\""
];
for (const marker of requiredRendererMarkers) {
  assert.ok(renderer.includes(marker), `renderer is missing Luna marker: ${marker}`);
}

const scopedReadMethods = [
  "getSettings",
  "getCheckpointStatus",
  "getOverview",
  "getAnnualDelta",
  "getWorldKnowledge",
  "getHistoricalBindings",
  "getDiagnostics",
  "getPromptDiagnostics",
  "getSubjectiveResponderOptions",
  "getSubjectiveWorldView",
  "getEntityKinshipInspector"
];
assert.ok(worldlineSource.includes('useV95ReadBoundary("worldline")'), "Worldline reads must use the scoped read boundary");
for (const marker of [
  'readTask("checkpoint", () => Promise.all([',
  'readTask("bindings", () => readInvoke("getHistoricalBindings"',
  'readTask("prompt", () => readInvoke("getPromptDiagnostics"',
  'readTask("responders", () => readInvoke("getSubjectiveResponderOptions"',
  'readTask("subjective", () => Promise.all([',
  'readTask("inspector", () => readInvoke("getEntityKinshipInspector"'
]) {
  assert.ok(worldlineSource.includes(marker), `Worldline read is missing its scoped read task: ${marker}`);
}
for (const method of scopedReadMethods) {
  assert.ok(worldlineSource.includes(`readInvoke("${method}"`), `renderer is missing scoped Worldline read method: ${method}`);
  assert.ok(!worldlineSource.includes(`invoke("${method}"`), `Worldline read method must not bypass the scoped read task: ${method}`);
}

const directInvokeMethods = Array.from(worldlineSource.matchAll(/(?:^|[^A-Za-z])invoke\("([^"]+)"/g), (match) => match[1]);
assert.deepStrictEqual([...new Set(directInvokeMethods)].sort(), [
  "createSupplemental",
  "deleteSupplemental",
  "rebuildCheckpoint",
  "selectAutosaveFile",
  "setAutosavePath",
  "setRecallSettings",
  "temporalArchive",
  "updateSupplemental",
  "validateAutosavePath"
].sort(), "direct Worldline invoke calls must stay within the explicit UI intent allowlist");
assert.ok(!directInvokeMethods.includes("getOfficialRecollection"), "official recollection must not bypass the scoped reader");
assert.ok(worldlineSource.includes("createOfficialRecollectionReader({ runtime: v95Runtime, worldlineApi: window.worldlineAPI })"), "the production page must mount the scoped reader");
assert.ok(worldlineSource.includes('officialReaderRef.current?.refresh(String(subjectiveResponderId || ""))'), "the diagnostic button must use the scoped reader");
assert.ok(worldlineSource.includes('getStateFor(String(subjectiveResponderId || ""), contextVersion)'), "the render path must hide old responder/context results synchronously");

for (const method of [
  "setAutosavePath",
  "validateAutosavePath",
  "selectAutosaveFile",
  "rebuildCheckpoint",
  "createSupplemental",
  "updateSupplemental",
  "deleteSupplemental"
]) {
  assert.ok(renderer.includes(`invoke(\"${method}\"`), `renderer is missing Terra IPC method: ${method}`);
}

assert.match(styles, /\.worldline-view\s*\{/);
assert.match(styles, /\.worldline-semantic-grid\s*\{/);
assert.match(styles, /\.worldline-semantic-item small\s*\{/);
assert.match(styles, /\.worldline-editor-form textarea/);
assert.match(styles, /\.worldline-token-row\s*\{/);
assert.match(styles, /\.worldline-resolver-trace\s*\{/);
assert.match(styles, /\.worldline-binding-controls\s*\{/);
assert.match(styles, /\.worldline-identity-resolution\s*\{/);
assert.match(styles, /\.worldline-candidate-card\s*\{/);
assert.match(styles, /\.worldline-delta-detail\s*\{/);
assert.ok(html.includes('src="./assets/index-Dn3qWlAB.js"'), "renderer bundle is not loaded by index.html");
assert.ok(html.includes('href="./assets/index-WtJH_nua.css"'), "renderer stylesheet is not loaded by index.html");
assert.ok(renderer.includes('key !== "displayName" && key !== "aliasCandidate"'), "ambiguous candidates must not use authoritative display names");
assert.ok(renderer.includes("isAmbiguous && isGameTruth"), "ambiguous candidates must be blocked from the Game Truth panel");
assert.ok(renderer.includes("isAmbiguous && (isCharacterQuery || isTitleQuery)"), "ambiguous query entities must use the candidate panel");

console.log("V8.4.2 Luna Worldline UI structure: PASS");
