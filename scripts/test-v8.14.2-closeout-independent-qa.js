"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { getFactCandidates, scanVisibleDisclosures } = require("../resources/app/out/main/memory-system/memory4-disclosure");
const { directSpeechSpans } = require("../resources/app/out/main/memory-system/memory4-entity-context");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-closeout-qa-"));
const summaries = path.join(temporary, "summaries");
for (const id of [2, 3, 4]) fs.mkdirSync(path.join(summaries, `${id}_Fixture`), { recursive: true });
const coordinator = new Memory4Coordinator(new MemoryStore({ baseDir: path.join(temporary, "memory"), summaryFoldersDir: summaries }));
const campaignToken = "closeout-independent-campaign";
const scope = { campaignToken, ownerId: 2 };
const target = { id: 1, firstName: "赵太初", shortName: "赵太初", fullName: "赵太初", nickname: "北地之虎",
  primaryTitle: "明王", traits: [{ id: "bastard", name: "私生子" }] };
const owner = { id: 2, firstName: "张道素", shortName: "张道素", fullName: "张道素", traits: [] };
const speaker = { id: 3, firstName: "张道正", shortName: "张道正", fullName: "张道正", traits: [] };
const bystander = { id: 4, firstName: "李明府", shortName: "李明府", fullName: "李明府", traits: [] };
const characters = [target, owner, speaker, bystander];
const gameData = (date, changedTarget = target, token = campaignToken, rows = characters) => ({ campaignToken: token, date,
  characters: new Map(rows.map(character => [character.id, character.id === 1 ? changedTarget : character])) });
const fact = (character, factType, value) => getFactCandidates(character).find(candidate => candidate.factType === factType && candidate.value === value);

function scan(text, { ownerId = 2, knownBy = [ownerId], roster = characters } = {}) {
  const token = campaignToken;
  const data = { campaignToken: token, date: "1170.1.1", characters: new Map(roster.map(character => [character.id, character])) };
  const snapshot = { campaignToken: token, ownerId, conversationId: "speech-fixture", finalizationId: "speech-finalization",
    date: data.date, sourceRevision: hash("speech-revision"), disclosureCharacters: roster,
    fragments: [{ fragmentId: "speech-fragment", sourceMessageIds: [21], messageId: 21, text, speakerId: 3,
      sourceRole: "assistant", entityIds: roster.map(character => character.id), knownBy, visibility: "public",
      sourceType: "spoken", sourceTextVerified: true, visibilityEvidence: "finalization_validated_segment" }] };
  return scanVisibleDisclosures(snapshot, data).disclosures;
}

function snapshot(date, finalizationId, epoch, text = "“我是明王，也是私生子。”") {
  const candidateRows = getFactCandidates(target);
  return { ...scope, conversationId: `conversation-${finalizationId}`, finalizationId, date,
    sourceRevision: hash(["revision", finalizationId]), disclosureCharacters: characters,
    disclosureFactEpochs: { "1": Object.fromEntries(candidateRows.filter(candidate => candidate.factType !== "AGE")
      .map(candidate => [`${candidate.factType}:${candidate.factKey}`, epoch])) },
    fragments: [{ fragmentId: `fragment-${finalizationId}`, sourceMessageIds: [22], messageId: 22, text,
      speakerId: 1, sourceRole: "assistant", entityIds: [1, 2, 3], knownBy: [2], visibility: "participants",
      sourceType: "spoken", sourceTextVerified: true, visibilityEvidence: "finalization_validated_segment" }] };
}

