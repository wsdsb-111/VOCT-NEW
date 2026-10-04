"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { getFactCandidates, scanVisibleDisclosures } = require("../resources/app/out/main/memory-system/memory4-disclosure");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-disclosure-core-"));
const summariesDir = path.join(temporary, "summaries");
for (const id of [1, 2, 3, 4]) fs.mkdirSync(path.join(summariesDir, `${id}_Fixture`), { recursive: true });
const coordinator = new Memory4Coordinator(new MemoryStore({ baseDir: path.join(temporary, "memory"), summaryFoldersDir: summariesDir }));
const scope = { campaignToken: "disclosure-campaign", ownerId: 2 };
const target = { id: 1, firstName: "甲", shortName: "甲", fullName: "甲", primaryTitle: "明王", traits: [{ name: "私生子" }] };
const owner = { id: 2, firstName: "乙", shortName: "乙", fullName: "乙", traits: [] };
const bystander = { id: 3, firstName: "丙", shortName: "丙", fullName: "丙", traits: [] };
const characters = new Map([[1, target], [2, owner], [3, bystander]]);
const gameData = { campaignToken: scope.campaignToken, date: "1164.5.20", characters };
const makeSnapshot = (text = "我乃明王，也是私生子。", overrides = {}) => ({ ...scope, conversationId: "conversation-1",
  finalizationId: "finalization-1", date: gameData.date, sourceRevision: hash("source-revision-1"),
  disclosureCharacters: [...characters.values()], fragments: [{ fragmentId: "segment-1", sourceMessageIds: [11], messageId: 11,
    text, speakerId: 1, entityIds: [1], knownBy: [1, 2], visibility: "participants", sourceType: "spoken",
    sourceTextVerified: true, visibilityEvidence: "finalization_validated_segment" }], ...overrides });
const factRow = (rows, type, value) => rows.find(row => row.factType === type && row.value === value);
function markSnapshotCommitted(snapshot) {
  const snapshotScope = { campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId };
  const directory = coordinator.store.directory(snapshotScope);
  fs.mkdirSync(directory, { recursive: true });
  const index = coordinator.store.loadIndex(snapshotScope);
  const indexPath = path.join(directory, "index.json");
  if (!fs.existsSync(indexPath)) fs.writeFileSync(indexPath, JSON.stringify(index));
  const metadataPath = path.join(directory, "metadata.json");
  const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, "utf8")) : {};
  metadata.campaignToken = snapshotScope.campaignToken;
  metadata.ownerId = snapshotScope.ownerId;
  metadata.revision = index.revision;
  metadata.indexHash = hash(index);
  metadata.knownEvidenceRevisions = { ...metadata.knownEvidenceRevisions,
    [hash([snapshot.conversationId, snapshot.ownerId])]: snapshot.sourceRevision };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
}
function recordSnapshot(snapshot) {
  markSnapshotCommitted(snapshot);
  return coordinator.recordDisclosures(snapshot, { campaignToken: snapshot.campaignToken, date: snapshot.date,
    characters: new Map(snapshot.disclosureCharacters.map(character => [character.id, character])) });
}

function expectNoDisclosure(snapshot, data = gameData) {
  assert.deepEqual(scanVisibleDisclosures(snapshot, data).disclosures, []);
}

