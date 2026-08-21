const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { createParticipantBinding, invocationValidator, actionExecutor, riskPolicy } = require(path.join(root, "resources", "app", "out", "main", "action-system"));

const player = { id: 1, fullName: "玩家" };
const zhangSan = { id: 2, fullName: "张三" };
const gameData = { characters: new Map([[1, player], [2, zhangSan]]) };
const loaded = { id: "isInjured", validation: { valid: true }, definition: { semantic: { riskLevel: "high" } } };
const binding = createParticipantBinding({
  messageId: 9,
  eventId: "evt_1",
  actionId: "isInjured",
  speakerCharacterId: player.id,
  actorCharacterId: player.id,
  patientCharacterId: zhangSan.id,
  sourceCharacterId: player.id,
  targetCharacterId: zhangSan.id
});
const availableAction = { signature: "isInjured", sourceCharacterId: player.id, sourceLocked: true, resolvedTargetCharacterId: zhangSan.id, targetLocked: true, validTargetCharacterIds: [zhangSan.id] };
const rejected = invocationValidator.validateInvocation({
  modelInvocation: { actionId: "isInjured", targetCharacterId: player.id, args: {} },
  availableAction,
  binding,
  registry: { getById: () => loaded },
  gameData
});
assert.strictEqual(rejected.reason, "binding_target_mismatch", "incorrect model target must be rejected");
const validated = invocationValidator.validateInvocation({
  modelInvocation: { actionId: "isInjured", targetCharacterId: zhangSan.id, args: {} },
  availableAction,
  binding,
  registry: { getById: () => loaded },
  gameData
});
assert(validated.valid, "bound invocation must validate");
assert.strictEqual(validated.invocation.targetCharacterId, zhangSan.id, "runtime must preserve the locked target");
assert.strictEqual(riskPolicy.requiresApproval(loaded, {}, "non-destructive"), true, "high-risk binding must still require approval");

const effects = [];
actionExecutor.execute({
  actionSandbox: {
    executeAction: async (_filePath, context) => {
      context.runGameEffect("runtime_effect");
      return null;
    }
  },
  effectWriter: { writeEffect: (_data, sourceId, targetId, effect) => effects.push({ sourceId, targetId, effect }) },
  filePath: "runtime-test",
  gameData,
  sourceCharacter: gameData.characters.get(validated.invocation.sourceCharacterId),
  targetCharacter: gameData.characters.get(validated.invocation.targetCharacterId),
  args: validated.invocation.args,
  conversation: {},
  dryRun: false,
  lang: "zh"
}).then(() => {
  assert.deepStrictEqual(effects, [{ sourceId: player.id, targetId: zhangSan.id, effect: "runtime_effect" }], "executor must use the immutable binding scope");
  console.log("VOTC v6.7 runtime: PASS (validator, risk policy, and executor binding)");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
