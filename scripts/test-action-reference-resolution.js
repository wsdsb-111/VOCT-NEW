const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ConversationReferenceContext, ReferenceResolver, ParticipantResolver } = require(path.join(root, "resources", "app", "out", "main", "action-system"));

const player = { id: 1, fullName: "玩家", shortName: "玩家", gender: "male" };
const zhangSan = { id: 2, fullName: "张三", shortName: "张三", gender: "male" };
const liSi = { id: 3, fullName: "李四", shortName: "李四", gender: "male" };
const wangShi = { id: 4, fullName: "王氏", shortName: "王氏", gender: "female" };
const unknownGenderNpc = { id: 5, fullName: "阿史那", shortName: "阿史那" };
const gameData = { characters: new Map([[1, player], [2, zhangSan], [3, liSi], [4, wangShi], [5, unknownGenderNpc]]) };
const injury = { semantic: { evidencePatterns: [/刺伤|伤了/], participantRoles: { source: "actor", target: "patient" }, riskLevel: "high" } };
const knight = { semantic: { evidencePatterns: [/任命.{0,16}骑士|骑士/], participantRoles: { source: "patient", target: "actor" } } };
const opinion = { semantic: { evidencePatterns: [/好感/], participantRoles: { source: "actor", target: "patient" }, riskLevel: "low" } };

function resolveMessage({ text, speaker = player, context, definition = injury, messageId = 2, primaryAddresseeId = null }) {
  const message = { id: messageId, content: text, primaryAddresseeId };
  context.observeMessage({ message, speaker, characters: gameData.characters.values(), primaryAddresseeId });
  const event = { eventId: `evt_${messageId}`, evidence: { text, start: 0, end: text.length } };
  const references = ReferenceResolver.resolveEventReferences({ message, event, speaker, gameData, referenceContext: context, primaryAddresseeId, actionDefinition: definition });
  return { references, result: ParticipantResolver.resolve({ event, message, speaker, gameData, actionDefinition: definition, actionId: "isInjured", references, activeParticipantIds: context.activeParticipantIds }) };
}

let context = new ConversationReferenceContext({ activeParticipantIds: [1, 2, 3, 4] });
let outcome = resolveMessage({ text: "我刺伤张三。", context });
assert.strictEqual(outcome.result.sourceCharacter.id, player.id, "first person must be the message speaker");
assert.strictEqual(outcome.result.targetCharacter.id, zhangSan.id, "explicit name must resolve");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 2, 3] });
outcome = resolveMessage({ text: "我刺伤你。", context, primaryAddresseeId: liSi.id });
assert.strictEqual(outcome.result.mode, "resolved", "multi-party second person with primary addressee must resolve");
assert.strictEqual(outcome.result.targetCharacter.id, liSi.id, "primary addressee must win over roster order");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 2, 3] });
outcome = resolveMessage({ text: "张三，我任命你为骑士。", context, definition: knight });
assert.strictEqual(outcome.result.mode, "resolved", "explicit vocative must resolve in a multi-party conversation");
assert.strictEqual(outcome.result.sourceCharacter.id, zhangSan.id, "knight source must be the appointee");
assert.strictEqual(outcome.result.targetCharacter.id, player.id, "knight target must be the speaker who appointed");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 2] });
context.observeMessage({ message: { id: 1, content: "张三拔出了剑。" }, speaker: zhangSan, characters: gameData.characters.values() });
outcome = resolveMessage({ text: "我刺伤了他。", context });
assert.strictEqual(outcome.result.mode, "resolved", "unique recent third-person mention must resolve");
assert.strictEqual(outcome.result.targetCharacter.id, zhangSan.id, "他 must bind to the unique recent male mention");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 2] });
outcome = resolveMessage({ text: "我刺伤了他。", context });
assert.strictEqual(outcome.result.mode, "resolved", "strict 1v1 third person must resolve without a prior mention");
assert.strictEqual(outcome.result.targetCharacter.id, zhangSan.id, "1v1 他 must bind to the only interlocutor");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 2] });
outcome = resolveMessage({ text: "我刺伤了她。", context });
assert.strictEqual(outcome.result.mode, "unresolved", "1v1 gender mismatch must fail closed");
assert.strictEqual(outcome.references.find((reference) => reference.surface === "她").reason, "unresolved_gender_mismatch", "gender mismatch must preserve an explicit diagnostic");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 4] });
outcome = resolveMessage({ text: "我刺伤了她。", context });
assert.strictEqual(outcome.result.mode, "resolved", "strict female 1v1 third person must resolve");
assert.strictEqual(outcome.result.targetCharacter.id, wangShi.id, "1v1 她 must bind to the only interlocutor");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 5] });
outcome = resolveMessage({ text: "我刺伤了他。", context });
assert.strictEqual(outcome.result.mode, "unresolved", "high-risk action must not guess a gendered pronoun when gender is unknown");
assert.strictEqual(outcome.references.find((reference) => reference.surface === "他").reason, "unknown_gender_high_risk", "unknown-gender high-risk refusal must preserve a diagnostic");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 5] });
outcome = resolveMessage({ text: "我因好感增加而赞赏他。", context, definition: opinion });
assert.strictEqual(outcome.result.mode, "resolved", "low-risk action may use the unique 1v1 interlocutor when gender is unknown");
assert.strictEqual(outcome.result.targetCharacter.id, unknownGenderNpc.id, "low-risk fallback must bind only to the unique interlocutor");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 2, 3] });
context.observeMessage({ message: { id: 1, content: "张三和李四走了进来。" }, speaker: player, characters: gameData.characters.values() });
outcome = resolveMessage({ text: "我刺伤了他。", context });
assert.strictEqual(outcome.result.mode, "unresolved", "ambiguous third person must fail closed");
assert.strictEqual(outcome.references.find((reference) => reference.surface === "他").reason, "ambiguous_third_person", "third-person diagnostic must remain explicit");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 2, 4] });
context.observeMessage({ message: { id: 1, content: "张三和王氏走了进来。" }, speaker: player, characters: gameData.characters.values() });
outcome = resolveMessage({ text: "我刺伤了她。", context });
assert.strictEqual(outcome.result.mode, "resolved", "unique gender evidence must resolve 她");
assert.strictEqual(outcome.result.targetCharacter.id, wangShi.id, "她 must bind to the unique recent female mention");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 2] });
outcome = resolveMessage({ text: "我伤了自己。", context });
assert.strictEqual(outcome.result.mode, "resolved", "speaker reflexive must resolve");
assert.strictEqual(outcome.result.sourceCharacter.id, player.id, "self injury source must be the speaker");
assert.strictEqual(outcome.result.targetCharacter.id, player.id, "self injury target must be the speaker");

console.log("VOTC v6.7 reference resolution: PASS (你/他/她/自己, directed and fail-closed)");
