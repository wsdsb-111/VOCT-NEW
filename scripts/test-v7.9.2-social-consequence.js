"use strict";

const assert = require("assert");
const social = require("../resources/app/out/main/action-system/social");

function participant(id, name) {
  return { id, name, isPlayer: id === 1 };
}

function makeContext(text, options = {}) {
  const actorId = options.actorId ?? 2;
  const targetId = Object.prototype.hasOwnProperty.call(options, "targetId") ? options.targetId : 1;
  const evidenceId = `dialogue:${options.messageId ?? 1}`;
  const participants = options.participants || [participant(1, "玩家"), participant(2, "李思念")];
  const confirmedWorldEvents = options.confirmedWorldEvents || [];
  const knowledgeMap = options.knowledgeMap || Object.fromEntries(participants.map((item) => [item.id, {
    [evidenceId]: { known: true, basis: "current_dialogue" },
    ...Object.fromEntries(confirmedWorldEvents.map((event) => [event.evidenceId, { known: true, basis: "direct_witness" }]))
  }]));
  return {
    conversationId: "conversation-1",
    turnEpoch: 1,
    message: {
      id: options.messageId ?? 1,
      role: actorId === 1 ? "user" : "assistant",
      name: participants.find((item) => item.id === actorId)?.name || null,
      content: text,
      actorId,
      targetId
    },
    dialogueEvidence: [{
      evidenceId,
      type: "dialogue",
      sourceMessageId: options.messageId ?? 1,
      actorId,
      targetId,
      content: text,
      confidence: 1,
      worldStateConfirmed: false
    }],
    confirmedWorldEvents,
    memoryEvidence: [],
    gameFacts: [],
    directParticipants: participants,
    observerParticipants: [],
    relationshipStates: options.relationshipStates || [],
    opinionStates: [],
    knowledgeMap,
    recentDialogue: [],
    recentConsequences: []
  };
}

function resolve(text, options) {
  const context = makeContext(text, options);
  const gateResult = social.socialConsequenceGate.evaluate(context);
  return { context, gateResult, consequence: social.localConsequenceResolver.resolve(context, gateResult) };
}

assert(social.socialConsequenceGate, "social consequence gate must be exported");
assert(social.localConsequenceResolver, "local consequence resolver must be exported");

const rescueEvent = {
  evidenceId: "confirmed:rescue-1",
  type: "confirmed_world_event",
  sourceMessageId: 1,
  sourceEventId: "rescue-1",
  actorId: 1,
  targetId: 2,
  content: "rescue",
  confidence: 1,
  worldStateConfirmed: true
};

const cases = [
  { text: "多谢你救我性命，此恩我绝不会忘。", actorId: 2, targetId: 1, delta: 5, source: 2, target: 1, confirmedWorldEvents: [rescueEvent] },
  { text: "你这个卑鄙小人！", actorId: 1, targetId: 2, delta: -2, source: 2, target: 1 },
  { text: "我要杀了你父亲！", actorId: 1, targetId: 2, delta: -3, source: 2, target: 1 },
  { text: "我已经把你父亲杀了。", actorId: 1, targetId: 2, delta: -2, source: 2, target: 1 },
  { text: "我主动吻了你，你也欣然回应。", actorId: 2, targetId: 1, delta: 2, source: 2, target: 1 }
];

for (const fixture of cases) {
  const result = resolve(fixture.text, fixture);
  assert.strictEqual(result.gateResult.eligible, true, fixture.text);
  assert.strictEqual(result.consequence.opinionChanges.length, 1, fixture.text);
  assert.deepStrictEqual(
    {
      sourceCharacterId: result.consequence.opinionChanges[0].sourceCharacterId,
      targetCharacterId: result.consequence.opinionChanges[0].targetCharacterId,
      delta: result.consequence.opinionChanges[0].delta
    },
    { sourceCharacterId: fixture.source, targetCharacterId: fixture.target, delta: fixture.delta },
    fixture.text
  );
}

for (const text of ["今天天气甚好。", "开封位于汴水之畔。", "我们讨论一下赋税制度。"]) {
  const result = resolve(text);
  assert.strictEqual(result.gateResult.eligible, false, text);
  assert.strictEqual(result.consequence.opinionChanges.length, 0, text);
}

const kiss = resolve("我亲吻了你，你也回吻了我。");
assert.strictEqual(kiss.consequence.relationshipTransition, null, "a kiss must never establish Lover");

