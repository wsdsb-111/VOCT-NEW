"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { LLMManager, TokenCounter } = require(path.join(root, "resources", "app", "out", "main", "provider-service.js"));
const { createProviderDiagnostics } = require(path.join(root, "resources", "app", "out", "main", "analytics", "provider-diagnostics.js"));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v89-chat-telemetry-"));
const provider = {
  chatCompletion() {
    return (async function* streamFixture() {
      yield { delta: { reasoning: "PRIVATE_REASONING_MARKER" } };
      yield { delta: { content: "VISIBLE_CONTENT_MARKER" } };
      return {
        content: "VISIBLE_CONTENT_MARKER",
        usage: {
          prompt_tokens: 20,
          completion_tokens: 5,
          total_tokens: 25,
          prompt_cache_hit_tokens: 12,
          prompt_cache_miss_tokens: 8,
          cache_reporting_status: "reported"
        }
      };
    })();
  }
};
const settingsRepository = {
  getActiveProviderConfig: () => ({ instanceId: "compatible", providerType: "openai-compatible", customName: "Fixture", defaultModel: "deepseek-v4-flash-0731", defaultParameters: { temperature: 0.7 } }),
  getGlobalStreamSetting: () => true,
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89OutboundDiagnostics: true, chatPromptV89RuntimeProfileSplit: false })
};
const providerRegistry = { createProvider: () => provider };
const ProviderDiagnostics = createProviderDiagnostics({ fs, path, dataDir: tempDir, settingsRepository, providerRegistry, TokenCounter });
const diagnostics = new ProviderDiagnostics();
const manager = new LLMManager({
  settingsRepository,
  providerRegistry,
  usageAnalytics: { record() {} },
  providerDiagnostics: diagnostics,
  TokenCounter,
  PromptBuilder: {},
  debugVerboseLLM: false,
  logVerboseLLM: () => {}
});
const messages = [{ role: "system", content: "STABLE_SECRET" }, { role: "user", content: "USER_SECRET" }];
const blocks = [
  { id: "stable", messageStartPosition: 0, messageCount: 1, tokens: 3, stable: true },
  { id: "current-user", messageStartPosition: 1, messageCount: 1, tokens: 3, stable: false }
];

(async () => {
  const response = await manager.sendChatRequest(messages, void 0, false, { requestType: "chat", blocks });
  for await (const _chunk of response) {
    // Consume the provider stream so timing and final usage are committed.
  }
  const entry = diagnostics.getRecent(1)[0];
  assert.strictEqual(entry.provider, "openai-compatible", "chat diagnostics must cover the DeepSeek OpenAI-compatible route");
  assert.strictEqual(entry.realRequestDiff.version, "real_request_diff_v1");
  assert.strictEqual(entry.realRequestDiff.comparisonStatus, "cold_local_baseline");
  assert(entry.requestStartedAt && entry.firstReasoningAt && entry.firstVisibleContentAt && entry.requestCompletedAt);
  assert(entry.reasoningTTFTMs >= 0 && entry.visibleTTFTMs >= 0 && entry.outputTimeMs >= 0 && entry.totalLatencyMs >= 0);
  assert.strictEqual(entry.normalizedUsage.prompt_cache_hit_tokens, 12);
  const persisted = fs.readFileSync(path.join(tempDir, "provider-diagnostics.jsonl"), "utf8");
  assert.doesNotMatch(persisted, /STABLE_SECRET|USER_SECRET|PRIVATE_REASONING_MARKER|VISIBLE_CONTENT_MARKER/);
  console.log("VOTC V8.9 chat telemetry: PASS (OpenAI-compatible capture, reasoning/visible TTFT, redacted persistence)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
