const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const conversationStart = source.indexOf("class Conversation {");
const conversationEnd = source.indexOf("\nclass ConversationManager {", conversationStart);
assert(conversationStart >= 0 && conversationEnd > conversationStart, "Cannot extract Conversation");
eval(`${source.slice(conversationStart, conversationEnd)}\nglobalThis.__V68Conversation = Conversation;`);
const Conversation = globalThis.__V68Conversation;

const player = { id: 1, shortName: "玩家" };
const deadNpc = { id: 2, shortName: "张三" };
const liveNpc = { id: 3, shortName: "李四" };
const conversation = {
  gameData: { playerID: player.id, characters: new Map([[player.id, player], [deadNpc.id, deadNpc], [liveNpc.id, liveNpc]]) },
  inactiveParticipantIds: new Map(),
  npcQueue: [deadNpc, liveNpc],
  referenceContext: { activeParticipantIds: [player.id, deadNpc.id, liveNpc.id] }
};
conversation.isCharacterAvailableForConversation = Conversation.prototype.isCharacterAvailableForConversation;

Conversation.prototype.markParticipantInactive.call(conversation, deadNpc.id, "dead");
assert(!conversation.npcQueue.some((npc) => npc.id === deadNpc.id), "dead participant must be removed from an already-built responder queue");
assert(!conversation.referenceContext.activeParticipantIds.includes(deadNpc.id), "dead participant must leave reference resolution candidates");
assert.deepStrictEqual(Conversation.prototype.getNpcList.call(conversation).map((npc) => npc.id), [liveNpc.id], "only the dead NPC must stop participating");
assert.strictEqual(Conversation.prototype.isCharacterAvailableForConversation.call(conversation, deadNpc), false, "dead NPC must be unavailable");
assert.strictEqual(Conversation.prototype.isCharacterAvailableForConversation.call(conversation, liveNpc), true, "living NPC must remain available");

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

console.log("VOTC v6.8 death lifecycle: PASS (dead participant queue and action guards)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
