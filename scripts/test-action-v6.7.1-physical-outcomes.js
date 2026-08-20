const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
const killed = require(path.join(actionsDir, "z_characterIsKilled.js"));
const injured = require(path.join(actionsDir, "z_isInjured.js"));
globalThis.actionRegistry = {
  getAllActions: () => [
    { id: killed.signature, definition: killed },
    { id: injured.signature, definition: injured }
  ]
};
const engineStart = source.indexOf("class ActionEngine {");
const engineEnd = source.indexOf("\nclass Conversation {", engineStart);
assert(engineStart >= 0 && engineEnd > engineStart, "Cannot extract ActionEngine");
eval(`${source.slice(engineStart, engineEnd)}\nglobalThis.__V671ActionEngine = ActionEngine;`);
const ActionEngine = globalThis.__V671ActionEngine;

const outcomes = [
  ["我拿匕首刺中了张三的肩膀。", "isInjured"],
  ["我将刀刃刺入张三的腹部。", "isInjured"],
  ["我砍下张三的手。", "isInjured"],
  ["我割下了张三的脑袋。", "characterIsKilled"],
  ["我砍下张三的头颅。", "characterIsKilled"],
  ["我斩下张三的首级。", "characterIsKilled"],
  ["张三的头颅被我割了下来。", "characterIsKilled"],
  ["我一刀将张三枭首。", "characterIsKilled"]
];

for (const [text, expectedActionId] of outcomes) {
  const profile = ActionEngine.getSemanticActionProfile(text);
  assert(profile.reasons.includes("death_or_injury"), `${text}: must enter physical-outcome semantic resolution`);
  assert.deepStrictEqual(profile.allowedActionIds, [expectedActionId], `${text}: must resolve only ${expectedActionId}`);
}

const player = { id: 1, shortName: "玩家", fullName: "玩家" };
const zhangSan = { id: 2, shortName: "张三", fullName: "张三" };
const gameData = { playerID: player.id, playerName: player.fullName, characters: new Map([[player.id, player], [zhangSan.id, zhangSan]]) };
for (const [text, actionId, expectedSourceId, expectedTargetId] of [
  ["我拿匕首刺中了张三的肩膀。", "isInjured", player.id, zhangSan.id],
  ["我砍下张三的脑袋。", "characterIsKilled", zhangSan.id, player.id]
]) {
  const event = ActionEngine.getSemanticActionProfile(text).events.find((candidate) => candidate.category === "death_or_injury");
  const definition = actionId === "isInjured" ? injured : killed;
  const result = globalThis.__V67ActionSystem.ParticipantResolver.resolve({
    event,
    message: { id: text, role: "user", content: text },
    speaker: player,
    gameData,
    actionDefinition: definition,
    actionId,
    references: []
  });
  assert.strictEqual(result.mode, "resolved", `${text}: participant binding must resolve`);
  assert.strictEqual(result.sourceCharacter.id, expectedSourceId, `${text}: source binding must remain correct`);
  assert.strictEqual(result.targetCharacter.id, expectedTargetId, `${text}: target binding must remain correct`);
}

(async () => {
const runtimeActions = [killed, injured].map((definition) => ({
  id: definition.signature,
  definition: {
    ...definition,
    async check() {
      return { canExecute: true, requiresTarget: true, validTargetCharacterIds: [player.id, zhangSan.id] };
    }
  },
  validation: { valid: true },
  filePath: "v6.7.1-runtime-test"
}));
globalThis.actionRegistry = {
  getAllActions: () => runtimeActions,
  getById: (id) => runtimeActions.find((action) => action.id === id) || null,
  getEffectiveDestructive: () => true,
  getEffectiveRiskLevel: () => "high",
  hasDestructiveOverride: () => false,
  shouldRequireApproval: () => true,
  registerValidation: () => {}
};
globalThis.settingsRepository = {
  getLanguage: () => "zh",
  getActionsProviderConfig: () => ({ useMinimizedActionsSchema: true }),
  getActionApprovalSettings: () => ({ approvalMode: "non-destructive" })
};
globalThis.usageAnalytics = { record: () => {} };
globalThis.resolveI18nString = (value) => typeof value === "object" ? value.zh || value.en : value;
globalThis.ActionPromptBuilder = {
  buildActionMessages: (_conversation, _source, available) => {
    globalThis.__V671AvailableActions = available;
    return [];
  },
  getActionPromptBlocks: () => []
};
globalThis.buildStructuredResponseJsonSchema = () => ({});
globalThis.buildStructuredResponseSchema = () => ({ parse: (value) => value });
globalThis.healJsonResponseWithLogging = (content) => JSON.parse(content);
globalThis.logVerboseLLM = () => {};
globalThis.llmManager = {
  sendActionsRequest: async () => ({
    content: JSON.stringify({ actions: [{ actionId: globalThis.__V671SelectedActionId, targetCharacterId: 999, args: {} }] })
  })
};

for (const [text, actionId, expectedSourceId, expectedTargetId] of [
  ["我用匕首刺中张三肩膀。", "isInjured", player.id, zhangSan.id],
  ["我砍下张三脑袋。", "characterIsKilled", zhangSan.id, player.id]
]) {
  globalThis.__V671SelectedActionId = actionId;
  const result = await ActionEngine.evaluateForCharacter({ gameData, messages: [], actionGateProcessedTriggers: new Set() }, player, null, {
    id: `runtime:${actionId}`,
    role: "user",
    name: player.fullName,
    content: text
  });
  const available = globalThis.__V671AvailableActions.find((action) => action.signature === actionId);
  assert(available, `${text}: runtime must expose ${actionId}`);
  assert.strictEqual(available.sourceCharacterId, expectedSourceId, `${text}: runtime source must preserve binding`);
  assert.strictEqual(available.resolvedTargetCharacterId, expectedTargetId, `${text}: runtime target must preserve binding`);
  assert.strictEqual(result.needsApproval[0].targetCharacterId, expectedTargetId, `${text}: approval must reject the model's wrong target`);
}

console.log("VOTC v6.7.1 physical outcomes: PASS (injury/death semantics and bindings)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
