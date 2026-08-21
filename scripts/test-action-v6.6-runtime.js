const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const { getActionEngine } = require("./action-engine-test-helper");
const { getConversationClass } = require("./conversation-test-helper");

const player = { id: 1, fullName: "玩家", shortName: "玩家" };
const zhangSan = { id: 2, fullName: "张三", shortName: "张三" };
const guard = { id: 3, fullName: "卫兵", shortName: "卫兵" };
const gameData = {
  playerID: player.id,
  playerName: player.fullName,
  characters: new Map([[player.id, player], [zhangSan.id, zhangSan], [guard.id, guard]])
};
const runtimeExpectedSources = new Map();
const deathAction = {
  signature: "characterIsKilled",
  triggerCategories: ["death_or_injury"],
  semantic: {
    evidencePatterns: [/杀死|杀了/],
    participantRoles: { source: "patient", target: "actor" },
    riskLevel: "high"
  },
  title: { zh: "被目标杀死" },
  description: "Kill the source.",
  args: [],
  async check({ gameData: checkedGameData, sourceCharacter }) {
    return {
      canExecute: sourceCharacter?.id === (runtimeExpectedSources.get("characterIsKilled") ?? zhangSan.id),
      requiresTarget: true,
      validTargetCharacterIds: Array.from(checkedGameData.characters.keys())
    };
  }
};
const loadedDeathAction = { id: deathAction.signature, definition: deathAction, validation: { valid: true }, filePath: "runtime-test" };
const checkedSources = [];
const createRuntimeAction = ({ signature, category, evidencePatterns, participantRoles, riskLevel, sourceId }) => ({
  id: signature,
  definition: {
    signature,
    triggerCategories: [category],
    semantic: { evidencePatterns, participantRoles, riskLevel },
    title: { zh: signature },
    description: signature,
    args: [],
    async check({ gameData: checkedGameData, sourceCharacter }) {
      checkedSources.push({ signature, sourceId: sourceCharacter?.id });
      return {
        canExecute: sourceCharacter?.id === (runtimeExpectedSources.get(signature) ?? sourceId),
        requiresTarget: !!participantRoles,
        validTargetCharacterIds: Array.from(checkedGameData.characters.keys())
      };
    }
  },
  validation: { valid: true },
  filePath: "runtime-test"
});
const loadedActions = [
  loadedDeathAction,
  createRuntimeAction({ signature: "isImprisonedBy", category: "imprisonment", evidencePatterns: [/关进|关押|囚禁/], participantRoles: { source: "patient", target: "actor" }, riskLevel: "high", sourceId: zhangSan.id }),
  createRuntimeAction({ signature: "isEmployedAsKnightBy", category: "employment_or_office", evidencePatterns: [/任命.*骑士|骑士/], participantRoles: { source: "patient", target: "actor" }, riskLevel: "medium", sourceId: zhangSan.id }),
  createRuntimeAction({ signature: "isInjured", category: "death_or_injury", evidencePatterns: [/刺伤|砍伤/], participantRoles: { source: "actor", target: "patient" }, riskLevel: "high", sourceId: player.id }),
  createRuntimeAction({ signature: "playerPaysGoldTo", category: "gold", evidencePatterns: [/给.*金币|金币.*给/], riskLevel: "medium", sourceId: player.id })
];
let approvalMode = "non-destructive";
globalThis.actionRegistry = {
  getAllActions: () => loadedActions,
  getById: (id) => loadedActions.find((action) => action.id === id) || null,
  getEffectiveDestructive: (id) => globalThis.actionRegistry.getEffectiveRiskLevel(id) === "high",
  getEffectiveRiskLevel: (id) => globalThis.actionRegistry.getById(id)?.definition.semantic.riskLevel || "low",
  hasDestructiveOverride: () => false,
  shouldRequireApproval: (_id, mode) => mode !== "all",
  registerValidation: () => {}
};
globalThis.settingsRepository = {
  getLanguage: () => "zh",
  getActionsProviderConfig: () => ({ useMinimizedActionsSchema: true }),
  getActionApprovalSettings: () => ({ approvalMode })
};
globalThis.usageAnalytics = { record: () => {} };
globalThis.resolveI18nString = (value) => typeof value === "object" ? value.zh || value.en : value;
globalThis.ActionPromptBuilder = {
  buildActionMessages: (_conv, _source, available) => {
    globalThis.__runtimeAvailableActions = available;
    return [];
  },
  getActionPromptBlocks: () => []
};
globalThis.buildStructuredResponseJsonSchema = () => ({});
globalThis.buildStructuredResponseSchema = () => ({ parse: (value) => value });
globalThis.healJsonResponseWithLogging = (content) => JSON.parse(content);
const effectScopes = [];
globalThis.ActionEffectWriter = {
  writeEffect: (_gameData, sourceId, targetId, effectBody) => effectScopes.push({ sourceId, targetId, effectBody })
};
globalThis.ActionSandbox = {
  executeAction: async (_filePath, context) => {
    context.runGameEffect("runtime_test_effect");
    return null;
  }
};
globalThis.llmManager = {
  sendActionsRequest: async () => ({
    content: JSON.stringify({
      actions: [{
        actionId: globalThis.__runtimeSelectedActionId,
        targetCharacterId: globalThis.__runtimeAvailableActions.find((action) => action.signature === globalThis.__runtimeSelectedActionId)?.resolvedTargetCharacterId,
        args: {}
      }]
    })
  })
};
globalThis.logVerboseLLM = () => {};
globalThis.createMessage = (message) => message;

