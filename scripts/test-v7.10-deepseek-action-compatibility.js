"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { DeepseekProvider } = require(path.join(root, "resources", "app", "out", "main", "providers"));
const provider = new DeepseekProvider();

const schema = {
  type: "object",
  properties: { actions: { type: "array", items: { type: "object" } } },
  required: ["actions"]
};
const actionRequest = {
  model: "deepseek-v4-flash",
  messages: [
    { role: "system", content: "Official action instructions" },
    { role: "system", content: "Available Actions:\n- noOp" },
    { role: "user", content: "Nothing happened." }
  ],
  stream: false,
  temperature: 0.6,
  max_tokens: 1800,
  response_format: { type: "json_schema", json_schema: { name: "votc_actions", schema, strict: true } }
};
const transformedAction = provider.transformRequestForDeepseek(actionRequest, { actionSchemaDeliveryMode: "official_full_injected" });
assert.deepStrictEqual(transformedAction.response_format, { type: "json_object" });
assert.deepStrictEqual(transformedAction.thinking, { type: "disabled" }, "only the DeepSeek action adapter may disable thinking");
assert.strictEqual(transformedAction.temperature, actionRequest.temperature);
assert.strictEqual(transformedAction.max_tokens, actionRequest.max_tokens);
const injectedActionList = transformedAction.messages.find((message) => message.content.startsWith("Available Actions:"));
assert(injectedActionList.content.includes("Schema name: votc_actions"));
assert(injectedActionList.content.includes("actions: array of objects"), "the action schema must be retained in the injected prompt");
assert(!actionRequest.messages[1].content.includes("Schema name:"), "the adapter must not mutate caller messages");

const optimizedAction = provider.transformRequestForDeepseek(actionRequest, { actionSchemaDeliveryMode: "optimized_local_validation" });
assert.deepStrictEqual(optimizedAction.response_format, { type: "json_object" });
assert.deepStrictEqual(optimizedAction.thinking, { type: "disabled" });
assert.deepStrictEqual(optimizedAction.messages, actionRequest.messages, "optimized transport must not append the Full Schema to DeepSeek messages");

const chatRequest = {
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: "普通对话" }],
  stream: true,
  thinking: { type: "enabled" },
  max_tokens: 4096
};
assert.deepStrictEqual(provider.transformRequestForDeepseek(chatRequest), chatRequest, "normal DeepSeek chat must remain unchanged");

const summaryRequest = {
  model: "deepseek-v4-flash",
  messages: [{ role: "system", content: "总结对话" }, { role: "user", content: "对话内容" }],
  stream: false,
  thinking: { type: "disabled" },
  max_tokens: 8192,
  response_format: { type: "json_object" }
};
assert.deepStrictEqual(provider.transformRequestForDeepseek(summaryRequest), summaryRequest, "normal structured summary must remain unchanged");

console.log("VOTC v7.10 DeepSeek Action Compatibility: PASS");
