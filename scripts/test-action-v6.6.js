const assert = require("assert");
const events = require("events");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const source = fs.readFileSync(mainPath, "utf8");
const conversationSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "conversation.js"), "utf8");
const engineSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "action-engine-v3.js"), "utf8");
const approvalManagerSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "approval-manager.js"), "utf8");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
globalThis.actionRegistry = {
  getAllActions: () => fs.readdirSync(actionsDir).filter((file) => file.endsWith(".js")).map((file) => {
    const definition = require(path.join(actionsDir, file));
    return { id: definition.signature, definition };
  })
};
const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();

const ActionRegistry = globalThis.__V67ActionSystem.ActionRegistry;

const player = { id: 1, fullName: "玩家", shortName: "玩家" };
const zhangSan = { id: 2, fullName: "张三", shortName: "张三" };
const king = { id: 3, fullName: "国王", shortName: "国王" };
const gameData = {
  playerID: player.id,
  playerName: player.fullName,
  characters: new Map([[player.id, player], [zhangSan.id, zhangSan], [king.id, king]])
};

const definitions = {
  victimSource: { semantic: { evidencePatterns: [/(?:杀死|关进|任命|罢免|撤去)/], participantRoles: { source: "patient", target: "actor" } } },
  actorSource: { semantic: { evidencePatterns: [/(?:刺伤)/], participantRoles: { source: "actor", target: "patient" } } }
};

const resolve = (text, speaker, actionDefinition) => ActionEngine.resolveEventParticipants({
  event: { evidence: { text, start: 0, end: text.length } },
  speaker,
  gameData,
  actionDefinition
});

const participantCases = [
  ["我杀死了张三。", player, definitions.victimSource, 2, 1],
  ["张三被我杀死了。", player, definitions.victimSource, 2, 1],
  ["我把张三关进地牢。", player, definitions.victimSource, 2, 1],
  ["张三把我关进地牢。", player, definitions.victimSource, 1, 2],
  ["我任命张三为骑士。", player, definitions.victimSource, 2, 1],
  ["国王任命我为骑士。", player, definitions.victimSource, 1, 3],
  ["我罢免张三的议会职位。", player, definitions.victimSource, 2, 1],
  ["国王撤去我的议会职位。", player, definitions.victimSource, 1, 3],
  ["我刺伤张三。", player, definitions.actorSource, 1, 2],
  ["张三刺伤我。", player, definitions.actorSource, 2, 1]
];

for (const [text, speaker, definition, sourceId, targetId] of participantCases) {
  const result = resolve(text, speaker, definition);
  assert.strictEqual(result.mode, "resolved", `${text}: participant mapping should resolve`);
  assert.strictEqual(result.sourceCharacter.id, sourceId, `${text}: unexpected Action source`);
  assert.strictEqual(result.targetCharacter.id, targetId, `${text}: unexpected Action target`);
}

const unresolved = resolve("我杀死了他。", player, definitions.victimSource);
assert.strictEqual(unresolved.mode, "unresolved", "unnamed patient must fail closed");

const resolvedSemantic = ActionEngine.resolveSemanticEvent({ category: "death_or_injury", evidence: { text: "我杀死了张三。" } });
assert.deepStrictEqual(resolvedSemantic, {
  mode: "resolved",
  reasons: ["death_or_injury"],
  allowedActionIds: ["characterIsKilled"],
  evidence: ["metadata_positive_evidence"]
}, "metadata must be the primary semantic resolver");
const goldSemantic = ActionEngine.resolveSemanticEvent({ category: "gold", evidence: { text: "我把50金币交给张三。" } });
assert.strictEqual(goldSemantic.mode, "resolved", "gold actions must resolve from metadata evidence");
const unresolvedSemantic = ActionEngine.resolveSemanticEvent({ category: "death_or_injury", evidence: { text: "发生了一些事情。" } });
assert.strictEqual(unresolvedSemantic.mode, "unresolved", "unmatched state categories must fail closed");
assert(conversationSource.includes("const playerActionResults = await ActionEngine.evaluateForCharacter(this, user, null, userMsg);"), "player actions must be evaluated before NPC generation");
assert(!conversationSource.includes("pendingPlayerActionMessage"), "player actions must not wait for an NPC reply");

const registry = new ActionRegistry();
registry.actions.set("highRisk", { definition: { semantic: { riskLevel: "high" } } });
registry.actions.set("mediumRisk", { definition: { semantic: { riskLevel: "medium" } } });
registry.setDestructiveOverride("highRisk", false);
assert.strictEqual(registry.getEffectiveDestructive("highRisk"), true, "high risk cannot be downgraded by destructive override");
assert.strictEqual(registry.getEffectiveRiskLevel("highRisk"), "high", "high risk must be exposed by registry policy");
assert.strictEqual(registry.getEffectiveDestructive("mediumRisk"), false, "medium risk keeps the existing destructive behavior by default");
assert.strictEqual(registry.shouldRequireApproval("mediumRisk", "non-destructive"), false, "medium risk may proceed in non-destructive mode");
assert.strictEqual(registry.shouldRequireApproval("highRisk", "non-destructive"), true, "high risk must require approval in non-destructive mode");
assert.strictEqual(registry.shouldRequireApproval("mediumRisk", "none"), true, "none mode must require approval for every action");
assert.strictEqual(registry.shouldRequireApproval("highRisk", "all"), false, "all mode must permit every action without approval");