const unconfirmedKilling = resolve("我已经把你父亲杀了。", { actorId: 1, targetId: 2 });
assert.strictEqual(
  unconfirmedKilling.consequence.opinionChanges.some((item) => item.reasonCluster === "family_death"),
  false,
  "dialogue alone must not confirm a family death"
);

const ambiguous = resolve("你这个卑鄙小人！", {
  actorId: 1,
  targetId: null,
  participants: [participant(1, "玩家"), participant(2, "甲"), participant(3, "乙")]
});
assert.strictEqual(ambiguous.consequence.opinionChanges.length, 0, "ambiguous addressees must fail closed");

assert(social.relationshipTransitionGraph, "relationship transition graph must be exported");
assert(social.consequenceValidator, "consequence validator must be exported");
assert(social.consequenceCooldown, "consequence cooldown must be exported");
assert(social.observerImpactResolver, "observer impact resolver must be exported");

function character(id, name, relationsToCharacters = []) {
  return { id, fullName: name, shortName: name, relationsToCharacters };
}

const player = character(1, "玩家");
const neutralA = character(2, "甲");
const rivalA = character(2, "甲", [{ id: 1, relations: ["仇敌"] }]);
const friendA = character(2, "甲", [{ id: 1, relations: ["朋友"] }]);
assert.strictEqual(social.relationshipTransitionGraph.canTransition({ actionId: "becomeNemesisWith", sourceCharacter: neutralA, targetCharacter: player }).allowed, false);
assert.strictEqual(social.relationshipTransitionGraph.canTransition({ actionId: "becomeNemesisWith", sourceCharacter: rivalA, targetCharacter: player }).allowed, true);
assert.strictEqual(social.relationshipTransitionGraph.canTransition({ actionId: "becomeSoulmatesWith", sourceCharacter: friendA, targetCharacter: player }).allowed, false);

function applyScaled(conversation, item) {
  const scaled = social.consequenceCooldown.scaleDelta(conversation, item);
  const reservation = social.consequenceCooldown.reserve(conversation, scaled);
  assert(reservation, "cooldown reservation must be created");
  social.consequenceCooldown.apply(conversation, reservation.reservationId);
  return scaled;
}

const positiveConversation = {};
const positiveItem = { sourceCharacterId: 2, targetCharacterId: 1, reasonCluster: "gratitude", sourceEventId: "topic-1", delta: 2 };
const first = applyScaled(positiveConversation, positiveItem);
const second = applyScaled(positiveConversation, positiveItem);
const third = applyScaled(positiveConversation, positiveItem);
assert.deepStrictEqual([first.delta, second.delta, third.delta], [2, 1, 0]);

const negativeConversation = {};
const negativeItem = { sourceCharacterId: 2, targetCharacterId: 1, reasonCluster: "threat", sourceEventId: "topic-2", delta: -3 };
const negativeFirst = applyScaled(negativeConversation, negativeItem);
const negativeSecond = applyScaled(negativeConversation, negativeItem);
const negativeThird = applyScaled(negativeConversation, negativeItem);
assert.deepStrictEqual([negativeFirst.delta, negativeSecond.delta, negativeThird.delta], [-3, -1, 0]);

const releasedConversation = {};
const releasedItem = { sourceCharacterId: 2, targetCharacterId: 1, reasonCluster: "praise", sourceEventId: "topic-3", delta: 2 };
const releasedReservation = social.consequenceCooldown.reserve(releasedConversation, social.consequenceCooldown.scaleDelta(releasedConversation, releasedItem));
social.consequenceCooldown.release(releasedConversation, releasedReservation.reservationId);
assert.strictEqual(social.consequenceCooldown.scaleDelta(releasedConversation, releasedItem).delta, 2, "released reservations must not consume cooldown");

