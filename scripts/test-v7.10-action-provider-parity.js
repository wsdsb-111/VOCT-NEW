"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const providerServicePath = path.join(root, "resources", "app", "out", "main", "provider-service.js");
const { LLMManager, TokenCounter } = require(providerServicePath);

const defaultParameters = {
  temperature: 0.73,
  max_tokens: 2048,
  top_p: 0.82,
  presence_penalty: 0.15
};
const config = {
  providerType: "openai-compatible",
  customName: "Action Provider",
  defaultModel: "action-model",
  defaultParameters
};
let capturedRequest = null;
const provider = {
  async chatCompletion(request) {
    capturedRequest = request;
    return { content: '{"actions":[]}', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  }
};
const manager = new LLMManager({
  settingsRepository: { getActionsProviderConfig: () => config },
  providerRegistry: { createProvider: () => provider },
  usageAnalytics: { record() {} },
  TokenCounter,
  PromptBuilder: {}
});

(async () => {
  const messages = [{ role: "user", content: "Select completed actions." }];
  const schema = {
    type: "object",
    properties: { actions: { type: "array", items: { type: "object" } } },
    required: ["actions"],
    additionalProperties: false
  };
  const controller = new AbortController();
  await manager.sendActionsRequest(messages, "votc_actions", schema, controller.signal);

  assert(capturedRequest, "action provider must receive one request");
  assert.strictEqual(capturedRequest.model, config.defaultModel);
  assert.strictEqual(capturedRequest.messages, messages);
  assert.strictEqual(capturedRequest.stream, false);
  assert.strictEqual(capturedRequest.signal, controller.signal);
  for (const [key, value] of Object.entries(defaultParameters)) assert.strictEqual(capturedRequest[key], value, `${key} must preserve the selected provider default`);
  assert.strictEqual(capturedRequest.thinking, undefined, "LLMManager must not impose provider-specific thinking parameters");
  assert.deepStrictEqual(capturedRequest.response_format, {
    type: "json_schema",
    json_schema: { name: "votc_actions", schema, strict: true }
  });

  const source = fs.readFileSync(providerServicePath, "utf8");
  const actionMethod = source.slice(source.indexOf("async sendActionsRequest"), source.indexOf("async sendSummaryRequest"));
  assert(!actionMethod.includes("temperature: 0.1"));
  assert(!actionMethod.includes("max_tokens: 512"));
  assert(!actionMethod.includes('thinking: { type: "disabled" }'));
  console.log("VOTC v7.10 Action Provider Request Parity: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