function commitSource(snapshot, targetScope = scope) {
  const directory = coordinator.store.directory(targetScope);
  fs.mkdirSync(directory, { recursive: true });
  const index = coordinator.store.loadIndex(targetScope);
  const indexPath = path.join(directory, "index.json");
  if (!fs.existsSync(indexPath)) fs.writeFileSync(indexPath, JSON.stringify(index));
  const metadataPath = path.join(directory, "metadata.json");
  const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, "utf8")) : {};
  metadata.campaignToken = targetScope.campaignToken;
  metadata.ownerId = targetScope.ownerId;
  metadata.revision = index.revision;
  metadata.indexHash = hash(index);
  metadata.knownEvidenceRevisions = { ...metadata.knownEvidenceRevisions,
    [hash([snapshot.conversationId, targetScope.ownerId])]: snapshot.sourceRevision };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
}

function record(snapshot, targetScope = scope) {
  commitSource(snapshot, targetScope);
  return coordinator.recordDisclosures(snapshot, { campaignToken: snapshot.campaignToken, date: snapshot.date,
    characters: new Map(snapshot.disclosureCharacters.map(character => [character.id, character])) });
}

function recordLetter(targetScope, date, letterId, text, changedTarget = target) {
  return coordinator.recordLetterDisclosures({ campaignToken: targetScope.campaignToken, date, ownerId: targetScope.ownerId,
    senderId: 3, recipientId: targetScope.ownerId, letterId, text,
    characters: gameData(date, changedTarget, targetScope.campaignToken).characters });
}

function factState(readScope, entityId, factRef) {
  return coordinator.store.readKnownEntities(readScope).currentFactState?.[String(entityId)]?.[`${factRef.factType}:${factRef.factKey}`];
}

