"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.__V67ActionSystem = actionSystem;
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const injured = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_isInjured.js"));
const { getActionEngine } = require("./action-engine-test-helper");
for (const [text, expected] of [
  ["我在他的手臂上划了一剑。", "wounded"],
  ["我在他的腿上砍了一刀。", "wounded"],
  ["我砍断了他的腿。", "cut_leg"],
  ["我剜掉了他的一只眼。", "remove_eye"],
  ["我刺瞎了他的双眼。", "blind"],
  ["我阉割了他。", "cut_balls"],
  ["我明确毁容了他。", "disfigured"]
]) {
  assert.strictEqual(actionSystem.injuryTypeResolver.resolve(text).injuryType, expected, `${text}: injury type mismatch`);
}
function character(id, name) {
  return {
    id,
    fullName: name,
    shortName: name,
    gender: "male",
    sheHe: "he",
    traits: [],
    relationsToCharacters: [],
    hasTrait(name) { return this.traits.some((trait) => trait.name === name); },
    addTrait(trait) { this.traits.push(trait); },
    removeTrait(name) { this.traits = this.traits.filter((trait) => trait.name !== name); }
  };
}
const player = character(1, "玩家");
const target = character(2, "张三");
const gameData = { playerID: player.id, playerName: player.fullName, characters: new Map([[1, player], [2, target]]) };
const loaded = { id: injured.signature, definition: injured, validation: { valid: true }, filePath: "v6.8.4-injury" };
globalThis.actionRegistry = {
  getAllActions: () => [loaded],
  getById: (id) => id === loaded.id ? loaded : null,
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
globalThis.logVerboseLLM = () => {};
let llmRequests = 0;
globalThis.llmManager = { sendActionsRequest: async () => { llmRequests += 1; throw new Error("injury must not call Action LLM"); } };
globalThis.ActionPromptBuilder = { buildActionMessages: () => [], getActionPromptBlocks: () => [] };
globalThis.buildStructuredResponseJsonSchema = () => ({});
globalThis.buildStructuredResponseSchema = () => ({ parse: (value) => value });
globalThis.healJsonResponseWithLogging = (content) => JSON.parse(content);
const effects = [];
globalThis.ActionEffectWriter = { writeEffect: (_gameData, sourceId, targetId, effectBody) => effects.push({ sourceId, targetId, effectBody }) };
globalThis.ActionSandbox = { executeAction: async (_filePath, context) => injured.run(context) };
const ActionEngine = getActionEngine();
assert.deepStrictEqual(ActionEngine.getSemanticActionProfile("我砍断了张三的腿。").allowedActionIds, ["isInjured"], "explicit leg loss must reach Injury before local type resolution");
(async () => {
  const conversation = { gameData, messages: [], actionGateProcessedTriggers: new Set(), inactiveParticipantIds: new Map() };
  const message = { id: 8410, role: "user", name: player.fullName, content: "我并没有杀张三，只是在张三的手臂上划了一剑。" };
  const injuryEvent = ActionEngine.getSemanticActionProfile(message.content).events.find((event) => event.allowedActionIds.includes("isInjured"));
  const diagnosticContext = ActionEngine.getConversationReferenceContext(conversation, message, player);
  const diagnosticBinding = ActionEngine.resolveEventParticipants({ event: injuryEvent, message, speaker: player, gameData, actionDefinition: injured, actionId: "isInjured", referenceContext: diagnosticContext });
  assert.strictEqual(diagnosticBinding.mode, "resolved", `injury binding diagnostic: ${diagnosticBinding.reason}; evidence=${JSON.stringify(injuryEvent?.evidence)}`);
  const pending = await ActionEngine.evaluateForCharacter(conversation, player, null, message);
  assert.strictEqual(llmRequests, 0, "exact injury must use local invocation");
  assert.strictEqual(pending.needsApproval.length, 1, "high-risk injury must retain approval");
  const invocation = pending.needsApproval[0].invocation;
  assert.deepStrictEqual({ actionId: invocation.actionId, source: invocation.sourceCharacterId, target: invocation.targetCharacterId, injuryType: invocation.args.injuryType }, { actionId: "isInjured", source: player.id, target: target.id, injuryType: "wounded" });
  const result = await ActionEngine.runInvocation(conversation, player, invocation);
  assert.strictEqual(result.success, true);
  assert(result.feedback?.message, "injury execution must return feedback");
  assert(effects.some((effect) => effect.sourceId === player.id && effect.targetId === target.id && /wounded_1/.test(effect.effectBody)), "injury must write the bound CK3 effect scope");
  console.log("VOTC v6.8.4 injury runtime: PASS (local injury type, approval, feedback and effect scope)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
