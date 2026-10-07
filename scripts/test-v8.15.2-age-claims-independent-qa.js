"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const events = require("node:events");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { scanVisibleDisclosures } = require("../resources/app/out/main/memory-system/memory4-disclosure");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");
const memorySystem = require("../resources/app/out/main/memory-system");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8152-age-claims-qa-"));
const baseDir = path.join(temporary, "memory");
const summariesDir = path.join(temporary, "summaries");
const campaignToken = "v8152-age-owner-qa";
const sourceDate = "1164.5.20";
const nextDate = "1164.5.21";
const debugLogPath = path.join(temporary, "debug.log");
for (const [id, name] of [[1, "甲"], [2, "乙"], [3, "丙"]]) {
  fs.mkdirSync(path.join(summariesDir, `${id}_${name}`), { recursive: true });
}
fs.writeFileSync(debugLogPath, "synthetic QA fixture", "utf8");

function makeCharacter(id, name, age) {
  return { id, name, firstName: name, shortName: name, fullName: name, age, traits: [], secrets: [], knownSecrets: [],
    relationsToCharacters: [], relationsToPlayer: [], alive: true, isDead: false, dead: false };
}

function makeCharacters({ npcAge = 13 } = {}) {
  return new Map([[1, makeCharacter(1, "甲", 16)], [2, makeCharacter(2, "乙", npcAge)], [3, makeCharacter(3, "丙", 10)]]);
}

function makeGameData(characters = makeCharacters(), date = sourceDate) {
  return { campaignToken, date, totalDays: 425000, year: 1164, playerID: 1, playerName: "甲", aiID: 2, aiName: "乙",
    characters, ck3RelationshipReadbackComplete: false, loadCharactersSummaries() {} };
}

function makeMessage(id, role, speakerId, text, { visibility = "participants" } = {}) {
  const character = makeCharacters().get(speakerId);
  return { id, role, speakerCharacterId: speakerId, name: character?.shortName || "", content: text,
    memory4Fragments: [{ start: 0, end: text.length, visibility, sourceType: "spoken",
      recipientIds: [speakerId === 1 ? 2 : 1], entityIds: [1, 2, 3] }] };
}

function makeOwnerSnapshot(engine, messages, { npcAge = 13, ownerId = 1, conversationId = "age-negative-fixture" } = {}) {
  const characters = makeCharacters({ npcAge });
  const participants = [...characters.values()];
  const context = { campaignToken, conversationId, finalizationId: `${conversationId}-finalization`,
    episodeId: `${conversationId}-episode`, date: sourceDate, totalDays: 425000, participants,
    participantPresence: participants.map(character => ({ characterId: character.id, joinedAtMessageId: 0, leftAtMessageId: null })),
    disclosureCharacters: participants.map(character => ({ id: character.id,
      names: [character.firstName, character.shortName, character.fullName, character.name],
      facts: [{ factType: "AGE", value: String(character.age), factKey: `age_${character.age}` }] })),
    messages };
  return { snapshot: engine.memory4.buildOwnerSnapshot(context, ownerId), characters };
}

function scan(engine, messages, options) {
  const { snapshot, characters } = makeOwnerSnapshot(engine, messages, options);
  return scanVisibleDisclosures(snapshot, { campaignToken, date: snapshot.date, characters });
}

function addMessage(conversation, id, role, speakerId, text) {
  conversation.messages.push(makeMessage(id, role, speakerId, text));
}

