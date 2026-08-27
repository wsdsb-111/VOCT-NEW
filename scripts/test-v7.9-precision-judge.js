"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.__V67ActionSystem = actionSystem;
const judge = actionSystem.semantic.precisionActionJudge;

assert.strictEqual(judge.isEligibleMessage({ role: "system", content: "x" }), false);
assert.strictEqual(judge.isEligibleMessage({ role: "assistant", type: "summary", content: "x" }), false);
assert.strictEqual(judge.isEligibleMessage({ role: "user", content: "x" }), true);
const directCatalog = { entries: [{ actionId: "makeAlliance", risk: "high" }, { actionId: "characterIsKilled", risk: "high" }, { actionId: "isInjured", risk: "high" }, { actionId: "changeOpinionOf", risk: "low" }, { actionId: "setEmotion", risk: "low" }] };
assert.strictEqual(judge.parseResult({ content: '{"occurrence":"completed_action","actionId":"makeAlliance","confidence":0.94}' }, directCatalog, [], 1).executable, false);
assert.strictEqual(judge.parseResult({ content: '{"occurrence":"completed_action","actionId":"makeAlliance","confidence":0.95}' }, directCatalog, [], 1).executable, true);
assert.strictEqual(judge.parseResult({ content: '{"occurrence":"completed_action","actionId":"setEmotion","confidence":0.89}' }, directCatalog, [], 1).executable, false);
for (const occurrence of ["requested_execution", "planned_action", "reported_past_action", "hypothetical", "failed_attempt", "ambiguous"]) {
  const result = judge.parseResult({ content: JSON.stringify({ occurrence, actionId: "characterIsKilled", confidence: 0.99 }) }, directCatalog, [], 1);
  assert.strictEqual(result.executable, false, `${occurrence} must never execute even at high confidence`);
}
assert.strictEqual(judge.parseResult({ content: '{"occurrence":"ambiguous","actionId":"isInjured","confidence":0.99}' }, directCatalog, [], 1).executable, false, "an attack without injury evidence must not infer injury");
assert.strictEqual(judge.parseResult({ content: '{"occurrence":"none","actionId":"changeOpinionOf","confidence":0.99}' }, directCatalog, [], 1).executable, false, "visible emotion alone must not infer opinion change");

const opinionDefinition = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_changeOpinionOf.js"));
const allianceDefinition = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_makeAlliance.js"));
const actions = [
  { id: "changeOpinionOf", definition: opinionDefinition, validation: { valid: true }, filePath: "z_changeOpinionOf.js" },
  { id: "makeAlliance", definition: allianceDefinition, validation: { valid: true }, filePath: "z_makeAlliance.js" }
];
const player = { id: 1, shortName: "李思昭", fullName: "李思昭", isRuler: true };
const npc = { id: 2, shortName: "李思念", fullName: "李思念", isRuler: true };
const gameData = { playerID: 1, playerName: player.fullName, characters: new Map([[1, player], [2, npc]]) };
const calls = [];
const analytics = [];
const effects = [];
let currentMode = "precision";