try {
  const direct = scan("张道正望向赵太初，心知北地之虎正是明王。“北地之虎是明王，也是私生子。”");
  assert(direct.some(row => row.entityId === 1 && row.factType === "TITLE" && row.value === "明王"),
    "explicit third-person title speech is eligible despite surrounding narration");
  assert(direct.some(row => row.entityId === 1 && row.factType === "TRAIT" && row.value === "私生子"),
    "explicit third-person Trait speech is eligible");
  assert.deepEqual(scan("张道正心想，北地之虎正是明王。"), [], "assistant narration cannot disclose a fact");
  assert.deepEqual(scan("张道正在纸上写下：‘北地之虎是明王。’"), [],
    "quoted writing is not a spoken Disclosure");
  assert.deepEqual(scan("“我听说北地之虎是明王。”"), [], "quoted hearsay cannot disclose a current fact");
  assert.deepEqual(scan("“有人说北地之虎是明王。”"), [], "attributed third-party speech cannot disclose a current fact");
  assert.deepEqual(scan("“北地之虎不是明王。”"), [], "negated direct speech cannot disclose the denied fact");
  assert.deepEqual(directSpeechSpans("“北地之虎是明王。’"), [], "mismatched quote boundaries fail closed");
  assert.deepEqual(scan("“北地之虎是明王。”", { ownerId: 4, knownBy: [2] }), [],
    "a whisper disclosed only to one Owner cannot reach a bystander");
  assert(scan("“北地之虎是明王。”", { ownerId: 2, knownBy: [2] }).some(row => row.entityId === 1),
    "the authorized whisper recipient can learn the claim");

  const duplicateNickname = { id: 5, fullName: "丁", nickname: "北地之虎", traits: [] };
  assert.deepEqual(scan("“北地之虎是明王。”", { roster: [...characters, duplicateNickname] }), [],
    "two characters sharing a nickname are ambiguous");
  const aliasCollision = { ...target, nickname: "张道素" };
  assert.deepEqual(scan("“张道素是明王。”", { roster: [aliasCollision, owner, speaker, bystander] }), [],
    "a nickname colliding with another character's name is ambiguous");

  const initial = gameData("1164.1.1");
  coordinator.refreshCurrentFactState(scope, initial);
  const titleFact = fact(target, "TITLE", "明王");
  const traitFact = fact(target, "TRAIT", "私生子");
  assert.equal(factState(scope, 1, titleFact).epoch, 1);
  const oldSnapshot = snapshot(initial.date, "old-epoch-proof", 1);
  assert.equal(record(oldSnapshot).status, "RECORDED", "a proof tied to the observed first epoch is accepted");

  const initialTitle = coordinator.getCurrentDisclosures(scope, 1, initial).find(row => row.factType === "TITLE");
  const initialTrait = coordinator.getCurrentDisclosures(scope, 1, initial).find(row => row.factType === "TRAIT");
  coordinator.updateManualDisclosure(scope, 1, initialTitle, "MANUAL_KNOWN", initial, { expectedRevision: initialTitle.revision });
  coordinator.deleteDisclosure(scope, 1, initialTrait, initial, { expectedRevision: initialTrait.revision });

  const absent = gameData("1164.1.2", { ...target, primaryTitle: "None", traits: [] });
  coordinator.refreshCurrentFactState(scope, absent);
  assert.equal(factState(scope, 1, titleFact).present, false, "an observed removal closes the current Fact epoch");
  const restored = gameData("1164.1.2");
  coordinator.refreshCurrentFactState(scope, restored);
  assert.equal(factState(scope, 1, titleFact).epoch, 2, "same-day reappearance starts a new epoch");
  assert.equal(coordinator.getCurrentDisclosures(scope, 1, restored).find(row => row.factType === "TITLE").effectiveKnown, false,
    "MANUAL_KNOWN from an earlier epoch does not identify the new Fact");
  assert.equal(coordinator.getCurrentDisclosures(scope, 1, restored).find(row => row.factType === "TRAIT").status, "MANUAL_HIDDEN",
    "MANUAL_HIDDEN continues to suppress a reappearing Fact");

  const stateBeforeHistoricalConflict = coordinator.store.readKnownEntities(scope).currentFactState;
  coordinator.refreshCurrentFactState(scope, absent, { historical: true });
  assert.deepEqual(coordinator.store.readKnownEntities(scope).currentFactState, stateBeforeHistoricalConflict,
    "a conflicting equal-date historical snapshot cannot roll back a live refresh");
  const staleResult = record(oldSnapshot);
  assert.equal(staleResult.changed, false, "an epoch-1 snapshot cannot be rebound to the current epoch");
  const staleTitle = coordinator.getCurrentDisclosures(scope, 1, restored).find(row => row.factType === "TITLE");
  assert.equal(staleTitle.effectiveKnown, false, "stale snapshot replay cannot restore current knowledge");

  const secondEpochSnapshot = snapshot(restored.date, "new-epoch-proof", 2);
  assert.equal(record(secondEpochSnapshot).status, "RECORDED", "a snapshot capturing epoch 2 can establish current knowledge");
  const afterFresh = coordinator.getCurrentDisclosures(scope, 1, restored);
  assert.equal(afterFresh.find(row => row.factType === "TITLE").effectiveKnown, true);
  assert.equal(Object.values(afterFresh.find(row => row.factType === "TITLE").evidenceBySource)[0].factEpoch, 2);
  assert.equal(afterFresh.find(row => row.factType === "TRAIT").status, "MANUAL_HIDDEN",
    "fresh proof cannot override an Owner's manual hide");

  const nextAbsence = gameData("1164.1.3", { ...target, primaryTitle: "None", traits: [] });
  coordinator.refreshCurrentFactState(scope, nextAbsence);
  const nextPresence = gameData("1164.1.3");
  coordinator.refreshCurrentFactState(scope, nextPresence);
  assert.equal(factState(scope, 1, titleFact).epoch, 3);
  assert.equal(coordinator.getCurrentDisclosures(scope, 1, nextPresence).find(row => row.factType === "TITLE").effectiveKnown, false,
    "epoch-2 evidence expires after another observed removal");
  assert.equal(coordinator.getCurrentDisclosures(scope, 1, nextPresence).find(row => row.factType === "TRAIT").status, "MANUAL_HIDDEN");

  const beforeMissingDto = factState(scope, 1, titleFact);
  coordinator.refreshCurrentFactState(scope, { ...nextPresence, date: "1164.1.4", characters: new Map([[2, owner]]) });
  assert.deepEqual(factState(scope, 1, titleFact), beforeMissingDto, "a missing Character DTO is not evidence that its Facts disappeared");
  const traitBeforePartialDto = factState(scope, 1, traitFact);
  const partialCharacter = { id: 1, primaryTitle: "None" };
  coordinator.refreshCurrentFactState(scope, { ...nextPresence, date: "1164.1.5",
    characters: new Map([[1, partialCharacter], [2, owner]]) });
  assert.deepEqual(factState(scope, 1, traitFact), traitBeforePartialDto,
    "a partial Character DTO without Trait data cannot imply Trait absence");
  const serializedBeforeRead = fs.readFileSync(path.join(coordinator.store.directory(scope), "known-entities.json"), "utf8");
  coordinator.getCurrentDisclosures(scope, 1, gameData("1164.1.6", { ...target, traits: [] }));
  assert.equal(fs.readFileSync(path.join(coordinator.store.directory(scope), "known-entities.json"), "utf8"), serializedBeforeRead,
    "profile reads do not refresh or mutate current Fact state");

  const otherOwner = { campaignToken, ownerId: 3 };
  const otherCampaign = { campaignToken: "independent-campaign", ownerId: 2 };
  coordinator.refreshCurrentFactState(otherOwner, gameData("1164.1.3"));
  coordinator.refreshCurrentFactState(otherCampaign, gameData("1164.1.3", target, otherCampaign.campaignToken));
  assert.equal(factState(otherOwner, 1, titleFact).epoch, 1, "another Owner has an isolated Fact epoch");
  assert.equal(factState(otherCampaign, 1, titleFact).epoch, 1, "another Campaign has an isolated Fact epoch");
  assert.equal(coordinator.getCurrentDisclosures(otherOwner, 1, gameData("1164.1.3")).some(row => row.effectiveKnown), false,
    "one Owner's disclosure evidence is not visible to another Owner");
  assert.equal(factState(scope, 1, titleFact).epoch, 3, "refreshing another Owner or Campaign cannot alter the original epoch");

  const legacyScope = { campaignToken: "legacy-migration-campaign", ownerId: 2 };
  coordinator.recordLetterDisclosures({ ...legacyScope, date: "1164.1.1", senderId: 1, recipientId: 2,
    letterId: "legacy-proof", text: "我乃明王。", characters: gameData("1164.1.1").characters });
  const legacyDirectory = coordinator.store.directory(legacyScope);
  const legacyKnown = coordinator.store.readKnownEntities(legacyScope);
  delete legacyKnown.currentFactState;
  for (const disclosedFact of Object.values(legacyKnown.entities["1"].disclosedFacts)) {
    for (const proof of Object.values(disclosedFact.evidenceBySource)) delete proof.factEpoch;
  }
  fs.writeFileSync(path.join(legacyDirectory, "known-entities.json"), JSON.stringify(legacyKnown));
  const legacyPresent = gameData("1164.1.2", target, legacyScope.campaignToken);
  coordinator.refreshCurrentFactState(legacyScope, legacyPresent);
  assert.equal(coordinator.getCurrentDisclosures(legacyScope, 1, legacyPresent).find(row => row.factType === "TITLE").effectiveKnown, true,
    "legacy evidence migrates to epoch 1 on first observed presence");
  coordinator.refreshCurrentFactState(legacyScope, gameData("1164.1.3", { ...target, primaryTitle: "None" }, legacyScope.campaignToken));
  const legacyRestored = gameData("1164.1.4", target, legacyScope.campaignToken);
  coordinator.refreshCurrentFactState(legacyScope, legacyRestored);
  assert.equal(coordinator.getCurrentDisclosures(legacyScope, 1, legacyRestored).find(row => row.factType === "TITLE").effectiveKnown, false,
    "migrated epoch-1 proof cannot survive a later absence and reappearance");

  const sameDayLegacyScope = { campaignToken: "same-day-first-absence-campaign", ownerId: 2 };
  const transitionDate = "1164.2.1";
  coordinator.recordLetterDisclosures({ ...sameDayLegacyScope, date: transitionDate, senderId: 1, recipientId: 2,
    letterId: "same-day-legacy-proof", text: "我乃明王。", characters: gameData(transitionDate).characters });
  const sameDayKnown = coordinator.store.readKnownEntities(sameDayLegacyScope);
  delete sameDayKnown.currentFactState;
  delete sameDayKnown.currentFactObservedDates;
  for (const disclosedFact of Object.values(sameDayKnown.entities["1"].disclosedFacts)) {
    for (const proof of Object.values(disclosedFact.evidenceBySource)) delete proof.factEpoch;
  }
  fs.writeFileSync(path.join(coordinator.store.directory(sameDayLegacyScope), "known-entities.json"), JSON.stringify(sameDayKnown));
  const firstObservedAbsent = gameData(transitionDate, { ...target, primaryTitle: "None", traits: [] }, sameDayLegacyScope.campaignToken);
  coordinator.refreshCurrentFactState(sameDayLegacyScope, firstObservedAbsent);
  assert.equal(factState(sameDayLegacyScope, 1, titleFact).epoch, 0, "first observing absence leaves the legacy Fact unbound");
  const firstObservedPresent = gameData(transitionDate, target, sameDayLegacyScope.campaignToken);
  coordinator.refreshCurrentFactState(sameDayLegacyScope, firstObservedPresent);
  const sameDayState = factState(sameDayLegacyScope, 1, titleFact);
  assert.equal(sameDayState.epoch, 1);
  assert.equal(sameDayState.legacyContinuous, false, "same-day reappearance after observed absence is not a legacy continuity");
  assert.equal(coordinator.getCurrentDisclosures(sameDayLegacyScope, 1, firstObservedPresent)
    .find(row => row.factType === "TITLE").effectiveKnown, false,
  "an epochless legacy source cannot bind after same-day first absence and reappearance");
  const unboundSnapshot = snapshot(transitionDate, "epochless-after-absence", 1);
  unboundSnapshot.campaignToken = sameDayLegacyScope.campaignToken;
  delete unboundSnapshot.disclosureFactEpochs;
  assert.equal(unboundSnapshot.disclosureFactEpochs, undefined);
  assert.equal(factState(sameDayLegacyScope, 1, titleFact).legacyContinuous, false);
  const unboundResult = record(unboundSnapshot, sameDayLegacyScope);
  assert.equal(unboundResult.status, "RECORDED", "the independent continuous trait may still be recorded");
  const titleAfterEpochlessReplay = coordinator.getCurrentDisclosures(sameDayLegacyScope, 1, firstObservedPresent)
    .find(row => row.factType === "TITLE");
  assert.equal(titleAfterEpochlessReplay.effectiveKnown, false,
    "an epochless snapshot cannot attach title proof to epoch 1 after observed absence");
  assert.equal(Object.values(titleAfterEpochlessReplay.evidenceBySource)
    .some(proof => proof.sourceKind === "CONVERSATION"), false,
  "the replay must not persist epochless conversation proof for the reappeared title");

  const letterScope = { campaignToken: "letter-fact-epoch-campaign", ownerId: 2 };
  const firstLetterDate = "1164.3.1";
  assert.equal(recordLetter(letterScope, firstLetterDate, "replaceable-letter", "赵太初是明王。").status, "RECORDED");
  assert.equal(coordinator.getCurrentDisclosures(letterScope, 1, gameData(firstLetterDate, target, letterScope.campaignToken))
    .find(row => row.factType === "TITLE").effectiveKnown, true);
  recordLetter(letterScope, firstLetterDate, "replaceable-letter", "赵太初不是明王。");
  assert.equal(coordinator.getCurrentDisclosures(letterScope, 1, gameData(firstLetterDate, target, letterScope.campaignToken))
    .find(row => row.factType === "TITLE").effectiveKnown, false,
  "changed text for the same letter withdraws its old title proof within the same Fact epoch");

  assert.equal(recordLetter(letterScope, firstLetterDate, "epoch-one-letter", "赵太初是明王。").status, "RECORDED");
  const letterAbsent = gameData("1164.3.2", { ...target, primaryTitle: "None" }, letterScope.campaignToken);
  coordinator.refreshCurrentFactState(letterScope, letterAbsent);
  const letterRestored = gameData("1164.3.2", target, letterScope.campaignToken);
  coordinator.refreshCurrentFactState(letterScope, letterRestored);
  assert.equal(factState(letterScope, 1, titleFact).epoch, 2);
  assert.equal(recordLetter(letterScope, letterRestored.date, "epoch-one-letter", "赵太初是明王。").status, "NO_DISCLOSURE",
    "same-day replay of an archived letter ID cannot rebind its epoch-1 proof to epoch 2");
  assert.equal(coordinator.getCurrentDisclosures(letterScope, 1, letterRestored).find(row => row.factType === "TITLE").effectiveKnown, false);
  assert.equal(recordLetter(letterScope, letterRestored.date, "fresh-epoch-two-letter", "赵太初是明王。").status, "RECORDED",
    "a new letter ID can establish proof for the reappeared Fact epoch");
  assert.equal(coordinator.getCurrentDisclosures(letterScope, 1, letterRestored).find(row => row.factType === "TITLE").effectiveKnown, true);

  const staleScope = { campaignToken: "uncommitted-snapshot-campaign", ownerId: 2 };
  coordinator.refreshCurrentFactState(staleScope, gameData("1164.1.1", target, staleScope.campaignToken));
  const beforeUncommitted = coordinator.store.readKnownEntities(staleScope).currentFactState;
  const staleTarget = { ...target, primaryTitle: "None", traits: [] };
  const staleCharacters = characters.map(character => character.id === 1 ? staleTarget : character);
  const uncommitted = { ...snapshot("1180.1.1", "uncommitted-later-snapshot", 1), campaignToken: staleScope.campaignToken,
    disclosureCharacters: staleCharacters };
  const rejected = coordinator.recordDisclosures(uncommitted, { campaignToken: staleScope.campaignToken, date: uncommitted.date,
    characters: new Map(staleCharacters.map(character => [character.id, character])) });
  assert.equal(rejected.status, "SKIPPED", "an uncommitted source revision is rejected");
  assert.deepEqual(coordinator.store.readKnownEntities(staleScope).currentFactState, beforeUncommitted,
    "a rejected future-dated snapshot must not advance current Fact state");

  const invalidScope = { campaignToken: "invalid-refresh-must-not-create", ownerId: 2 };
  const invalidSidecar = path.join(summaries, ".memory4", String(invalidScope.ownerId), hash(invalidScope.campaignToken));
  assert.equal(fs.existsSync(invalidSidecar), false);
  assert.throws(() => coordinator.refreshCurrentFactState(invalidScope,
    { ...initial, campaignToken: "wrong-campaign" }), error => error.message === "memory4_disclosure_current_scope_invalid");
  assert.equal(fs.existsSync(invalidSidecar), false, "a rejected scope/date must not create Owner storage");

  console.log("PASS V8.14.2 independent closeout QA: speech provenance, alias ambiguity, epoch migration/replay, partial snapshots, and scope isolation");
} finally {
  const resolved = path.resolve(temporary);
  assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("votc-v8142-closeout-qa-"));
  fs.rmSync(resolved, { recursive: true, force: true });
}
