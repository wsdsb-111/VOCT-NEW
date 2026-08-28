"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.__V67ActionSystem = actionSystem;

const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();
const playerDefinition = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_playerPaysGoldTo.js"));
const npcDefinition = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_paysGoldTo.js"));
const actions = [
  { id: playerDefinition.signature, definition: playerDefinition, validation: { valid: true }, filePath: "z_playerPaysGoldTo.js" },
  { id: npcDefinition.signature, definition: npcDefinition, validation: { valid: true }, filePath: "z_paysGoldTo.js" }
];

const analytics = [];
let providerCalls = 0;
let effects = [];

globalThis.actionRegistry = {
  getAllActions: () => actions,
  getActionIdsForCategories: (categories) => new Set(categories.includes("gold") ? actions.map((action) => action.id) : []),
  getById: (id) => actions.find((action) => action.id === id) || null,
  isActionDisabled: () => false,
  registerValidation() {},
  getEffectiveDestructive: () => false,
  getEffectiveRiskLevel: () => "medium",
  hasDestructiveOverride: () => false,
  shouldRequireApproval: () => false
};
globalThis.settingsRepository = {
  getLanguage: () => "zh",
  getActionSystemMode: () => "performance",
  getActionApprovalSettings: () => ({ approvalMode: "never" }),
  getActionsProviderConfig: () => ({ useMinimizedActionsSchema: true })
};
globalThis.usageAnalytics = { record: (entry) => analytics.push(entry) };
globalThis.llmManager = {
  sendActionsRequest: async () => {
    providerCalls++;
    return { content: '{"actions":[]}' };
  }
};
globalThis.ActionPromptBuilder = actionSystem.ActionPromptBuilder.configure({
  TokenCounter: { estimateMessageTokens: () => 1, estimateTokens: () => 1 },
  createPromptFingerprint: (value) => String(value).length.toString(16)
});
globalThis.buildStructuredResponseJsonSchema = actionSystem.actionSchema.buildStructuredResponseJsonSchema;
globalThis.buildStructuredResponseSchema = actionSystem.actionSchema.buildStructuredResponseSchema;
globalThis.healJsonResponseWithLogging = (content) => JSON.parse(content);
globalThis.resolveI18nString = (value) => typeof value === "string" ? value : value?.zh || value?.en || "";
globalThis.ActionSandbox = {
  executeAction: async (filePath, context) => (filePath.includes("playerPaysGoldTo") ? playerDefinition : npcDefinition).run(context)
};
globalThis.ActionEffectWriter = {
  writeEffect: (_gameData, sourceId, targetId, body) => effects.push({ sourceId, targetId, body })
};

function createCharacters(count = 2) {
  const characters = new Map([
    [1, { id: 1, shortName: "李思昭", fullName: "李思昭", gold: 1e3 }],
    [2, { id: 2, shortName: "李思念", fullName: "李思念", gold: 1e3 }]
  ]);
  for (let id = 3; id <= count; id++) characters.set(id, { id, shortName: `旁观者${id}`, fullName: `旁观者${id}`, gold: 1e3 });
  return characters;
}

function createConversation(id, count = 2) {
  const characters = createCharacters(count);
  return {
    id,
    turnEpoch: 1,
    gameData: { playerID: 1, playerName: "李思昭", characters },
    messages: [],
    actionGateProcessedTriggers: new Set(),
    processedActionEventIds: new Set(),
    inactiveParticipantIds: new Set(),
    getHistory() { return this.messages; },
    getActiveConversationCharacters() { return [...characters.values()]; }
  };
}

async function evaluate({ id, text, speakerId = 1, count = 2 }) {
  const conv = createConversation(id, count);
  const speaker = conv.gameData.characters.get(speakerId);
  const message = { id: `${id}:message`, role: speakerId === 1 ? "user" : "assistant", name: speaker.fullName, content: text };
  conv.messages.push(message);
  effects = [];
  providerCalls = 0;
  const result = await ActionEngine.evaluateForCharacter(conv, speaker, null, message);
  return { conv, result, effects: [...effects], providerCalls };
}

