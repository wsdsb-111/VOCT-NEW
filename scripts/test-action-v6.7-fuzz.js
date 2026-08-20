const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ConversationReferenceContext, ReferenceResolver, ParticipantResolver } = require(path.join(root, "resources", "app", "out", "main", "action-system"));

const player = { id: 1, fullName: "玩家", shortName: "玩家", gender: "male" };
const zhangSan = { id: 2, fullName: "张三", shortName: "张三", gender: "male" };
const liSi = { id: 3, fullName: "李四", shortName: "李四", gender: "male" };
const gameData = { characters: new Map([[1, player], [2, zhangSan], [3, liSi]]) };
const injury = { semantic: { evidencePatterns: [/刺伤|刺入|划过/], participantRoles: { source: "actor", target: "patient" } } };

function resolve(text, context) {
  const message = { id: 2, content: text };
  context.observeMessage({ message, speaker: player, characters: gameData.characters.values() });
  const event = { eventId: "evt_2", evidence: { text, start: 0, end: text.length } };
  const references = ReferenceResolver.resolveEventReferences({ message, event, speaker: player, gameData, referenceContext: context });
  return ParticipantResolver.resolve({ event, message, speaker: player, gameData, actionDefinition: injury, actionId: "isInjured", references });
}

let context = new ConversationReferenceContext({ activeParticipantIds: [1, 2] });
context.observeMessage({ message: { id: 1, content: "张三怒视着我，拔出了腰间短剑。" }, speaker: zhangSan, characters: gameData.characters.values() });
let result = resolve("我抢先一步，一剑划过他的手臂。", context);
assert.strictEqual(result.mode, "resolved", "unique RP-style third person must resolve");
assert.strictEqual(result.targetCharacter.id, zhangSan.id, "RP-style third person must retain its antecedent");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 2, 3] });
context.observeMessage({ message: { id: 1, content: "张三与李四并肩冲来。" }, speaker: player, characters: gameData.characters.values() });
result = resolve("我转身刺向他。", context);
assert.strictEqual(result.mode, "unresolved", "ambiguous RP-style third person must not execute");

console.log("VOTC v6.7 fuzz: PASS (short-range RP reference safety)");
