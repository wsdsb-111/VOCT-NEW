"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { Memory4RecallPlanner } = require("../resources/app/out/main/memory-system/memory4-recall-planner");
const { projectVisibleTranscript } = require("../resources/app/out/main/memory-system/memory4-visibility");
const { getFactCandidates, scanVisibleDisclosures } = require("../resources/app/out/main/memory-system/memory4-disclosure");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");
const { parseGameState } = require("../resources/app/out/main/worldline/game-state-adapter");
const { getCurrentTruth } = require("../resources/app/out/main/worldline/current-truth-adapter");
const { classifySelectedWorldFacts } = require("../resources/app/out/main/worldline/world-knowledge-classifier");
const { buildSubjectiveWorldPrompt } = require("../resources/app/out/main/worldline/subjective-prompt-context");

const root = fs.mkdtempSync(path.join(__dirname, ".v8.15.1-independent-qa-"));
const campaignToken = "votc-v8151-independent-qa-campaign";
const fixtureDate = "1164.5.20";
let checks = 0;

function check(name, run) {
  return Promise.resolve().then(run).then(() => {
    checks++;
    console.log("PASS " + name);
  });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function snapshotFiles(directory) {
  const result = {};
  const visit = current => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("unexpected_fixture_symlink");
      if (entry.isDirectory()) visit(file);
      else result[path.relative(directory, file)] = fs.readFileSync(file).toString("base64");
    }
  };
  visit(directory);
  return result;
}

