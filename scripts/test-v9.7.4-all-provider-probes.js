"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.resolve(__dirname, "../resources/app/out/main/providers/index.js");
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(fs.readFileSync(path.resolve(__dirname, "../src/app/main/providers/index.js"), "utf8"), filename);
const providers = compiled.exports;
(async () => {
  for (const [name, budget] of [["BaseProvider", 2048], ["OpenAICompatibleProvider", 2048], ["Player2Provider", 2048],
    ["GeminiProvider", 2048], ["ZhipuProvider", 2048], ["OpenRouterProvider", 128], ["DeepseekProvider", 128]]) {
    const provider = new providers[name]();
    const config = { apiKey: "fixture-key", defaultModel: "fixture-model", glmReasoningEffort: "high", defaultParameters: { max_tokens: 8192 } };
    const original = JSON.stringify(config);
    let sent;
    provider.chatCompletion = async (request, effectiveConfig) => {
      sent = request;
      assert.equal(request.stream, false, name);
      assert.equal(request.max_tokens, budget, name);
      assert.equal(request.messages[0].content, "Reply with exactly: OK", name);
      if (name === "ZhipuProvider") assert.equal(effectiveConfig.glmReasoningEffort, "low");
      return { id: "fixture", content: "OK", finish_reason: "stop" };
    };
    assert.equal((await provider.testConnection(config)).success, true, name);
    assert(sent);
    for (const response of [{ content: "O", finish_reason: "length" }, { content: "OK" },
      { content: "", finish_reason: "stop" }, { content: "   ", finish_reason: "stop" },
      { content: null, finish_reason: "stop" }]) {
      provider.chatCompletion = async () => response;
      assert.equal((await provider.testConnection(config)).success, false, `${name} rejects incomplete/empty response`);
    }
    assert.equal(JSON.stringify(config), original, `${name} cannot mutate user settings`);
  }
  const glm = new providers.ZhipuProvider();
  const normal = glm.buildRequestParams({ model: "fixture-model", max_tokens: 8192, stream: true, messages: [] },
    { glmReasoningEffort: "high", glmClearThinking: false });
  assert.equal(normal.reasoning_effort, "high");
  assert.deepEqual(normal.thinking, { type: "enabled", clear_thinking: false });
  assert.equal(normal.max_tokens, 8192);
  let glmPayload;
  glm._nonStreamZhipuChatCompletion = async request => {
    glmPayload = request;
    return { content: "OK", finish_reason: "stop" };
  };
  assert.equal((await glm.testConnection({ apiKey: "fixture-key", defaultModel: "fixture-model", glmReasoningEffort: "high" })).success, true);
  assert.equal(glmPayload.reasoning_effort, "low");
  assert.equal(glmPayload.max_tokens, 2048);
  assert.equal(glmPayload.thinking.type, "enabled");
  const gemini = new providers.GeminiProvider();
  gemini._nonStreamChatCompletion = async (_baseUrl, _apiKey, _model, request) => {
    assert.equal(gemini.buildRequestBody(request).generationConfig.maxOutputTokens, 2048);
    return { content: "OK", finish_reason: "stop" };
  };
  assert.equal((await gemini.testConnection({ apiKey: "fixture-key", defaultModel: "fixture-model" })).success, true);
  const ollama = new providers.OllamaProvider();
  let listCalls = 0;
  ollama.listModels = async () => { listCalls++; return [{ id: "fixture-model" }]; };
  ollama.chatCompletion = () => { throw Error("Ollama directory probe must not generate"); };
  const result = await ollama.testConnection({ providerType: "ollama", defaultModel: "fixture-model", baseUrl: "http://127.0.0.1:11434" });
  assert.equal(result.success, true);
  assert.match(result.message, /generation was not tested/);
  assert.equal(listCalls, 1);
  console.log("PASS all Provider probes: sufficient budgets, short response, strict completion, no config mutation, unchanged GLM chat and directory-only Ollama");
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
