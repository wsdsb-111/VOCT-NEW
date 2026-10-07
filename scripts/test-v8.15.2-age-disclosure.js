"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { scanVisibleDisclosures } = require("../resources/app/out/main/memory-system/memory4-disclosure");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8152-age-disclosure-"));
const campaignToken = "v8.15.2-age-disclosure-fixture";
const date = "1164.5.20";
const characters = [
  { id: 1, name: "赵太初", firstName: "赵太初", shortName: "赵太初", fullName: "赵太初", age: 16, traits: [] },
  { id: 2, name: "张道素", firstName: "张道素", shortName: "张道素", fullName: "张道素", age: 13, traits: [] }
];
const gameData = { campaignToken, date, characters: new Map(characters.map(character => [character.id, character])) };

function gameDataAt(gameDate, currentNpcAge = 13, token = campaignToken) {
  const rows = characters.map(character => character.id === 2 ? { ...character, age: currentNpcAge } : character);
  return { campaignToken: token, date: gameDate, characters: new Map(rows.map(character => [character.id, character])) };
}

function scan(text, { targetId = 2, ownerId = 1, sourceRole = "assistant", speakerId = targetId,
  messageId = 0, targetAge = characters.find(character => character.id === targetId).age } = {}) {
  const target = characters.find(character => character.id === targetId);
  const owner = characters.find(character => character.id === ownerId);
  const candidateData = { ...gameData, characters: new Map([[targetId, { ...target, age: targetAge }], [ownerId, owner]]) };
  const fragment = { fragmentId: `scan-${messageId}`, messageId, sourceMessageIds: [messageId], text, sourceRole,
    speakerId, entityIds: [targetId], presentIds: [ownerId, targetId], knownBy: [ownerId, targetId],
    sourceType: "spoken", visibility: "participants", visibilityEvidence: "application_fragment" };
  return scanVisibleDisclosures({ campaignToken, conversationId: "age-scan", ownerId, date,
    sourceRevision: "a".repeat(64), fragments: [fragment] }, candidateData);
}

function scanAgeAnswer(answer) {
  const fragments = [
    { fragmentId: "age-question", messageId: 0, sourceMessageIds: [0], text: "你今年多少岁？", sourceRole: "user",
      speakerId: 1, entityIds: [2], presentIds: [1, 2], knownBy: [1], sourceType: "spoken", visibility: "participants",
      visibilityEvidence: "application_fragment" },
    { fragmentId: "age-answer", messageId: 1, sourceMessageIds: [1], text: answer, sourceRole: "assistant",
      speakerId: 2, entityIds: [2], presentIds: [1, 2], knownBy: [1, 2], sourceType: "spoken", visibility: "participants",
      visibilityEvidence: "application_fragment" }
  ];
  return scanVisibleDisclosures({ campaignToken, conversationId: "age-answer-scan", ownerId: 1, date,
    sourceRevision: "b".repeat(64), fragments }, gameData);
}

function message(id, role, speakerCharacterId, content) {
  const speaker = characters.find(character => character.id === speakerCharacterId);
  return { id, role, speakerCharacterId, name: speaker.name, content, memory4Fragments: [{ start: 0, end: content.length,
    visibility: "participants", sourceType: "spoken", recipientIds: characters.map(character => character.id).filter(id => id !== speakerCharacterId),
    knownBy: characters.map(character => character.id), entityIds: characters.map(character => character.id) }] };
}

function context({ conversationId, finalizationId, scopeToken = campaignToken, excludedSummaryOwnerIds = [],
  playerStatement = "我今年16岁比你大三岁。", npcAnswer = "今年13岁。", npcPresentAtQuestion = true } = {}) {
  return { campaignToken: scopeToken, conversationId, finalizationId, date, totalDays: 1, finalizationVisibilityV1: true,
    participants: characters, excludedSummaryOwnerIds,
    participantPresence: [{ characterId: 1, joinedAtMessageId: 0 },
      { characterId: 2, joinedAtMessageId: npcPresentAtQuestion ? 0 : 1 }],
    messages: [message(0, "user", 1, "你今年多少岁？"), message(1, "assistant", 2, npcAnswer),
      message(2, "user", 1, playerStatement)] };
}

function ageFact(rows, value) {
  return rows.find(row => row.factType === "AGE" && row.value === String(value));
}