async function main() {
  const engine = new MemoryEngine({ baseDir, summaryFoldersDir: summariesDir, trace: { record() {} } });
  const gameData = makeGameData();
  Conversation.configure({ memoryEngine: engine,
    settingsRepository: { getCK3DebugLogPath: () => debugLogPath, getChatPromptV813Layout: () => false },
    runFileManager: { isAvailable: () => true }, parseLog: async () => gameData,
    createError: input => ({ type: "error", ...input }), createMessage: input => ({ type: "message", ...input }),
    events, uuid: { v4: () => "v8152-age-question-answer" }, path });
  const conversation = new Conversation();
  await conversation.gameDataReady;
  await conversation.worldlinePrefetchPromise;
  await conversation.memoryRecoveryPromise;
  engine.observeParticipants(conversation, [1, 2], 0);
  addMessage(conversation, 1, "user", 1, "你今年多少岁？");
  addMessage(conversation, 2, "assistant", 2, "今年13岁。");
  conversation.nextId = 3;

  const context = conversation.buildFinalizationBaseContext();
  context.finalizationId = "v8152-age-question-answer-finalization";
  context.episodeId = "v8152-age-question-answer-episode";
  const ownerSnapshot = engine.memory4.buildOwnerSnapshot(context, 1);
  const questionFragment = ownerSnapshot.fragments.find(fragment => fragment.messageId === 1);
  const answerFragment = ownerSnapshot.fragments.find(fragment => fragment.messageId === 2);
  assert(questionFragment && answerFragment, "the real Conversation owner snapshot retains both spoken fragments");
  assert.equal(questionFragment.sourceRole, "user");
  assert.equal(answerFragment.sourceRole, "assistant");
  assert.deepEqual(questionFragment.presentIds, [1, 2], "the age question was actually present to its responder");
  assert.deepEqual(answerFragment.presentIds, [1, 2], "the answer was actually visible to the Owner");
  assert(questionFragment.knownBy.includes(1) && questionFragment.knownBy.includes(2));
  assert(answerFragment.knownBy.includes(1));

  const sourceCharacters = new Map(ownerSnapshot.disclosureCharacters.map(character => [character.id, character]));
  const scanned = scanVisibleDisclosures(ownerSnapshot, { campaignToken, date: sourceDate, characters: sourceCharacters });
  const ageDisclosure = scanned.disclosures.find(row => row.entityId === 2 && row.factType === "AGE" && row.value === "13");
  assert(ageDisclosure, "the Owner's current age question binds the NPC's matching subjectless answer to that NPC");
  assert.deepEqual(ageDisclosure.evidence.sourceMessageIds, [1, 2], "both question and answer message IDs are retained as evidence");
  assert(ageDisclosure.evidence.sourceFragmentIds.length >= 2, "both question and answer fragment IDs are retained");
  assert.equal(ageDisclosure.evidence.sourceTextHashes.length, 2, "both question and answer text hashes are retained");

  const scope = { campaignToken, ownerId: 1 };
  engine.memory4.store.ensureDisclosureScope(scope);
  engine.memory4.store.recordKnownEvidence(ownerSnapshot);
  const recorded = engine.memory4.recordDisclosures(ownerSnapshot, { campaignToken, date: sourceDate, characters: sourceCharacters });
  assert.equal(recorded.status, "RECORDED", "the question-bound age passes through the real Memory4 persistence path");
  const persisted = engine.memory4.store.getDisclosedFacts(scope, 2).find(fact => fact.factType === "AGE" && fact.value === "13");
  assert(persisted, "the age claim is written to the Memory4 disclosure store");
  const persistedProof = Object.values(persisted.evidenceBySource).find(proof => proof.sourceKind === "CONVERSATION");
  assert.deepEqual(persistedProof.sourceMessageIds, [1, 2], "persisted proof must link the question and answer");

  const reopened = new MemoryEngine({ baseDir, summaryFoldersDir: summariesDir, trace: { record() {} } });
  const currentTruth = makeGameData(makeCharacters({ npcAge: 14 }), nextDate);
  const afterRestart = reopened.memory4.getCurrentDisclosures(scope, 2, currentTruth)
    .find(fact => fact.factType === "AGE");
  assert.equal(afterRestart?.value, "13", "restart reads the spoken age rather than replacing it with backend age 14");
  assert.equal(afterRestart?.firstAcquiredDate, sourceDate, "restart preserves the question-bound acquisition date");
  assert.equal(afterRestart?.current, false, "the saved age remains a historical disclosure, not current truth");
  assert.equal(afterRestart?.currentKnownAge, 14, "a valid historical age disclosure authorizes reading the current CK3 age");
  assert.equal(afterRestart?.currentAgeReadDate, nextDate, "the current age carries its actual as-of game date");
  const unchangedHistory = reopened.memory4.store.getDisclosedFacts(scope, 2)
    .find(fact => fact.factType === "AGE" && fact.value === "13");
  assert.equal(unchangedHistory?.value, "13", "reading current age must not rewrite the historical spoken value");
  assert.equal(unchangedHistory?.firstAcquiredDate, sourceDate, "reading current age must not alter the historical learned date");
  assert.deepEqual(unchangedHistory?.evidenceBySource, persisted.evidenceBySource,
    "reading current age must not fabricate or mutate the historical disclosure proof");

  const archivedAge = reopened.memory4.getCurrentDisclosures(scope, 2, null, { currentGameDate: nextDate })
    .find(fact => fact.factType === "AGE");
  assert.equal(archivedAge?.value, "13", "archive reads retain the historical spoken age");
  assert.equal(archivedAge?.currentKnownAge, null, "archive/history reads never overlay a current CK3 age");
  assert.equal(archivedAge?.currentAgeReadDate, null, "archive/history reads do not invent a current-age read date");
  const beforeDisclosure = reopened.memory4.getCurrentDisclosures(scope, 2,
    makeGameData(makeCharacters({ npcAge: 13 }), "1164.5.19"));
  assert.equal(beforeDisclosure.some(fact => fact.factType === "AGE"), false,
    "an age proof dated in the future cannot authorize current age before it was learned");
  const unavailableAge = reopened.memory4.getCurrentDisclosures(scope, 2,
    makeGameData(makeCharacters({ npcAge: null }), nextDate)).find(fact => fact.factType === "AGE");
  assert.equal(unavailableAge?.currentKnownAge, null, "missing current CK3 age remains unavailable despite historical authorization");
  assert.throws(() => reopened.memory4.getCurrentDisclosures(scope, 2,
    { ...currentTruth, campaignToken: "wrong-campaign" }), /memory4_disclosure_current_scope_invalid/,
  "a campaign mismatch fails closed instead of carrying current age across campaigns");
  assert.deepEqual(reopened.memory4.getCurrentDisclosures({ campaignToken, ownerId: 3 }, 2, currentTruth), [],
    "a different Owner receives no current age without its own historical disclosure proof");

  const uiConversation = { id: "v8152-age-ui-context", isActive: true, gameData: currentTruth };
  const summariesManager = createSummariesManager({ fs, path, summariesDir, memoryEngine: reopened, memorySystem,
    getCurrentConversation: () => uiConversation,
    requestSummary: async () => { throw new Error("AGE UI DTO read must not call a provider"); } });
  const uiData = await summariesManager.getMemory4OwnerData({ ownerId: 1, expectedCampaignToken: campaignToken,
    expectedContextId: uiConversation.id });
  const uiProfile = uiData.known.items.find(item => item.entityId === 2);
  const uiAge = uiProfile?.disclosedFacts.find(fact => fact.factType === "AGE");
  assert.equal(uiAge?.value, "13", "the Memory4 UI DTO exposes the persisted spoken age");
  assert.equal(uiAge?.current, false, "the UI DTO labels the saved age historical after CK3 age changes");
  assert.equal(uiAge?.firstAcquiredDate, sourceDate);
  assert.equal(uiAge?.currentKnownAge, 14, "the live UI DTO separates authorized current age from the historical value");
  assert.equal(uiAge?.currentAgeReadDate, nextDate, "the live UI DTO records when current CK3 age was read");
  assert.deepEqual(reopened.memory4.getCurrentDisclosures({ campaignToken, ownerId: 3 }, 2, currentTruth), [],
    "backend age must not automatically appear for an Owner without a disclosure proof");

  const forgottenProjection = reopened.memory4.forgetSummaryProjection({ campaignToken, perspectiveOwnerId: 1,
    characterId: 2, conversationId: ownerSnapshot.conversationId, finalizationId: ownerSnapshot.finalizationId,
    sourceMessageIds: [1, 2], segmentIds: ownerSnapshot.fragments.map(fragment => fragment.fragmentId) },
  { ownerId: 1, counterpartId: 2 });
  assert(forgottenProjection.disclosureEvidenceRevoked > 0, "forgetting the age source revokes its disclosure authorization");
  const forgottenAge = reopened.memory4.getCurrentDisclosures(scope, 2, currentTruth)
    .find(fact => fact.factType === "AGE");
  assert.equal(forgottenAge?.currentKnownAge ?? null, null, "a forgotten historical disclosure no longer authorizes current age");

  const answer = makeMessage(2, "assistant", 2, "今年13岁。");
  assert.equal(scan(engine, [answer]).disclosures.some(row => row.entityId === 2 && row.factType === "AGE"), false,
    "a subjectless answer without an Owner age question is not disclosed");
  assert.equal(scan(engine, [makeMessage(1, "user", 1, "你喜欢这座城吗？"), answer]).disclosures
    .some(row => row.entityId === 2 && row.factType === "AGE"), false,
  "an unrelated Owner question cannot authorize an age answer");
  assert.equal(scan(engine, [makeMessage(1, "user", 1, "你今年多少岁？"),
    makeMessage(2, "assistant", 3, "丙插话：“我有件事想说。”"),
    makeMessage(3, "assistant", 2, "今年13岁。")]).disclosures
    .some(row => row.entityId === 2 && row.factType === "AGE"), false,
  "a third NPC interruption breaks the Owner question-to-answer binding");
  assert.equal(scan(engine, [makeMessage(1, "user", 1, "你今年多少岁？", { visibility: "private" }), answer]).disclosures
    .some(row => row.entityId === 2 && row.factType === "AGE"), false,
  "a private question the responder could not hear cannot authorize an age answer");
  assert.equal(scan(engine, [makeMessage(1, "user", 1, "我今年16岁比你大三岁。")]).disclosures
    .some(row => row.entityId === 2 && row.factType === "AGE"), false,
  "a comparative age difference cannot be used to infer the other character's age");
  assert.equal(scan(engine, [makeMessage(1, "user", 1, "你今年多少岁？"), answer], { npcAge: 14 }).disclosures
    .some(row => row.entityId === 2 && row.factType === "AGE"), false,
  "an answer that disagrees with the current CK3 age is rejected");
  assert(scan(engine, [makeMessage(1, "assistant", 2, "我今年13岁。")]).disclosures
    .some(row => row.entityId === 2 && row.factType === "AGE" && row.value === "13"),
  "an explicit current self-age assertion remains admissible without a question");

  console.log("V8.15.2 age claims independent QA: PASS (owner Q&A binding, persistence/restart/UI DTO, private and interruption boundaries, no age inference)");
}

main().catch(error => { console.error(error.stack || error.message || error); process.exitCode = 1; })
  .finally(() => {
    const target = path.resolve(temporary);
    if (target.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(target, { recursive: true, force: true });
  });
