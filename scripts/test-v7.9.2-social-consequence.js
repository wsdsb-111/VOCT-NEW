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

console.log("VOTC v7.9.2 Social Consequence Local Resolver: PASS");
