"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { DeepseekProvider } = require(path.join(__dirname, "..", "resources", "app", "out", "main", "providers"));
const { TokenCounter } = require(path.join(__dirname, "..", "resources", "app", "out", "main", "provider-service"));
const rendererSource = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");

const provider = new DeepseekProvider();
const schema = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        anyOf: [
          { type: "object", properties: { actionId: { const: "playerPaysGoldTo" }, targetId: { type: "number" }, amount: { type: "number" } }, required: ["actionId", "targetId", "amount"] },
          { type: "object", properties: { actionId: { const: "isImprisonedBy" }, targetId: { type: "number" } }, required: ["actionId", "targetId"] }
        ]
      }
    }
  },
  required: ["actions"]
};

const categories = ["payment", "imprisonment", "undress", "location", "emotion", "injury", "no_action", "relationship"];
let baselineTokens = 0;
let optimizedTokens = 0;
for (let index = 0; index < 30; index++) {
  const category = categories[index % categories.length];
  const messages = [
    { role: "system", content: "You are an action selection engine in a roleplay AI system." },
    { role: "system", content: `Recent messages:\nplayer: ${category} case ${index}` },
    { role: "system", content: "Recent actions (last 5):\nnone" },
    { role: "system", content: "Characters in this conversation (order matches CK3 global list):\n0: Player (id=1)\n1: NPC (id=2)" },
    { role: "system", content: "Available Actions:\nplayerPaysGoldTo(targetId, amount)\nisImprisonedBy(targetId)" },
    { role: "system", content: 'Examples of correct JSON output:\n{"actions":[]}' },
    { role: "user", content: "Given everything above, select the actions (if any) that should be executed right now." }
  ];
  const request = {
    model: "deepseek-v4-flash",
    messages,
    stream: false,
    response_format: { type: "json_schema", json_schema: { name: "votc_actions", schema, strict: true } }
  };
  const baseline = provider.transformRequestForDeepseek(request, { actionSchemaDeliveryMode: "official_full_injected", deepseekActionStablePrefixOptimization: false });
  const optimized = provider.transformRequestForDeepseek(request, { actionSchemaDeliveryMode: "optimized_local_validation", deepseekActionStablePrefixOptimization: false });
  assert.deepStrictEqual(baseline.response_format, { type: "json_object" });
  assert.deepStrictEqual(optimized.response_format, { type: "json_object" });
  assert.deepStrictEqual(baseline.thinking, { type: "disabled" });
  assert.deepStrictEqual(optimized.thinking, { type: "disabled" });
  assert(baseline.messages.some((message) => message.content.includes("Schema name: votc_actions")), `baseline ${category} must inject Full Schema`);
  assert.deepStrictEqual(optimized.messages, messages, `optimized ${category} must preserve official messages without duplicate schema`);
  assert.deepStrictEqual(request.response_format.json_schema.schema, schema, "official Full Schema object must remain available to ActionEngine/local validation");
  baselineTokens += TokenCounter.calculateTotalTokens(baseline.messages);
  optimizedTokens += TokenCounter.calculateTotalTokens(optimized.messages);
}
assert(optimizedTokens < baselineTokens, "optimized transport must reduce raw serialized prompt tokens");

const stableInput = [
  { role: "system", content: "You are an action selection engine in a roleplay AI system." },
  { role: "system", content: "Recent messages:\nvolatile" },
  { role: "system", content: "Recent actions (last 5):\nvolatile" },
  { role: "system", content: "Characters in this conversation (order matches CK3 global list):\nroster" },
  { role: "system", content: "Available Actions:\nstable" },
  { role: "system", content: "Examples of correct JSON output:\nstable" },
  { role: "user", content: "Given everything above, select the actions (if any) that should be executed right now." }
];
const stableRequest = { model: "deepseek-v4-flash", messages: stableInput, response_format: { type: "json_schema", json_schema: { name: "votc_actions", schema } } };
const stable = provider.transformRequestForDeepseek(stableRequest, { actionSchemaDeliveryMode: "optimized_local_validation", deepseekActionStablePrefixOptimization: true });
assert.deepStrictEqual(stable.messages.map((message) => message.content.split("\n")[0]), [
  "You are an action selection engine in a roleplay AI system.",
  "Available Actions:",
  "Examples of correct JSON output:",
  "Characters in this conversation (order matches CK3 global list):",
  "Recent actions (last 5):",
  "Recent messages:",
  "Given everything above, select the actions (if any) that should be executed right now."
]);
assert.deepStrictEqual(stableInput, stableRequest.messages, "stable-prefix transport must reorder a copy, not mutate official messages");
assert(rendererSource.includes("区块自身估算 Token"), "analytics UI must label block-self tokens");
assert(rendererSource.includes("后续连带未命中 Token"), "analytics UI must label downstream miss tokens separately");
assert(rendererSource.includes("不是服务商缓存断点遥测"), "analytics UI must disclose ordered-prefix estimation");

console.log(`VOTC v7.10-RC3 Action Transport: PASS (30-case schema dedup; estimated ${baselineTokens} -> ${optimizedTokens}; stable-prefix flag default-safe)`);
