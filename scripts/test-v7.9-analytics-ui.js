"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const versions = require(path.join(root, "resources", "app", "out", "main", "version.js"));
assert.strictEqual(versions.VOTC_CORE_VERSION, "7.9.2");
assert.strictEqual(versions.ACTION_ENGINE_VERSION, "3.0");
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
analytics.record({ requestType: "action_mode_metric", actionSystemMode: "performance", metric: "pendingCreated" }, null);
analytics.record({ requestType: "action_mode_metric", actionSystemMode: "performance", metric: "semanticRescueCalls" }, null);
analytics.record({ requestType: "action_mode_metric", actionSystemMode: "balanced", metric: "stageBProviderCalls" }, null);
analytics.record({ requestType: "action_mode_metric", actionSystemMode: "precision", metric: "precisionJudgeCalls" }, null);
analytics.record({ requestType: "action_mode_metric", actionSystemMode: "performance", metric: "semanticRescueMatched" }, null);
analytics.record({ requestType: "action_mode_metric", actionSystemMode: "performance", metric: "providerExecuted" }, null);
analytics.record({ requestType: "chat", actionSystemMode: "performance" }, { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
analytics.record({ requestType: "chat", actionSystemMode: "performance" }, { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
analytics.record({ requestType: "action", actionStage: "semantic_rescue", actionSystemMode: "performance" }, { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 });
analytics.record({ requestType: "action", actionSystemMode: "balanced" }, { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 });
analytics.record({ requestType: "action", actionStage: "precision_stage_a", actionSystemMode: "precision" }, { prompt_tokens: 16, completion_tokens: 4, total_tokens: 20 });
analytics.record({ requestType: "action", actionStage: "social_consequence_judge", actionSystemMode: "precision" }, { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 });
const report = analytics.getReport();
assert.ok(["balanced", "performance", "precision"].includes(report.actionEngine3.currentMode), "current action mode must remain a valid mode after analytics retention");
assert.strictEqual(report.actionEngine3.pendingCreated, 1);
assert.strictEqual(report.actionEngine3.semanticRescueCalls, 1);
assert.strictEqual(report.actionEngine3.stageBProviderCalls, 1);
assert.strictEqual(report.actionEngine3.precisionJudgeCalls, 1);
assert.strictEqual(report.actionEngine3.semanticRescueMatched, 1);
assert.strictEqual(report.actionEngine3.providerExecuted, 1);
assert.strictEqual(report.actionEngine3.recognitionEfficiency, 1 / 4);
assert.strictEqual(report.actionEngine3.actionApiCallsPer100ChatMessages, 200);
assert.deepStrictEqual(
  Object.fromEntries(Object.entries(report.actionEngine3.modeTokenUsage).map(([mode, usage]) => [mode, { requests: usage.requests, totalTokens: usage.totalTokens }])),
  {
    balanced: { requests: 1, totalTokens: 10 },
    performance: { requests: 1, totalTokens: 6 },
    precision: { requests: 2, totalTokens: 35 }
  },
  "action Token usage must stay separated by the mode that made the request"
);
assert.deepStrictEqual(
  Object.fromEntries(Object.entries(report.actionEngine3.modeTokenUsage).map(([mode, usage]) => [mode, Object.fromEntries(Object.entries(usage.stages).map(([stage, stageUsage]) => [stage, { requests: stageUsage.requests, totalTokens: stageUsage.totalTokens }]))])),
  {
    balanced: {
      stageB: { requests: 1, totalTokens: 10 },
      semanticRescue: { requests: 0, totalTokens: 0 },
      precisionJudge: { requests: 0, totalTokens: 0 },
      socialJudge: { requests: 0, totalTokens: 0 }
    },
    performance: {
      stageB: { requests: 0, totalTokens: 0 },
      semanticRescue: { requests: 1, totalTokens: 6 },
      precisionJudge: { requests: 0, totalTokens: 0 },
      socialJudge: { requests: 0, totalTokens: 0 }
    },
    precision: {
      stageB: { requests: 0, totalTokens: 0 },
      semanticRescue: { requests: 0, totalTokens: 0 },
      precisionJudge: { requests: 1, totalTokens: 20 },
      socialJudge: { requests: 1, totalTokens: 15 }
    }
  },
  "each action mode must expose Stage B, Semantic Rescue, Precision Judge, and Social Judge Token usage"
);

const renderer = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
const rendererCss = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-WtJH_nua.css"), "utf8");
const main = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const actionEngine = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "action-engine.js"), "utf8");
const settings = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "config", "settings-repository.js"), "utf8");
const ipc = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "resources", "app", "out", "preload", "preload.js"), "utf8");
assert(main.includes('enum: ["balanced", "performance", "precision"]'));
assert(settings.includes('this.store.set("actionSystemMode", "balanced")'));
assert(settings.includes('throw new Error("invalid_action_system_mode")'));
assert(ipc.includes('"llm:saveActionSystemMode"'));
assert(preload.includes("saveActionSystemMode"));
for (const marker of ["Action Engine 3.0", "动作系统模式", "平衡模式", "性能模式", "精准模式", "Semantic Rescue 调用 / 命中", "Precision Judge 调用 / 动作", "每 100 条对话的动作 API 调用"]) {
  assert(renderer.includes(marker), `optimization UI must display ${marker}`);
}
assert(renderer.includes('className: "optimization-mode-toggle"'), "action mode name must expose the expandable triangle control");
assert(renderer.includes('showActionModeTokenUsage ? "▼" : "▶"'), "action mode toggle must display the triangle state");
assert(renderer.includes("actionModeTokenUsage"), "optimization UI must render per-mode action Token usage");
assert(rendererCss.includes(".optimization-mode-toggle"), "mode-token toggle needs visible styling");
assert(renderer.includes('className: "action-mode-token-usage"'), "mode-token rows must show the per-stage Token split");
assert(renderer.includes('stageUsage("socialJudge")'), "mode-token rows must show Social Judge Token usage");
assert(renderer.includes("查看当前记忆策略"), "memory routing descriptions must be collapsed by default");
assert(renderer.includes('className: "optimization-capability-details"'), "integration status must be collapsed by default");
assert(rendererCss.includes(':root[data-votc-theme="ink"] .summaries-manager .memory-engine-overview'), "ink Memory Engine overview must use the soft paper surface");
assert(actionEngine.includes('actionStage: "stage_b"'), "new Stage B requests must include an explicit stage for Token attribution");
const actionsView = renderer.slice(renderer.indexOf("const ActionsView = () => {"), renderer.indexOf("const PromptsView = () => {"));
for (const marker of ["updateActionSystemMode", "saveActionSystemMode", 'const currentActionSystemMode = appSettings?.actionSystemMode || "balanced"', 'className: "action-mode-controls"', 'role: "radiogroup"', '["balanced", "config.actionModeBalanced"]', '["performance", "config.actionModePerformance"]', '["precision", "config.actionModePrecision"]']) {
  assert(renderer.includes(marker), `Actions UI must expose ${marker}`);
}
assert(actionsView.includes('onClick: () => handleActionSystemModeChange(mode)'), "Actions UI mode buttons must save immediately");
const providerSidebar = renderer.slice(renderer.indexOf("const ProviderSidebar = ({"), renderer.indexOf("const getCacheKey$1 ="));
assert(!providerSidebar.includes('t("config.actionSystemMode")'), "provider sidebar must not retain the misplaced action mode selector");
assert(rendererCss.includes(".actions-view .action-mode-controls button.active"), "active action mode must be visually distinct");
for (const theme of ["parchment", "ink"]) {
  assert(rendererCss.includes(`:root[data-votc-theme="${theme}"] .actions-view .action-mode-controls button.active`), `${theme} theme must preserve active-mode contrast`);
}
console.log("VOTC v7.9 Analytics 3.0 and mode UI: PASS");
