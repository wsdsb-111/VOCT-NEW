"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");

const mainDir = path.resolve(__dirname, "../src/app/main");
const MAIN_BODY = "SINGLE_UNMARKED_MAIN_BODY_FIXTURE";
const cases = [
  { id: "glm_cache_v2", layoutId: "glm_cache_v2" },
  { id: "v813-query-dynamic", layoutId: "v813" }
];

for (const testCase of cases) {
  for (const promptPlanMode of ["legacy", "shadow", "v9"]) {
    const fixture = createFixture(testCase.id);
    fixture.promptSettings.mainTemplate = MAIN_BODY;
    const runtime = createPromptRuntime(mainDir, fixture);
    const result = runtime.PromptBuilder.buildMessagesWithTokenCount(
      fixture.history,
      fixture.responder,
      fixture.gameData,
      fixture.currentSessionSummary,
      fixture.memoryContext,
      fixture.definition.providerConfig,
      { promptPlanMode }
    );

    assert.equal(result.promptProfile.layoutId, testCase.layoutId,
      `${testCase.id}/${promptPlanMode}: fixture must select the intended legacy layout`);
    assert.equal(result.promptPlanMode, promptPlanMode,
      `${testCase.id}/${promptPlanMode}: builder must retain the requested plan mode`);
    assert.equal(result.messages.filter(message => message.content === MAIN_BODY).length, 1,
      `${testCase.id}/${promptPlanMode}: deferred main body must appear exactly once in outbound messages`);
    assert.deepEqual(result.serialized.messages, result.messages,
      `${testCase.id}/${promptPlanMode}: serialized Plan messages must equal the actual prompt`);

    const emittedMain = result.promptPlan.blocks.filter(block => ["main", "main_segment"].includes(block.legacyType)
      && block.content === MAIN_BODY);
    assert.equal(emittedMain.length, 1,
      `${testCase.id}/${promptPlanMode}: the emitted body must have exactly one semantic Plan block`);
    assert.equal(emittedMain[0].legacyBlockId,
      testCase.layoutId === "glm_cache_v2" ? "main-system-main" : "main-system",
      `${testCase.id}/${promptPlanMode}: the semantic block must identify the actual main message`);
    assert.deepEqual(emittedMain[0].messages, [{ role: "system", content: MAIN_BODY }],
      `${testCase.id}/${promptPlanMode}: the Plan block must own the real body message`);
    assert.equal(result.promptPlan.blocks.some(block => block.legacyBlockId === "main-system"
      && block.legacyType === "main"), testCase.layoutId === "v813",
    `${testCase.id}/${promptPlanMode}: token-only main accounting must not serialize as a second legacy block`);
  }
}

console.log("PASS V9.4 source deferred-main span regression (GLM Cache v2 and V8.13, legacy/shadow/v9)");
