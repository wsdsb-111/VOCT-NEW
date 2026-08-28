"use strict";

const assert = require("assert");
const actionSystem = require("../resources/app/out/main/action-system");
const social = require("../resources/app/out/main/action-system/social");

function character(id, name, relationsToCharacters = []) {
  return { id, fullName: name, shortName: name, relationsToCharacters, opinions: [] };
}

const player = character(1, "玩家");
const victim = character(2, "甲");
const friend = character(3, "乙", [{ id: 2, relations: ["朋友"] }]);
const lover = character(4, "丙", [{ id: 2, relations: ["情人"] }]);
const unrelated = character(5, "丁");
const asleepFriend = character(6, "戊", [{ id: 2, relations: ["朋友"] }]);
const characters = new Map([player, victim, friend, lover, unrelated, asleepFriend].map((item) => [item.id, item]));

function makeConversation(message, inactiveParticipantIds = new Map()) {
  return {
    id: "multiplayer-social",
    turnEpoch: 1,
    messages: [message],
    gameData: { playerID: 1, playerName: "玩家", characters },
    inactiveParticipantIds,
    waitingCharacterIds: new Set(),
    departedCharacterIds: new Set(),
    getActiveConversationCharacters() {
      return [...characters.values()].filter((item) => !this.inactiveParticipantIds.has(item.id) && !this.waitingCharacterIds.has(item.id) && !this.departedCharacterIds.has(item.id));
    }
  };
}

social.socialConsequenceEngine.configure({ ActionEngine: actionSystem.ActionEngine });

const namedMessage = { id: 1, role: "user", name: "玩家", content: "甲，你今天做得很好。" };
const namedConversation = makeConversation(namedMessage);
const namedRaw = social.socialContextProvider.buildContext({ conversation: namedConversation, message: namedMessage, confirmedEvents: [] });
const namedResolved = social.socialConsequenceEngine.resolveMessageParticipants(namedRaw, namedConversation, namedMessage);
assert.strictEqual(namedResolved.message.targetId, 2, "mature reference resolution must bind the unique named addressee in a six-person scene");
assert.strictEqual(social.socialConsequenceGate.evaluate(namedResolved).eligible, true);

const ambiguousMessage = { id: 2, role: "user", name: "玩家", content: "你这个混蛋。" };
const ambiguousConversation = makeConversation(ambiguousMessage);
const ambiguousRaw = social.socialContextProvider.buildContext({ conversation: ambiguousConversation, message: ambiguousMessage, confirmedEvents: [] });
const ambiguousResolved = social.socialConsequenceEngine.resolveMessageParticipants(ambiguousRaw, ambiguousConversation, ambiguousMessage);
assert.strictEqual(ambiguousResolved.message.targetId, null);
assert.strictEqual(social.socialConsequenceGate.evaluate(ambiguousResolved).reasons[0], "participants_unresolved", "ambiguous second person in multiplayer must fail closed");

const harmMessage = { id: 3, role: "user", name: "玩家", content: "我当众重伤了甲。", primaryAddresseeId: 2 };
const witnessConversation = makeConversation(harmMessage, new Map([[6, "asleep"]]));
const confirmedEvent = {
  eventId: "injury-visible-1",
  actionId: "isInjured",
  sourceCharacterId: 1,
  targetCharacterId: 2,
  success: true,
  effectWritten: true,
  observable: true
};
const witnessRaw = social.socialContextProvider.buildContext({ conversation: witnessConversation, message: harmMessage, confirmedEvents: [confirmedEvent] });
assert.strictEqual(witnessRaw.directParticipants.some((item) => item.id === 6), false, "asleep characters must not be active witnesses");
const evidenceId = witnessRaw.confirmedWorldEvents[0].evidenceId;
for (const id of [1, 2]) assert(["direct_actor", "direct_victim"].includes(witnessRaw.knowledgeMap[id][evidenceId].basis));
for (const id of [3, 4, 5]) assert.strictEqual(witnessRaw.knowledgeMap[id][evidenceId].basis, "visible_witness");
assert.strictEqual(witnessRaw.knowledgeMap[6], undefined, "asleep character must receive no knowledge entry");

const witnessContext = social.socialConsequenceEngine.resolveMessageParticipants(witnessRaw, witnessConversation, harmMessage);
const directConsequence = social.createConsequence({
  consequenceId: "visible-harm",
  directParticipants: { actorId: 1, targetId: 2 },
  opinionChanges: [{ sourceCharacterId: 2, targetCharacterId: 1, delta: -7, confidence: 1, reason: "confirmed injury", reasonCluster: "severe_harm", evidenceId, sourceEventId: confirmedEvent.eventId }],
  riskLevel: "high"
});
const observerEffects = social.observerImpactResolver.resolve({ context: witnessContext, directConsequence, mode: "performance" });
assert.deepStrictEqual(observerEffects.map((item) => item.sourceCharacterId).sort(), [3, 4], "only the victim's present friend and lover may receive observer effects");
assert(observerEffects.length <= 2);

function applyScaled(conversation, item) {
  const scaled = social.consequenceCooldown.scaleDelta(conversation, item);
  const reservation = social.consequenceCooldown.reserve(conversation, scaled);
  assert(reservation);
  social.consequenceCooldown.apply(conversation, reservation.reservationId);
  return scaled.delta;
}

const cooldownConversation = {};
const sameTopicMessages = [
  "你很聪明。",
  "你确实很聪明。",
  "我最欣赏你的智慧。"
];
const sameTopicDeltas = sameTopicMessages.map((text, index) => applyScaled(cooldownConversation, {
  sourceCharacterId: 2,
  targetCharacterId: 1,
  reasonCluster: "praise",
  normalizedTopic: social.evidencePolicy.cooldownTopic({ item: { reasonCluster: "praise" }, evidence: null, messageText: text }),
  sourceEventId: `message-${index + 1}`,
  delta: 2
}));
assert.deepStrictEqual(sameTopicDeltas, [2, 1, 0], "same semantic topic across message IDs must decay 100% -> 40% -> 0%");

const appearanceDelta = applyScaled(cooldownConversation, {
  sourceCharacterId: 2,
  targetCharacterId: 1,
  reasonCluster: "praise",
  normalizedTopic: social.evidencePolicy.cooldownTopic({ item: { reasonCluster: "praise" }, evidence: null, messageText: "你的容貌十分美丽。" }),
  delta: 2
});
assert.strictEqual(appearanceDelta, 2, "a different semantic subject must use an independent cooldown");

const eventConversation = {};
const eventOne = { sourceCharacterId: 2, targetCharacterId: 1, reasonCluster: "rescue", evidenceAuthority: "confirmed_world", sourceEventId: "event-1", delta: 5 };
const eventTwo = { ...eventOne, sourceEventId: "event-2" };
assert.strictEqual(applyScaled(eventConversation, eventOne), 5);
assert.strictEqual(applyScaled(eventConversation, eventTwo), 5, "a new confirmed event ID must not be suppressed by an older event cooldown");

console.log("VOTC v7.9.2 multiplayer target, witness knowledge and cooldown topic identity: PASS");
