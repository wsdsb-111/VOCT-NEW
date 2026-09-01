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
  "window.worldlineAPI",
  "autosave.ck3 path",
  "Open Diagnostics",
  "Checkpoint Status",
  "Annual Delta",
  "Historical Identity",
  "Supplemental Knowledge",
  "worldline-semantic-grid",
  "semanticMeta",
  "politicalContext",
  "Player Primary Title",
  "Direct Liege",
  "Top Realm",
  "Top Realm Ruler",
  "Checkpoint Freshness",
  "Prompt / World Recall Diagnostics",
  "Query Analyzer Entities",
  "Matched Game Truth",
  "Matched Supplemental",
  "World Prompt Token",
  "Trimmed Items",
  "Unknown / Unconfirmed",
  "confidence:",
  "raw:",
  "source:",
  "source: \"PLAYER_CANON\"",
  "gameDate: \"\"",
  "scope: \"SESSION\"",
  "checkpointScope: \"CURRENT_CHECKPOINT\"",
  "currentTab === \"worldline\""
];
for (const marker of requiredRendererMarkers) {
  assert.ok(renderer.includes(marker), `renderer is missing Luna marker: ${marker}`);
}

for (const method of [
  "getSettings",
  "setAutosavePath",
  "validateAutosavePath",
  "selectAutosaveFile",
  "getCheckpointStatus",
  "rebuildCheckpoint",
  "getOverview",
  "getAnnualDelta",
  "getWorldKnowledge",
  "getHistoricalBindings",
  "getDiagnostics",
  "getPromptDiagnostics",
  "listSupplemental",
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
assert.ok(html.includes('src="./assets/index-Dn3qWlAB.js"'), "renderer bundle is not loaded by index.html");
assert.ok(html.includes('href="./assets/index-WtJH_nua.css"'), "renderer stylesheet is not loaded by index.html");

console.log("V8.4 Luna Worldline UI structure: PASS");
