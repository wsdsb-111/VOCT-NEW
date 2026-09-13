"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ProviderRegistry } = require(path.join(root, "resources", "app", "out", "main", "provider-service.js"));
const { ZhipuProvider, registerProviderImplementations } = require(path.join(root, "resources", "app", "out", "main", "providers"));
const { createUsageAnalytics } = require(path.join(root, "resources", "app", "out", "main", "analytics", "usage-analytics.js"));
const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");

assert(mainSource.includes('"zhipu"'), "the persisted provider list must include zhipu");
assert(mainSource.includes('glmReasoningEffort: "low"'), "GLM must default to low reasoning effort");
assert(mainSource.includes('glmClearThinking: true'), "GLM must default to clearing historical thinking");
assert(rendererSource.includes('children: "智谱 GLM"') || rendererSource.includes('"智谱 GLM"'), "the provider sidebar must expose 智谱 GLM");
assert(rendererSource.includes('id: "glmReasoningEffort"'), "the GLM reasoning selector must be rendered");
assert(rendererSource.includes('id: "glmClearThinking"'), "the GLM clear-thinking control must be rendered");
assert(rendererSource.includes('glmReasoningEffort: editingConfig.glmReasoningEffort'), "GLM reasoning settings must survive save and preset creation");

const config = {
  providerType: "zhipu",
  apiKey: "fixture-key",
  baseUrl: "",
  defaultModel: "glm-5.3-flash",
  glmReasoningEffort: "invalid",
  glmClearThinking: true
};

const provider = new ZhipuProvider();
assert.strictEqual(provider.getBaseUrl(config), "https://open.bigmodel.cn/api/paas/v4");
assert.strictEqual(provider.getReasoningEffort(config), "low", "missing or invalid GLM reasoning configuration must fail safe to low");
assert.deepStrictEqual(provider.buildRequestParams({
  model: "glm-5.3-flash",
  messages: [{ role: "user", content: "fixture" }],
  stream: true,
  temperature: 0.7,
  max_tokens: 4096,
  response_format: { type: "json_schema" }
}, config), {
  model: "glm-5.3-flash",
  messages: [{ role: "user", content: "fixture" }],
  stream: true,
  temperature: 0.7,
  max_tokens: 4096,
  top_p: undefined,
  presence_penalty: undefined,
  frequency_penalty: undefined,
  reasoning_effort: "low",
  thinking: { type: "enabled", clear_thinking: true },
  response_format: { type: "json_schema" },
  stream_options: { include_usage: true }
});

const rawUsage = {
  prompt_tokens: 100,
  completion_tokens: 40,
  total_tokens: 140,
  prompt_tokens_details: { cached_tokens: 75 },
  completion_tokens_details: { reasoning_tokens: 30 }
};
assert.deepStrictEqual(provider.normalizeUsage(rawUsage), {
  prompt_tokens: 100,
  completion_tokens: 40,
  total_tokens: 140,
  prompt_cache_hit_tokens: 75,
  prompt_cache_miss_tokens: 25,
  cache_reporting_status: "reported",
  prompt_tokens_details: { cached_tokens: 75 },
  completion_tokens_details: { reasoning_tokens: 30 },
  reasoning_tokens: 30,
  visible_completion_tokens: 10
});
assert.deepStrictEqual(provider.normalizeUsage({ prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 }), {
  prompt_tokens: 100,
  completion_tokens: 2,
  total_tokens: 102,
  prompt_cache_hit_tokens: null,
  prompt_cache_miss_tokens: null,
  cache_reporting_status: "not_reported",
  prompt_tokens_details: undefined,
  completion_tokens_details: undefined,
  reasoning_tokens: 0,
  visible_completion_tokens: 2
}, "a missing cached_tokens field must remain unknown rather than becoming zero");

