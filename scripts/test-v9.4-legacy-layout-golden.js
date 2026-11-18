"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { Conversation } = require("../src/app/main/conversation/conversation.js");
const { BASELINE_COMMIT, CASES, capturePromptOutput } = require("./fixtures/v9.4/legacy-layout-fixtures.js");
const golden = require("./fixtures/v9.4/legacy-layout-golden.json");
const { applyIdentityDelta } = require("./fixtures/v9.4/legacy-layout-v96-identity-delta.js");

const mainDir = path.resolve(__dirname, "../src/app/main");
assert.equal(golden.schemaVersion, "v9.4_legacy_prompt_golden_v1");
assert.equal(golden.baselineCommit, BASELINE_COMMIT, "the checked-in legacy snapshot must stay pinned to the approved source SHA");
assert.deepEqual(golden.cases.map(({ id }) => id), CASES.map(({ id }) => id), "fixture cases and frozen Golden entries must stay in sync");

// Keep the frozen baseline and earlier identity delta intact. The later trait/concealment
// rule deliberately extends only this responder block, also in compatibility mode.
const concealment = `

=== 自身性格与身份的扮演边界 ===
你自己的完整特质应影响思考、动机、措辞与行事风格，即使尚未披露也保持这些内在影响。自身资料不等于听众知情。对不知真身者，所有超自然身份都应伪装，以符合表面身份的言行表达内在动机；避免无意直呼、暗示或在可听见的台词中暴露真身。只感到非凡气息的听众仍不知具体种族，可描写已获准的感知大类，不可用种族专属线索揭底。识别种族不表示知道氏族、血脉、亚种或职分；这些细分特质仍按各自披露规则。除非主动明确披露，不把内心知识当作公开信息。已知真身的听众不必假装不知；多人交谈仍须顾及不知情者。普通性格、巫师、私生子等保持各自原有知情规则。
- 听众 Runtime ID 41002：已获知你的身份=无确认项目；未获知你的身份=无列明项目。`;
const outputs = new Map(golden.cases.map(({ id, output }) => {
  const expected = applyIdentityDelta(id, output);
  const block = expected.diagnosticBlocks.find((item) => item.id === "responder-game-facts");
  assert.equal(block?.messageCount, 1);
  assert.equal(block.tokens, 648);
  const message = expected.messages[block.messageStartPosition];
  assert.equal(message.role, "system");
  message.content += concealment;
  block.tokens += 236;
  for (const key of ["totalTokens", "dynamicTokens", "dynamicTailTokens"]) expected.tokenCounts[key] += 236;
  const budget = expected.requestBudget;
  budget.estimatedInputTokens = Math.ceil(expected.tokenCounts.totalTokens * 1.1);
  budget.pressureRatio = budget.estimatedInputTokens / budget.effectiveInputBudget;
  return [id, expected];
}));
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

console.log(`PASS V9.4 legacy PromptBuilder Goldens with explicit identity and concealment deltas (${CASES.length} layouts/profiles, full messages, anchors, spans and request budgets; baseline ${BASELINE_COMMIT})`);
