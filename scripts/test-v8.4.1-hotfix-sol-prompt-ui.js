"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
const tokenRendererStart = renderer.indexOf("const promptTokenBreakdownRows");
const tokenRendererEnd = renderer.indexOf("const resolverTraceValue", tokenRendererStart);
assert.ok(tokenRendererStart >= 0 && tokenRendererEnd > tokenRendererStart, "the dedicated token renderer must exist");
const tokenRenderer = renderer.slice(tokenRendererStart, tokenRendererEnd);
assert.ok(tokenRenderer.includes("item.label"), "token rows must render the backend label field");
assert.ok(tokenRenderer.includes("item.id"), "token rows must render the stable block ID");
assert.ok(tokenRenderer.includes("item.tokens"), "token rows must render the measured token count");
assert.ok(!tokenRenderer.includes("item.body") && !tokenRenderer.includes("item.visibility"), "token rows must not use Supplemental fields");

const diagnosticsStart = renderer.indexOf('activeTab === "diagnostics"');
const diagnosticsEnd = renderer.indexOf('className: "worldline-card worldline-editor"', diagnosticsStart);
const diagnostics = renderer.slice(diagnosticsStart, diagnosticsEnd);
const worldlineStart = renderer.indexOf("function WorldlineView()");
const worldlineEnd = renderer.indexOf("function ConfigPanel", worldlineStart);
const worldline = renderer.slice(worldlineStart, worldlineEnd);
assert.ok(diagnostics.includes("promptTokenBreakdownRows(promptDiagnostics.tokenBreakdown"), "Prompt Diagnostics must call the dedicated token renderer");
assert.ok(worldline.includes("tokenBreakdownTotal"), "Prompt Diagnostics must expose the block sum");
assert.ok(worldline.includes("tokenBreakdownMatches"), "Prompt Diagnostics must compare the block sum with worldPromptTokens");
for (const blockId of ["worldline-stable", "worldline-topic", "worldline-supplemental", "worldline-current"]) {
  const service = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "worldline", "worldline-service.js"), "utf8");
  assert.ok(service.includes(`"${blockId}"`), `backend token breakdown must retain ${blockId}`);
}
assert.ok(worldline.includes("promptResolverTraceRows(promptDiagnostics.resolverTrace)"), "the UI must consume the backend Resolver Trace");

console.log("V8.4.1 Hotfix Sol Prompt UI: PASS (token fields, total equality gate and resolver trace)");