const nonStreamProvider = new ZhipuProvider();
let nonStreamRequest;
nonStreamProvider.createOpenAIClient = () => ({
  chat: { completions: { create: async (request) => {
    nonStreamRequest = request;
    return { id: "glm-non-stream", choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: rawUsage };
  } } }
});
(async () => {
  const nonStreamResponse = await nonStreamProvider.chatCompletion({
    model: "glm-5.3-flash",
    messages: [{ role: "user", content: "fixture" }],
    stream: false,
    max_tokens: 4096
  }, { ...config, glmReasoningEffort: "high", glmClearThinking: false });
  assert.strictEqual(nonStreamRequest.reasoning_effort, "high");
  assert.deepStrictEqual(nonStreamRequest.thinking, { type: "enabled", clear_thinking: false });
  assert.strictEqual(nonStreamRequest.stream_options, undefined);
  assert.strictEqual(nonStreamResponse.usage.reasoning_tokens, 30);
  assert.deepStrictEqual(nonStreamResponse.usage_debug.raw_usage.prompt_tokens_details, { cached_tokens: 75 });
  assert.strictEqual(nonStreamResponse.usage_debug.normalized_usage.cache_reporting_status, "reported");

  const streamProvider = new ZhipuProvider();
  streamProvider.createOpenAIClient = () => ({
    chat: { completions: { create: async () => (async function* () {
      yield { id: "glm-stream", choices: [{ delta: { reasoning_content: "hidden" }, finish_reason: null }] };
      yield { id: "glm-stream", choices: [{ delta: { content: "visible" }, finish_reason: "stop" }] };
      yield { id: "glm-stream", choices: [], usage: rawUsage };
    })() } } }
  );
  const iterator = streamProvider.chatCompletion({
    model: "glm-5.3-flash",
    messages: [{ role: "user", content: "fixture" }],
    stream: true,
    max_tokens: 4096
  }, config)[Symbol.asyncIterator]();
  const chunks = [];
  let streamResponse;
  while (true) {
    const step = await iterator.next();
    if (step.done) {
      streamResponse = step.value;
      break;
    }
    chunks.push(step.value);
  }
  assert.strictEqual(chunks[0].delta.reasoning, "hidden", "reasoning remains a stream-only field");
  assert.strictEqual(streamResponse.content, "visible");
  assert.strictEqual(streamResponse.usage.prompt_cache_hit_tokens, 75, "usage-only tail chunks must be normalized");
  assert.strictEqual(streamResponse.usage.visible_completion_tokens, 10);
  assert.deepStrictEqual(streamResponse.usage_debug.raw_usage.prompt_tokens_details, { cached_tokens: 75 });

  const fallbackProvider = new ZhipuProvider();
  fallbackProvider.createOpenAIClient = () => ({ models: { list: async () => { throw new Error("fixture unavailable"); } } });
  assert.deepStrictEqual(await fallbackProvider.listModels(config), [{ id: "glm-5.3-flash", name: "GLM-5.3-Flash" }]);

  const registrations = new ProviderRegistry();
  registerProviderImplementations(registrations);
  assert.strictEqual(registrations.isRegistered("zhipu"), true, "智谱 GLM must use a dedicated provider registration");

  const events = [];
  const UsageAnalytics = createUsageAnalytics({
    fs: { existsSync: () => false, mkdirSync: () => {}, writeFileSync: () => {}, readFileSync: () => "" },
    dataDir: "fixture",
    analyticsFile: "fixture",
    retention: { retainUsageAnalyticsEntries: (entries) => entries },
    createPromptFingerprint: () => "fixture"
  });
  const analytics = new UsageAnalytics();
  analytics.write = (data) => events.push(data.entries.at(-1));
  analytics.record({ providerType: "zhipu", model: "glm-5.3-flash", requestType: "chat" }, provider.normalizeUsage(rawUsage));
  assert.strictEqual(events[0].reasoningTokens, 30);
  assert.strictEqual(events[0].visibleCompletionTokens, 10);
  assert.strictEqual(events[0].cacheHitTokens, 75);
  assert.strictEqual(events[0].cacheMissTokens, 25);
  analytics.record({ providerType: "zhipu", model: "glm-5.3-flash", requestType: "chat" }, provider.normalizeUsage({ prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 }));
  assert.strictEqual(events[1].cacheHitTokens, null, "missing cached_tokens must remain unknown in aggregate analytics");
  assert.strictEqual(events[1].cacheMissTokens, null, "missing cached_tokens must not become a cache miss count");

  console.log("V8.8.5 Zhipu provider: PASS (GLM request controls, stream usage, analytics, fallback and registration)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