function engineFixture(name, ownerIds = [1, 2, 3]) {
  const directory = path.join(root, name);
  const summariesDir = path.join(directory, "summaries");
  for (const id of ownerIds) fs.mkdirSync(path.join(summariesDir, id + "_Fixture"), { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  return { directory, summariesDir, engine, coordinator: engine.memory4 };
}

function characterRoster() {
  return [
    { id: 1, firstName: "甲", shortName: "甲", fullName: "甲", nickname: "北地之虎",
      primaryTitle: "皇帝", traits: [{ id: "trait_bastard", name: "私生子" }] },
    { id: 2, firstName: "乙", shortName: "乙", fullName: "乙", traits: [] },
    { id: 3, firstName: "丙", shortName: "丙", fullName: "丙", primaryTitle: "枢密使", traits: [] }
  ];
}

function makeConversationContext({ ownerId = 2, speakerId = 1, text = "我如今是皇帝，也是私生子。",
  conversationId = "qa-conversation", finalizationId = "qa-finalization", date = fixtureDate,
  joinedOwnerAt = 0, characters = characterRoster() } = {}) {
  const byId = new Map(characters.map(character => [character.id, character]));
  const recipients = [ownerId];
  return {
    campaignToken, ownerId, conversationId, finalizationId, episodeId: "episode-" + finalizationId,
    date, totalDays: 425000, finalizationVisibilityV1: true,
    participants: characters,
    disclosureCharacters: characters,
    disclosureFactEpochsByOwner: {},
    participantPresence: characters.map(character => ({ characterId: character.id,
      joinedAtMessageId: character.id === ownerId ? joinedOwnerAt : 0, leftAtMessageId: null })),
    verifiedSummarySegments: [], relationshipChanges: [],
    messages: [{ id: 1, role: speakerId === 1 ? "user" : "assistant", speakerCharacterId: speakerId,
      characterId: speakerId, content: text, memory4Fragments: [{ start: 0, end: text.length,
        visibility: "participants", sourceType: "spoken", recipientIds: recipients,
        entityIds: [1], knownBy: [ownerId, speakerId] }] }],
    gameData: { campaignToken, date, characters: byId }
  };
}

function buildAndRecordConversation(coordinator, context) {
  const scope = { campaignToken: context.campaignToken, ownerId: context.ownerId };
  coordinator.store.ensureDisclosureScope(scope);
  context.disclosureFactEpochsByOwner = {
    [context.ownerId]: coordinator.captureDisclosureFactEpochs(scope, context.gameData)
  };
  const snapshot = coordinator.buildOwnerSnapshot(context, context.ownerId);
  coordinator.store.recordKnownEvidence(snapshot);
  const result = coordinator.recordDisclosures(snapshot, { campaignToken: snapshot.campaignToken,
    date: snapshot.date, characters: new Map(snapshot.disclosureCharacters.map(character => [character.id, character])) });
  return { snapshot, result, scope };
}

function makeCanonicalSnapshot(scope, name, { date = "1164.1.1", fragmentId = "fragment-" + name,
  text = "乙记得甲曾参与边境议和。", entityIds = [1] } = {}) {
  const finalizationId = "final-" + name;
  const conversationId = "conversation-" + name;
  const fragment = { fragmentId, messageId: 0, sourceMessageIds: [0], text, speakerId: scope.ownerId,
    speakerIds: [scope.ownerId], sourceTextVerified: true, sourceRole: "assistant",
    presentIds: [scope.ownerId, ...entityIds], knownBy: [scope.ownerId, ...entityIds],
    visibility: "participants", sourceType: "spoken", recipientIds: entityIds, entityIds,
    visibilityEvidence: "application_fragment" };
  return { ...scope, conversationId, finalizationId, episodeId: "episode-" + name, date,
    totalDays: 425000, sourceRevision: hash([name, "source"]), presentMessageCount: 1,
    completeness: "complete", summaryIds: [], counterpartIds: entityIds, fragments: [fragment] };
}

function canonicalEntry(fragmentId, text, entityIds = [1], eventTime = { status: "unknown" }) {
  return { memoryType: "DURABLE_KNOWLEDGE", text, fragmentIds: [fragmentId],
    participantIds: [2, ...entityIds], entityIds, topics: ["边境议和"],
    eventTime };
}

async function testWorldlineNormalization() {
  const currentSave = [
    "date=1066.1.1",
    "played_character=1",
    "living={",
    "  1={ first_name=\"甲\" culture=0 rite=34 family_data={ spouse=0 real_father=0 real_mother=0 } landed_data={ liege=0 } }",
    "}",
    "rites={ database={ 34={ faith=100 } } }",
    "faiths={ database={ 100={ faith_type=taoism } } }",
    "culture_manager={ cultures={ 0={ name=han culture_template=han_group } } }"
  ].join("\n");
  const snapshot = parseGameState(currentSave);
  const character = snapshot.characters["1"];
  const candidate = { id: "character:1", kind: "CHARACTER", sourceTier: "GAME_TRUTH",
    gameDate: snapshot.gameDate, payload: { id: "1", character } };
  const facts = classifySelectedWorldFacts({ gameTruth: [candidate] }, snapshot.gameDate, snapshot);
  const prompt = buildSubjectiveWorldPrompt({ promptFacts: facts });
  const faith = getCurrentTruth(snapshot, "1", "faith");
  const culture = getCurrentTruth(snapshot, "1", "culture");
  assert(faith.available, "rite -> faith -> faith type must normalize to an available Current Truth");
  assert(culture.available, "culture runtime ID zero is valid when the save maps it");
  assert(!/^\d+$/.test(String(faith.rawValue)), "a faith runtime ID must not be exposed as a faith name");
  assert(!/^\d+$/.test(String(culture.rawValue)), "a culture runtime ID must not be exposed as a culture name");
  assert(/taoism|道教/i.test(prompt), "the final world-fact prompt should use the canonical faith key: " + prompt);
  assert(/han|漢|汉/i.test(prompt), "the final world-fact prompt should use the canonical culture key: " + prompt);
  assert(!/当前文化为0|当前信仰为100|#0/.test(prompt), "runtime IDs and zero relationship sentinels must not become facts");
  assert(!facts.some(fact => fact.field === "PARENTS" || fact.field === "SPOUSE"), "zero relationship references are empty");
  assert.equal(character.parents.father, null);
  assert.equal(character.spouse, null);
  assert.equal(character.liege, null);

  const unresolved = parseGameState(currentSave.replace("culture=0 rite=34", "culture=77 rite=99"));
  const unresolvedFacts = classifySelectedWorldFacts({ gameTruth: [{ ...candidate,
    payload: { id: "1", character: unresolved.characters["1"] } }] }, unresolved.gameDate, unresolved);
  const unresolvedPrompt = buildSubjectiveWorldPrompt({ promptFacts: unresolvedFacts });
  assert(!unresolvedFacts.some(fact => (fact.field === "CHARACTER_FAITH" || fact.field === "CHARACTER_CULTURE")
    && /\b(?:77|99)\b/.test(fact.value || "")), "unmapped runtime IDs cannot be presented as canonical facts");
  assert(!/\b(?:77|99)\b/.test(unresolvedPrompt), "unresolved culture and rite IDs remain unknown in the prompt");

  const legacy = parseGameState("date=1066.1.1 played_character=1 living={ 1={ first_name=\"甲\" culture=han faith=taoism } }");
  assert.equal(getCurrentTruth(legacy, "1", "faith").rawValue, "taoism", "direct legacy faith fields remain compatible");
  assert.equal(getCurrentTruth(legacy, "1", "culture").rawValue, "han", "direct legacy culture fields remain compatible");
}

async function testMemory4LifecycleRecovery() {
  const fixture = engineFixture("m1-recovery");
  const engine = fixture.engine;
  const scope = { campaignToken, ownerId: 2 };
  const statement = "我如今是皇帝，也是私生子。";
  const context = makeConversationContext({ text: statement, conversationId: "m1-conversation", finalizationId: "m1-finalization" });
  context.finalizationVisibilityV1 = false;
  const prepared = engine.prepareFinalizationContext(context);
  engine.commitFinalization(prepared, { structured: true, sessionSummary: statement, summarySegments: [], memories: [] });
  const narrativeRecoveryPath = engine.writeRecoverySnapshot(prepared, { finalizationStatus: "pending", finalizationStage: "persist" });
  const filter = engine.memory4.store.filterForgottenSnapshot.bind(engine.memory4.store);
  let failOnce = true;
  engine.memory4.store.filterForgottenSnapshot = (snapshot, ...args) => {
    if (Number(snapshot?.ownerId) !== 2) return filter(snapshot, ...args);
    if (failOnce) { failOnce = false; throw new Error("injected_snapshot_io_failure"); }
    return filter(snapshot, ...args);
  };
  const first = await engine.finalizeConversation({ ...prepared,
    requestDurable: async () => JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }) });
  assert.equal(failOnce, false);
  assert(first.durable.owners.some(owner => owner.ownerId === 2 && owner.status === "EXTRACTION_FAILED"),
    "transient snapshot failure remains visible in finalization results: " + JSON.stringify(first));
  assert(fs.existsSync(narrativeRecoveryPath), "committed Narrative recovery material remains available for the failed Owner handoff");
  assert(fs.readFileSync(narrativeRecoveryPath, "utf8").includes(statement),
    "Narrative recovery preserves the source words needed to retry deterministic disclosure");

  const restarted = new MemoryEngine({ baseDir: path.join(fixture.directory, "memory"),
    summaryFoldersDir: fixture.summariesDir, trace: { record() {} } });
  const recovered = await restarted.recoverPendingFinalizations({ activeCampaignToken: campaignToken,
    isMemory4RecoveryCurrent: () => true,
    requestDurable: async () => JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }) });
  assert(recovered.some(owner => owner.status === "NO_DURABLE_CONTENT" || owner.success === true),
    "the restarted Narrative plus Memory4 recovery path must consume the pending handoff: " + JSON.stringify(recovered));
  assert.equal(restarted.listRecoverySnapshots().length, 0, "Narrative recovery clears after the Owner handoff completes");
  assert.equal(fs.readdirSync(restarted.memory4.recoveryDir).filter(name => name.endsWith(".json")).length, 0,
    "Memory4 recovery clears after deterministic extraction completes");
  const disclosures = restarted.memory4.getCurrentDisclosures(scope, 1, context.gameData);
  assert(disclosures.some(fact => fact.factType === "TITLE" && fact.value === "皇帝" && fact.effectiveKnown),
    "a recovered Owner snapshot records its self-disclosed current title");
  assert(disclosures.some(fact => fact.factType === "TRAIT" && fact.value === "私生子" && fact.effectiveKnown),
    "a recovered Owner snapshot records its self-disclosed current trait");
}