const participantRoleScripts = [
  "z_characterIsKilled.js",
  "z_isInjured.js",
  "z_isImprisonedBy.js",
  "z_isEmployedAsKnightBy.js"
];
for (const file of participantRoleScripts) {
  const action = require(path.join(actionsDir, file));
  assert(action.semantic?.participantRoles, `${file}: participantRoles metadata is required`);
}
for (const file of ["z_isInjured.js", "z_isImprisonedBy.js"]) {
  const action = require(path.join(actionsDir, file));
  registry.actions.set(action.signature, { definition: action });
  assert.strictEqual(registry.getEffectiveDestructive(action.signature), true, `${file}: high risk must enter destructive approval policy`);
}
const highRiskActions = fs.readdirSync(actionsDir).filter((file) => file.endsWith(".js")).map((file) => require(path.join(actionsDir, file))).filter((action) => action.semantic?.riskLevel === "high");
assert(highRiskActions.length > 0, "standard actions must declare high-risk cases");
for (const action of highRiskActions) {
  registry.actions.set(action.signature, { definition: action });
  registry.setDestructiveOverride(action.signature, false);
  assert.strictEqual(registry.getEffectiveDestructive(action.signature), true, `${action.signature}: high risk cannot be downgraded`);
  assert.strictEqual(registry.shouldRequireApproval(action.signature, "non-destructive"), true, `${action.signature}: high risk requires approval`);
}
assert(approvalManagerSource.includes("riskLevel: action.riskLevel"), "approval payload must preserve the resolved risk level");
assert(engineSource.includes("action_participant_resolution"), "participant outcomes must be recorded without message text");

const parserCases = [
  ["我刺向他但他躲开了。", 0],
  ["我刺向他，可他躲开了。", 0],
  ["我杀了他或许这是个错误。", 1],
  ["因为昨天的事情，我今天刺伤了他。", 1],
  ["我昨天发誓报仇，今天终于刺伤了他。", 1],
  ["听说他杀了人，但我现在只是把门关上。", 0],
  ["我没有杀他不过我确实刺伤了他。", 1],
  ["我想杀他，但现在只是离开。", 0],
  ["我杀了第一个人然后又刺伤第二个人。", 2],
  ["我没有杀张三只是刺伤了他。", 1],
  ["张三想刺我但最后没有动手。", 0],
  ["我刺向张三但被他躲开了。", 0],
  ["我试图杀死张三但失败了。", 0],
  ["我差点杀了张三。", 0],
  ["我要杀了你。", 0],
  ["总有一天我会杀了你。", 0],
  ["我杀了他——不，我只是做了个梦。", 0]
];
for (const [text, expectedCount] of parserCases) {
  const parsed = ActionEngine.parseActionEvents(text);
  const stateEvents = parsed.events.filter((event) => event.category === "death_or_injury");
  assert.strictEqual(stateEvents.length, expectedCount, `${text}: unexpected accepted state-action count`);
}
for (const text of ["我准备把张三关起来。", "我把他关起来……至少我本来是这么打算的。"] ) {
  assert.strictEqual(ActionEngine.parseActionEvents(text).events.length, 0, `${text}: plan or posthoc negation must not execute`);
}
const separateEvents = ActionEngine.parseActionEvents("我刺伤张三，然后把李四关进地牢。").events;
assert.deepStrictEqual(separateEvents.map((event) => event.category), ["death_or_injury", "combat", "imprisonment"], "multiple actions must retain independent event categories");
assert(separateEvents[0].evidence.text.includes("刺伤张三") && separateEvents[2].evidence.text.includes("李四关进地牢"), "multiple actions must retain isolated evidence spans");

const originalRegistry = globalThis.actionRegistry;
globalThis.actionRegistry = {
  getAllActions: () => [{
    id: "metadataOnlyAction",
    definition: {
      triggerCategories: ["metadata_only"],
      semantic: { candidatePatterns: [/龙纹机关/] }
    }
  }]
};
assert(ActionEngine.getActionTriggers("龙纹机关已经启动。", { candidateOnly: true }).includes("metadata_only"), "candidate-only Gate must discover metadata-defined action categories");
globalThis.actionRegistry = originalRegistry;

console.log("VOTC v6.6 P0 tests: PASS (participants, approval policy, and parser boundaries)");
