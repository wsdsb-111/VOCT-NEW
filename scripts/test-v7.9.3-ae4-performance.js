"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ActionEngineV4 } = require(path.join(root, "resources/app/out/main/action-system/action-engine"));
const hintDetector = require(path.join(root, "resources/app/out/main/action-system/v4/performance/fallback-hint-detector"));
const executionFormGuard = require(path.join(root, "resources/app/out/main/action-system/v4/performance/execution-form-guard"));

const player = { id: 1, shortName: "Player", fullName: "Player", gold: 500, relationsToCharacters: [] };
const npc = { id: 2, shortName: "NPC", fullName: "NPC", gold: 100, relationsToCharacters: [] };
const gameData = { playerID: 1, playerName: "Player", characters: new Map([[1, player], [2, npc]]) };
const effects = [];

function action(id, { args = [], targets = [2], metadata = {} } = {}) {
  return {
    id,
    filePath: id,
    validation: { valid: true },
    definition: {
      signature: id,
      title: id,
      args,
      description: id,
      actionMetadata: metadata,
      check: () => ({ canExecute: true, validTargetCharacterIds: targets }),
      run: ({ runGameEffect, args: values }) => { runGameEffect(`${id}:${JSON.stringify(values)}`); return id; }
    }
  };
}

const loaded = new Map([
  action("playerPaysGoldTo", { args: [{ name: "amount", type: "number", description: "amount", required: true, min: 1, max: 500, step: 1 }], metadata: { availabilityRequirements: { source: "player" } } }),
  action("changeLocation", { targets: [], args: [{ name: "location", type: "enum", description: "location", required: true, options: ["throne_room"] }], metadata: { targetPolicy: "none" } }),
  action("isImprisonedBy"),
  action("becomeLoversWith", { metadata: { executionMode: "consent_required", relationshipTransition: true } })
].map((item) => [item.id, item]));
const registry = {
  getAllActions: () => [...loaded.values()],
  getById: (id) => loaded.get(id),
  isActionDisabled: () => false,
  registerValidation: () => {},
  shouldRequireApproval: () => false,
  getEffectiveDestructive: () => false,
  getEffectiveRiskLevel: () => "low"
};
const providerCalls = [];
const outputs = [];
const llmManager = {
  sendActionsRequest: async (messages, schemaName, schema, signal, metadata) => {
    providerCalls.push({ messages, schemaName, schema, signal, metadata });
    return { content: JSON.stringify(outputs.shift() || { decisions: [] }) };
  }
};
ActionEngineV4.configure({
  actionRegistry: registry,
  settingsRepository: {
    getActionSystemMode: () => "performance",
    getLanguage: () => "en",
    getActionApprovalSettings: () => ({ approvalMode: "none", pauseOnApproval: false }),
    getActionsProviderConfig: () => ({ providerType: "fixture", defaultModel: "fixture" })
  },
  usageAnalytics: { record: () => {} },
  llmManager,
  ActionSandbox: { executeAction: (filePath, context) => loaded.get(filePath).definition.run(context) },
  ActionEffectWriter: { writeEffect: (_gameData, sourceId, targetId, body) => effects.push({ sourceId, targetId, body }) },
  resolveI18nString: (value) => typeof value === "string" ? value : value.en
});

const conversation = { gameData, messages: [], inactiveParticipantIds: new Map(), getActiveConversationCharacters: () => [player, npc] };
async function evaluate(message) {
  conversation.messages.push(message);
  return ActionEngineV4.evaluateForCharacter(conversation, message.role === "user" ? player : npc, null, message);
}

(async () => {
  let result = await evaluate({ id: 1, role: "user", name: "Player", content: "我把50金币交给NPC。" });
  assert.strictEqual(result.autoApproved.length, 1, "deterministic payment must HIT locally");
  assert.strictEqual(result.autoApproved[0].actionId, "playerPaysGoldTo");
  assert.strictEqual(providerCalls.length, 0);

  result = await evaluate({ id: 2, role: "user", name: "Player", content: "我们进入了王座厅。" });
  assert.strictEqual(result.autoApproved[0].actionId, "changeLocation");
  assert.strictEqual(providerCalls.length, 0);

  result = await evaluate({ id: 3, role: "user", name: "Player", content: "如果我把50金币交给NPC，会怎样？" });
  assert.strictEqual(result.autoApproved.length, 0, "basic conditional guard must block local execution");
  assert.strictEqual(providerCalls.length, 0, "guarded conditional must not call compact selector");

  result = await evaluate({ id: 4, role: "user", name: "Player", content: "今天天气不错。" });
  assert.strictEqual(result.autoApproved.length, 0);
  assert.strictEqual(providerCalls.length, 0, "no hint must end locally");

  outputs.push({ decisions: [{ type: "action_call", actionId: "isImprisonedBy", sourceCharacterId: 1, targetCharacterId: 2, arguments: {}, evidenceMessageIds: [5], confidence: 0.1 }] });
  result = await evaluate({ id: 5, role: "user", name: "Player", content: "卫兵执行了我的命令，将NPC押入地牢。" });
  assert.strictEqual(providerCalls.length, 1, "MAYBE must call compact selector at most once");
  assert.strictEqual(result.autoApproved[0].actionId, "isImprisonedBy");

  outputs.push({ decisions: [{ type: "action_call", actionId: "becomeLoversWith", sourceCharacterId: 1, targetCharacterId: 2, arguments: {}, evidenceMessageIds: [6], confidence: 0.2 }] });
  result = await evaluate({ id: 6, role: "user", name: "Player", content: "NPC，我请求与你正式成为恋人。" });
  assert.strictEqual(providerCalls.length, 2);
  assert.strictEqual(result.autoApproved.length, 0, "compact selector must not bypass consent");
  assert.strictEqual(result.pendingConsent.length, 1);

  assert.strictEqual(executionFormGuard.evaluate("如果我给NPC 50金币会怎样？").status, "BLOCK");
  assert.strictEqual(executionFormGuard.evaluate("昨天我给过NPC 50金币。").status, "BLOCK");
  assert.strictEqual(executionFormGuard.evaluate("不要把NPC关起来。").status, "BLOCK");
  for (const [id, text] of [
    [7, "昨天我还不愿意，今天我把50金币交给了NPC。"],
    [8, "别再说了，把NPC关进地牢。"],
    [9, "如果你不服，现在就把NPC押入牢房。"]
  ]) {
    assert.strictEqual(executionFormGuard.evaluate(text).status, "MAYBE", `${text} must remain eligible for Compact Selector`);
    await evaluate({ id, role: "user", name: "Player", content: text });
  }
  assert.strictEqual(providerCalls.length, 5, "three mixed-clause messages must each make exactly one Compact Selector call");

  for (const text of ["他被刺伤了。", "他被杀死了。", "任命他为内阁成员。", "我们达成停战。", "她脱下了长袍。"]) {
    assert.strictEqual(hintDetector.evaluate({ message: { content: text }, activePending: [] }).possibleAction, true, `${text} must not be a fallback false negative`);
  }
  assert.strictEqual(providerCalls.filter((call) => call.metadata.actionStage === "performance_compact").length, 5);
  console.log("PASS v7.9.3 AE4 Phase 5 Performance pipeline");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
