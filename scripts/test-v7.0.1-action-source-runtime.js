"use strict";

const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { buildCanonicalInvocation } = require(path.join(root, "resources", "app", "out", "main", "action-system", "invocation-validator"));

const characters = new Map([[1, { id: 1 }], [2, { id: 2 }], [3, { id: 3 }]]);
const registry = { getById: (id) => id === "runtimeAction" ? { validation: { valid: true } } : null };
function canonical(sourceCharacterId, targetCharacterId, binding = null) {
  return buildCanonicalInvocation({
    modelInvocation: { actionId: "runtimeAction", targetCharacterId, args: {} },
    availableAction: { signature: "runtimeAction", sourceCharacterId, resolvedTargetCharacterId: targetCharacterId, sourceLocked: !!binding, targetLocked: !!binding, validTargetCharacterIds: [targetCharacterId] },
    binding,
    registry,
    gameData: { characters },
    eventId: "runtime-event",
    traceId: "runtime-trace"
  });
}

for (const [source, target, label] of [[1, 2, "玩家→NPC"], [2, 1, "NPC→玩家"], [2, 3, "NPC→NPC"]]) {
  const result = canonical(source, target);
  assert.strictEqual(result.valid, true, `${label} must receive a canonical invocation`);
  assert.strictEqual(result.invocation.sourceCharacterId, source, `${label} source must come from local available action`);
  assert.strictEqual(result.invocation.targetCharacterId, target, `${label} target must remain locally resolved`);
}
const spoofed = buildCanonicalInvocation({ modelInvocation: { actionId: "runtimeAction", sourceCharacterId: 3, targetCharacterId: 2, args: {} }, availableAction: { signature: "runtimeAction", sourceCharacterId: 1, resolvedTargetCharacterId: 2, validTargetCharacterIds: [2] }, registry, gameData: { characters } });
assert.strictEqual(spoofed.valid, false);
assert.strictEqual(spoofed.reason, "binding_source_mismatch");
console.log("VOTC v7.0.1 action source runtime: PASS (player, NPC, third-party and spoof rejection)");