async function run() {
  const summariesDir = path.join(temporary, "summaries");
  fs.mkdirSync(summariesDir, { recursive: true });
  for (const character of characters) fs.mkdirSync(path.join(summariesDir, `${character.id}_${character.fullName}`), { recursive: true });
  fs.mkdirSync(path.join(summariesDir, "3_未获知Owner"), { recursive: true });
  const coordinator = new Memory4Coordinator(new MemoryStore({ baseDir: path.join(temporary, "memory"), summaryFoldersDir: summariesDir }));
  try {
    for (const [text, targetAge, speakerId, sourceRole, ownerId] of [
      ["我今年23岁。", 23, 2, "assistant", 1],
      ["我今年二十三岁。", 23, 2, "assistant", 1],
      ["我的年龄是23岁。", 23, 2, "assistant", 1],
      ["我已经活了三十载。", 30, 2, "assistant", 1],
      ["赵太初今年23岁。", 23, 1, "user", 2]
    ]) {
      const result = scan(text, { targetId: ownerId === 1 ? 2 : 1, ownerId, sourceRole, speakerId, targetAge });
      assert(ageFact(result.disclosures, targetAge), `a clearly spoken current age matching CK3 is recorded: ${text}`);
    }
    const quotedAnswer = ageFact(scanAgeAnswer("“今年13岁。”").disclosures, 13);
    assert(quotedAnswer, "a bare age inside a validated direct-speech span can answer the Owner's current-age question");
    assert.deepEqual(quotedAnswer.evidence.sourceMessageIds, [0, 1], "quoted age proof retains the question and response");

    for (const text of ["今年13岁。", "我明年13岁。", "我今年12岁。", "我今年13岁左右。", "听说我今年13岁。"] ) {
      assert.equal(ageFact(scan(text).disclosures, 13), undefined, `missing, future, approximate, or wrong age stays unknown: ${text}`);
    }
    assert.equal(ageFact(scan("“今年13岁。”").disclosures, 13), undefined,
      "a quoted bare age without an immediate Owner question remains unknown");
    assert.equal(ageFact(scan("赵太初，我今年23岁。", { targetId: 1, ownerId: 2, speakerId: 2,
      sourceRole: "user", targetAge: 23 }).disclosures, 23), undefined,
    "a first-person claim cannot be rebound to a same-age named third party");

    const requestDurable = async () => JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] });
    const npcQuestionContext = context({ conversationId: "npc-age-question", finalizationId: "npc-age-question-finalization",
      excludedSummaryOwnerIds: [2] });
    const npcResult = await coordinator.finalizeCommitted(npcQuestionContext, requestDurable, { isNarrativeCommitted: true });
    assert.equal(npcResult.status, "COMPLETE", JSON.stringify(npcResult));
    const playerScope = { campaignToken, ownerId: 1 };
    const npcDisclosure = ageFact(coordinator.getCurrentDisclosures(playerScope, 2, gameData), 13);
    assert(npcDisclosure, "an NPC's omitted-subject current age answer is recorded for the question Owner");
    assert.equal(npcDisclosure.firstAcquiredDate, date, "the persisted age is tied to its disclosure date");
    const npcProof = Object.values(npcDisclosure.evidenceBySource).find(proof => proof.sourceKind === "CONVERSATION");
    assert(npcProof.sourceMessageIds.includes(0) && npcProof.sourceMessageIds.includes(1),
      "the age proof retains both the Owner's question and NPC's answer message IDs");
    assert(npcProof.sourceFragmentIds.length >= 2 && npcProof.sourceTextHashes.length >= 2,
      "the age proof retains both question and answer fragment/hash evidence");

    const refreshedGameData = gameDataAt("1164.5.21", 14);
    const refreshedAgeRows = coordinator.getCurrentDisclosures(playerScope, 2, refreshedGameData);
    const refreshedAge = ageFact(refreshedAgeRows, 13);
    assert(refreshedAge, "a previously disclosed age remains as its original history row after CK3 age refresh");
    assert.equal(refreshedAge.value, "13", "current truth does not rewrite the historical disclosure value");
    assert.equal(refreshedAge.factId, npcDisclosure.factId, "current truth does not replace the historical fact identity");
    assert.equal(refreshedAge.firstAcquiredDate, date, "current truth preserves the original acquisition date");
    assert.equal(refreshedAge.lastConfirmedDate, date, "reading live age does not create a confirmation event");
    assert.deepEqual(refreshedAge.evidenceBySource, npcDisclosure.evidenceBySource,
      "reading live age does not mutate the historical proof");
    assert.equal(refreshedAge.currentKnownAge, 14,
      "an effective AGE proof authorizes reading the live CK3 age at the refresh date");
    assert.equal(refreshedAge.currentAgeReadDate, "1164.5.21", "the live age projection records its truth date");
    assert.equal(ageFact(refreshedAgeRows, 14), undefined, "the live age is not persisted as a fabricated new disclosure");
    const secondRefresh = ageFact(coordinator.getCurrentDisclosures(playerScope, 2, gameDataAt("1164.5.22", 15)), 13);
    assert.equal(secondRefresh?.currentKnownAge, 15, "a later CK3 refresh updates only the current-age projection");
    assert.equal(secondRefresh?.currentAgeReadDate, "1164.5.22");
    assert.equal(secondRefresh?.factId, npcDisclosure.factId, "multiple refreshes retain the same historical age fact");

    const archivedAgeRows = coordinator.getCurrentDisclosures(playerScope, 2, null, { currentGameDate: "1164.5.21" });
    assert.equal(ageFact(archivedAgeRows, 13)?.currentKnownAge, null, "archive reads preserve age history without a live current age");
    assert.equal(ageFact(archivedAgeRows, 13)?.currentAgeReadDate, null, "archive reads have no live AGE read date");
    assert.throws(() => coordinator.getCurrentDisclosures(playerScope, 2,
      gameDataAt("1164.5.21", 14, `${campaignToken}-other`)), /memory4_disclosure_current_scope_invalid/,
    "another campaign cannot supply the current AGE");
    const futureRead = coordinator.getCurrentDisclosures(playerScope, 2, gameDataAt("1164.5.19", 14));
    assert.equal(ageFact(futureRead, 13), undefined, "a proof acquired after the read date cannot authorize current AGE");
    const invalidCurrentRead = coordinator.getCurrentDisclosures(playerScope, 2, gameDataAt("1164.5.21", null));
    assert.equal(ageFact(invalidCurrentRead, 13)?.currentKnownAge, null, "invalid current CK3 age leaves only the historical disclosure");
    assert.equal(ageFact(invalidCurrentRead, 13)?.currentAgeReadDate, null, "invalid current AGE has no truth date");
    assert.equal(ageFact(coordinator.getCurrentDisclosures({ campaignToken, ownerId: 3 }, 2, refreshedGameData), 13), undefined,
      "current CK3 age alone does not authorize an unheard Owner");

    const playerAgeContext = context({ conversationId: "player-age-claim", finalizationId: "player-age-claim-finalization",
      excludedSummaryOwnerIds: [1] });
    const playerResult = await coordinator.finalizeCommitted(playerAgeContext, requestDurable, { isNarrativeCommitted: true });
    assert.equal(playerResult.status, "COMPLETE");
    const npcOwnerScope = { campaignToken, ownerId: 2 };
    const playerDisclosure = ageFact(coordinator.getCurrentDisclosures(npcOwnerScope, 1, gameData), 16);
    assert(playerDisclosure, "a player's matching current age remains 16 despite a later comparison mentioning 3 years");
    assert.equal(playerDisclosure.value, "16");
    assert.equal(ageFact(coordinator.getCurrentDisclosures(npcOwnerScope, 1, gameData), 3), undefined,
      "the comparative age difference is never mistaken for the speaker's age");

    const forgottenAge = coordinator.forgetSummaryProjection({ campaignToken, perspectiveOwnerId: 1, characterId: 2,
      conversationId: npcQuestionContext.conversationId, finalizationId: npcQuestionContext.finalizationId,
      sourceMessageIds: [0, 1], sourceSegmentIds: npcProof.sourceFragmentIds }, { ownerId: 1, counterpartId: 2 });
    assert(forgottenAge.disclosureEvidenceRevoked > 0, "forgetting the source revokes the age authorization");
    assert.equal(ageFact(coordinator.getCurrentDisclosures(playerScope, 2, refreshedGameData), 13), undefined,
      "a forgotten AGE proof no longer authorizes current known age");

    const absentTargetContext = context({ conversationId: "npc-age-not-present", finalizationId: "npc-age-not-present-finalization",
      scopeToken: `${campaignToken}-not-present`, excludedSummaryOwnerIds: [2], npcPresentAtQuestion: false });
    await coordinator.finalizeCommitted(absentTargetContext, requestDurable, { isNarrativeCommitted: true });
    assert.equal(ageFact(coordinator.getCurrentDisclosures({ campaignToken: absentTargetContext.campaignToken, ownerId: 1 }, 2,
      { ...gameData, campaignToken: absentTargetContext.campaignToken }), 13), undefined,
      "a question cannot bind an omitted-subject answer to a responder who was not present when asked");

    const interruptedContext = context({ conversationId: "npc-age-interrupted", finalizationId: "npc-age-interrupted-finalization",
      scopeToken: `${campaignToken}-interrupted`, excludedSummaryOwnerIds: [2] });
    interruptedContext.messages.splice(1, 0, message(1, "assistant", 1, "稍后再说。"));
    interruptedContext.messages[2].id = 2;
    interruptedContext.messages[3].id = 3;
    const interrupted = await coordinator.finalizeCommitted(interruptedContext, requestDurable, { isNarrativeCommitted: true });
    assert.equal(interrupted.status, "COMPLETE");
    assert.equal(ageFact(coordinator.getCurrentDisclosures({ campaignToken: interruptedContext.campaignToken, ownerId: 1 }, 2,
      { ...gameData, campaignToken: interruptedContext.campaignToken }), 13), undefined,
      "a third-party reply interrupts the question-to-responder binding");

    console.log("V8.15.2 age disclosure: PASS (truth-matched production disclosure, current-age refresh, history, archive, scope, and Forget gates)");
  } finally {
    const targetPath = path.resolve(temporary);
    assert(targetPath.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
