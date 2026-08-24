"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.__V67ActionSystem = actionSystem;
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const intercourse = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_intercourse.js"));
const { getActionEngine } = require("./action-engine-test-helper");
function character(id, name, age) {
  return { id, fullName: name, shortName: name, age, gender: id === 3 ? "female" : "male", traits: [], relationsToCharacters: [], addTrait(trait) { this.traits.push(trait); } };
}
const player = character(1, "玩家A", 30);
const npcB = character(2, "NPCB", 28);
const npcC = character(3, "NPCC", 26);
const minor = character(4, "未成年D", 15);
const unknown = character(5, "年龄未知E", undefined);
const gameData = { playerID: player.id, playerName: player.fullName, characters: new Map([[1, player], [2, npcB], [3, npcC], [4, minor], [5, unknown]]) };
npcB.traits.push({ name: "HadSex", desc: `[withId=${npcC.id}]` });
const availability = intercourse.check({ gameData, sourceCharacter: npcB });
assert(availability.validTargetCharacterIds.includes(npcC.id), "old HadSex traits must not permanently block a new event");
assert(!availability.validTargetCharacterIds.includes(minor.id), "minor target must fail closed");
assert(!availability.validTargetCharacterIds.includes(unknown.id), "unknown-age target must fail closed");
assert.strictEqual(intercourse.check({ gameData, sourceCharacter: minor }).canExecute, false, "minor source must fail closed");
const loaded = { id: intercourse.signature, definition: intercourse, validation: { valid: true }, filePath: "v6.8.4-intercourse" };
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
globalThis.llmManager = { sendActionsRequest: async () => { llmRequests += 1; throw new Error("intercourse must not call Action LLM"); } };
globalThis.ActionPromptBuilder = { buildActionMessages: () => [], getActionPromptBlocks: () => [] };
globalThis.buildStructuredResponseJsonSchema = () => ({});
globalThis.buildStructuredResponseSchema = () => ({ parse: (value) => value });
globalThis.healJsonResponseWithLogging = (content) => JSON.parse(content);
const effects = [];
globalThis.ActionEffectWriter = { writeEffect: (_gameData, sourceId, targetId, effectBody) => effects.push({ sourceId, targetId, effectBody }) };
globalThis.ActionSandbox = { executeAction: async (_filePath, context) => intercourse.run(context) };
const ActionEngine = getActionEngine();
(async () => {
  const conversation = { gameData, messages: [], actionGateProcessedTriggers: new Set(), inactiveParticipantIds: new Map(), primaryAddresseeId: npcC.id };
  const message = { id: 8401, role: "assistant", name: npcB.fullName, content: "我与NPCC共度了春宵。", primaryAddresseeId: npcC.id };
  const pending = await ActionEngine.evaluateForCharacter(conversation, npcB, null, message);
  assert.strictEqual(llmRequests, 0, "completed intercourse with exact binding must use local invocation");
  assert.strictEqual(pending.needsApproval.length, 1, "high-risk local invocation must retain approval");
  const invocation = pending.needsApproval[0].invocation;
  assert.deepStrictEqual({ actionId: invocation.actionId, source: invocation.sourceCharacterId, target: invocation.targetCharacterId, args: invocation.args }, { actionId: "intercourse", source: npcB.id, target: npcC.id, args: {} });
  assert(![invocation.sourceCharacterId, invocation.targetCharacterId].includes(player.id), "player A must not enter B-C intercourse binding");
  const result = await ActionEngine.runInvocation(conversation, npcB, invocation);
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(effects.map(({ sourceId, targetId }) => ({ sourceId, targetId })), [{ sourceId: npcB.id, targetId: npcC.id }]);
  assert.match(effects[0].effectBody, /had_sex_with_effect/);
  const duplicate = await ActionEngine.evaluateForCharacter(conversation, npcB, null, message);
  assert.strictEqual(duplicate.needsApproval.length + duplicate.autoApproved.length, 0, "same message/event must dedupe");
  const next = await ActionEngine.evaluateForCharacter(conversation, npcB, null, { ...message, id: 8402 });
  assert.strictEqual(next.needsApproval.length, 1, "a later independent completed event must remain available");
  for (const text of ["我想与NPCC同房。", "我准备今晚与NPCC圆房。", "我亲吻了NPCC。", "我拥抱着NPCC躺在床上。"]) {
    assert(!ActionEngine.getSemanticActionProfile(text).allowedActionIds.includes("intercourse"), `${text}: incomplete intimacy must not trigger intercourse`);
  }
  console.log("VOTC v6.8.4 intercourse runtime: PASS (local invocation, adults, event dedupe and B-C effect scope)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