(async () => {
  for (const [text, amount, unit] of [
    ["50文", 50, "文"], ["50文钱", 50, "文钱"], ["50铜钱", 50, "铜钱"],
    ["50金币", 50, "金币"], ["50金", 50, "金"], ["50银币", 50, "银币"],
    ["50两", 50, "两"], ["50两银子", 50, "两银子"], ["1贯", 1, "贯"], ["1贯钱", 1, "贯钱"]
  ]) {
    const resolution = actionSystem.moneyAmountResolver.resolve(text);
    assert.strictEqual(resolution.resolved, true, text);
    assert.strictEqual(resolution.normalizedAmount, amount, text);
    assert.strictEqual(resolution.rawUnit, unit, text);
    assert.strictEqual(resolution.normalizationMode, "direct_game_unit", text);
  }
  assert.deepStrictEqual(actionSystem.moneyAmountResolver.resolve("一些钱"), { resolved: false, reason: "money_amount_not_found" });

  for (const [index, text] of ["我给李思念50文钱。", "我递给李思念50文。", "我把50文交给李思念。"].entries()) {
    const evaluated = await evaluate({ id: `player-${index}`, text, count: 6 });
    assert.strictEqual(evaluated.result.autoApproved[0]?.actionId, "playerPaysGoldTo", text);
    assert.strictEqual(evaluated.result.autoApproved[0]?.success, true, text);
    assert.deepStrictEqual([evaluated.effects[0]?.sourceId, evaluated.effects[0]?.targetId], [1, 2], `${text}: named target must not expand to observers`);
    assert.strictEqual(evaluated.providerCalls, 0, `${text}: deterministic payment must skip Stage B`);
  }

  const npcPayment = await evaluate({ id: "npc-payment", text: "李思念给了李思昭20文。", speakerId: 2, count: 6 });
  assert.strictEqual(npcPayment.result.autoApproved[0]?.actionId, "paysGoldTo");
  assert.deepStrictEqual([npcPayment.effects[0]?.sourceId, npcPayment.effects[0]?.targetId], [2, 1]);
  assert.strictEqual(npcPayment.providerCalls, 0);

  for (const [index, text] of [
    "我想给李思念50文。",
    "我准备明天给李思念50文。",
    "我可以给你50文吗？",
    "我愿意给你50文。",
    "我递给她50文，但她没有接。",
    "我本来想给她50文，但最后没有给。"
  ].entries()) {
    const evaluated = await evaluate({ id: `non-executed-${index}`, text });
    assert.strictEqual(evaluated.effects.length, 0, `${text}: non-completed transfer must not execute`);
    assert.strictEqual(evaluated.providerCalls, 0, `${text}: non-completed transfer must not call Action Provider`);
  }

  const proposal = actionSystem.interaction.proposalDetector.detect({
    text: "我可以给你50文吗？",
    speaker: { id: 1, shortName: "李思昭", fullName: "李思昭" },
    characters: [...createCharacters(2).values()],
    registry: globalThis.actionRegistry
  });
  assert.strictEqual(proposal?.interactionType, "requested_execution");
  assert.strictEqual(proposal?.candidateActionIds[0], "playerPaysGoldTo");
  assert.deepStrictEqual(proposal?.extractedArgs, { amount: 50 });

  const ambiguousAmount = await evaluate({ id: "ambiguous-amount", text: "我把一些钱递给李思念。" });
  assert.strictEqual(ambiguousAmount.effects.length, 0, "an unresolved amount must not be invented locally");
  assert.strictEqual(ambiguousAmount.providerCalls, 1, "an unresolved amount may fall back to Stage B after passing the gold gate");
  assert(!analytics.some((entry) => entry.metric === "precisionJudgeCalls"), "the deterministic money hotfix must not add Precision Judge calls");
  console.log("VOTC v7.9.1 Hotfix gold: PASS (local amount, completion boundary, binding and zero Stage B)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
