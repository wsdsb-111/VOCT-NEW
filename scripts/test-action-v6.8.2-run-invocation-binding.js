"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.__V67ActionSystem = actionSystem;
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const engineStart = source.indexOf("class ActionEngine {");
const engineEnd = source.indexOf("\nclass Conversation {", engineStart);
assert(engineStart >= 0 && engineEnd > engineStart, "Cannot extract ActionEngine");

const player = { id: 1, fullName: "玩家", shortName: "玩家" };
const zhangSan = { id: 2, fullName: "张三", shortName: "张三" };
const gameData = { characters: new Map([[player.id, player], [zhangSan.id, zhangSan]]) };
const loadedAction = {
  id: "characterIsKilled",
  validation: { valid: true },
  filePath: "v6.8.2-runtime-test",
  definition: { signature: "characterIsKilled" }
};
globalThis.actionRegistry = { getById: (id) => id === loadedAction.id ? loadedAction : null };
globalThis.settingsRepository = { getLanguage: () => "zh" };
globalThis.resolveI18nString = (value) => typeof value === "object" ? value.zh || value.en : value;
const effectScopes = [];
const executionContexts = [];
globalThis.ActionEffectWriter = {
  writeEffect: (_data, sourceId, targetId, effectBody) => effectScopes.push({ sourceId, targetId, effectBody })
};
globalThis.ActionSandbox = {
  executeAction: async (_filePath, context) => {
    executionContexts.push({
      sourceId: context.sourceCharacter.id,
      targetId: context.targetCharacter?.id ?? null,
      args: context.args,
      dryRun: context.dryRun
    });
    context.runGameEffect("death_effect");
    return { message: "ok", sentiment: "neutral" };
  }
};

eval(`${source.slice(engineStart, engineEnd)}\nglobalThis.__V682ActionEngine = ActionEngine;`);
const ActionEngine = globalThis.__V682ActionEngine;
const invocation = Object.freeze({
  actionId: "characterIsKilled",
  args: { reason: "execution" },
  sourceCharacterId: zhangSan.id,
  targetCharacterId: player.id,
  bindingId: "bind_death_1"
});

function createConversation() {
  const inactive = [];
  return {
    gameData,
    inactive,
    markParticipantInactive: (id, reason) => inactive.push({ id, reason })
  };
}

(async () => {
  const previewConversation = createConversation();
  const preview = await ActionEngine.runInvocation(previewConversation, player, invocation, { dryRun: true });
  assert.strictEqual(preview.sourceCharacterId, zhangSan.id, "preview must use invocation source instead of the wrong caller");
  assert.strictEqual(preview.targetCharacterId, player.id, "preview must preserve invocation target");
  assert.strictEqual(preview.bindingId, invocation.bindingId, "preview must preserve binding identity");
  assert.deepStrictEqual(previewConversation.inactive, [], "preview must not update conversation lifecycle");
  assert.strictEqual(effectScopes.length, 0, "preview must not write a CK3 effect");

  const autoConversation = createConversation();
  const auto = await ActionEngine.runInvocation(autoConversation, zhangSan, invocation);
  const autoScope = effectScopes.at(-1);
  const manualConversation = createConversation();
  const manual = await ActionEngine.runInvocation(manualConversation, player, invocation);
  const manualScope = effectScopes.at(-1);

  assert.deepStrictEqual(manualScope, autoScope, "manual and auto execution must write the same source, target and effect");
  assert.strictEqual(auto.sourceCharacterId, manual.sourceCharacterId, "manual and auto source IDs must match");
  assert.strictEqual(auto.targetCharacterId, manual.targetCharacterId, "manual and auto target IDs must match");
  assert.strictEqual(auto.bindingId, manual.bindingId, "manual and auto binding IDs must match");
  assert.deepStrictEqual(manualConversation.inactive, [{ id: zhangSan.id, reason: "dead" }], "death lifecycle must inactivate the resolved source");
  assert(!manualConversation.inactive.some((entry) => entry.id === player.id), "wrong caller must remain active");
  assert.deepStrictEqual(executionContexts.map(({ sourceId, targetId }) => ({ sourceId, targetId })), [
    { sourceId: zhangSan.id, targetId: player.id },
    { sourceId: zhangSan.id, targetId: player.id },
    { sourceId: zhangSan.id, targetId: player.id }
  ], "preview, auto and manual paths must share one participant binding");

  const missingSource = await ActionEngine.runInvocation(createConversation(), player, { ...invocation, sourceCharacterId: 999 });
  assert.strictEqual(missingSource.success, false, "missing bound source must fail locally");
  assert.strictEqual(missingSource.error, "Resolved source character unavailable");

  const binding = actionSystem.createParticipantBinding({
    actionId: "characterIsKilled",
    sourceCharacterId: zhangSan.id,
    targetCharacterId: player.id
  });
  const available = actionSystem.availabilityService.buildAvailableAction({
    action: loadedAction,
    args: [],
    checkResult: { requiresTarget: true, validTargetCharacterIds: [player.id] },
    sourceCharacter: zhangSan,
    targetCharacter: player,
    description: "death",
    binding
  });
  assert.strictEqual(available.sourceLocked, true, "resolved available action must lock its source");
  const mismatch = actionSystem.invocationValidator.validateInvocation({
    modelInvocation: { actionId: "characterIsKilled", args: {} },
    availableAction: { signature: "characterIsKilled", sourceCharacterId: player.id, sourceLocked: true, targetLocked: true },
    binding,
    registry: globalThis.actionRegistry,
    gameData
  });
  assert.strictEqual(mismatch.reason, "binding_source_mismatch", "locked source mismatch must fail local validation");
  const missingBindingSource = actionSystem.createParticipantBinding({
    actionId: "characterIsKilled",
    sourceCharacterId: 999,
    targetCharacterId: player.id
  });
  const missingSourceValidation = actionSystem.invocationValidator.validateInvocation({
    modelInvocation: { actionId: "characterIsKilled", args: {} },
    availableAction: { signature: "characterIsKilled", sourceCharacterId: 999, sourceLocked: true, targetLocked: true },
    binding: missingBindingSource,
    registry: globalThis.actionRegistry,
    gameData
  });
  assert.strictEqual(missingSourceValidation.reason, "source_not_in_game_data", "missing bound source must fail validation before execution");

  console.log("VOTC v6.8.2 run invocation binding: PASS (preview, auto, manual and lifecycle parity)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
