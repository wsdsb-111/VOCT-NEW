"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const social = require(path.join(root, "resources", "app", "out", "main", "action-system", "social"));

function createConversation() {
  const player = { id: 1, shortName: "李思昭", fullName: "李思昭", relationsToCharacters: [], opinions: [] };
  const npc = { id: 2, shortName: "李思念", fullName: "李思念", relationsToCharacters: [], opinions: [] };
  return {
    id: "scene-1",
    turnEpoch: 3,
    messages: [{ id: 10, role: "user", name: player.fullName, content: "我要杀了你父亲！" }],
    gameData: { playerID: 1, playerName: player.fullName, characters: new Map([[1, player], [2, npc]]) },
    getActiveConversationCharacters() { return [...this.gameData.characters.values()]; }
  };
}

const conversation = createConversation();
let estimateCalls = 0;
const memoryContext = {
  turnRecall: [
    { memoryId: "m1", content: "李思念记得李思昭曾经救过自己。" },
    { memoryId: "m2", content: "这条过长证据不应越过预算。" }
  ],
  stableMemories: [{ memoryId: "stable", content: "不应整块复制的稳定记忆。" }]
};

social.socialContextProvider.captureMemoryEvidence({
  conversation,
  messageId: 11,
  characterId: 2,
  memoryContext,
  estimateTokens: (text) => {
    estimateCalls++;
    return text.includes("过长") ? 300 : 18;
  }
});

const npcMessage = { id: 11, role: "assistant", name: "李思念", content: "我记得此恩。" };
conversation.messages.push(npcMessage);
const context = social.socialContextProvider.buildContext({ conversation, message: npcMessage, confirmedEvents: [] });

assert.strictEqual(estimateCalls, 2, "capture must budget supplied recall entries without querying Memory Engine");
assert.strictEqual(context.memoryEvidence.length, 1, "memory evidence must stop before the 256-token cap");
assert.strictEqual(context.memoryEvidence[0].type, "memory");
assert.strictEqual(context.memoryEvidence[0].worldStateConfirmed, false, "recalled prose is knowledge evidence, not a world fact");
assert.strictEqual(context.dialogueEvidence.length, 1);
assert.strictEqual(context.dialogueEvidence[0].worldStateConfirmed, false, "dialogue claims do not confirm world state");
assert.deepStrictEqual(context.confirmedWorldEvents, []);
assert(Object.isFrozen(context.memoryEvidence[0]), "evidence snapshots must be immutable");
assert.strictEqual(conversation.temporarySocialEvidenceStore instanceof Map, true);

const failed = { actionId: "characterIsKilled", success: false, effectWritten: false, eventId: "evt-failed", sourceCharacterId: 1, targetCharacterId: 2 };
const dry = { actionId: "characterIsKilled", success: true, effectWritten: false, eventId: "evt-dry", sourceCharacterId: 1, targetCharacterId: 2 };
const succeeded = { actionId: "characterIsKilled", success: true, effectWritten: true, eventId: "evt-success", sourceCharacterId: 1, targetCharacterId: 2 };
const confirmed = social.socialContextProvider.buildContext({ conversation, message: npcMessage, confirmedEvents: [failed, dry, succeeded] });
assert.strictEqual(confirmed.confirmedWorldEvents.length, 1, "only a successful written effect is a confirmed event");
assert.strictEqual(confirmed.confirmedWorldEvents[0].sourceEventId, "evt-success");
assert.strictEqual(confirmed.confirmedWorldEvents[0].worldStateConfirmed, true);

social.socialContextProvider.releaseMessageEvidence(conversation, npcMessage.id, { force: true });
assert.strictEqual(conversation.temporarySocialEvidenceStore.has(npcMessage.id), false);

const evidence = social.createEvidence({ evidenceId: "e1", type: "dialogue", content: "x" });
assert(Object.isFrozen(evidence));
assert.throws(() => social.createEvidence({ evidenceId: "e2", type: "invented", content: "x" }), /invalid_evidence_type/);
assert.strictEqual(social.LIMITS.memoryTokens, 256);

console.log("VOTC v7.9.2 social context boundary: PASS");
