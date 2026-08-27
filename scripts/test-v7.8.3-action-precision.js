"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));

const customWithoutSemantic = {
  id: "customCupAction",
  definition: {
    signature: "customCupAction",
    triggerCategories: ["daily_object_interaction"],
    args: [],
    description: "custom action without semantic metadata",
    check: async () => ({ canExecute: true }),
    run() {}
  },
  validation: { valid: true },
  filePath: "customCupAction.js"
};
let providerCalls = 0;
const analytics = [];
globalThis.actionRegistry = {
  getAllActions: () => [customWithoutSemantic],
  getActionIdsForCategories: () => new Set([customWithoutSemantic.id]),
  registerValidation() {}
};
globalThis.settingsRepository = { getLanguage: () => "zh" };
globalThis.usageAnalytics = { record: (metadata) => analytics.push(metadata) };
globalThis.llmManager = { sendActionsRequest: async () => { providerCalls++; return { content: '{"actions":[]}' }; } };

const { getActionEngine } = require("./action-engine-test-helper");
const actionSystem = globalThis.__V67ActionSystem;
const ActionEngine = getActionEngine();
const player = { id: 1, shortName: "玩家", fullName: "玩家" };
const npc = { id: 2, shortName: "乙", fullName: "乙" };
const gameData = { playerID: 1, playerName: "玩家", characters: new Map([[1, player], [2, npc]]) };

