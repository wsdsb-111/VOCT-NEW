"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ActionEngineV4 } = require(path.join(root, "resources/app/out/main/action-system/action-engine"));
const selectorSchema = require(path.join(root, "resources/app/out/main/action-system/v4/proposal/action-selector-schema"));
const precisionPrompt = require(path.join(root, "resources/app/out/main/action-system/v4/precision/precision-selector-prompt"));
const compactSelector = require(path.join(root, "resources/app/out/main/action-system/v4/performance/compact-action-selector"));

const player = { id: 1, shortName: "Player", fullName: "Player", gold: 100, relationsToCharacters: [] };
const npc = { id: 2, shortName: "NPC", fullName: "NPC", gold: 100, relationsToCharacters: [] };
const gameData = { playerID: 1, playerName: "Player", characters: new Map([[1, player], [2, npc]]) };
const action = {
  id: "playerPaysGoldTo",
  filePath: "playerPaysGoldTo",
  validation: { valid: true },
  definition: {
    signature: "playerPaysGoldTo",
    actionMetadata: { availabilityRequirements: { source: "player" } },
    title: "Pay",
    args: [{ name: "amount", type: "number", description: "amount", required: true, min: 1, max: 100, step: 1 }],
    description: "Pay gold",
    check: () => ({ canExecute: true, validTargetCharacterIds: [2] }),
    run: () => null
  }
};
const calls = [];
const analytics = [];
const registry = {
  getAllActions: () => [action],
  getById: (id) => id === action.id ? action : null,
  isActionDisabled: () => false,
  registerValidation: () => {},
  shouldRequireApproval: () => false,
  getEffectiveDestructive: () => false,
  getEffectiveRiskLevel: () => "low"
};
const settingsRepository = {
  getActionSystemMode: () => "precision",
  getLanguage: () => "en",
  getActionApprovalSettings: () => ({ approvalMode: "none", pauseOnApproval: false }),
  getActionsProviderConfig: () => ({ providerType: "fixture", defaultModel: "fixture-model" })
};
const llmManager = {
  sendActionsRequest: async (messages, schemaName, schema, _signal, metadata) => {
    calls.push({ messages, schemaName, schema, metadata });
    return { content: JSON.stringify({ decisions: [] }), finish_reason: "stop" };
  }
};
ActionEngineV4.configure({
  actionRegistry: registry,
  settingsRepository,
  llmManager,
  usageAnalytics: { record: (entry) => analytics.push(entry) },
  ActionSandbox: { executeAction: async () => null },
  ActionEffectWriter: { writeEffect: () => {} },
  resolveI18nString: (value) => typeof value === "string" ? value : value.en
});

const oldHistory = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, role: index % 2 ? "assistant" : "user", name: index % 2 ? "NPC" : "Player", content: `old-${index + 1}` }));
const conversation = {
  gameData,
  messages: [...oldHistory],
  inactiveParticipantIds: new Map(),
  getActiveConversationCharacters: () => [player, npc]
};

(async () => {
  for (const rules of [precisionPrompt.UNIVERSAL_RULES, compactSelector.COMPACT_RULES]) {
    assert(rules.includes("A newly made explicit proposal MUST emit action_call"), "both selectors must create Pending from a new consent proposal");
    assert(rules.includes("This action_call represents a proposal, NOT gameplay execution"));
    assert(rules.includes("Acceptance, rejection, or defer from CURRENT_MESSAGE MUST use pending_response"));
    assert(rules.includes("Never emit a fresh action_call merely to represent acceptance"));
  }
  const ordinary = { id: 20, role: "user", name: "Player", content: "今天天气不错。" };
  await ActionEngineV4.evaluateForCharacter(conversation, player, null, ordinary);
  conversation.messages.push(ordinary);
  const question = { id: 21, role: "assistant", name: "NPC", content: "你愿意留下吗？" };
  await ActionEngineV4.evaluateForCharacter(conversation, npc, null, question);
  assert.strictEqual(calls.length, 2, "every valid Precision RP message must call the selector exactly once");
  assert.strictEqual(calls[0].schemaName, "votc_ae4_q2");
  assert.strictEqual(calls[0].messages[0].content, calls[1].messages[0].content, "stable prefix must be byte-identical");
  const dynamic = JSON.parse(calls[1].messages[1].content.replace(/^AE4_P2_DYNAMIC_CONTEXT\n/, ""));
  assert.strictEqual(dynamic.recentDialogue.length, 4, "P2 must contain only the latest four prior dialogue turns");
  assert.strictEqual(dynamic.currentMessage.id, 21);
  assert(!calls[1].messages[1].content.includes("old-1"), "P2 must not include full history");
  assert.strictEqual(calls[0].metadata.selectorVersion, "ae4-selector-v3");
  assert.strictEqual(calls[0].metadata.catalogVersion, "ae4-c2-v3");
  assert.strictEqual(calls[0].metadata.schemaVersion, "ae4-q2-v1");
  assert(calls[0].metadata.stablePrefixHash && calls[0].metadata.availableCatalogHash && calls[0].metadata.p2ContextHash);

  const duplicate = await ActionEngineV4.evaluateForCharacter(conversation, npc, null, question);
  assert.strictEqual(calls.length, 2, "duplicate messageId is a technical skip");
  assert.strictEqual(duplicate.autoApproved.length, 0);

  llmManager.sendActionsRequest = async (...args) => {
    calls.push({ messages: args[0], metadata: args[4] });
    return { content: "not-json" };
  };
  const malformed = { id: 22, role: "user", name: "Player", content: "我给你五十金币。" };
  const malformedResult = await ActionEngineV4.evaluateForCharacter(conversation, player, null, malformed);
  assert.strictEqual(calls.length, 3, "malformed Q2 must not trigger a repair or second judge call");
  assert.strictEqual(malformedResult.autoApproved.length, 0);
  assert(malformedResult.rejected.some((item) => item.reason === "unparseable_q2_json"));
  const extraField = selectorSchema.parse(JSON.stringify({ decisions: [{
    type: "action_call",
    actionId: "playerPaysGoldTo",
    sourceCharacterId: 1,
    targetCharacterId: 2,
    arguments: { amount: 50 },
    evidenceMessageIds: [22],
    confidence: 1,
    guessedTarget: true
  }] }));
  assert.deepStrictEqual(extraField, { valid: false, reason: "invalid_q2_schema" }, "local Q2 validation must enforce additionalProperties=false");

  const v4Source = fs.readFileSync(path.join(root, "resources/app/out/main/action-system/v4/action-engine-v4.js"), "utf8");
  assert(!/candidate-gate|event-parser|semantic-rescue|precision-action-judge/.test(v4Source), "Precision runtime must not import AE3 semantic gates");
  console.log("PASS v7.9.3 AE4 Phase 3 Precision selector");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
