"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources/app/out/main/action-system"));
const { ActionEngine, ActionEngineV4 } = require(path.join(root, "resources/app/out/main/action-system/action-engine"));
const socialEngine = require(path.join(root, "resources/app/out/main/action-system/social/social-consequence-engine"));

const player = { id: 1, shortName: "Player", fullName: "Player", gold: 100, relationsToCharacters: [] };
const npc = { id: 2, shortName: "NPC", fullName: "NPC", gold: 100, relationsToCharacters: [] };
const third = { id: 3, shortName: "Third", fullName: "Third", gold: 100, relationsToCharacters: [] };
const gameData = { playerID: 1, playerName: "Player", characters: new Map([[1, player], [2, npc], [3, third]]) };
const effects = [];
let mode = "precision";

const opinion = {
  id: "changeOpinionOf",
  filePath: "changeOpinionOf",
  validation: { valid: true },
  definition: {
    signature: "changeOpinionOf",
    title: "Opinion",
    args: [{ name: "value", type: "number", description: "value", required: true, min: -10, max: 10, step: 1 }],
    description: "Opinion",
    check: ({ gameData: data, sourceCharacter }) => ({ canExecute: true, validTargetCharacterIds: [...data.characters.keys()].filter((id) => id !== sourceCharacter.id) }),
    run: ({ runGameEffect, args }) => { runGameEffect(`opinion:${args.value}`); return `opinion:${args.value}`; }
  }
};
const registry = {
  getAllActions: () => [opinion],
  getById: (id) => id === opinion.id ? opinion : null,
  isActionDisabled: () => false,
  registerValidation: () => {},
  shouldRequireApproval: () => false,
  getEffectiveDestructive: () => false,
  getEffectiveRiskLevel: () => "low"
};
const settingsRepository = {
  getActionSystemMode: () => mode,
  getLanguage: () => "en",
  getActionApprovalSettings: () => ({ approvalMode: "none", pauseOnApproval: false }),
  getActionsProviderConfig: () => ({ providerType: "fixture", defaultModel: "fixture" })
};
const dependencies = {
  actionRegistry: registry,
  settingsRepository,
  usageAnalytics: { record: () => {} },
  llmManager: { sendActionsRequest: async () => { throw new Error("direct social must not call a separate precision judge"); } },
  ActionSandbox: { executeAction: (_filePath, context) => opinion.definition.run(context) },
  ActionEffectWriter: { writeEffect: (_data, sourceId, targetId, body) => effects.push({ sourceId, targetId, body }) },
  resolveI18nString: (value) => typeof value === "string" ? value : value.en
};
ActionEngine.configure({ ...dependencies, actionEngineVersion: 4 });
ActionEngineV4.configure(dependencies);
socialEngine.configure({ ActionEngine, settingsRepository, llmManager: dependencies.llmManager, usageAnalytics: dependencies.usageAnalytics });

function conversation() {
  return {
    id: "social-test",
    gameData,
    messages: [],
    inactiveParticipantIds: new Map(),
    waitingCharacterIds: new Set(),
    departedCharacterIds: new Set(),
    temporarySocialEvidenceStore: new Map(),
    getActiveConversationCharacters: () => [player, npc, third]
  };
}

function decision(messageId, value, targetId = 2, evidenceMessageIds = [messageId]) {
  return { type: "action_call", actionId: "changeOpinionOf", sourceCharacterId: 1, targetCharacterId: targetId, arguments: { value }, evidenceMessageIds, confidence: 0.01 };
}

async function direct(conv, id, content, value, options = {}) {
  const message = { id, role: "user", name: "Player", content };
  conv.messages.push(message);
  return ActionEngineV4.evaluateProposals(conv, player, message, [decision(id, value, options.targetId || 2, options.evidenceMessageIds || [id])], { mode: "precision", origin: options.origin || "precision_selector" });
}

