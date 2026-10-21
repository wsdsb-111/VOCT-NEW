"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { CASES, createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");
const mainDir = path.resolve(__dirname, "../src/app/main");
const frozenKinds = new Set(["GLOBAL_STATIC", "CONVERSATION_FROZEN", "RESPONDER_FROZEN"]);
const multiset = messages => messages.map(message => JSON.stringify(message)).sort();
let cases = 0;

for (const definition of CASES) {
  for (const memory of ["normal", "absent", "long"]) {
    const build = mode => {
      const fixture = createFixture(definition.id);
      if (memory === "absent") fixture.memoryContext = null;
      if (memory === "long") fixture.memoryContext.directStableText += "\n" + "FICTIONAL LEGAL RECENT MEMORY \n".repeat(2000);
      const runtime = createPromptRuntime(mainDir, fixture);
      return runtime.PromptBuilder.buildMessagesWithTokenCount(fixture.history, fixture.responder, fixture.gameData,
        fixture.currentSessionSummary, fixture.memoryContext, definition.providerConfig, { promptPlanMode: mode });
    };
    const legacy = build("legacy");
    const current = build("v9");
    assert.deepEqual(multiset(current.messages), multiset(legacy.messages), `${definition.id}/${memory}: authorized role/content multiset changed`);
    assert.deepEqual(current.messages[0], legacy.messages[0], "cache anchor bytes and role remain unchanged");
    assert.equal(current.totalTokens, legacy.totalTokens, "reordering never reduces the legal narrative budget by dropping text");
    for (const entry of current.blocks) {
      assert(["GLOBAL_STATIC", "CONVERSATION_FROZEN", "RESPONDER_FROZEN", "DYNAMIC"].includes(entry.block.lifecycle), "public legacy lifecycle fields keep their existing enum");
      assert.equal(entry.block.semanticKind, current.promptPlan.blocks.find(block => block.id === entry.block.id).kind);
    }
    for (const [field, kind] of Object.entries({ globalStaticTokens: "GLOBAL_STATIC", conversationFrozenTokens: "CONVERSATION_FROZEN", responderFrozenTokens: "RESPONDER_FROZEN" })) {
      assert.equal(current[field], current.promptPlan.blocks.filter(block => block.kind === kind).reduce((sum, block) => sum + block.tokens.estimated, 0), `${field} follows the actual Plan lifecycle`);
    }
    let leftFrozenPrefix = false;
    for (const block of current.promptPlan.blocks) {
      if (!frozenKinds.has(block.kind)) leftFrozenPrefix = true;
      else assert.equal(leftFrozenPrefix, false, "static/frozen blocks must never follow history or dynamic blocks");
    }
    const legacyParts = legacy.messages.map(message => [message.role, message.content]);
    assert.equal(legacyParts.length, current.serialized.messages.length);
    assert.equal(current.promptPlan.layoutRevision, "v9_4_static_first_1");
    assert.equal(legacy.promptPlan.layoutRevision, "v9_4_compat_1");
    assert.equal(current.promptProfile.layoutId, legacy.promptProfile.layoutId);
    assert.equal(current.promptProfile.id, legacy.promptProfile.id);
    cases++;
  }
}

console.log(`PASS V9.4 static/frozen-first order (${cases} layout/profile x memory cases; unchanged authorized messages, anchors and input tokens)`);