(async () => {
  const conversation = { id: "action-precision", turnEpoch: 1, gameData, messages: [], actionGateProcessedTriggers: new Set(), inactiveParticipantIds: new Map() };
  const message = { id: 10, role: "user", name: "玩家", content: "我拿起茶杯。" };
  const profile = ActionEngine.getSemanticActionProfile(message.content);
  assert.strictEqual(profile.resolutionMode, "unresolved");
  assert.deepStrictEqual(profile.allowedActionIds, []);
  const result = await ActionEngine.evaluateForCharacter(conversation, player, null, message);
  assert.deepStrictEqual(result, { autoApproved: [], needsApproval: [] });
  assert.strictEqual(providerCalls, 0, "empty semantic allowlist must fail closed before Action Provider");
  assert(analytics.some((entry) => entry.requestType === "action_outcome" && entry.actionOutcome === "no_semantic_module_match"), "semantic rejection must remain observable");

  for (const content of ["我喜欢你。", "我以后会杀了他。", "你去把他关起来。", "要不要给他100金币？", "他回忆昨天杀人的事情。", "她神情复杂。"] ) {
    const skipped = await ActionEngine.evaluateForCharacter({ ...conversation, actionGateProcessedTriggers: new Set() }, player, null, { id: content, role: "user", name: "玩家", content });
    assert.deepStrictEqual(skipped, { autoApproved: [], needsApproval: [] }, `${content}: must not produce an action`);
  }
  assert.strictEqual(providerCalls, 0, "ordinary, future, requested, recalled and ambiguous text must not call Action Provider");

  const emotionCases = new Map([
    ["她微笑着点头。", "happy"],
    ["她轻笑了一声。", "laugh"],
    ["她流泪了。", "crying"],
    ["她暴怒地拍案。", "rage"],
    ["她跪下祈祷。", "praying"],
    ["她举杯敬酒。", "toast"]
  ]);
  for (const [content, emotion] of emotionCases) assert.strictEqual(actionSystem.emotionTypeResolver.resolve(content).emotion, emotion, content);
  for (const content of ["她神情复杂。", "她若有所思。", "她微笑后又哭泣。", ""]) {
    assert.strictEqual(actionSystem.emotionTypeResolver.resolve(content).resolved, false, `${content}: ambiguous emotion must remain unresolved`);
  }

  const setEmotionDefinition = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_setEmotion.js"));
  const setEmotion = { id: "setEmotion", definition: setEmotionDefinition, validation: { valid: true }, filePath: "z_setEmotion.js" };
  const effects = [];
  providerCalls = 0;
  analytics.length = 0;
  globalThis.actionRegistry = {
    getAllActions: () => [setEmotion],
    getActionIdsForCategories: () => new Set(["setEmotion"]),
    getById: (id) => id === "setEmotion" ? setEmotion : null,
    registerValidation() {},
    getEffectiveDestructive: () => false,
    getEffectiveRiskLevel: () => "low",
    hasDestructiveOverride: () => false,
    shouldRequireApproval: () => false
  };
  globalThis.settingsRepository = {
    getLanguage: () => "zh",
    getActionApprovalSettings: () => ({ approvalMode: "never" }),
    getActionsProviderConfig: () => ({ useMinimizedActionsSchema: true })
  };
  globalThis.usageAnalytics = { record: (metadata) => analytics.push(metadata) };
  globalThis.llmManager = { sendActionsRequest: async () => { providerCalls++; return { content: '{"actions":[]}' }; } };
  globalThis.resolveI18nString = (value) => typeof value === "string" ? value : value?.zh || value?.en || "";
  globalThis.ActionSandbox = { executeAction: async (_filePath, context) => setEmotionDefinition.run(context) };
  globalThis.ActionEffectWriter = { writeEffect: (_gameData, sourceId, targetId, body) => effects.push({ sourceId, targetId, body }) };

  const localConversation = {
    id: "action-local-emotion",
    turnEpoch: 7,
    gameData,
    messages: [],
    actionGateProcessedTriggers: new Set(),
    processedActionEventIds: new Set(),
    inactiveParticipantIds: new Map()
  };
  const localMessage = { id: 20, role: "assistant", name: npc.fullName, content: "我轻笑了一声。" };
  const localResult = await ActionEngine.evaluateForCharacter(localConversation, npc, null, localMessage);
  assert.strictEqual(localResult.autoApproved.length, 1, "exact visible pose must execute locally");
  assert.strictEqual(localResult.autoApproved[0].success, true);
  assert.strictEqual(providerCalls, 0, "deterministic emotion must not call Action Provider");
  assert.strictEqual(effects.length, 1);
  assert.strictEqual(effects[0].sourceId, npc.id);
  assert.strictEqual(effects[0].targetId, npc.id);
  assert.match(effects[0].body, /value = flag:laugh/);
  assert(analytics.some((entry) => entry.requestType === "action_outcome" && entry.invocationOrigin === "local" && entry.executedActionIds.includes("setEmotion")), "local execution origin must be observable");

  for (const [content, expectedOutcome] of [["我微笑后又哭泣。", "deterministic_unresolved"], ["我神情复杂地看着她。", null]]) {
    const ambiguousConversation = {
      ...localConversation,
      id: `action-ambiguous-${content}`,
      actionGateProcessedTriggers: new Set(),
      processedActionEventIds: new Set()
    };
    const beforeEffects = effects.length;
    const beforeProviderCalls = providerCalls;
    const ambiguousResult = await ActionEngine.evaluateForCharacter(ambiguousConversation, npc, null, { id: content, role: "assistant", name: npc.fullName, content });
    assert.deepStrictEqual(ambiguousResult, { autoApproved: [], needsApproval: [] }, `${content}: ambiguous emotion must fail closed`);
    assert.strictEqual(providerCalls, beforeProviderCalls, `${content}: ambiguous emotion must not call Action Provider`);
    assert.strictEqual(effects.length, beforeEffects, `${content}: ambiguous emotion must not write an effect`);
    if (expectedOutcome) assert(analytics.some((entry) => entry.requestType === "action_outcome" && entry.actionOutcome === expectedOutcome), `${content}: deterministic rejection must remain observable`);
  }

  const duplicateResult = await ActionEngine.evaluateForCharacter(localConversation, npc, null, localMessage);
  assert.deepStrictEqual(duplicateResult, { autoApproved: [], needsApproval: [] });
  assert.strictEqual(effects.length, 1, "same ActionEvent must execute at most once per turn");
  assert(analytics.some((entry) => entry.requestType === "action_skipped" && entry.skipReason === "event.already_processed_action_event"), "event dedupe must remain observable");

  console.log("VOTC v7.8.3 action precision: PASS (fail-closed, local emotion, event dedupe)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
