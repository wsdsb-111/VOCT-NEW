"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "resources/app/out/renderer/assets/index-Dn3qWlAB.js"), "utf8");
const css = fs.readFileSync(path.join(root, "resources/app/out/renderer/assets/index-WtJH_nua.css"), "utf8");
const preload = fs.readFileSync(path.join(root, "resources/app/out/preload/preload.js"), "utf8");
const analytics = fs.readFileSync(path.join(root, "resources/app/out/main/analytics/usage-analytics.js"), "utf8");
const conversation = fs.readFileSync(path.join(root, "resources/app/out/main/conversation/conversation.js"), "utf8");

assert(renderer.includes("Token / Cache Observability"), "Luna exposes the Token / Cache observability panel");
assert(renderer.includes("window.usageAPI") && renderer.includes("loadUsageReport"), "Luna reads the existing usage report through the preload boundary");
assert(renderer.includes('Object.prototype.hasOwnProperty.call(entry, "memoryStableTokens")') && renderer.includes("instrumentedChatObservations"), "old chat records cannot masquerade as V8.6.1 observability evidence");
for (const field of [
  "memoryStableTokens",
  "memoryDirectTokens",
  "memoryTopicTokens",
  "memoryTurnRecallTokens",
  "worldStableTokens",
  "worldTurnRecallTokens",
  "worldRetrievalMs",
  "worldPolicyMs",
  "memoryRecallMs",
  "promptBuildMs",
  "worldSharedCacheHit",
  "worldSubjectiveCacheHit"
]) assert(renderer.includes(field), `Renderer displays persisted ${field}`);
assert(renderer.includes("Supplemental knowledge is limited to the current session and checkpoint."), "Supplemental scope is explicit in the UI");
assert(renderer.includes("CK3 Runtime IDs, comma-separated (optional)"), "Supplemental audience input explains the runtime-ID boundary");
assert(css.includes(".worldline-observability-panel") && css.includes(".worldline-observability-caption"), "observability UI has bounded styles");
assert(preload.includes("getReport: () => electron.ipcRenderer.invoke(\"usage:getReport\")"), "usage report remains behind the preload API");
for (const field of ["memoryStableTokens", "worldTurnRecallTokens", "worldRetrievalMs", "promptBuildMs", "worldSharedCacheHit", "worldSubjectiveCacheHit"]) {
  assert(analytics.includes(`${field}: Number(metadata?.${field})`) || analytics.includes(`${field}: metadata?.${field}`), `analytics persists ${field}`);
}
assert(!conversation.includes("getSubjectiveWorldView?.("), "Luna diagnostics do not switch production Subjective Prompt injection");

console.log("V8.6.1 Luna Diagnostics UI: PASS (Token/Cache observability, scoped Supplemental copy and production Prompt isolation)");
