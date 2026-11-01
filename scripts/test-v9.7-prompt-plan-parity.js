"use strict";

const assert = require("node:assert/strict");
const { resolvePlanMode } = require("../src/app/main/prompts/prompt-plan-layouts");
const { finalizePromptBuild } = require("../src/app/main/prompts/prompt-plan-compat");
const { SCOPE } = require("./fixtures/v9.4/prompt-plan-security-fixture");
const originalMode = process.env.VOTC_PROMPT_PLAN_MODE;
try {
  for (const mode of ["legacy", "shadow", "v9"]) {
    process.env.VOTC_PROMPT_PLAN_MODE = mode;
    assert.equal(resolvePlanMode(), mode);
    assert.equal(resolvePlanMode("shadow"), "shadow", "explicit option takes priority over environment");
  }
  process.env.VOTC_PROMPT_PLAN_MODE = "invalid";
  assert.throws(() => resolvePlanMode(), error => error.code === "PLAN_MODE_INVALID");
  assert.equal(resolvePlanMode("v9"), "v9");
  for (const type of ["custom", "description", "examples"]) {
    for (const mode of ["legacy", "shadow", "v9"]) {
      const messages = [{ role: "legacy-script-role", content: "\ufeffSYNTHETIC_CUSTOM\r\n保留原始字节" }];
      const build = { messages, blocks: [{ block: { id: `script-${type}`, type, role: "system" },
        content: messages[0].content, tokens: 8, messageSpan: { start: 0, end: 1 } }],
        promptProfile: { id: "synthetic", layoutId: "v813" } };
      const options = { mode, requestType: "chat", scope: { ...SCOPE }, revisionSnapshot: { source: "synthetic-r1" },
        providerConfig: { providerType: "synthetic", defaultModel: "synthetic" }, promptSettings: {} };
      const before = JSON.stringify(build);
      const result = finalizePromptBuild(build, options);
      assert.equal(result.promptPlanStatus, "LEGACY_OBSERVED");
      assert.deepEqual(result.messages, messages);
      assert.equal(JSON.stringify(build), before, "fallback does not rewrite input messages");
      const mixed = structuredClone(build);
      mixed.messages.push({ role: "invalid-history-role", content: "history" });
      mixed.blocks.push({ block: { id: "history", type: "history", role: "user" }, content: "history", tokens: 1,
        messageSpan: { start: 1, end: 2 } });
      assert.throws(() => finalizePromptBuild(mixed, options), error => error.code === "PLAN_BLOCK_ROLE_INVALID",
        "custom fallback cannot authorize an invalid history block");
    }
  }
} finally {
  if (originalMode === undefined) delete process.env.VOTC_PROMPT_PLAN_MODE;
  else process.env.VOTC_PROMPT_PLAN_MODE = originalMode;
}
console.log("PASS V9.7 Prompt compatibility: environment priority; three script block types x three modes; byte preservation and unsafe mixed-block rejection");