globalThis.actionRegistry = {
  getAllActions: () => actions,
  getActionIdsForCategories: (categories) => new Set(actions.filter((action) => action.definition.triggerCategories.some((category) => categories.includes(category))).map((action) => action.id)),
  getById: (id) => actions.find((action) => action.id === id) || null,
  isActionDisabled: () => false,
  registerValidation() {},
  getEffectiveRiskLevel: (id) => id === "makeAlliance" ? "high" : "low",
  getEffectiveDestructive: (id) => id === "makeAlliance",
  hasDestructiveOverride: () => false,
  shouldRequireApproval: () => false
};
globalThis.settingsRepository = {
  getLanguage: () => "zh",
  getActionSystemMode: () => currentMode,
  getActionApprovalSettings: () => ({ approvalMode: "never" }),
  getActionsProviderConfig: () => ({ useMinimizedActionsSchema: true })
};
globalThis.usageAnalytics = { record: (entry) => analytics.push(entry) };
globalThis.llmManager = {
  sendActionsRequest: async (messages, requestId) => {
    calls.push(requestId);
    if (requestId === "votc_actions") return { content: '{"actions":[{"actionId":"changeOpinionOf","targetCharacterId":2,"args":{"value":7}}]}' };
    if (requestId === "votc_action_semantic_rescue") return { content: '{"matched":true,"actionId":"changeOpinionOf","confidence":0.91}' };
    const current = JSON.parse(messages[messages.length - 1].content).currentMessage;
    if (current.includes("喜欢你") || current.includes("天气不错")) return { content: '{"occurrence":"none","actionId":null,"confidence":0.99,"evidence":null}' };
    if (current.includes("军事盟约")) return { content: '{"occurrence":"proposal","candidateActionId":"makeAlliance","confidence":0.97,"evidence":"建立军事盟约"}' };
    if (current.includes("甚合我意")) return { content: '{"occurrence":"accepted_pending_commitment","pendingId":"pending_1","actionId":"makeAlliance","confidence":0.97,"evidence":"此议甚合我意"}' };
    return { content: '{"occurrence":"completed_action","actionId":"changeOpinionOf","confidence":0.91,"evidence":"我对李思念另眼相看"}' };
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
globalThis.ActionSandbox = { executeAction: async (filePath, context) => filePath.includes("makeAlliance") ? allianceDefinition.run(context) : opinionDefinition.run(context) };
globalThis.ActionEffectWriter = { writeEffect: (_gameData, sourceId, targetId, body) => effects.push({ sourceId, targetId, body }) };

const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();
function conversation(id) {
  return {
    id,
    turnEpoch: 1,
    gameData,
    messages: [],
    actionGateProcessedTriggers: new Set(),
    processedActionEventIds: new Set(),
    inactiveParticipantIds: new Set(),
    getActiveConversationCharacters: () => [player, npc],
    getHistory() { return this.messages; }
  };
}

(async () => {
  const ordinary = conversation("ordinary");
  const ordinaryMessage = { id: "ordinary", role: "user", name: player.fullName, content: "李思念，我喜欢你。" };
  ordinary.messages.push(ordinaryMessage);
  const ordinaryResult = await ActionEngine.evaluateForCharacter(ordinary, player, null, ordinaryMessage);
  assert.deepStrictEqual(ordinaryResult, { autoApproved: [], needsApproval: [] });
  assert.strictEqual(effects.length, 0, "Stage A none must stop before Stage B");

  const completed = conversation("completed");
  const completedMessage = { id: "completed", role: "user", name: player.fullName, content: "从今日起，我对李思念另眼相看。" };
  completed.messages.push(completedMessage);
  const completedResult = await ActionEngine.evaluateForCharacter(completed, player, null, completedMessage);
  assert.strictEqual(completedResult.autoApproved.length, 1);
  assert.deepStrictEqual(calls.slice(-2), ["votc_action_precision_judge", "votc_actions"], "Stage B must run only after Stage A identifies one exact action");
  assert.strictEqual(effects.length, 1);

  const pending = conversation("pending");
  const proposal = { id: "proposal", role: "user", name: player.fullName, content: "李思念，我提议与你建立军事盟约。" };
  pending.messages.push(proposal);
  const proposalResult = await ActionEngine.evaluateForCharacter(pending, player, null, proposal);
  assert.deepStrictEqual(proposalResult, { autoApproved: [], needsApproval: [] });
  assert.strictEqual([...pending.pendingActionIntentStore.items.values()][0].status, "awaiting_response");
  pending.turnEpoch++;
  const reply = { id: "reply", role: "assistant", name: npc.fullName, content: "此议甚合我意。" };
  pending.messages.push(reply);
  const accepted = await ActionEngine.evaluateForCharacter(pending, npc, null, reply);
  assert.strictEqual(accepted.autoApproved.length, 1, "Stage A may confirm a valid bilateral pending commitment");
  assert.strictEqual(effects.length, 2);
  assert.deepStrictEqual([effects[1].sourceId, effects[1].targetId], [player.id, npc.id]);
  assert.strictEqual(calls.filter((id) => id === "votc_actions").length, 1, "pending confirmation fast path must not call Stage B");

  assert(analytics.some((entry) => entry.metric === "precisionJudgeCalls"));
  assert(analytics.some((entry) => entry.metric === "stageAActionDetected"));
  assert(analytics.some((entry) => entry.metric === "stageAProposal"));
  assert(analytics.some((entry) => entry.metric === "stageBProviderCalls"));

  async function benchmarkMode(mode) {
    currentMode = mode;
    const beforeCalls = calls.length;
    const beforeEffects = effects.length;
    const conv = conversation(`benchmark-${mode}`);
    const ordinaryBenchmark = { id: `${mode}:ordinary`, role: "user", name: player.fullName, content: "今日天气不错。" };
    conv.messages.push(ordinaryBenchmark);
    await ActionEngine.evaluateForCharacter(conv, player, null, ordinaryBenchmark);
    conv.turnEpoch++;
    const implicitBenchmark = { id: `${mode}:implicit`, role: "user", name: player.fullName, content: "我对李思念刮目相看。" };
    conv.messages.push(implicitBenchmark);
    await ActionEngine.evaluateForCharacter(conv, player, null, implicitBenchmark);
    return { actionApiCalls: calls.length - beforeCalls, executed: effects.length - beforeEffects };
  }
  const benchmark = {
    balanced: await benchmarkMode("balanced"),
    performance: await benchmarkMode("performance"),
    precision: await benchmarkMode("precision")
  };
  assert.deepStrictEqual(benchmark.balanced, { actionApiCalls: 0, executed: 0 });
  assert.deepStrictEqual(benchmark.performance, { actionApiCalls: 2, executed: 1 });
  assert.deepStrictEqual(benchmark.precision, { actionApiCalls: 3, executed: 1 });
  assert(benchmark.performance.actionApiCalls < benchmark.precision.actionApiCalls, "the same corpus and provider must use fewer Action API calls in performance mode than precision mode");
  console.log("VOTC v7.9 precision Stage A/Stage B: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
