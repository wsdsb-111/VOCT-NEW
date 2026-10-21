"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { Conversation } = require("../src/app/main/conversation/conversation.js");
const { BASELINE_COMMIT, CASES, capturePromptOutput } = require("./fixtures/v9.4/legacy-layout-fixtures.js");
const golden = require("./fixtures/v9.4/legacy-layout-golden.json");

const mainDir = path.resolve(__dirname, "../src/app/main");
assert.equal(golden.schemaVersion, "v9.4_legacy_prompt_golden_v1");
assert.equal(golden.baselineCommit, BASELINE_COMMIT, "the checked-in legacy snapshot must stay pinned to the approved source SHA");
assert.deepEqual(golden.cases.map(({ id }) => id), CASES.map(({ id }) => id), "fixture cases and frozen Golden entries must stay in sync");

const outputs = new Map(golden.cases.map(({ id, output }) => [id, output]));
for (const { id } of CASES) {
  const expected = outputs.get(id);
  const actual = capturePromptOutput({ mainDir, caseId: id, Conversation });
  assert.deepEqual(actual, expected, `${id}: current compatibility entry differs from the frozen PromptBuilder output`);
  const shadow = capturePromptOutput({ mainDir, caseId: id, Conversation, promptPlanMode: "shadow" });
  assert.deepEqual(shadow, actual, `${id}: shadow Plan serialization must preserve the legacy outbound layout and metadata`);

  assert.equal(actual.anchor.role, "system", `${id}: cache anchor must remain the first system message`);
  assert.equal(actual.anchor.utf8Base64, Buffer.from(actual.messages[0].content, "utf8").toString("base64"), `${id}: anchor bytes changed`);
  assert.equal(actual.anchor.sha256, crypto.createHash("sha256").update(actual.messages[0].content, "utf8").digest("hex"));

  const mapped = actual.diagnosticBlocks.filter((block) => block.messageStartPosition !== null);
  assert.equal(mapped.length, actual.blockOrder.length, `${id}: each emitted legacy block must map to a message range`);
  assert.equal(mapped.reduce((sum, block) => sum + block.messageCount, 0), actual.messages.length,
    `${id}: legacy block ranges must cover all physical messages`);
  assert.equal(actual.requestBudget.estimatedInputTokens, Math.ceil(actual.tokenCounts.totalTokens * 1.1),
    `${id}: request budget must use the actual built message array`);
}

const byId = (id) => outputs.get(id);
assert.equal(byId("v5").promptProfile.layoutId, "v5");
assert.equal(byId("v6").promptProfile.layoutId, "v6");
assert.equal(byId("v7").promptProfile.layoutId, "v7");
assert.equal(byId("v813-query-dynamic").promptProfile.layoutId, "v813");
assert.equal(byId("glm_cache_v2").promptProfile.id, "glm_cache_v2");
assert.equal(byId("glm_cache_v2").promptProfile.layoutId, "glm_cache_v2");
assert.equal(byId("deepseek_v89-v6").promptProfile.id, "deepseek_v89");
assert.equal(byId("deepseek_v89-v6").promptProfile.layoutId, "v6", "DeepSeek profile and semantic layout remain separate IDs");

const queryBeforeFreeze = byId("v813-query-dynamic");
const frozenAfterSuccess = byId("v813-success-frozen");
const frozenBlock = frozenAfterSuccess.blockOrder.find((block) => block.id === "memory-dynamic-frozen");
const historyIndex = frozenAfterSuccess.blockOrder.findIndex((block) => block.id === "history-current-user");
assert(frozenBlock, "a confirmed dynamic-summary snapshot must use its existing frozen block");
assert.equal(frozenBlock.lifecycle, "RESPONDER_FROZEN", "confirmed dynamic summaries keep their frozen lifecycle");
assert(frozenAfterSuccess.blockOrder.findIndex((block) => block.id === "memory-dynamic-frozen") < historyIndex,
  "successfully frozen time and third-party recall precedes mutable current history");
for (const marker of ["TIME_RECALL_FIXTURE", "THIRD_PARTY_RECALL_FIXTURE"]) {
  const occurrences = (text) => text.split(marker).length - 1;
  assert.equal(queryBeforeFreeze.messages.reduce((sum, message) => sum + occurrences(message.content), 0), 1,
    `${marker}: query-driven source is emitted once before successful freezing`);
  assert.equal(frozenAfterSuccess.messages.reduce((sum, message) => sum + occurrences(message.content), 0), 1,
    `${marker}: successful frozen reuse emits one copy and no duplicate query patch`);
}
assert(queryBeforeFreeze.blockOrder.some((block) => block.id === "memory-turn-recall" && block.lifecycle === "DYNAMIC"));
assert(queryBeforeFreeze.blockOrder.some((block) => block.id === "third-party-evidence-patch" && block.lifecycle === "DYNAMIC"));

console.log(`PASS V9.4 legacy PromptBuilder Goldens (${CASES.length} layouts/profiles, full messages, anchors, spans and request budgets; baseline ${BASELINE_COMMIT})`);