async function run() {
  try {
    const rankAndPositions = getFactCandidates({ primaryTitle: "None", titleRankConcept: "concept_kingdom",
      heldCourtAndCouncilPositions: "枢密使；侍中，军机大臣", traits: [{ id: "bastard", name: "私生子" }] });
    assert.deepEqual(new Set(rankAndPositions.filter(row => row.factType === "TITLE").map(row => row.value)),
      new Set(["国王", "枢密使", "侍中", "军机大臣"]),
      "only actual rank mapping and individual explicit office values should become title candidates");
    assert(rankAndPositions.find(row => row.value === "国王").aliases.includes("king"));
    assert(rankAndPositions.find(row => row.value === "国王").aliases.includes("concept_kingdom"));
    assert(!getFactCandidates({ primaryTitle: "concept_none", titleRankConcept: "concept_none", heldCourtAndCouncilPositions: "无" }).length,
      "empty title sentinels are not disclosure candidates");

    const snapshot = makeSnapshot();
    const first = recordSnapshot(snapshot);
    assert.equal(first.status, "RECORDED");
    assert.equal(first.count, 2, "one declarative clause may disclose multiple independently matched facts");
    const rows = coordinator.getCurrentDisclosures(scope, 1, gameData);
    const title = factRow(rows, "TITLE", "明王");
    const trait = factRow(rows, "TRAIT", "私生子");
    assert(title && trait);
    assert.equal(title.factKey, "title_明王");
    assert.equal(trait.factKey, "trait_bastard");
    assert.deepEqual({ campaignToken: title.campaignToken, ownerId: title.ownerId, entityId: title.entityId },
      { campaignToken: scope.campaignToken, ownerId: scope.ownerId, entityId: 1 });
    assert.equal(title.status, "AUTO_DISCLOSED");
    assert.equal(title.effectiveKnown, true);
    assert.equal(Object.values(title.evidenceBySource)[0].sourceKind, "CONVERSATION");
    assert.deepEqual(Object.values(title.evidenceBySource)[0].sourceMessageIds, [11]);

    const indexBeforeRepeat = coordinator.store.loadIndex(scope).revision;
    const repeated = recordSnapshot(snapshot);
    assert.equal(repeated.changed, false, "the same source revision is idempotent");
    assert.equal(coordinator.store.loadIndex(scope).revision, indexBeforeRepeat);

    const ownerThreeScope = { campaignToken: scope.campaignToken, ownerId: 3 };
    const isolatedSnapshot = makeSnapshot("我乃明王。", { ownerId: 3, conversationId: "conversation-owner-3",
      finalizationId: "finalization-owner-3", sourceRevision: hash("owner-3-source"),
      fragments: [{ ...snapshot.fragments[0], fragmentId: "segment-owner-3", sourceMessageIds: [12], messageId: 12, knownBy: [1, 3] }] });
    recordSnapshot(isolatedSnapshot);
    const isolatedChanged = makeSnapshot("我不是明王。", { ownerId: 3, conversationId: "conversation-owner-3",
      finalizationId: "finalization-owner-3", sourceRevision: hash("owner-3-source-2"),
      fragments: [{ ...snapshot.fragments[0], fragmentId: "segment-owner-3", sourceMessageIds: [12], messageId: 12, text: "我不是明王。", knownBy: [1, 3] }] });
    recordSnapshot(isolatedChanged);
    assert.equal(factRow(coordinator.getCurrentDisclosures(ownerThreeScope, 1, gameData), "TITLE", "明王").status, null,
      "a changed source revision removes its unsupported automatic proof");
    const firstOwnerThreeProof = makeSnapshot("我乃明王。", { ownerId: 3, conversationId: "conversation-owner-3-revision",
      finalizationId: "finalization-owner-3-revision-1", sourceRevision: hash("owner-3-revision-1"),
      fragments: [{ ...snapshot.fragments[0], fragmentId: "segment-owner-3-revision", sourceMessageIds: [13], messageId: 13, knownBy: [1, 3] }] });
    recordSnapshot(firstOwnerThreeProof);
    const firstOwnerThreeRow = factRow(coordinator.getCurrentDisclosures(ownerThreeScope, 1, gameData), "TITLE", "明王");
    const nextOwnerThreeProof = makeSnapshot("我仍是明王。", { ownerId: 3, conversationId: "conversation-owner-3-revision",
      finalizationId: "finalization-owner-3-revision-2", sourceRevision: hash("owner-3-revision-2"),
      fragments: [{ ...firstOwnerThreeProof.fragments[0], text: "我仍是明王。", sourceMessageIds: [14], messageId: 14 }] });
    recordSnapshot(nextOwnerThreeProof);
    assert(factRow(coordinator.getCurrentDisclosures(ownerThreeScope, 1, gameData), "TITLE", "明王").revision > firstOwnerThreeRow.revision,
      "replacing proof in a new finalization must not reset the manual expectedRevision guard");

    const readContext = coordinator.createProfileReadContext(scope);
    let readCount = 0;
    const originalRead = coordinator.store.read.bind(coordinator.store);
    coordinator.store.read = (...args) => { readCount++; return originalRead(...args); };
    assert(factRow(coordinator.getCurrentDisclosures(scope, 1, gameData, { readContext }), "TITLE", "明王"));
    assert.equal(readCount, 0, "frozen Profile read context must avoid a per-entity sidecar read");
    coordinator.store.read = originalRead;

    assert.equal(factRow(coordinator.getCurrentDisclosures({ campaignToken: scope.campaignToken, ownerId: 4 }, 1, gameData), "TITLE", "明王").effectiveKnown, false,
      "a co-present owner must not inherit another Owner's disclosure");
    assert.throws(() => coordinator.getCurrentDisclosures(scope, 1, { ...gameData, campaignToken: "other-campaign" }), /scope/i);

    const hidden = coordinator.deleteDisclosure(scope, 1, title, gameData, { expectedRevision: title.revision });
    assert.equal(hidden.status, "MANUAL_HIDDEN");
    assert.equal(hidden.effectiveKnown, false);
    assert(hidden.tombstone, "manual removal must persist a no-resurrection tombstone");
    assert.throws(() => coordinator.deleteDisclosure(scope, 1, title, gameData, { expectedRevision: title.revision }), /revision|stale/i);
    const repeatedHidden = recordSnapshot(snapshot);
    assert.equal(repeatedHidden.changed, false);
    assert.equal(factRow(coordinator.getCurrentDisclosures(scope, 1, gameData), "TITLE", "明王").status, "MANUAL_HIDDEN",
      "automatic replay must not resurrect an explicitly hidden fact");
    const currentHidden = factRow(coordinator.getCurrentDisclosures(scope, 1, gameData), "TITLE", "明王");
    const knownAgain = coordinator.updateManualDisclosure(scope, 1, currentHidden, "MANUAL_KNOWN", gameData,
      { expectedRevision: currentHidden.revision });
    assert.equal(knownAgain.effectiveKnown, true);
    const changedSource = makeSnapshot("我确为明王，也是私生子。", { sourceRevision: hash("source-revision-2"), finalizationId: "finalization-2" });
    recordSnapshot(changedSource);
    assert.equal(factRow(coordinator.getCurrentDisclosures(scope, 1, gameData), "TITLE", "明王").status, "MANUAL_KNOWN",
      "new automatic proof must preserve explicit manual priority");

    const staleSnapshot = makeSnapshot("我乃明王，也是私生子。", { finalizationId: "finalization-stale", sourceRevision: hash("stale-revision") });
    assert.equal(coordinator.recordDisclosures(staleSnapshot, { campaignToken: scope.campaignToken, date: staleSnapshot.date,
      characters }).status, "SKIPPED", "an uncommitted revision cannot be recorded over the committed source");
    const noDisclosure = makeSnapshot("我不是明王。", { finalizationId: "finalization-3", sourceRevision: hash("no-disclosure-revision") });
    assert.equal(recordSnapshot(noDisclosure).status, "NO_DISCLOSURE");
    assert.equal(factRow(coordinator.getCurrentDisclosures(scope, 1, gameData), "TRAIT", "私生子").effectiveKnown, false,
      "a current finalization with no claim withdraws the previous finalization's proof");

    const beforeKnowledge = coordinator.getCurrentDisclosures(scope, 1, { ...gameData, date: "1164.5.19" });
    assert.equal(factRow(beforeKnowledge, "TITLE", "明王").effectiveKnown, false,
      "future proof must not be visible at an earlier game date");
    assert.equal(factRow(beforeKnowledge, "TITLE", "明王").status, null);
    assert.deepEqual(coordinator.getCurrentDisclosures(scope, 1, null, { currentGameDate: "1164.5.19" }), [],
      "archive reads must not expose the value of a fact before its acquisition date");
    const changedTruth = { ...target, primaryTitle: "皇帝", traits: [] };
    const currentTruth = coordinator.getCurrentDisclosures(scope, 1, { ...gameData, characters: new Map([[1, changedTruth], [2, owner], [3, bystander]]) });
    assert.equal(factRow(currentTruth, "TITLE", "明王"), undefined, "old title must not be shown as current truth");
    assert.equal(factRow(currentTruth, "TRAIT", "私生子"), undefined, "removed trait must not be shown as current truth");
    assert.deepEqual(coordinator.getCurrentDisclosures(scope, 1, null), [], "archive reads without an as-of date fail closed");
    const archived = coordinator.getCurrentDisclosures(scope, 1, null, { currentGameDate: gameData.date });
    assert(factRow(archived, "TITLE", "明王")?.current === false, "archive keeps historical records without claiming current truth");

    const rejected = [
      makeSnapshot("我不是明王。"), makeSnapshot("我可能是明王。"), makeSnapshot("我是不是明王？"),
      makeSnapshot("如果我是明王。"), makeSnapshot("听说我乃明王。"), makeSnapshot("我心想我乃明王。"),
      makeSnapshot("我乃明王。", { fragments: [{ ...snapshot.fragments[0], sourceTextVerified: false }] }),
      makeSnapshot("我乃明王。", { fragments: [{ ...snapshot.fragments[0], sourceType: "narration" }] }),
      makeSnapshot("我乃明王。", { fragments: [{ ...snapshot.fragments[0], visibility: "private" }] }),
      makeSnapshot("我乃明王。", { fragments: [{ ...snapshot.fragments[0], knownBy: [1, 3] }] }),
      makeSnapshot("甲是明王。", { fragments: [{ ...snapshot.fragments[0], text: "甲是明王。", speakerId: 2, entityIds: [] }] })
    ];
    for (const rejectedSnapshot of rejected) expectNoDisclosure(rejectedSnapshot);

    const ambiguousRoster = [...characters.values(), { id: 4, firstName: "甲", shortName: "甲", fullName: "甲", traits: [] }];
    expectNoDisclosure(makeSnapshot("甲是明王。", { disclosureCharacters: ambiguousRoster,
      fragments: [{ ...snapshot.fragments[0], text: "甲是明王。", speakerId: 2, entityIds: [1, 4] }] }),
    { ...gameData, characters: new Map(ambiguousRoster.map(character => [character.id, character])) });

    const otherCampaign = { campaignToken: "other-campaign", ownerId: 2 };
    assert.equal(factRow(coordinator.getCurrentDisclosures(otherCampaign, 1,
      { ...gameData, campaignToken: otherCampaign.campaignToken }), "TITLE", "明王").effectiveKnown, false);

    const letter = coordinator.recordLetterDisclosures({ campaignToken: scope.campaignToken, date: gameData.date,
      ownerId: 3, senderId: 1, recipientId: 3, letterId: "letter-1", text: "我乃明王。", characters });
    assert.equal(letter.status, "RECORDED");
    const letterTitle = factRow(coordinator.getCurrentDisclosures(ownerThreeScope, 1, gameData), "TITLE", "明王");
    const letterProof = Object.values(letterTitle.evidenceBySource).find(proof => proof.sourceKind === "LETTER");
    assert(letterProof);
    assert.equal(letterProof.sourceLetterId, "letter-1");
    assert.equal(letterProof.senderId, 1);
    assert.equal(letterProof.recipientId, 3);
    assert.deepEqual(letterProof.knownBy, [3]);
    assert.deepEqual(letterProof.sourceMessageIds, []);
    assert.equal(coordinator.recordLetterDisclosures({ campaignToken: scope.campaignToken, date: gameData.date,
      ownerId: 3, senderId: 1, recipientId: 3, letterId: "letter-1", text: "我乃明王。", characters }).changed, false,
    "letter disclosure is idempotent by letterId and body revision");
    const ownerTwoTitle = factRow(coordinator.getCurrentDisclosures(scope, 1, gameData), "TITLE", "明王");
    assert.equal(Object.values(ownerTwoTitle.evidenceBySource).some(proof => proof.sourceKind === "LETTER"), false,
      "letter proof remains recipient-owner scoped");

    const firstLetterSummaries = path.join(temporary, "first-letter-summaries");
    fs.mkdirSync(firstLetterSummaries, { recursive: true });
    const firstLetterCoordinator = new Memory4Coordinator(new MemoryStore({
      baseDir: path.join(temporary, "first-letter-memory"), summaryFoldersDir: firstLetterSummaries
    }));
    const firstRecipient = { id: 9, firstName: "丁", shortName: "丁", fullName: "丁", traits: [] };
    const firstLetter = firstLetterCoordinator.recordLetterDisclosures({ campaignToken: "first-letter-campaign", date: gameData.date,
      ownerId: 9, senderId: 1, recipientId: 9, letterId: "first-letter-1", text: "我乃明王。",
      characters: new Map([...characters, [9, firstRecipient]]) });
    assert.equal(firstLetter.status, "RECORDED", "a verified first letter can initialize its recipient Owner sidecar");
    assert(fs.existsSync(path.join(firstLetterSummaries, ".memory4", "9", hash("first-letter-campaign"), "known-entities.json")));
    assert.equal(factRow(firstLetterCoordinator.getCurrentDisclosures({ campaignToken: "first-letter-campaign", ownerId: 9 }, 1,
      { ...gameData, campaignToken: "first-letter-campaign", characters: new Map([...characters, [9, firstRecipient]]) }), "TITLE", "明王").effectiveKnown, true);
    console.log("V8.14.2 disclosure core: PASS (scanner gates, current truth, Owner/Campaign scope, manual priority, date and idempotency)");
  } finally {
    const targetPath = path.resolve(temporary);
    assert(targetPath.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
