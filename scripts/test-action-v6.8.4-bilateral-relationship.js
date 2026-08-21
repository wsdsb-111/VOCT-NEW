"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.__V67ActionSystem = actionSystem;
const actionFiles = [
  "z_intercourse.js",
  "z_becomeSoulmatesWith.js",
  "z_becomeLoversWith.js",
  "z_becomeFriendsWith.js",
  "z_becomeBestFriendsWith.js",
  "z_becomeBloodBrothersWith.js",
  "z_becomeRivalsWith.js",
  "z_becomeNemesisWith.js",
  "z_agreedToTruceWith.js",
  "z_makeAlliance.js"
];
const definitions = actionFiles.map((file) => require(path.join(actionsDir, file)));
for (const definition of definitions) {
  assert.strictEqual(definition.semantic?.bilateralPersistentEffect, true, `${definition.signature}: bilateral contract marker is required`);
  assert.deepStrictEqual(definition.semantic?.participantRoles, { source: "actor", target: "patient" }, `${definition.signature}: actor/patient roles are required`);
}
globalThis.__V684ActionRegistry = actionSystem.ActionRegistry;
const invalidBilateral = { ...definitions[0], semantic: { ...definitions[0].semantic } };
delete invalidBilateral.semantic.participantRoles;
assert.strictEqual(globalThis.__V684ActionRegistry.prototype.validateCandidate.call({}, invalidBilateral).valid, false, "registry must reject bilateral metadata without participantRoles");
globalThis.actionRegistry = { getAllActions: () => definitions.map((definition) => ({ id: definition.signature, definition })) };
const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();
for (const text of [
  "B向C表白，说自己深爱着她。",
  "B说愿与C成为恋人。",
  "B抱住C，轻轻亲吻了她。",
  "B与C久久对视，随后亲吻了彼此。"
]) {
  const selected = ActionEngine.getSemanticActionProfile(text).allowedActionIds;
  assert(!selected.includes("becomeLoversWith") && !selected.includes("becomeSoulmatesWith"), `${text}: RP contact/proposal must not persist a romantic relation`);
}
assert.deepStrictEqual(ActionEngine.getSemanticActionProfile("B与C正式成为了恋人。").allowedActionIds, ["becomeLoversWith"]);
assert.deepStrictEqual(ActionEngine.getSemanticActionProfile("B与C正式结为了灵魂伴侣。").allowedActionIds, ["becomeSoulmatesWith"]);
const player = { id: 1, fullName: "玩家A", shortName: "玩家A", gender: "male", relationsToCharacters: [] };
const npcB = { id: 2, fullName: "NPCB", shortName: "NPCB", gender: "male", relationsToCharacters: [] };
const npcC = { id: 3, fullName: "NPCC", shortName: "NPCC", gender: "female", relationsToCharacters: [] };
const gameData = { playerID: 1, playerName: player.fullName, characters: new Map([[1, player], [2, npcB], [3, npcC]]) };
const message = { id: 84, role: "assistant", name: npcB.fullName, content: "NPCC，我与你已经正式成为恋人了。", primaryAddresseeId: npcC.id };
const event = ActionEngine.getSemanticActionProfile(message.content).events.find((item) => item.allowedActionIds.includes("becomeLoversWith"));
const context = new actionSystem.ConversationReferenceContext({ activeParticipantIds: [1, 2, 3], primaryAddresseeId: npcC.id });
context.observeMessage({ message, speaker: npcB, characters: gameData.characters.values(), primaryAddresseeId: npcC.id });
const references = actionSystem.ReferenceResolver.resolveEventReferences({ message, event, speaker: npcB, gameData, referenceContext: context, primaryAddresseeId: npcC.id, actionDefinition: definitions.find((definition) => definition.signature === "becomeLoversWith") });
const bindingResult = actionSystem.ParticipantResolver.resolve({ event, message, speaker: npcB, gameData, actionDefinition: definitions.find((definition) => definition.signature === "becomeLoversWith"), actionId: "becomeLoversWith", references, activeParticipantIds: [1, 2, 3] });
assert.strictEqual(bindingResult.mode, "resolved", "B-C completed relation must resolve in a three-person conversation");
assert.deepStrictEqual([bindingResult.sourceCharacter.id, bindingResult.targetCharacter.id], [npcB.id, npcC.id]);
const available = actionSystem.availabilityService.buildAvailableAction({
  action: { id: "becomeLoversWith" },
  args: [],
  checkResult: { canExecute: true, validTargetCharacterIds: [player.id, npcC.id] },
  sourceCharacter: npcB,
  targetCharacter: npcC,
  description: "completed lover transition",
  binding: bindingResult.binding
});
assert.strictEqual(available.sourceLocked, true);
assert.strictEqual(available.targetLocked, true);
assert.deepStrictEqual(available.validTargetCharacterIds, [npcC.id], "player A must be removed from the locked target set");
const loaded = { id: "becomeLoversWith", definition: definitions.find((definition) => definition.signature === "becomeLoversWith"), validation: { valid: true } };
const rejected = actionSystem.invocationValidator.validateInvocation({
  modelInvocation: { actionId: "becomeLoversWith", targetCharacterId: player.id, args: {} },
  availableAction: available,
  binding: bindingResult.binding,
  registry: { getById: () => loaded },
  gameData
});
assert.strictEqual(rejected.reason, "binding_target_mismatch", "a model-selected player target must be explicitly rejected");
let effectScope = null;
loaded.definition.run({ gameData, sourceCharacter: npcB, targetCharacter: npcC, args: {}, lang: "zh", dryRun: false, runGameEffect: (effectBody) => { effectScope = { sourceId: npcB.id, targetId: npcC.id, effectBody }; } });
assert.deepStrictEqual([effectScope.sourceId, effectScope.targetId], [npcB.id, npcC.id]);
assert.strictEqual(player.relationsToCharacters.length, 0, "player A relations must remain unchanged");
assert(npcB.relationsToCharacters.some((entry) => entry.id === npcC.id));
assert(npcC.relationsToCharacters.some((entry) => entry.id === npcB.id));
console.log("VOTC v6.8.4 bilateral relationship: PASS (explicit transitions, three-person locks and B-C-only effects)");