const sixParticipants = [
  participant(1, "玩家"), participant(2, "受害者"), participant(3, "好友"),
  participant(4, "恋人"), participant(5, "路人"), participant(6, "不知情好友")
];
const majorEvidence = {
  evidenceId: "confirmed:injury-1",
  type: "confirmed_world_event",
  sourceMessageId: 20,
  sourceEventId: "injury-1",
  actorId: 1,
  targetId: 2,
  content: "isInjured",
  confidence: 1,
  worldStateConfirmed: true
};
const observerContext = makeContext("我重伤了你。", {
  messageId: 20,
  actorId: 1,
  targetId: 2,
  participants: sixParticipants,
  confirmedWorldEvents: [majorEvidence],
  relationshipStates: [
    { sourceCharacterId: 3, targetCharacterId: 2, relations: ["朋友"] },
    { sourceCharacterId: 4, targetCharacterId: 2, relations: ["情人"] },
    { sourceCharacterId: 6, targetCharacterId: 2, relations: ["朋友"] }
  ],
  knowledgeMap: {
    1: { [majorEvidence.evidenceId]: { known: true } },
    2: { [majorEvidence.evidenceId]: { known: true } },
    3: { [majorEvidence.evidenceId]: { known: true } },
    4: { [majorEvidence.evidenceId]: { known: true } },
    5: { [majorEvidence.evidenceId]: { known: true } },
    6: { [majorEvidence.evidenceId]: { known: false } }
  }
});
observerContext.observerParticipants = sixParticipants.slice(2);
observerContext.directParticipants = sixParticipants.slice(0, 2);
const directConsequence = social.createConsequence({
  consequenceId: "major-1",
  conversationId: observerContext.conversationId,
  sourceEventId: majorEvidence.sourceEventId,
  directParticipants: { actorId: 1, targetId: 2 },
  opinionChanges: [{ sourceCharacterId: 2, targetCharacterId: 1, delta: -7, reasonCluster: "severe_injury", confidence: 1, evidenceId: majorEvidence.evidenceId }],
  riskLevel: "high"
});
const observerEffects = social.observerImpactResolver.resolve({ context: observerContext, directConsequence, mode: "performance" });
assert.strictEqual(observerEffects.length, 2, "observer effects must be capped at two");
assert.deepStrictEqual(observerEffects.map((item) => item.sourceCharacterId).sort(), [3, 4]);

const oversizedConsequence = social.createConsequence({
  consequenceId: "bounded-1",
  conversationId: observerContext.conversationId,
  sourceEventId: majorEvidence.sourceEventId,
  directParticipants: { actorId: 1, targetId: 2 },
  opinionChanges: [
    { sourceCharacterId: 2, targetCharacterId: 1, delta: -7, reasonCluster: "severe_injury", confidence: 1, evidenceId: majorEvidence.evidenceId },
    { sourceCharacterId: 2, targetCharacterId: 1, delta: -6, reasonCluster: "severe_injury", confidence: 1, evidenceId: majorEvidence.evidenceId },
    { sourceCharacterId: 2, targetCharacterId: 1, delta: -5, reasonCluster: "severe_injury", confidence: 1, evidenceId: majorEvidence.evidenceId }
  ],
  observerEffects: [
    ...observerEffects,
    { sourceCharacterId: 5, targetCharacterId: 1, delta: -4, reasonCluster: "observer_severe_injury", confidence: 1, evidenceId: majorEvidence.evidenceId }
  ],
  riskLevel: "high"
});
const bounded = social.consequenceValidator.validate({ consequence: oversizedConsequence, context: observerContext, mode: "performance" });
assert.strictEqual(bounded.consequence.opinionChanges.length, 2, "direct Opinion must be capped at two");
assert.strictEqual(bounded.consequence.observerEffects.length, 2, "observer Opinion must be capped at two");

const invalidDelta = social.createConsequence({
  consequenceId: "invalid-delta",
  directParticipants: { actorId: 1, targetId: 2 },
  opinionChanges: [{ sourceCharacterId: 2, targetCharacterId: 1, delta: -11, reasonCluster: "severe_injury", confidence: 1, evidenceId: majorEvidence.evidenceId }]
});
const rejectedDelta = social.consequenceValidator.validate({ consequence: invalidDelta, context: observerContext, mode: "performance" });
assert.strictEqual(rejectedDelta.valid, false);
assert.strictEqual(rejectedDelta.rejected.some((item) => item.reason === "invalid_opinion_delta"), true, "out-of-range values must be rejected, not clamped");

for (const mutation of [
  { worldStateConfirmed: false, known: true },
  { worldStateConfirmed: true, known: false }
]) {
  const event = { ...majorEvidence, worldStateConfirmed: mutation.worldStateConfirmed };
  const context = makeContext("我恨你。", {
    actorId: 2,
    targetId: 1,
    confirmedWorldEvents: [event],
    knowledgeMap: {
      1: { [event.evidenceId]: { known: true } },
      2: { [event.evidenceId]: { known: mutation.known } }
    }
  });
  const gateResult = social.socialConsequenceGate.evaluate(context);
  const consequence = social.localConsequenceResolver.resolve(context, gateResult);
  assert.strictEqual(consequence.opinionChanges.some((item) => item.reasonCluster === "severe_injury"), false);
}

console.log("VOTC v7.9.2 Social Consequence Local Resolver: PASS");
