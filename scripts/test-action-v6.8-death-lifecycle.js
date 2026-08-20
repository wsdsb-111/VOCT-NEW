const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.__V67ActionSystem = actionSystem;
const engineStart = source.indexOf("class ActionEngine {");
const engineEnd = source.indexOf("\nclass Conversation {", engineStart);
assert(engineStart >= 0 && engineEnd > engineStart, "Cannot extract ActionEngine");
eval(`${source.slice(engineStart, engineEnd)}\nglobalThis.__V681ActionEngine = ActionEngine;`);
const ActionEngine = globalThis.__V681ActionEngine;
const conversationStart = source.indexOf("class Conversation {");
const conversationEnd = source.indexOf("\nclass ConversationManager {", conversationStart);
assert(conversationStart >= 0 && conversationEnd > conversationStart, "Cannot extract Conversation");
eval(`${source.slice(conversationStart, conversationEnd)}\nglobalThis.__V68Conversation = Conversation;`);
const Conversation = globalThis.__V68Conversation;

const player = { id: 1, fullName: "玩家", shortName: "玩家", gender: "male" };
const deadNpc = { id: 2, fullName: "张三", shortName: "张三", gender: "male" };
const liveNpc = { id: 3, fullName: "李四", shortName: "李四", gender: "male" };
const conversation = {
  id: "death-lifecycle",
  gameData: { playerID: player.id, characters: new Map([[player.id, player], [deadNpc.id, deadNpc], [liveNpc.id, liveNpc]]) },
  inactiveParticipantIds: new Map(),
  npcQueue: [deadNpc, liveNpc],
  messages: [{ id: 1, role: "assistant", name: deadNpc.shortName, content: "张三拔出了剑。" }],
  referenceContext: new actionSystem.ConversationReferenceContext({ activeParticipantIds: [player.id, deadNpc.id, liveNpc.id] })
};
conversation.isCharacterAvailableForConversation = Conversation.prototype.isCharacterAvailableForConversation;
conversation.getActiveConversationCharacters = Conversation.prototype.getActiveConversationCharacters;
conversation.referenceContext.observeMessage({ message: conversation.messages[0], speaker: deadNpc, characters: conversation.gameData.characters.values() });

Conversation.prototype.markParticipantInactive.call(conversation, deadNpc.id, "dead");
assert(!conversation.npcQueue.some((npc) => npc.id === deadNpc.id), "dead participant must be removed from an already-built responder queue");
assert(!conversation.referenceContext.activeParticipantIds.includes(deadNpc.id), "dead participant must leave reference resolution candidates");
assert.deepStrictEqual(Conversation.prototype.getNpcList.call(conversation).map((npc) => npc.id), [liveNpc.id], "only the dead NPC must stop participating");
assert.strictEqual(Conversation.prototype.isCharacterAvailableForConversation.call(conversation, deadNpc), false, "dead NPC must be unavailable");
assert.strictEqual(Conversation.prototype.isCharacterAvailableForConversation.call(conversation, liveNpc), true, "living NPC must remain available");

const explicitDeadMessage = { id: 2, role: "user", content: "我刺伤张三。" };
const rebuiltContext = ActionEngine.getConversationReferenceContext(conversation, explicitDeadMessage, player);
assert.deepStrictEqual(rebuiltContext.activeParticipantIds, [player.id, liveNpc.id], "reference-context rebuild must not re-add a dead participant");
const injury = { semantic: { evidencePatterns: [/刺伤|伤了/], participantRoles: { source: "actor", target: "patient" }, riskLevel: "high" } };
const explicitDeadResult = ActionEngine.resolveEventParticipants({
  event: { eventId: "dead-explicit", evidence: { text: explicitDeadMessage.content, start: 0, end: explicitDeadMessage.content.length } },
  message: explicitDeadMessage,
  speaker: player,
  gameData: conversation.gameData,
  actionDefinition: injury,
  actionId: "isInjured",
  referenceContext: rebuiltContext
});
assert.strictEqual(explicitDeadResult.mode, "unresolved", "a dead character cannot be rebound as a destructive target by explicit name");
assert.strictEqual(explicitDeadResult.reason, "unavailable_reference_target", "dead-target refusal must remain diagnosable");

const pronounMessage = { id: 3, role: "user", content: "我刺伤了他。" };
const pronounContext = ActionEngine.getConversationReferenceContext(conversation, pronounMessage, player);
const pronounResult = ActionEngine.resolveEventParticipants({
  event: { eventId: "dead-pronoun", evidence: { text: pronounMessage.content, start: 0, end: pronounMessage.content.length } },
  message: pronounMessage,
  speaker: player,
  gameData: conversation.gameData,
  actionDefinition: injury,
  actionId: "isInjured",
  referenceContext: pronounContext
});
assert.strictEqual(pronounResult.mode, "resolved", "the sole living interlocutor must remain usable after a death");
assert.strictEqual(pronounResult.targetCharacter.id, liveNpc.id, "third-person fallback must never rebind the dead participant");

(async () => {
let generated = false;
await Conversation.prototype.respondAs.call({
  isCharacterAvailableForConversation: () => false,
  gameData: {},
  messages: [],
  emitUpdate: () => { generated = true; }
}, deadNpc);
assert.strictEqual(generated, false, "pre-generation availability guard must skip a dead queued NPC");
assert(source.includes('conv.markParticipantInactive?.(npc.id, "dead")'), "successful death execution must inactivate the victim");
assert(source.includes('skipReason: "inactive_participant"'), "inactive players and NPCs must not execute further actions");

console.log("VOTC v6.8.1 death lifecycle: PASS (context rebuild, target binding, queue and action guards)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
