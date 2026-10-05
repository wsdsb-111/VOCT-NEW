"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const events = require("node:events");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { Memory4Store } = require("../resources/app/out/main/memory-system/memory4-store");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { getFactCandidates, disclosureFactId, isCurrentAgeAssertion, scanVisibleDisclosures } = require("../resources/app/out/main/memory-system/memory4-disclosure");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-age-disclosure-"));
const summariesDir = path.join(temporary, "summaries");
fs.mkdirSync(summariesDir, { recursive: true });
const backingStore = new MemoryStore({ baseDir: path.join(temporary, "memory"), summaryFoldersDir: summariesDir });
const memory4 = new Memory4Store(backingStore);
const scope = { campaignToken: "age-campaign", ownerId: 2 };
const target = { id: 1, age: 23, traits: [] };
const owner = { id: 2, age: 31, traits: [] };
const candidate = { factType: "AGE", factKey: "age_23", canonicalKey: "23", value: "23", aliases: [] };
const sourceRevision = hash("age-source-revision");
const snapshot = { ...scope, sourceKind: "CONVERSATION", conversationId: "age-conversation", finalizationId: "age-finalization",
  date: "1164.5.20", sourceRevision, disclosureCharacters: [target, owner] };

function recordAgeDisclosure() {
  memory4.ensureDisclosureScope(scope);
  const directory = memory4.directory(scope);
  const metadataPath = path.join(directory, "metadata.json");
  const metadata = memory4.read(metadataPath, null);
  metadata.knownEvidenceRevisions = { ...metadata.knownEvidenceRevisions,
    [hash([snapshot.conversationId, scope.ownerId])]: sourceRevision };
  backingStore.writeJson(metadataPath, metadata);
  const factId = disclosureFactId(scope, target.id, "AGE", candidate.factKey);
  return memory4.recordDisclosures(snapshot, [{ entityId: target.id, factType: "AGE", factKey: candidate.factKey,
    value: candidate.value, factId, evidence: { sourceMessageIds: [17], sourceFragmentIds: ["age-fragment"],
      visibilityEvidence: ["finalization_source_paragraph"], sourceTextHashes: [hash("我今年23岁")] } }]);
}

function scanSnapshot(text, age = target.age) {
  const fragment = { fragmentId: "age-fragment", sourceMessageIds: [17], messageId: 17, text, speakerId: target.id,
    entityIds: [target.id], knownBy: [scope.ownerId, target.id], visibility: "participants", sourceType: "spoken",
    sourceTextVerified: true, visibilityEvidence: "finalization_source_paragraph", sourceRole: "user" };
  return { ...scope, date: snapshot.date, sourceRevision: hash([text, age]), fragments: [fragment] };
}

