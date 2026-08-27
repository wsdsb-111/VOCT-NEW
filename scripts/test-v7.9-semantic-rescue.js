"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.__V67ActionSystem = actionSystem;

const { semanticCorpus, semanticRescue } = actionSystem.semantic;
assert(semanticCorpus.ENTRIES.length >= 12, "phase-one semantic corpus must cover at least twelve frequent actions");
assert(semanticCorpus.ENTRIES.every((entry) => entry.positive.length > 0 && entry.negative.length > 0));

const lowAction = {
  id: "changeOpinionOf",
  definition: { triggerCategories: ["opinion_change"], semantic: { riskLevel: "low" }, title: { zh: "改变看法" } },
  validation: { valid: true }
};
const highAction = {
  id: "characterIsKilled",
  definition: { triggerCategories: ["combat"], semantic: { riskLevel: "high" }, title: { zh: "死亡" } },
  validation: { valid: true }
};
const registry = { getEffectiveRiskLevel: (id) => id === "characterIsKilled" ? "high" : "low" };
assert.deepStrictEqual(semanticRescue.shortlist({ event: { category: "combat", evidence: { text: "他已经被杀死" } }, actions: [highAction], registry }), [], "performance rescue must exclude high-risk actions");
assert.strictEqual(semanticRescue.parseResult({ content: '{"matched":true,"actionId":"changeOpinionOf","confidence":0.84}' }, [{ actionId: "changeOpinionOf", risk: "low" }]).matched, false);
assert.strictEqual(semanticRescue.parseResult({ content: '{"matched":true,"actionId":"changeOpinionOf","confidence":0.85}' }, [{ actionId: "changeOpinionOf", risk: "low" }]).matched, true);
const phaseThreeActions = [
  ["makeAlliance", "relationship"],
  ["agreedToTruceWith", "relationship"],
  ["becomeFriendsWith", "relationship"],
  ["changeOpinionOf", "opinion_change"],
  ["isEmployedBy", "employment_or_office"]
].map(([id, category]) => ({ id, definition: { triggerCategories: [category], semantic: { riskLevel: "medium" }, title: { zh: id } }, validation: { valid: true } }));
for (const [category, evidence, expected] of [
  ["relationship", "双方正式结成同盟", "makeAlliance"],
  ["relationship", "双方正式签订停战协议", "agreedToTruceWith"],
  ["relationship", "从今往后我们便是朋友", "becomeFriendsWith"],
  ["opinion_change", "我对你刮目相看", "changeOpinionOf"],
  ["employment_or_office", "领主正式将他招入宫廷", "isEmployedBy"]
]) {
  assert(semanticRescue.shortlist({ event: { category, evidence: { text: evidence } }, actions: phaseThreeActions, registry }).some((entry) => entry.actionId === expected), `${expected} must be covered by phase-three rescue retrieval`);
}

const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();
const definition = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_changeOpinionOf.js"));
const loaded = { id: "changeOpinionOf", definition, validation: { valid: true }, filePath: "z_changeOpinionOf.js" };
const player = { id: 1, shortName: "李思昭", fullName: "李思昭" };
const npc = { id: 2, shortName: "李思念", fullName: "李思念" };
const gameData = { playerID: 1, playerName: player.fullName, characters: new Map([[1, player], [2, npc]]) };
const calls = [];
const effects = [];
const analytics = [];

globalThis.actionRegistry = {
  getAllActions: () => [loaded],
  getActionIdsForCategories: (categories) => new Set(categories.includes("opinion_change") ? [loaded.id] : []),
  getById: (id) => id === loaded.id ? loaded : null,
  registerValidation() {},
  getEffectiveRiskLevel: () => "low",
  getEffectiveDestructive: () => false,
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
  sendActionsRequest: async (_messages, requestId) => {
    calls.push(requestId);
    if (requestId === "votc_action_semantic_rescue") return { content: '{"matched":true,"actionId":"changeOpinionOf","confidence":0.91}' };
    return { content: '{"actions":[{"actionId":"changeOpinionOf","targetCharacterId":2,"args":{"value":6}}]}' };
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
globalThis.ActionSandbox = { executeAction: async (_filePath, context) => definition.run(context) };
globalThis.ActionEffectWriter = { writeEffect: (_gameData, sourceId, targetId, body) => effects.push({ sourceId, targetId, body }) };

(async () => {
  const conv = {
    id: "semantic-rescue",
    turnEpoch: 1,
    gameData,
    messages: [],
    actionGateProcessedTriggers: new Set(),
    processedActionEventIds: new Set(),
    inactiveParticipantIds: new Set(),
    getHistory() { return this.messages; }
  };
  const message = { id: "opinion", role: "user", name: player.fullName, content: "我对李思念刮目相看。" };
  conv.messages.push(message);
  const result = await ActionEngine.evaluateForCharacter(conv, player, null, message);
  assert.strictEqual(result.autoApproved.length, 1, "a low-risk unresolved event may be rescued and then executed through the existing provider");
  assert.deepStrictEqual(calls, ["votc_action_semantic_rescue", "votc_actions"]);
  assert.strictEqual(effects.length, 1);
  assert.deepStrictEqual([effects[0].sourceId, effects[0].targetId], [player.id, npc.id]);
  assert(analytics.some((entry) => entry.metric === "semanticRescueCalls"));
  assert(analytics.some((entry) => entry.metric === "semanticRescueMatched"));
  console.log("VOTC v7.9 performance semantic rescue: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
