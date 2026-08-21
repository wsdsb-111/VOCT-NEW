const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { createParticipantBinding, invocationValidator } = require(path.join(root, "resources", "app", "out", "main", "action-system"));

const player = { id: 1, fullName: "玩家" };
const zhangSan = { id: 2, fullName: "张三" };
const gameData = { characters: new Map([[1, player], [2, zhangSan]]) };
const binding = createParticipantBinding({
  messageId: 7,
  eventId: "evt_1",
  actionId: "isInjured",
  speakerCharacterId: player.id,
  actorCharacterId: player.id,
  patientCharacterId: zhangSan.id,
  sourceCharacterId: player.id,
  targetCharacterId: zhangSan.id,
  resolutionBasis: ["first_person=speaker", "explicit_name", "active_voice"]
});
const loaded = { id: "isInjured", validation: { valid: true }, definition: { signature: "isInjured" } };
const registry = { getById: (id) => id === "isInjured" ? loaded : null };
const availableAction = {
  signature: "isInjured",
  sourceCharacterId: player.id,
  resolvedTargetCharacterId: zhangSan.id,
  validTargetCharacterIds: [zhangSan.id],
  targetLocked: true
};

assert(Object.isFrozen(binding), "ParticipantBinding must be immutable");
assert(Object.isFrozen(binding.references), "ParticipantBinding references must be immutable");
const rejectedMismatch = invocationValidator.validateInvocation({
  modelInvocation: { actionId: "isInjured", targetCharacterId: 999, args: { injuryType: "wounded" } },
  availableAction,
  binding,
  registry,
  gameData
});
assert.strictEqual(rejectedMismatch.valid, false, "a model target that conflicts with a locked binding must be rejected");
assert.strictEqual(rejectedMismatch.reason, "binding_target_mismatch");
const validated = invocationValidator.validateInvocation({
  modelInvocation: { actionId: "isInjured", targetCharacterId: zhangSan.id, args: { injuryType: "wounded" } },
  availableAction,
  binding,
  registry,
  gameData
});
assert.strictEqual(validated.valid, true, "a known action with binding must validate");
assert.strictEqual(validated.invocation.sourceCharacterId, player.id, "binding source must be preserved");
assert.strictEqual(validated.invocation.targetCharacterId, zhangSan.id, "validated target must preserve binding");
assert.strictEqual(validated.invocation.bindingId, binding.bindingId, "invocation must retain binding identity");

assert.strictEqual(invocationValidator.validateInvocation({
  modelInvocation: { actionId: "characterIsKilled", args: {} },
  availableAction,
  binding,
  registry,
  gameData
}).valid, false, "actions outside the semantic allowlist must be rejected");

console.log("VOTC v6.7 participant binding: PASS (immutable source/target contract)");