async function run() {
  try {
    assert.deepEqual(getFactCandidates({ age: 0 }).filter(fact => fact.factType === "AGE").map(fact => fact.value), ["0"]);
    assert.deepEqual(getFactCandidates({ age: "23" }).filter(fact => fact.factType === "AGE").map(fact => fact.value), ["23"]);
    assert.deepEqual(getFactCandidates({ age: 23 }).filter(fact => fact.factType === "AGE"), [candidate]);
    assert.deepEqual(getFactCandidates({ age: 23, facts: [{ factType: "AGE", value: "24" }] })
      .filter(fact => fact.factType === "AGE").map(fact => fact.value), ["23"], "candidate facts cannot override the CK3 age field");
    assert.deepEqual(getFactCandidates({ facts: [candidate] }).filter(fact => fact.factType === "AGE"), [candidate],
      "a normalized age candidate must survive a disclosure profile projection without the top-level age field");
    assert.equal(getFactCandidates({ age: "", facts: [candidate] }).some(fact => fact.factType === "AGE"), false,
      "an explicit unknown age must not fall back to a stale structured candidate");
    for (const age of [undefined, null, "", "  ", "age", "0x17", "23.5", -1, 1.5, NaN, Infinity]) {
      assert.equal(getFactCandidates({ age }).some(fact => fact.factType === "AGE"), false, `invalid CK3 age ${String(age)} must not become a candidate`);
    }

    const spokenFact = { factType: "AGE", value: "23" };
    const speakerFragment = { speakerId: 1 };
    assert.equal(isCurrentAgeAssertion("我今年23岁", ["我"], spokenFact, speakerFragment), true);
    assert.equal(isCurrentAgeAssertion("我现在二十三岁", ["我"], spokenFact, speakerFragment), true);
    assert.equal(isCurrentAgeAssertion("我二十三岁", ["我"], spokenFact, speakerFragment), true);
    for (const sentence of ["我去年23岁", "我计划今年23岁", "我不是23岁", "听说我今年23岁", "他今年23岁", "他说我今年23岁"]) {
      assert.equal(isCurrentAgeAssertion(sentence, ["我"], spokenFact, speakerFragment), false, `${sentence} is not a current self-disclosure`);
    }
    assert.equal(isCurrentAgeAssertion("我今年23岁", ["赵太初"], spokenFact, speakerFragment), false,
      "a name match alone cannot attribute a first-person age claim to another character");
    assert.equal(isCurrentAgeAssertion("我今年23岁", ["我"], { ...spokenFact, value: "24" }, speakerFragment), false,
      "the asserted age must match the CK3 age candidate");
    assert.equal(scanVisibleDisclosures(scanSnapshot("我今年23岁。"), { campaignToken: scope.campaignToken, date: snapshot.date,
      characters: new Map([[target.id, target], [owner.id, owner]]) }).disclosures.length, 1,
    "a validated source paragraph can disclose the speaker's matching current CK3 age");
    assert.equal(scanVisibleDisclosures(scanSnapshot("我今年20岁。"), { campaignToken: scope.campaignToken, date: snapshot.date,
      characters: new Map([[target.id, target], [owner.id, owner]]) }).disclosures.length, 0,
    "an age statement that disagrees with the date-current CK3 candidate is not recorded");

    const recorded = recordAgeDisclosure();
    assert.equal(recorded.count, 1);
    const currentTruth = { campaignToken: scope.campaignToken, date: "1164.5.21", characters: new Map([[1, { ...target, age: 24 }], [2, owner]]) };
    const disclosed = memory4.getCurrentDisclosures(scope, target.id, currentTruth);
    assert.equal(disclosed.length, 1, "undisclosed current age must not appear beside historical disclosures");
    assert.equal(disclosed[0].factType, "AGE");
    assert.equal(disclosed[0].value, "23");
    assert.equal(disclosed[0].current, false, "a disclosed age is historical even if CK3 age later changes");
    assert.equal(disclosed[0].firstAcquiredDate, snapshot.date);
    assert.equal(disclosed[0].effectiveKnown, true);

    const beforeDisclosure = memory4.getCurrentDisclosures(scope, target.id, { ...currentTruth, date: "1164.5.19" });
    assert.deepEqual(beforeDisclosure, [], "future age disclosure must stay hidden before its proof date");
    assert.throws(() => memory4.updateManualDisclosure(scope, target.id, candidate, "MANUAL_KNOWN", "1164.5.21", 0), /invalid/i,
      "AGE records cannot be manually marked known");

    const invalidatedMetadataPath = path.join(memory4.directory(scope), "metadata.json");
    const invalidatedMetadata = memory4.read(invalidatedMetadataPath, null);
    invalidatedMetadata.knownEvidenceRevisions[hash([snapshot.conversationId, scope.ownerId])] = hash("changed-source-revision");
    backingStore.writeJson(invalidatedMetadataPath, invalidatedMetadata);
    assert.deepEqual(memory4.getCurrentDisclosures(scope, target.id, currentTruth), [],
      "a changed conversation source revision invalidates its historical age proof");

    const conversationSummaries = path.join(temporary, "conversation-summaries");
    fs.mkdirSync(conversationSummaries, { recursive: true });
    const engine = new MemoryEngine({ baseDir: path.join(temporary, "conversation-memory"),
      summaryFoldersDir: conversationSummaries, trace: { record() {} } });
    const gameData = { campaignToken: scope.campaignToken, date: snapshot.date, totalDays: 424242, playerID: 1, aiID: 2,
      characters: new Map([[1, { id: 1, name: "赵太初", firstName: "赵太初", shortName: "赵太初", fullName: "赵太初", age: 23, traits: [] }],
        [2, { id: 2, name: "张道素", firstName: "张道素", shortName: "张道素", fullName: "张道素", age: 31, traits: [] }]]),
      ck3RelationshipReadbackComplete: false, loadCharactersSummaries() {} };
    const debugLogPath = path.join(temporary, "conversation-debug.log");
    fs.writeFileSync(debugLogPath, "deterministic fixture", "utf8");
    Conversation.configure({ memoryEngine: engine,
      settingsRepository: { getCK3DebugLogPath: () => debugLogPath, getChatPromptV813Layout: () => false },
      runFileManager: { isAvailable: () => true }, parseLog: async () => gameData,
      createError: input => ({ type: "error", ...input }), createMessage: input => ({ type: "message", ...input }),
      events, uuid: { v4: () => "age-conversation-e2e" }, path });
    const conversation = new Conversation();
    await conversation.gameDataReady;
    await conversation.worldlinePrefetchPromise;
    await conversation.memoryRecoveryPromise;
    assert.equal(conversation.isActive, true, "the production Conversation must initialize with deterministic game data");
    engine.observeParticipants(conversation, [1, 2], 0);
    conversation.messages.push({ id: 17, role: "user", speakerCharacterId: 1, name: "赵太初", content: "我今年23岁。" });
    conversation.nextId = 18;
    const context = conversation.buildFinalizationBaseContext();
    context.finalizationId = "age-conversation-e2e-finalization";
    const ageFromConversation = context.disclosureCharacters.find(character => character.id === 1)?.facts
      .find(fact => fact.factType === "AGE");
    assert.equal(ageFromConversation?.value, "23", "Conversation must capture its date-current CK3 age candidate");
    const ownerSnapshot = engine.memory4.buildOwnerSnapshot(context, 2);
    assert.equal(ownerSnapshot.disclosureCharacters.find(character => character.id === 1)?.facts
      .find(fact => fact.factType === "AGE")?.value, "23",
    "buildOwnerSnapshot must preserve the normalized AGE through its facts-only projection");
    assert(ownerSnapshot.fragments.some(fragment => fragment.visibilityEvidence === "finalization_source_paragraph"
      && fragment.text === "我今年23岁。"), "the source paragraph must survive Conversation owner projection");
    const ownerScope = { campaignToken: scope.campaignToken, ownerId: 2 };
    engine.memory4.store.ensureDisclosureScope(ownerScope);
    engine.memory4.store.recordKnownEvidence(ownerSnapshot);
    const result = engine.memory4.recordDisclosures(ownerSnapshot, { campaignToken: ownerSnapshot.campaignToken,
      date: ownerSnapshot.date, characters: new Map(ownerSnapshot.disclosureCharacters.map(character => [character.id, character])) });
    assert.equal(result.status, "RECORDED", "the projected AGE must pass source scanning and persist through the Memory4 Store");
    const currentTruthAfterAgeUp = { campaignToken: scope.campaignToken, date: "1164.5.21",
      characters: new Map([[1, { ...gameData.characters.get(1), age: 24 }], [2, gameData.characters.get(2)]]) };
    const endToEndHistory = engine.memory4.getCurrentDisclosures(ownerScope, 1, currentTruthAfterAgeUp)
      .find(fact => fact.factType === "AGE");
    assert.equal(endToEndHistory?.value, "23");
    assert.equal(endToEndHistory?.firstAcquiredDate, snapshot.date);
    assert.equal(endToEndHistory?.current, false, "the production read path must retain the original age/date as historical");
    console.log("V8.14.2 age disclosure: PASS (validated age candidates, self-claim assertions, historical date and source revision gates)");
  } finally {
    const targetPath = path.resolve(temporary);
    assert(targetPath.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