async function testCommittedDetailRecovery() {
  const fixture = engineFixture("m2-derived-recovery", [2]);
  const scope = { campaignToken, ownerId: 2 };
  fixture.coordinator.store.ensureDisclosureScope(scope);
  const snapshot = makeCanonicalSnapshot(scope, "m2-primary");
  snapshot.fragments[0].text = "1164年1月1日，甲与乙完成了边境议和。";
  fixture.coordinator.store.commitOwner(snapshot, { status: "STORE",
    entries: [canonicalEntry(snapshot.fragments[0].fragmentId, snapshot.fragments[0].text, [1],
      { status: "reported", precision: "day", from: "1164.1.1", to: "1164.1.1" })] });
  fixture.coordinator.saveRecovery(snapshot, { status: "PENDING", retryCount: 0, lastError: null });

  const restarted = new MemoryEngine({ baseDir: path.join(fixture.directory, "memory"),
    summaryFoldersDir: fixture.summariesDir, trace: { record() {} } });
  restarted.memory4.configureDerived({ isCampaignCurrent: token => token === campaignToken,
    estimateTokens: text => Math.ceil(String(text || "").length / 2) });
  const recovered = await restarted.memory4.recoverPending(null,
    { activeCampaignToken: campaignToken, isNarrativeCommitted: () => true });
  assert(recovered.some(owner => owner.alreadyCommitted === true || owner.derivedRecovered === true
    || owner.status === "COMPLETE"), "recovery must recognize the already committed detail: " + JSON.stringify(recovered));
  for (let attempt = 0; attempt < 20; attempt++) {
    if (restarted.memory4.derived.list(scope).years.length) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const derived = restarted.memory4.derived.list(scope);
  assert(derived.years.some(year => year.eventYear === 1164 && year.items.some(item => item.text.includes("边境议和"))),
    "restarting from an already-committed Detail must still rebuild its eligible Year view");
  assert.equal(fs.readdirSync(restarted.memory4.recoveryDir).filter(name => name.endsWith(".json")).length, 0);
}

async function testCanonicalOnlyRecall() {
  const directory = path.join(root, "m3-canonical-only");
  const summariesDir = path.join(directory, "summaries");
  fs.mkdirSync(summariesDir, { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const scope = { campaignToken, ownerId: 2 };
  engine.memory4.store.ensureDisclosureScope(scope);
  const snapshot = makeCanonicalSnapshot(scope, "canonical-only", { date: "1164.12.31", text: "1164年甲曾在边境议和时交出玉印。" });
  const committed = engine.memory4.store.commitOwner(snapshot, { status: "STORE",
    entries: [canonicalEntry(snapshot.fragments[0].fragmentId, snapshot.fragments[0].text, [1],
      { status: "reported", precision: "year", from: "1164.1.1", to: "1164.12.31" })] });
  assert.equal(fs.existsSync(path.join(summariesDir, "2_Fixture")), false, "the fixture has no Legacy owner directory");
  const target = { id: 1, firstName: "甲", shortName: "甲", fullName: "甲" };
  const planner = new Memory4RecallPlanner(engine.memory4);
  const packet = planner.plan({ ...scope, currentGameDate: "1180.8.11", currentTotalDays: 0,
    conversationId: "canonical-only-query", sceneRevision: "scene", turnEpoch: 1,
    querySpeakerId: 1, entityIds: [1], explicitTargetEntityIds: [1], entityProfiles: [target],
    entityNames: ["甲"], entityNamesById: { 1: ["甲"] }, gameData: { characters: new Map([[1, target]]) },
    query: "甲在边境议和时交出了什么？", topics: ["边境议和"], legacyMemories: [],
    memoryEngineRemainingBudget: 1200, providerRemainingSafeBudget: 1200,
    estimateTokens: text => Math.ceil(String(text || "").length / 2) });
  assert(packet.items.some(item => item.memory.memoryId === committed.entryIds[0]),
    "a valid canonical sidecar must remain recallable without a Legacy folder: " + JSON.stringify(packet.diagnostics));

  const wrongOwner = planner.plan({ campaignToken, ownerId: 3, currentGameDate: "1180.8.11",
    conversationId: "wrong-owner", turnEpoch: 1, querySpeakerId: 1, query: "甲在边境议和时交出了什么？",
    topics: ["边境议和"], legacyMemories: [], estimateTokens: text => Math.ceil(String(text || "").length / 2) });
  assert.equal(wrongOwner.items.length, 0, "canonical-only routing must keep Owner scope closed");

  const indexFile = path.join(engine.memory4.store.directory(scope), "index.json");
  const index = engine.memory4.store.read(indexFile, null);
  index.revision++;
  writeJson(indexFile, index);
  assert.throws(() => planner.plan({ ...scope, currentGameDate: "1180.8.11",
    conversationId: "corrupt-canonical", turnEpoch: 1, querySpeakerId: 1,
    query: "甲在边境议和时交出了什么？", topics: ["边境议和"], legacyMemories: [] }),
  /memory4_metadata_index_mismatch|memory4_index_invalid/,
  "canonical-only routing must still fail closed on a corrupt index");
}

async function testDisclosureDirectionAndEpochs() {
  const fixture = engineFixture("disclosure-contract");
  const coordinator = fixture.coordinator;
  const selfContext = makeConversationContext({ text: "我如今是皇帝，也是私生子。",
    conversationId: "self-disclosure", finalizationId: "self-disclosure-final" });
  const selfResult = buildAndRecordConversation(coordinator, selfContext);
  const scope = selfResult.scope;
  assert.equal(selfResult.result.status, "RECORDED");
  const selfFacts = coordinator.store.getDisclosedFacts(scope, 1);
  assert.deepEqual(new Set(selfFacts.map(fact => fact.factType)), new Set(["TITLE", "TRAIT"]),
    "a speaker's name remains an identity binding and does not become a persisted NAME fact");
  assert(selfFacts.every(fact => fact.knownBy.includes(2)),
    "the entity-scoped disclosure rows belong to the NPC Owner's view of the speaker");
  assert.deepEqual(getFactCandidates({ id: 1, fullName: "甲", nickname: "北地之虎", primaryTitle: "皇帝",
    traits: [{ id: "trait_bastard", name: "私生子" }] }).map(fact => fact.factType).sort(), ["TITLE", "TRAIT"],
  "candidate facts preserve the existing TITLE/TRAIT contract without adding NAME");

  const titleRoster = characterRoster().map(character => character.id === 2
    ? { ...character, primaryTitle: "皇帝" } : character);
  const titleRelationship = makeConversationContext({ ownerId: 1, speakerId: 2, text: "我是皇帝的朋友。",
    conversationId: "self-title-relationship", finalizationId: "self-title-relationship-final", characters: titleRoster });
  const titleRelationshipSnapshot = coordinator.buildOwnerSnapshot(titleRelationship, 1);
  const titleRelationshipFacts = scanVisibleDisclosures(titleRelationshipSnapshot, titleRelationship.gameData).disclosures;
  assert.equal(titleRelationshipFacts.some(fact => fact.entityId === 2 && fact.factType === "TITLE" && fact.value === "皇帝"), false,
    "an NPC's relationship to a title holder must not disclose the title as the NPC's own");

  const braveRoster = characterRoster().map(character => character.id === 1
    ? { ...character, traits: [{ id: "brave", name: "勇敢" }] } : character);
  const traitRelationship = makeConversationContext({ ownerId: 2, speakerId: 1, text: "我很勇敢的弟弟。",
    conversationId: "self-trait-relationship", finalizationId: "self-trait-relationship-final", characters: braveRoster });
  const traitRelationshipSnapshot = coordinator.buildOwnerSnapshot(traitRelationship, 2);
  const traitRelationshipFacts = scanVisibleDisclosures(traitRelationshipSnapshot, traitRelationship.gameData).disclosures;
  assert.equal(traitRelationshipFacts.some(fact => fact.entityId === 1 && fact.factType === "TRAIT" && fact.value === "勇敢"), false,
    "an NPC's relational modifier must not disclose the trait as a direct self-assertion");

  const hiddenRef = coordinator.getCurrentDisclosures(scope, 1, selfContext.gameData)
    .find(fact => fact.factType === "TITLE" && fact.value === "皇帝");
  const hidden = coordinator.deleteDisclosure(scope, 1, hiddenRef, selfContext.gameData,
    { expectedRevision: hiddenRef.revision });
  assert.equal(hidden.status, "MANUAL_HIDDEN");
  const repeated = buildAndRecordConversation(coordinator, makeConversationContext({
    text: "我仍然是皇帝。", conversationId: "self-disclosure-repeat", finalizationId: "self-disclosure-repeat-final"
  }));
  assert.equal(repeated.result.status, "RECORDED");
  assert.equal(coordinator.getCurrentDisclosures(scope, 1, selfContext.gameData)
    .find(fact => fact.factType === "TITLE" && fact.value === "皇帝").status, "MANUAL_HIDDEN",
  "new automatic proof cannot undo the Owner's manual hidden state");

  const thirdPartyFixture = engineFixture("third-party-disclosure", [2, 3]);
  const thirdPartyCoordinator = thirdPartyFixture.coordinator;
  const thirdPartyScope = { campaignToken, ownerId: 2 };
  const otherOwnerScope = { campaignToken, ownerId: 3 };
  thirdPartyCoordinator.store.ensureDisclosureScope(thirdPartyScope);
  thirdPartyCoordinator.store.ensureDisclosureScope(otherOwnerScope);
  const thirdPartyContext = makeConversationContext({ ownerId: 2, speakerId: 3,
    text: "丙说道：“甲是皇帝。”", conversationId: "third-party-disclosure",
    finalizationId: "third-party-disclosure-final" });
  const thirdParty = buildAndRecordConversation(thirdPartyCoordinator, thirdPartyContext);
  assert.equal(thirdParty.result.status, "RECORDED",
    "a direct public assertion by another speaker must be recorded for its listener: " + JSON.stringify(thirdParty.result));
  const heard = thirdPartyCoordinator.getCurrentDisclosures(thirdPartyScope, 1, thirdPartyContext.gameData)
    .find(fact => fact.factType === "TITLE" && fact.value === "皇帝");
  assert(heard?.effectiveKnown, "the named character's current fact is known by the listening Owner");
  const otherOwnerFacts = thirdPartyCoordinator.getCurrentDisclosures(otherOwnerScope, 1, thirdPartyContext.gameData);
  assert.equal(otherOwnerFacts.some(fact => fact.status && fact.effectiveKnown), false,
    "another NPC's Owner folder does not inherit the listener's third-party disclosure");

  const hearsay = buildAndRecordConversation(thirdPartyCoordinator, makeConversationContext({ ownerId: 2, speakerId: 3,
    text: "丙说道：“听说甲是皇帝。”", conversationId: "third-party-hearsay",
    finalizationId: "third-party-hearsay-final" }));
  assert.equal(hearsay.result.status, "NO_DISCLOSURE", "quoted hearsay is not proof that the fact was publicly asserted");

  const epochScope = { campaignToken, ownerId: 3 };
  const epochContext = makeConversationContext({ ownerId: 3, speakerId: 1, text: "我乃皇帝。",
    conversationId: "epoch-first", finalizationId: "epoch-first-final" });
  buildAndRecordConversation(coordinator, epochContext);
  coordinator.refreshCurrentFactState(epochScope, { campaignToken, date: "1164.5.21",
    characters: new Map(characterRoster().map(character => [character.id, { ...character,
      ...(character.id === 1 ? { primaryTitle: "国王" } : {}) }])) });
  const reintroduced = { campaignToken, date: "1164.5.22",
    characters: new Map(characterRoster().map(character => [character.id, character])) };
  coordinator.refreshCurrentFactState(epochScope, reintroduced);
  const staleEpochFact = coordinator.getCurrentDisclosures(epochScope, 1, reintroduced)
    .find(fact => fact.factType === "TITLE" && fact.value === "皇帝");
  assert.equal(staleEpochFact?.effectiveKnown, false,
    "a disclosure from a previous title epoch cannot be revived when the same title returns");
}

async function testLatePresenceAndAtomicDisclosureWrite() {
  const fixture = engineFixture("disclosure-atomic");
  const coordinator = fixture.coordinator;
  const lateContext = makeConversationContext({ ownerId: 2, speakerId: 3,
    text: "丙说道：“甲是皇帝。”", conversationId: "late-presence", finalizationId: "late-presence-final",
    joinedOwnerAt: 2 });
  lateContext.messages = [1, 2].map(id => ({ id, role: "assistant", speakerCharacterId: 3, characterId: 3,
    content: "丙说道：“甲是皇帝。”", memory4Fragments: [{ start: 0, end: "丙说道：“甲是皇帝。”".length,
      visibility: "participants", sourceType: "spoken", recipientIds: [2], knownBy: [2, 3], entityIds: [1] }] }));
  const projected = projectVisibleTranscript(lateContext, 2);
  assert.deepEqual(projected.fragments.map(fragment => fragment.messageId), [2],
    "Owner presence is evaluated at each source message, not at the end of the scene");
  lateContext.disclosureFactEpochsByOwner = {
    2: coordinator.captureDisclosureFactEpochs({ campaignToken, ownerId: 2 }, lateContext.gameData)
  };
  const lateSnapshot = coordinator.buildOwnerSnapshot(lateContext, 2);
  assert.deepEqual(lateSnapshot.fragments.map(fragment => fragment.messageId), [2]);
  coordinator.store.recordKnownEvidence(lateSnapshot);
  const lateResult = coordinator.recordDisclosures(lateSnapshot);
  assert.equal(lateResult.status, "RECORDED");
  assert.deepEqual(Object.values(coordinator.store.getDisclosedFacts({ campaignToken, ownerId: 2 }, 1)[0].evidenceBySource)
    .flatMap(proof => proof.sourceMessageIds), [2], "only the post-arrival source becomes disclosure evidence");

  const atomicContext = makeConversationContext({ ownerId: 2, speakerId: 1,
    text: "我如今是皇帝。", conversationId: "atomic-disclosure", finalizationId: "atomic-disclosure-final" });
  const scope = { campaignToken, ownerId: 2 };
  coordinator.store.ensureDisclosureScope(scope);
  atomicContext.disclosureFactEpochsByOwner = {
    2: coordinator.captureDisclosureFactEpochs(scope, atomicContext.gameData)
  };
  const snapshot = coordinator.buildOwnerSnapshot(atomicContext, 2);
  coordinator.store.recordKnownEvidence(snapshot);
  const directory = coordinator.store.directory(scope);
  const before = snapshotFiles(directory);
  const metadataPath = path.join(directory, "metadata.json");
  const originalWriteJson = coordinator.baseStore.writeJson.bind(coordinator.baseStore);
  let injected = false;
  coordinator.baseStore.writeJson = (file, value) => {
    if (!injected && path.resolve(file) === path.resolve(metadataPath)) {
      injected = true;
      throw new Error("injected_disclosure_metadata_write_failure");
    }
    return originalWriteJson(file, value);
  };
  try {
    assert.throws(() => coordinator.recordDisclosures(snapshot), /injected_disclosure_metadata_write_failure/);
  } finally {
    coordinator.baseStore.writeJson = originalWriteJson;
  }
  assert(injected, "the fixture injected the failure at the disclosure metadata commit boundary");
  assert.deepEqual(snapshotFiles(directory), before,
    "a failed multi-file disclosure commit must restore the previous known-entity, metadata, and index bytes");
  const retried = coordinator.recordDisclosures(snapshot);
  assert.equal(retried.status, "RECORDED", "the source remains retryable after an interrupted durable write");
  assert(coordinator.getCurrentDisclosures(scope, 1, atomicContext.gameData)
    .some(fact => fact.factType === "TITLE" && fact.value === "皇帝" && fact.effectiveKnown));
}

async function testAcceptedLetterDisclosureScope() {
  const fixture = engineFixture("letter-disclosure", [1, 2, 3]);
  const characters = new Map(characterRoster().map(character => [character.id, character]));
  const coordinator = fixture.coordinator;
  const rejected = scanVisibleDisclosures({ sourceKind: "LETTER" }, { campaignToken, date: fixtureDate, characters });
  assert.equal(rejected.skipped, "letter_source_requires_delivery_gate");
  const result = coordinator.recordLetterDisclosures({ campaignToken, date: fixtureDate, ownerId: 2,
    senderId: 1, recipientId: 2, letterId: "accepted-letter", text: "我如今是皇帝。", characters });
  assert.equal(result.status, "RECORDED");
  const ownerRows = coordinator.getCurrentDisclosures({ campaignToken, ownerId: 2 }, 1,
    { campaignToken, date: fixtureDate, characters });
  assert(ownerRows.some(fact => fact.factType === "TITLE" && fact.value === "皇帝" && fact.effectiveKnown));
  const ownerThreeRows = coordinator.getCurrentDisclosures({ campaignToken, ownerId: 3 }, 1,
    { campaignToken, date: fixtureDate, characters });
  assert.equal(ownerThreeRows.some(fact => fact.status && fact.effectiveKnown), false,
    "a received letter informs only its validated recipient Owner");
  const proof = Object.values(coordinator.store.getDisclosedFacts({ campaignToken, ownerId: 2 }, 1)[0].evidenceBySource)[0];
  assert.equal(proof.sourceLetterId, "accepted-letter");
  assert.equal(proof.senderId, 1);
  assert.equal(proof.recipientId, 2);
}

function fakeReact() {
  const states = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  const effects = [];
  const react = {
    Fragment: Symbol("Fragment"),
    createElement(type, props, ...children) { return { type, props: props || {}, children }; },
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef(initial) {
      const index = refIndex++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useEffect(effect) { effects.push(effect); },
    beginRender() { stateIndex = 0; refIndex = 0; effects.length = 0; },
    effects
  };
  return react;
}

function walk(node, visit) {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  if (typeof node !== "object") return;
  visit(node);
  walk(node.children, visit);
}

function findNode(tree, predicate) {
  let found = null;
  walk(tree, node => { if (!found && predicate(node)) found = node; });
  return found;
}

async function testRendererDelayedBodyResponse() {
  const source = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/memory4-manager.js"), "utf8");
  const moduleUrl = "data:text/javascript;base64," + Buffer.from(source, "utf8").toString("base64");
  const { Memory4Manager } = await import(moduleUrl);
  const react = fakeReact();
  let resolveBody;
  let ownerCalls = 0;
  const data = revision => ({ success: true, ownerId: 2, campaignToken, contextId: "ui-context",
    readOnlyArchive: false, readOnlyReason: null, known: { items: [], offset: 0, total: 0 },
    official: [], derived: { years: [], life: null }, legacy: { total: 0, items: [], counts: {} },
    generation: { lastStatus: null, noDurableContentCount: 0 },
    detail: { offset: 0, total: 1, items: [{ entryId: "entry-race", memoryType: "DURABLE_KNOWLEDGE",
      eventTime: { status: "unknown" }, revision }] } });
  const api = {
    async getMemory4OwnerData() { ownerCalls++; return data(ownerCalls === 1 ? 1 : 2); },
    getMemory4Entry() { return new Promise(resolve => { resolveBody = resolve; }); },
    onConversationUpdate() { return () => {}; }
  };
  const previousWindow = globalThis.window;
  globalThis.window = { conversationAPI: api, confirm: () => true };
  try {
    const render = () => {
      react.beginRender();
      return Memory4Manager({ react, ownerId: 2, refreshKey: 0 });
    };
    let tree = render();
    react.effects[0]?.();
    await new Promise(resolve => setImmediate(resolve));
    tree = render();
    const detailTab = findNode(tree, node => node.type === "button" && node.props.role === "tab"
      && node.children.some(child => child === "详细长期记忆"));
    assert(detailTab, "the production detail tab is present");
    detailTab.props.onClick();
    tree = render();
    const rowSummary = findNode(tree, node => node.type === "summary" && typeof node.props.onClick === "function");
    assert(rowSummary, "the production Detail row exposes its asynchronous body loader");
    const bodyRequest = rowSummary.props.onClick({ preventDefault() {} });
    await Promise.resolve();
    assert.equal(typeof resolveBody, "function", "the old body request is pending");

    tree = render();
    const refresh = findNode(tree, node => node.type === "button" && node.props.title === "刷新人物记忆");
    assert(refresh, "the production list refresh action is present");
    await refresh.props.onClick();
    assert.equal(ownerCalls, 2, "the refresh obtains a newer catalog revision");
    resolveBody({ success: true, entry: { entryId: "entry-race", revision: 1, text: "OLD_BODY_REVISION_1",
      conversationDate: "1164.1.1", acquiredDate: "1164.1.1" } });
    await bodyRequest;
    tree = render();
    let oldBodyRendered = false;
    walk(tree, node => { if (node.children?.includes("OLD_BODY_REVISION_1")) oldBodyRendered = true; });
    assert.equal(oldBodyRendered, false, "a body response started before refresh cannot repopulate the fresh list");
  } finally {
    globalThis.window = previousWindow;
  }
}

async function testNameBindingDoesNotBecomeFact() {
  const fixture = engineFixture("name-binding");
  const context = makeConversationContext({ text: "我名叫甲，如今是皇帝。",
    conversationId: "name-binding", finalizationId: "name-binding-final" });
  const recorded = buildAndRecordConversation(fixture.coordinator, context);
  const facts = fixture.coordinator.store.getDisclosedFacts(recorded.scope, 1);
  assert(facts.some(fact => fact.factType === "TITLE" && fact.value === "皇帝"));
  assert.equal(facts.some(fact => fact.factType === "NAME"), false,
    "the subject name remains an NPC identifier in source evidence, not a new disclosure schema type");
  assert(recorded.snapshot.fragments.some(fragment => fragment.entityIds.includes(1) || fragment.speakerId === 1),
    "the person named in the source remains resolvable as the disclosure subject");
}

async function main() {
  const cases = [
    [testWorldlineNormalization, "worldline rite/culture mapping, zero relationship sentinels, unresolved IDs and legacy fields"],
    [testMemory4LifecycleRecovery, "Owner snapshot failure recovery survives restart and records self-disclosed title/trait"],
    [testCommittedDetailRecovery, "already-committed Detail recovery rebuilds eligible Year memory"],
    [testCanonicalOnlyRecall, "canonical-only sidecar recall preserves scope and fail-closed index validation"],
    [testDisclosureDirectionAndEpochs, "self and third-party disclosures retain Owner direction, manual hidden and fact epochs"],
    [testLatePresenceAndAtomicDisclosureWrite, "per-message presence and disclosure persistence rollback under injected failure"],
    [testAcceptedLetterDisclosureScope, "validated Letter disclosure is recipient-scoped and cannot bypass delivery gate"],
    [testRendererDelayedBodyResponse, "renderer discards a delayed pre-refresh Detail body response"],
    [testNameBindingDoesNotBecomeFact, "character names remain subject binding data without adding a NAME fact type"]
  ];
  const failures = [];
  try {
    for (const [run, label] of cases) {
      try { await check(label, run); }
      catch (error) { failures.push({ label, error }); console.error("FAIL " + label + ":", error); }
    }
  } finally {
    const target = path.resolve(root);
    assert(target.startsWith(path.resolve(__dirname) + path.sep), "cleanup path must stay in the script directory");
    fs.rmSync(target, { recursive: true, force: true });
  }
  if (failures.length) throw new Error(failures.length + " of " + cases.length + " independent QA groups failed");
  console.log("V8.15.1 independent QA: PASS (" + checks + " groups; temporary fixtures only)");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
