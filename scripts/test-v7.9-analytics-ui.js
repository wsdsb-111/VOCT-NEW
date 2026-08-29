"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const versions = require(path.join(root, "resources", "app", "out", "main", "version.js"));
assert.strictEqual(versions.VOTC_CORE_VERSION, "7.9.3");
assert.strictEqual(versions.ACTION_ENGINE_VERSION, "4.0");
assert.strictEqual(versions.MEMORY_ENGINE_VERSION, "2.5", "v7.9 must not change Memory Engine behavior or data version");
const { createUsageAnalytics } = require(path.join(root, "resources", "app", "out", "main", "analytics", "usage-analytics.js"));
const retention = require(path.join(root, "resources", "app", "out", "main", "usage-analytics-retention.js"));
let stored = null;
const memoryFs = {
  existsSync: () => stored !== null,
  readFileSync: () => stored,
  mkdirSync() {},
  writeFileSync: (_file, content) => { stored = content; }
};
const UsageAnalytics = createUsageAnalytics({ fs: memoryFs, dataDir: "memory", analyticsFile: "memory/usage.json", retention, createPromptFingerprint: (value) => String(value || "").length.toString(16) });
const analytics = new UsageAnalytics();
analytics.record({ requestType: "action_v4_message", engineVersion: "4.0", actionSystemMode: "precision", outcome: "eligible" }, null);
for (const stage of ["Detected", "Bound", "Validated", "Approved", "Executed"]) {
  analytics.record({ requestType: "action_v4_funnel", engineVersion: "4.0", actionSystemMode: "precision", stage, outcome: "passed" }, null);
}
analytics.record({ requestType: "action_v4_funnel", engineVersion: "4.0", actionSystemMode: "precision", stage: "Pending/Consent", outcome: "pending" }, null);
analytics.record({ requestType: "action_v4_funnel", engineVersion: "4.0", actionSystemMode: "precision", stage: "Pending/Consent", outcome: "accepted" }, null);
analytics.record({ requestType: "action_v4_funnel", engineVersion: "4.0", actionSystemMode: "precision", stage: "Validated", outcome: "rejected" }, null);
analytics.record({ requestType: "action_v4_performance", engineVersion: "4.0", actionSystemMode: "performance", stage: "fast_resolver", outcome: "hit" }, null);
analytics.record({ requestType: "action_v4_message_result", engineVersion: "4.0", actionSystemMode: "performance", outcome: "detected", detectedDecisions: 1 }, null);
analytics.record({ requestType: "action_v4_message_result", engineVersion: "4.0", actionSystemMode: "precision", outcome: "no_action", detectedDecisions: 0 }, null);
analytics.record({ requestType: "action_v4_outcome", engineVersion: "4.0", actionSystemMode: "performance", origin: "performance_compact", executed: 1 }, null);
analytics.record({ requestType: "chat", actionSystemMode: "performance" }, { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
analytics.record({ requestType: "chat", actionSystemMode: "performance" }, { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
analytics.record(
  { requestType: "action", engineVersion: "4.0", actionStage: "performance_compact", actionSystemMode: "performance" },
  { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 6, prompt_cache_miss_tokens: 4 }
);
analytics.record(
  { requestType: "action", engineVersion: "4.0", actionStage: "precision_selector", actionSystemMode: "precision" },
  { prompt_tokens: 16, completion_tokens: 4, total_tokens: 20, prompt_cache_hit_tokens: 12, prompt_cache_miss_tokens: 4 }
);
const report = analytics.getReport();
assert.strictEqual(report.actionEngine4.currentMode, "precision");
assert.strictEqual(report.actionEngine4.eligibleMessages, 1);
assert.strictEqual(report.actionEngine4.detected, 1);
assert.strictEqual(report.actionEngine4.bound, 1);
assert.strictEqual(report.actionEngine4.validated, 1);
assert.strictEqual(report.actionEngine4.consentPending, 1);
assert.strictEqual(report.actionEngine4.approved, 1);
assert.strictEqual(report.actionEngine4.executed, 1);
assert.strictEqual(report.actionEngine4.rejected, 1);
assert.strictEqual(report.actionEngine4.fastResolverHits, 1);
assert.strictEqual(report.actionEngine4.compactSelectorCalls, 1);
assert.strictEqual(report.actionEngine4.precisionSelectorCalls, 1);
assert.strictEqual(report.actionEngine4.bindingSuccessRate, 1);
assert.strictEqual(report.actionEngine4.executionYield, 1);
assert.strictEqual(report.actionEngine4.pendingResolutionRate, 1);
assert.strictEqual(report.actionEngine4.compactSelectorHitRate, 1);
assert.strictEqual(report.actionEngine4.providerCallsPer100Dialogues, 100);
assert.strictEqual(report.actionEngine4.selectorCacheHitRate, 18 / 26);
assert.strictEqual(report.actionEngine4.uncachedTokensPerDialogue, 4);
assert.strictEqual(report.actionEngine4.tokensPerExecutedAction, 32);
assert.strictEqual(report.actionEngine4.uncachedTokensPerExecutedAction, 8);
assert.strictEqual(report.actionEngine4.noActionRate, 0.5);
assert.deepStrictEqual(
  Object.fromEntries(Object.entries(report.actionEngine4.modeTokenUsage).map(([mode, usage]) => [mode, { requests: usage.requests, totalTokens: usage.totalTokens }])),
  {
    performance: { requests: 1, totalTokens: 12 },
    precision: { requests: 1, totalTokens: 20 }
  },
  "action Token usage must stay separated by the mode that made the request"
);
assert.deepStrictEqual(
  Object.fromEntries(Object.entries(report.actionEngine4.modeTokenUsage).map(([mode, usage]) => [mode, Object.fromEntries(Object.entries(usage.stages).map(([stage, stageUsage]) => [stage, { requests: stageUsage.requests, totalTokens: stageUsage.totalTokens }]))])),
  {
    performance: {
      precisionSelector: { requests: 0, totalTokens: 0 },
      compactSelector: { requests: 1, totalTokens: 12 }
    },
    precision: {
      precisionSelector: { requests: 1, totalTokens: 20 },
      compactSelector: { requests: 0, totalTokens: 0 }
    }
  },
  "each AE4 mode must expose Precision and Compact Selector Token usage"
);

const renderer = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
const rendererCss = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-WtJH_nua.css"), "utf8");
const main = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const actionEngine = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "action-engine.js"), "utf8");
const settings = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "config", "settings-repository.js"), "utf8");
const ipc = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "resources", "app", "out", "preload", "preload.js"), "utf8");
assert(main.includes('enum: ["balanced", "performance", "precision"]'));
assert(settings.includes('this.store.set("actionSystemMode", "performance")'));
assert(settings.includes('const mode = stored === "precision" ? "precision" : "performance"'));
assert(settings.includes('const normalized = mode === "precision" ? "precision" : "performance"'));
assert(ipc.includes('"llm:saveActionSystemMode"'));
assert(preload.includes("saveActionSystemMode"));
for (const marker of ["Action Engine 4.0", "动作系统模式", "性能模式", "精准模式", "Detected / Bound / Validated", "Consent Pending / Approved / Executed", "Fast Resolver HIT / Compact / Precision", "每 100 条对话的 Selector 调用"]) {
  assert(renderer.includes(marker), `optimization UI must display ${marker}`);
}
assert(renderer.includes('className: "optimization-mode-toggle"'), "action mode name must expose the expandable triangle control");
assert(renderer.includes('showActionModeTokenUsage ? "▼" : "▶"'), "action mode toggle must display the triangle state");
assert(renderer.includes("actionModeTokenUsage"), "optimization UI must render per-mode action Token usage");
assert(rendererCss.includes(".optimization-mode-toggle"), "mode-token toggle needs visible styling");
assert(renderer.includes('className: "action-mode-token-usage"'), "mode-token rows must show the per-stage Token split");
assert(renderer.includes('stageUsage("precisionSelector")'), "mode-token rows must show Precision Selector Token usage");
assert(renderer.includes('stageUsage("compactSelector")'), "mode-token rows must show Compact Selector Token usage");
assert(renderer.includes("查看当前记忆策略"), "memory routing descriptions must be collapsed by default");
assert(renderer.includes('className: "optimization-capability-details"'), "integration status must be collapsed by default");
assert(rendererCss.includes(':root[data-votc-theme="ink"] .summaries-manager .memory-engine-overview'), "ink Memory Engine overview must use the soft paper surface");
assert(actionEngine.includes('require("./v4/action-engine-v4")'), "Action Engine router must default to AE4");
const actionsView = renderer.slice(renderer.indexOf("const ActionsView = () => {"), renderer.indexOf("const PromptsView = () => {"));
for (const marker of ["updateActionSystemMode", "saveActionSystemMode", 'const currentActionSystemMode = appSettings?.actionSystemMode === "precision" ? "precision" : "performance"', 'className: "action-mode-controls"', 'role: "radiogroup"', '["performance", "config.actionModePerformance"]', '["precision", "config.actionModePrecision"]']) {
  assert(renderer.includes(marker), `Actions UI must expose ${marker}`);
}
assert(!actionsView.includes('["balanced", "config.actionModeBalanced"]'), "Actions UI must remove the legacy Balanced mode button");
assert(actionsView.includes('onClick: () => handleActionSystemModeChange(mode)'), "Actions UI mode buttons must save immediately");
const providerSidebar = renderer.slice(renderer.indexOf("const ProviderSidebar = ({"), renderer.indexOf("const getCacheKey$1 ="));
assert(!providerSidebar.includes('t("config.actionSystemMode")'), "provider sidebar must not retain the misplaced action mode selector");
assert(rendererCss.includes(".actions-view .action-mode-controls button.active"), "active action mode must be visually distinct");
for (const theme of ["parchment", "ink"]) {
  assert(rendererCss.includes(`:root[data-votc-theme="${theme}"] .actions-view .action-mode-controls button.active`), `${theme} theme must preserve active-mode contrast`);
}
console.log("VOTC v7.9.3 Action Engine 4.0 analytics and mode UI: PASS");