const ActionEngine = getActionEngine();
globalThis.ActionEngine = ActionEngine;
const Conversation = getConversationClass();

(async () => {
  const conv = { gameData, actionGateProcessedTriggers: new Set() };
  const message = { id: 10, name: player.fullName, role: "user", content: "张三被我杀死。" };
  globalThis.__runtimeSelectedActionId = deathAction.signature;
  const result = await ActionEngine.evaluateForCharacter(conv, player, null, message);
  assert.strictEqual(globalThis.__runtimeAvailableActions.length, 1, "production runtime must expose one resolved action");
  assert.strictEqual(globalThis.__runtimeAvailableActions[0].sourceCharacterId, zhangSan.id, "production runtime must use the victim as action source");
  assert.strictEqual(globalThis.__runtimeAvailableActions[0].resolvedTargetCharacterId, player.id, "production runtime must bind the killer as target");
  assert.strictEqual(result.needsApproval.length, 1, "high-risk action must remain pending approval");
  assert.strictEqual(result.needsApproval[0].sourceCharacterId, zhangSan.id, "approval payload must preserve resolved source");
  assert.strictEqual(result.needsApproval[0].targetCharacterId, player.id, "approval payload must preserve the locked target");

  approvalMode = "all";
  globalThis.__runtimeSelectedActionId = deathAction.signature;
  const executedDeath = await ActionEngine.evaluateForCharacter({ gameData, actionGateProcessedTriggers: new Set() }, player, null, {
    id: 16,
    name: player.fullName,
    role: "user",
    content: "我杀死了张三。"
  });
  assert.strictEqual(executedDeath.autoApproved.length, 1, "explicit auto-approval must execute the production action invocation");
  assert.deepStrictEqual(effectScopes, [{ sourceId: zhangSan.id, targetId: player.id, effectBody: "runtime_test_effect" }], "CK3 effect writer must receive resolved victim and killer scope");

  const runParticipantCase = async ({ actionId, messageId, text, sourceId, targetId, mode = "non-destructive" }) => {
    approvalMode = mode;
    runtimeExpectedSources.set(actionId, sourceId);
    globalThis.__runtimeSelectedActionId = actionId;
    globalThis.__runtimeAvailableActions = [];
    const caseResult = await ActionEngine.evaluateForCharacter({ gameData, actionGateProcessedTriggers: new Set() }, player, null, {
      id: messageId,
      name: player.fullName,
      role: "user",
      content: text
    });
    const available = globalThis.__runtimeAvailableActions.find((action) => action.signature === actionId);
    if (actionId !== "isInjured") {
      assert(available, `${actionId}: production runtime must expose the resolved action`);
      assert.strictEqual(available.sourceCharacterId, sourceId, `${actionId}: check source must match participant metadata`);
      assert.strictEqual(available.resolvedTargetCharacterId, targetId, `${actionId}: target must be fixed before model output`);
    }
    assert.strictEqual(caseResult.needsApproval.length, 1, `${actionId}: action must wait for the configured approval policy`);
    assert.strictEqual(caseResult.needsApproval[0].sourceCharacterId, sourceId, `${actionId}: approval source must remain stable`);
    assert.strictEqual(caseResult.needsApproval[0].targetCharacterId, targetId, `${actionId}: approval target must preserve the binding`);
    return caseResult.needsApproval[0];
  };
  const assertEffectScope = async (pending) => {
    const before = effectScopes.length;
    await ActionEngine.runInvocation({ gameData }, gameData.characters.get(pending.sourceCharacterId), pending.invocation);
    assert.deepStrictEqual(effectScopes[before], { sourceId: pending.sourceCharacterId, targetId: pending.targetCharacterId, effectBody: "runtime_test_effect" }, `${pending.actionId}: execution must preserve approval participant binding`);
  };
  const imprisonment = await runParticipantCase({ actionId: "isImprisonedBy", messageId: 11, text: "我把张三关进地牢。", sourceId: zhangSan.id, targetId: player.id });
  const knight = await runParticipantCase({ actionId: "isEmployedAsKnightBy", messageId: 12, text: "我任命张三为骑士。", sourceId: zhangSan.id, targetId: player.id, mode: "none" });
  const injury = await runParticipantCase({ actionId: "isInjured", messageId: 13, text: "我刺伤张三。", sourceId: player.id, targetId: zhangSan.id });
  await assertEffectScope(imprisonment);
  await assertEffectScope(knight);
  await assertEffectScope(injury);
  const passiveDeath = await runParticipantCase({ actionId: "characterIsKilled", messageId: 17, text: "我被张三杀死。", sourceId: player.id, targetId: zhangSan.id });
  const passiveImprisonment = await runParticipantCase({ actionId: "isImprisonedBy", messageId: 18, text: "我被张三关进地牢。", sourceId: player.id, targetId: zhangSan.id });
  const passiveKnight = await runParticipantCase({ actionId: "isEmployedAsKnightBy", messageId: 19, text: "我被张三任命为骑士。", sourceId: player.id, targetId: zhangSan.id, mode: "none" });
  const passiveInjury = await runParticipantCase({ actionId: "isInjured", messageId: 20, text: "我被张三刺伤。", sourceId: zhangSan.id, targetId: player.id });
  await assertEffectScope(passiveDeath);
  await assertEffectScope(passiveImprisonment);
  await assertEffectScope(passiveKnight);
  await assertEffectScope(passiveInjury);
  assert(checkedSources.some((entry) => entry.signature === "isImprisonedBy" && entry.sourceId === zhangSan.id), "imprisonment check must execute against the prisoner");
  assert(checkedSources.some((entry) => entry.signature === "isEmployedAsKnightBy" && entry.sourceId === zhangSan.id), "knight check must execute against the appointee");
  assert(checkedSources.some((entry) => entry.signature === "isInjured" && entry.sourceId === player.id), "injury check must execute against the actor");

  approvalMode = "none";
  globalThis.__runtimeSelectedActionId = "playerPaysGoldTo";
  const playerGold = await ActionEngine.evaluateForCharacter({ gameData, actionGateProcessedTriggers: new Set() }, player, null, {
    id: 14,
    name: player.fullName,
    role: "user",
    content: "我给张三50金币。"
  });
  assert.strictEqual(playerGold.needsApproval[0].sourceCharacterId, player.id, "player gold action must retain the player source");
  const lifecycle = [];
  const originalEvaluate = ActionEngine.evaluateForCharacter;
  ActionEngine.evaluateForCharacter = async (_conversation, sourceCharacter, _signal, userMessage) => {
    lifecycle.push(`evaluate:${sourceCharacter.id}:${userMessage.id}`);
    _conversation.__failedNpcTrace?.push(`evaluate:${sourceCharacter.id}:${userMessage.id}`);
    return { autoApproved: [], needsApproval: [] };
  };
  const conversation = {
    isActive: true,
    isPaused: false,
    gameData,
    messages: [],
    nextId: 20,
    turnEpoch: 0,
    activeResponse: null,
    npcQueue: [],
    actionGateProcessedTriggers: new Set(["stale"]),
    getActionSystem: Conversation.prototype.getActionSystem,
    getTurnManager: Conversation.prototype.getTurnManager,
    getGenerationManager: Conversation.prototype.getGenerationManager,
    getActiveConversationCharacters: Conversation.prototype.getActiveConversationCharacters,
    isCharacterAvailableForConversation: Conversation.prototype.isCharacterAvailableForConversation,
    cancelActiveResponse: Conversation.prototype.cancelActiveResponse,
    emitUpdate: () => lifecycle.push("update"),
    handleActionResults: async () => lifecycle.push("results"),
    fillNpcQueue: () => lifecycle.push("fill"),
    resumeConversation: () => lifecycle.push("resume")
  };
  await Conversation.prototype.sendMessage.call(conversation, "我做出了行动。");
  const failedNpcLifecycle = [];
  const failedNpcConversation = {
    ...conversation,
    turnManager: null,
    generationManager: null,
    messages: [],
    nextId: 21,
    __failedNpcTrace: failedNpcLifecycle,
    actionGateProcessedTriggers: new Set(),
    emitUpdate: () => failedNpcLifecycle.push("update"),
    handleActionResults: async () => failedNpcLifecycle.push("results"),
    fillNpcQueue: () => failedNpcLifecycle.push("fill"),
    resumeConversation: () => {
      failedNpcLifecycle.push("npc_api_failed");
      throw new Error("NPC API failed");
    }
  };
  await assert.rejects(() => Conversation.prototype.sendMessage.call(failedNpcConversation, "我仍应先处理动作。"), /NPC API failed/);
  ActionEngine.evaluateForCharacter = originalEvaluate;
  assert.deepStrictEqual(lifecycle.slice(0, 5), ["update", "evaluate:1:20", "results", "fill", "resume"], "production conversation must evaluate player actions before NPC scheduling");
  assert.strictEqual(conversation.actionGateProcessedTriggers.size, 0, "a new player turn must reset stale action gate keys before evaluation");
  assert.deepStrictEqual(failedNpcLifecycle, ["update", "evaluate:1:21", "results", "fill", "npc_api_failed"], "NPC API failure must happen only after player action handling");

  console.log("VOTC v6.6 runtime harness: PASS (production participant binding and player lifecycle)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