(async () => {
  const conv = conversation();
  let result = await direct(conv, 1, "NPC，你做得很好。", 2);
  assert.strictEqual(result.autoApproved.length, 1, "low confidence must not veto a valid Q2 action");
  assert.strictEqual(effects.at(-1).body, "opinion:2");

  result = await direct(conv, 2, "NPC，你做得很好。", 2);
  assert.strictEqual(result.autoApproved.length, 1);
  assert.strictEqual(effects.at(-1).body, "opinion:1", "second same-topic cause must scale to 40%");

  result = await direct(conv, 3, "NPC，你做得很好。", 2);
  assert(result.rejected.some((item) => item.reason === "topic_cooldown_suppressed"), "third same-topic cause must scale to zero");

  result = await direct(conv, 4, "重复同一证据。", 2, { evidenceMessageIds: [1] });
  assert(result.rejected.some((item) => item.reason === "same_cause_deduped"), "same cause and effect must dedupe");

  result = await direct(conv, 5, "强烈称赞另一件事。", 4);
  assert(result.rejected.some((item) => item.reason === "rejected_direct_opinion_delta"), "direct opinion must use O2 discrete values only");

  result = await direct(conv, 6, "第三个独立赞赏。", 3, { targetId: 3 });
  assert(result.rejected.some((item) => item.reason === "direct_turn_cap"), "direct dialogue total must not exceed 5 in one turn");

  result = await direct(conv, 7, "confirmed injury", 7, { targetId: 3, origin: "derived_social" });
  assert.strictEqual(result.autoApproved.length, 1, "derived world effect may use a larger delta");
  result = await direct(conv, 8, "another confirmed event", 1, { targetId: 3, origin: "derived_social" });
  assert(result.rejected.some((item) => item.reason === "overall_turn_cap"), "all social effects must not exceed 10 in one turn");

  const performanceConversation = conversation();
  mode = "performance";
  const thanks = { id: 20, role: "user", name: "Player", content: "NPC，多谢你的帮助。" };
  performanceConversation.messages.push(thanks);
  const performanceSocial = await socialEngine.process({ conversation: performanceConversation, message: thanks, confirmedEvents: [], signal: null });
  assert.strictEqual(performanceSocial.metrics.mode, "performance");
  assert.strictEqual(performanceSocial.actionResults.autoApproved.length, 1, "Performance direct praise/gratitude must resolve locally");

  const precisionConversation = conversation();
  mode = "precision";
  const praise = { id: 30, role: "user", name: "Player", content: "NPC，你真是一位伟大的骑士。" };
  precisionConversation.messages.push(praise);
  const precisionDirectSidecar = await socialEngine.process({ conversation: precisionConversation, message: praise, confirmedEvents: [], signal: null });
  assert.strictEqual(precisionDirectSidecar.actionResults.autoApproved.length, 0, "Precision direct social must not run a parallel Social Local/Judge path");

  const worldMessage = { id: 31, role: "user", name: "Player", content: "NPC受伤了。" };
  precisionConversation.messages.push(worldMessage);
  const derived = await socialEngine.process({
    conversation: precisionConversation,
    message: worldMessage,
    confirmedEvents: [{ success: true, effectWritten: true, origin: "action", eventId: "ae4:injury:1", sourceMessageId: 31, sourceCharacterId: 1, targetCharacterId: 2, actionId: "isInjured" }],
    signal: null
  });
  assert(derived.actionResults.autoApproved.length >= 1, "confirmed world event must produce a derived consequence in Precision");

  const unconfirmedConversation = conversation();
  const claim = { id: 40, role: "user", name: "Player", content: "听说NPC受伤了。" };
  unconfirmedConversation.messages.push(claim);
  const unconfirmed = await socialEngine.process({ conversation: unconfirmedConversation, message: claim, confirmedEvents: [], signal: null });
  assert.strictEqual(unconfirmed.actionResults.autoApproved.length, 0, "unconfirmed claim must not become confirmed world evidence");

  console.log("PASS v7.9.3 AE4 Phase 6 Social and Opinion");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
