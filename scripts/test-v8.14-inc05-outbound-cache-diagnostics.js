"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { TokenCounter } = require(path.join(root, "resources", "app", "out", "main", "provider-service.js"));
const { OpenAICompatibleProvider, ZhipuProvider, DeepseekProvider } = require(path.join(root, "resources", "app", "out", "main", "providers"));
const { createProviderDiagnostics } = require(path.join(root, "resources", "app", "out", "main", "analytics", "provider-diagnostics.js"));
const { buildRealRequestSnapshot, buildRealRequestDiff } = require(path.join(root, "resources", "app", "out", "main", "analytics", "real-request-diff.js"));

function hash(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

async function captureActualOutbound(provider, request, config, captureMethod) {
  let actualRequest = null;
  provider[captureMethod] = (outboundRequest) => {
    actualRequest = outboundRequest;
    return outboundRequest;
  };
  await provider.chatCompletion(request, config);
  assert(actualRequest, `${provider.constructor.name} must pass a request to its transport`);
  assert.deepStrictEqual(actualRequest, provider.buildDiagnosticRequest(request, config), `${provider.constructor.name} diagnostic request must match its transport request`);
  return actualRequest;
}

async function main() {
  const requestMessages = [
    { role: "system", content: "stable system fixture" },
    { role: "developer", content: "stable responder fixture" },
    { role: "user", content: "volatile turn A" }
  ];
  const request = { model: "fixture-model", messages: requestMessages, stream: false, temperature: 0.7, max_tokens: 128 };

  const openAICompatible = new OpenAICompatibleProvider();
  const genericOutbound = await captureActualOutbound(openAICompatible, request, { apiKey: "fixture-key", baseUrl: "https://example.invalid/v1" }, "_nonStreamChatCompletion");
  const zhipu = new ZhipuProvider();
  zhipu.createOpenAIClient = () => ({});
  const zhipuConfig = { providerType: "zhipu", apiKey: "fixture-key", baseUrl: "https://example.invalid/v4", defaultModel: "glm-5.3-flash", glmReasoningEffort: "low", glmClearThinking: true };
  const zhipuOutbound = await captureActualOutbound(zhipu, { ...request, model: zhipuConfig.defaultModel }, zhipuConfig, "_nonStreamZhipuChatCompletion");
  const deepseek = new DeepseekProvider();
  const deepseekConfig = { providerType: "deepseek", apiKey: "fixture-key", baseUrl: "https://example.invalid/v1", defaultModel: "deepseek-v4-flash" };
  const deepseekOutbound = await captureActualOutbound(deepseek, { ...request, model: deepseekConfig.defaultModel }, deepseekConfig, "_nonStreamChatCompletion");
  assert.deepStrictEqual(genericOutbound.messages, request.messages);
  assert.deepStrictEqual(zhipuOutbound.messages, request.messages);
  assert.deepStrictEqual(deepseekOutbound.messages, request.messages);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-inc05-cache-diagnostics-"));
  try {
    const service = new (createProviderDiagnostics({
      fs,
      path,
      dataDir: tempDir,
      diagnosticsFile: path.join(tempDir, "provider-diagnostics.jsonl"),
      settingsRepository: {
        getActiveProviderConfig: () => zhipuConfig,
        getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89OutboundDiagnostics: true, chatPromptV810ProviderAdapter: true }),
        getPromptSettings: () => ({ blocks: [] })
      },
      providerRegistry: {},
      TokenCounter
    }))();
    const blocks = [
      { id: "stable_system", position: 0, messageStartPosition: 0, messageCount: 1, stable: true },
      { id: "stable_responder", position: 1, messageStartPosition: 1, messageCount: 1, stable: true },
      { id: "current_user", position: 2, messageStartPosition: 2, messageCount: 1, stable: false },
      { id: "later_stable", position: 3, messageStartPosition: 3, messageCount: 1, stable: true }
    ];
    const buildRequest = (messages) => ({ model: "glm-5.3-flash", messages, stream: true, temperature: 0.7, max_tokens: 4096, thinking: { type: "enabled", clear_thinking: true }, reasoning_effort: "low" });
    const buildMessages = (turn, responderName = "responder-name-A") => [
      { role: "system", content: "stable system fixture" },
      { role: "developer", content: "stable responder fixture", name: responderName },
      { role: "user", content: turn }
    ];
    const prepare = (messages) => service.prepareOutboundRequest({
      provider: "zhipu", model: "glm-5.3-flash", requestType: "chat", request: buildRequest(messages), blocks,
      conversationId: "conversation-fixture", responderId: "responder-fixture", baseUrl: zhipuConfig.baseUrl,
      promptProfile: { id: "glm_cache_v2", label: "GLM Cache v2", layoutId: "glm_cache_v2" }
    });

    const first = prepare(buildMessages("volatile turn A"));
    const second = prepare(buildMessages("volatile turn B"));
    const third = prepare(buildMessages("volatile turn C", "responder-name-B"));
    assert.strictEqual(first.stablePrefixEndPosition, 2, "boundary is the exclusive end message index, not the block index");
    assert.strictEqual(first.serializedPrefixSha256, hash(JSON.stringify(canonicalize([
      { role: "system", content: "stable system fixture" },
      { role: "developer", content: "stable responder fixture", name: "responder-name-A" }
    ]))));
    assert.strictEqual(first.stablePrefixUnchanged, null, "the first request has no previous prefix for comparison");
    assert.strictEqual(second.serializedPrefixSha256, first.serializedPrefixSha256, "volatile turns must not change the stable message-prefix hash");
    assert.strictEqual(second.stablePrefixUnchanged, true);
    assert.strictEqual(third.stablePrefixUnchanged, false, "a changed stable message name must break the prefix even when role/content are unchanged");

    const richMessages = [
      { role: "system", content: "tool fixture system" },
      { role: "assistant", content: null, tool_calls: [{ id: "tool-call-A", type: "function", function: { name: "lookup_fixture", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "tool-call-A", name: "lookup_fixture", content: "fixture tool result" },
      { role: "user", content: "volatile fixture turn" }
    ];
    const richBlocks = [0, 1, 2].map((position) => ({ id: `stable_${position}`, messageStartPosition: position, messageCount: 1, stable: true })).concat({ id: "dynamic", messageStartPosition: 3, messageCount: 1, stable: false });
    const buildRichSnapshot = (messages) => buildRealRequestSnapshot({
      providerType: "zhipu", model: "glm-5.3-flash", request: { model: "glm-5.3-flash", messages, stream: true },
      conversationId: "rich-conversation-fixture", responderId: "responder-fixture", blocks: richBlocks
    });
    const richBaseline = buildRichSnapshot(richMessages);
    for (const mutate of [
      (messages) => { messages[2].name = "changed_lookup_fixture"; },
      (messages) => { messages[1].tool_calls[0].id = "tool-call-B"; },
      (messages) => { messages[2].tool_call_id = "tool-call-B"; }
    ]) {
      const changedMessages = JSON.parse(JSON.stringify(richMessages));
      mutate(changedMessages);
      const diff = buildRealRequestDiff({ previousConversation: richBaseline, current: buildRichSnapshot(changedMessages) });
      assert.strictEqual(diff.stablePrefixEndPosition, 3);
      assert.strictEqual(diff.stablePrefixUnchanged, false, "all serialized outbound message fields must participate in the prefix hash");
    }

    const overlap = service.prepareOutboundRequest({
      provider: "zhipu", model: "glm-5.3-flash", requestType: "chat", request: buildRequest(buildMessages("overlap fixture")),
      blocks: [
        { id: "stable_overlap", messageStartPosition: 0, messageCount: 1, stable: true },
        { id: "dynamic_overlap", messageStartPosition: 0, messageCount: 1, stable: false },
        { id: "stable_after_overlap", messageStartPosition: 1, messageCount: 1, stable: true }
      ],
      conversationId: "conversation-overlap-fixture", responderId: "responder-fixture", baseUrl: zhipuConfig.baseUrl
    });
    assert.strictEqual(overlap.stablePrefixEndPosition, 0, "any overlapping dynamic block must make the message fail closed as unstable");

    const noStablePrefix = service.prepareOutboundRequest({
      provider: "zhipu", model: "glm-5.3-flash", requestType: "chat",
      request: buildRequest([{ role: "user", content: "volatile first message" }, { role: "system", content: "later stable message" }]),
      blocks: [
        { id: "dynamic_first", messageStartPosition: 0, messageCount: 1, stable: false },
        { id: "stable_later", messageStartPosition: 1, messageCount: 1, stable: true }
      ],
      conversationId: "conversation-empty-prefix", responderId: "responder-fixture", baseUrl: zhipuConfig.baseUrl
    });
    assert.strictEqual(noStablePrefix.stablePrefixEndPosition, 0, "later stable blocks cannot bridge a dynamic first message");
    assert.strictEqual(noStablePrefix.stablePrefixUnchanged, null, "an empty prefix is not reported as a reusable stable prefix");

    service.recordResponse({
      provider: "zhipu", model: "glm-5.3-flash", requestType: "chat",
      response: { usage_debug: {
        raw_usage: { prompt_tokens: 12000, completion_tokens: 20, total_tokens: 12020, prompt_tokens_details: { cached_tokens: 0 } },
        normalized_usage: { prompt_tokens: 12000, completion_tokens: 20, total_tokens: 12020, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 12000, cache_reporting_status: "reported" }
      } },
      usage: { prompt_tokens: 12000, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 12000, cache_reporting_status: "reported" },
      metadata: { realRequestDiff: second, blocks, messages: buildMessages("volatile turn B") }
    });
    const reportedZero = service.getRecent(1)[0];
    assert.strictEqual(reportedZero.rawUsage.prompt_tokens_details.cached_tokens, 0, "raw provider zero must be preserved");
    assert.strictEqual(reportedZero.normalizedUsage.prompt_cache_hit_tokens, 0, "normalized provider zero must remain zero");
    assert.strictEqual(reportedZero.providerUsage.cachedTokens, 0, "diagnostics must not infer a cache hit from the local prefix hash");
    assert.strictEqual(reportedZero.realRequestDiff.serializedPrefixSha256, second.serializedPrefixSha256);
    assert.strictEqual(reportedZero.realRequestDiff.stablePrefixUnchanged, true);

    const missing = prepare(buildMessages("volatile turn D"));
    service.recordResponse({
      provider: "zhipu", model: "glm-5.3-flash", requestType: "chat",
      response: { usage_debug: {
        raw_usage: { prompt_tokens: 12000, completion_tokens: 20, total_tokens: 12020 },
        normalized_usage: { prompt_tokens: 12000, completion_tokens: 20, total_tokens: 12020, prompt_cache_hit_tokens: null, prompt_cache_miss_tokens: null, cache_reporting_status: "not_reported" }
      } },
      usage: { prompt_tokens: 12000, cache_reporting_status: "not_reported" },
      metadata: { realRequestDiff: missing, blocks, messages: buildMessages("volatile turn D") }
    });
    const unreported = service.getRecent(1)[0];
    assert.strictEqual(unreported.rawUsage.prompt_tokens_details, undefined, "missing raw cache usage must remain absent");
    assert.strictEqual(unreported.normalizedUsage.prompt_cache_hit_tokens, undefined, "missing normalized cache usage must not become zero");
    assert.strictEqual(unreported.providerUsage.cachedTokens, null);
    const persisted = fs.readFileSync(path.join(tempDir, "provider-diagnostics.jsonl"), "utf8");
    assert.doesNotMatch(persisted, /stable system fixture|stable responder fixture|volatile turn|fixture-key/);
    assert.match(persisted, /serializedPrefixSha256/);
    assert.match(persisted, /stablePrefixUnchanged/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log("V8.14 INC05 outbound cache diagnostics: PASS (provider request parity, exact stable-prefix hash/boundary, raw usage preserved)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
