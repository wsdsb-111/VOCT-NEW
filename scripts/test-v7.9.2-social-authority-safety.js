"use strict";

const assert = require("assert");
const social = require("../resources/app/out/main/action-system/social");

const participants = [
  { id: 1, name: "玩家", isPlayer: true },
  { id: 2, name: "甲", isPlayer: false }
];

function makeContext(text, options = {}) {
  const dialogue = social.createEvidence({
    evidenceId: `dialogue:${options.messageId || 1}`,
    type: "dialogue",
    sourceMessageId: options.messageId || 1,
    actorId: 2,
    targetId: 1,
    content: text,
    worldStateConfirmed: false
  });
  const confirmed = options.confirmed || [];
  const evidence = [dialogue, ...confirmed];
  return {
    conversationId: "authority-test",
    turnEpoch: 1,
    message: { id: options.messageId || 1, role: "assistant", name: "甲", content: text, actorId: 2, targetId: 1 },
    dialogueEvidence: [dialogue],
    confirmedWorldEvents: confirmed,
    memoryEvidence: [],
    gameFacts: [],
    directParticipants: participants,
    observerParticipants: [],
    relationshipStates: options.relationshipStates || [],
    opinionStates: options.opinionStates || [],
    knowledgeMap: Object.fromEntries(participants.map((participant) => [participant.id, Object.fromEntries(evidence.map((item) => [item.evidenceId, { known: options.unknownFor === participant.id ? false : true }]))])),
    recentDialogue: [],
    recentConsequences: []
  };
}

function validate(context, input) {
  return social.consequenceValidator.validate({
    consequence: social.createConsequence({
      consequenceId: "authority",
      directParticipants: { actorId: 2, targetId: 1 },
      ...input
    }),
    context
  });
}

const dialogueClaim = makeContext("我已经杀了你父亲。", { messageId: 10 });
const forgedCluster = validate(dialogueClaim, {
  opinionChanges: [{ sourceCharacterId: 2, targetCharacterId: 1, delta: -10, confidence: 1, reason: "模型伪造标签", reasonCluster: "praise", evidenceId: "dialogue:10" }]
});
assert.strictEqual(forgedCluster.valid, false, "changing reasonCluster must not bypass local world authority");
assert(forgedCluster.rejected.some((entry) => entry.reason === "world_authority_required"));

const unknownEvidence = validate(dialogueClaim, {
  opinionChanges: [{ sourceCharacterId: 2, targetCharacterId: 1, delta: -2, confidence: 1, reason: "不存在证据", reasonCluster: "insult", evidenceId: "missing:evidence" }]
});
assert(unknownEvidence.rejected.some((entry) => entry.reason === "unknown_evidence"));

const unknownCharacter = validate(dialogueClaim, {
  opinionChanges: [{ sourceCharacterId: 999, targetCharacterId: 1, delta: -2, confidence: 1, reason: "未知人物", reasonCluster: "insult", evidenceId: "dialogue:10" }]
});
assert(unknownCharacter.rejected.some((entry) => entry.reason === "invalid_participants"));

const kissContext = makeContext("我亲吻了你，你也欣然回吻。", { messageId: 11 });
const kissToLover = validate(kissContext, {
  relationshipTransition: { actionId: "becomeLoversWith", sourceCharacterId: 2, targetCharacterId: 1, confidence: 1, reason: "普通亲吻", reasonCluster: "romance", evidenceId: "dialogue:11" }
});
assert.strictEqual(kissToLover.valid, false, "a kiss must not create Lover");
assert(kissToLover.rejected.some((entry) => entry.reason === "lover_evidence_required"));

const highOpinionContext = makeContext("我对你评价很高。", { messageId: 12, opinionStates: [{ sourceCharacterId: 2, targetCharacterId: 1, value: 100 }] });
const highOpinionFriend = validate(highOpinionContext, {
  relationshipTransition: { actionId: "becomeFriendsWith", sourceCharacterId: 2, targetCharacterId: 1, confidence: 1, reason: "高好感", reasonCluster: "friendship", evidenceId: "dialogue:12" }
});
assert.strictEqual(highOpinionFriend.valid, false, "high Opinion must not create Friend");

const confirmedHarm = social.createEvidence({
  evidenceId: "confirmed:harm-1",
  type: "confirmed_world_event",
  sourceEventId: "harm-1",
  actorId: 1,
  targetId: 2,
  actionId: "isInjured",
  content: "isInjured",
  worldStateConfirmed: true
});
const neutralNemesisContext = makeContext("我要报仇，与你不共戴天。", { messageId: 13, confirmed: [confirmedHarm] });
const neutralNemesis = validate(neutralNemesisContext, {
  relationshipTransition: { actionId: "becomeNemesisWith", sourceCharacterId: 2, targetCharacterId: 1, confidence: 1, reason: "严重伤害", reasonCluster: "hostility", evidenceId: confirmedHarm.evidenceId }
});
assert.strictEqual(neutralNemesis.valid, false, "Neutral must not jump directly to Nemesis");

const rivalContext = makeContext("我们从此就是朋友。", {
  messageId: 14,
  relationshipStates: [{ sourceCharacterId: 2, targetCharacterId: 1, relations: ["仇敌"] }]
});
const rivalToFriend = validate(rivalContext, {
  relationshipTransition: { actionId: "becomeFriendsWith", sourceCharacterId: 2, targetCharacterId: 1, confidence: 1, reason: "一次友善", reasonCluster: "friendship", evidenceId: "dialogue:14" }
});
assert.strictEqual(rivalToFriend.valid, false);
assert(rivalToFriend.rejected.some((entry) => entry.reason === "requires_reconciliation"));

const hostileContext = makeContext("你重伤了我，我恨你，我一定要报仇。", { messageId: 15, confirmed: [confirmedHarm] });
const gate = social.socialConsequenceGate.evaluate(hostileContext);
const hostileConsequence = social.localConsequenceResolver.resolve(hostileContext, gate);
assert.strictEqual(hostileConsequence.relationshipTransition.actionId, "becomeRivalsWith");
assert.strictEqual(hostileConsequence.relationshipTransition.evidenceId, confirmedHarm.evidenceId);
assert(hostileConsequence.relationshipTransition.confidence >= 0.88, "hostile confidence must be independent of relationship_statement");
assert.strictEqual(validate(hostileContext, hostileConsequence).valid, true, "confirmed severe harm plus revenge must establish Rival without relationship_statement");

const rivalHarmContext = makeContext("血债血偿，我定要报仇。", {
  messageId: 16,
  confirmed: [{ ...confirmedHarm, evidenceId: "confirmed:harm-2", sourceEventId: "harm-2" }],
  relationshipStates: [{ sourceCharacterId: 2, targetCharacterId: 1, relations: ["仇敌"] }]
});
const nemesisGate = social.socialConsequenceGate.evaluate(rivalHarmContext);
const nemesisConsequence = social.localConsequenceResolver.resolve(rivalHarmContext, nemesisGate);
assert.strictEqual(nemesisConsequence.relationshipTransition.actionId, "becomeNemesisWith");
assert.strictEqual(validate(rivalHarmContext, nemesisConsequence).valid, true, "Rival plus a new confirmed severe event and revenge may become Nemesis");

console.log("VOTC v7.9.2 social evidence authority and relationship safety: PASS");
