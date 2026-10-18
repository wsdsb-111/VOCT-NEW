"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CharacterKnowledgeService } = require("../src/app/main/worldline/character-knowledge-service");
const fixtureAutosavePath = path.join(__dirname, "autosave.ck3");

function fixtureSnapshot(campaignToken = "campaign-a") {
  return {
    playthroughId: campaignToken,
    gameDate: "1200.1.1",
    characters: {
      "1": { id: "1", firstName: "Owner A", liege: null, traits: [] },
      "2": { id: "2", firstName: "Target", liege: "1", traits: ["brave", "honest", "beauty_good_1", "witch", "adulterer"] },
      "3": { id: "3", firstName: "Owner B", liege: "99", traits: [] }
    },
    titles: {
      "100": { id: "100", key: "k_demo", holder: "2" }
    }
  };
}

function fixtureCheckpoint(snapshot, checkpointId) {
  return {
    id: checkpointId,
    state: "ACTIVE",
    source: { path: fixtureAutosavePath, fileSize: 100, modifiedAt: "2026-10-18T00:00:00.000Z", fingerprint: `fingerprint-${checkpointId}` },
    snapshot
  };
}

function fixtureWorldline(snapshot = fixtureSnapshot(), checkpointId = "checkpoint-a") {
  return {
    currentCheckpoint: fixtureCheckpoint(snapshot, checkpointId),
    settings: { autosavePath: fixtureAutosavePath, lastValidationStatus: "VALID" },
    freshnessStatus: "FRESH",
    getSettings() { return this.settings; },
    getCheckpointStatus() {
      return { checkpoint: { status: "ACTIVE", checkpointId: this.currentCheckpoint.id, freshnessStatus: this.freshnessStatus } };
    },
    getLiveState() {
      return { connected: true, gameDate: this.currentCheckpoint.snapshot.gameDate };
    },
    localizationResolver: {
      resolveForDisplay(_type, rawKey) { return { localizedValue: `显示:${rawKey}`, confidence: "CONFIRMED" }; }
    }
  };
}

const tempDir = fs.mkdtempSync(path.join(__dirname, ".v9.3.9-character-knowledge-"));
const testFs = {
  existsSync: fs.existsSync.bind(fs),
  readFileSync: fs.readFileSync.bind(fs),
  mkdirSync: fs.mkdirSync.bind(fs),
  writeFileSync: fs.writeFileSync.bind(fs),
  renameSync: (source, destination) => { fs.copyFileSync(source, destination); fs.unlinkSync(source); },
  statSync: () => ({ size: 100, mtime: new Date("2026-10-18T00:00:00.000Z") }),
  rmSync: fs.rmSync.bind(fs)
};
try {
  let now = new Date("2026-10-18T00:00:00.000Z");
  const worldline = fixtureWorldline();
  let gameData = {
    campaignToken: "campaign-a",
    date: "1200.1.1",
    totalDays: 123,
    characters: new Map([
      [1, { id: 1, knownSecrets: [{ ownerId: 2, type: "secret_witch" }] }],
      [3, { id: 3, knownSecrets: [] }]
    ])
  };
  const createService = () => new CharacterKnowledgeService({ dataDir: tempDir, worldlineService: worldline,
    getCurrentGameData: () => gameData, fs: testFs, clock: () => now });
  let service = createService();

  const ownerView = service.getOwnerView({ ownerRuntimeId: "1" });
  assert.equal(ownerView.scope.campaignToken, "campaign-a");
  assert.equal(ownerView.scope.sourceSnapshotId, "checkpoint-a");
  assert.equal(ownerView.owner.displayName, "Owner A");
  assert.ok(ownerView.targets.some((target) => target.runtimeId === "2" && target.displayName === "Target"));
  assert.ok(ownerView.targets.every((target) => target.displayName !== target.runtimeId));

  worldline.settings.lastValidationStatus = "NOT_FOUND";
  assert.throws(() => service.getOwnerView({ ownerRuntimeId: "1" }), /checkpoint_unavailable/);
  worldline.settings.lastValidationStatus = "VALID";
  worldline.freshnessStatus = "STALE";
  assert.throws(() => service.getOwnerView({ ownerRuntimeId: "1" }), /checkpoint_unavailable/);
  worldline.freshnessStatus = "FRESH";
  worldline.currentCheckpoint.source.path = path.join(__dirname, "old-autosave.ck3");
  assert.throws(() => service.getOwnerView({ ownerRuntimeId: "1" }), /checkpoint_unavailable/);
  worldline.currentCheckpoint.source.path = fixtureAutosavePath;

  const profileA = service.getTargetView({ ...ownerView.scope, targetRuntimeId: "2" });
  const bravery = profileA.facts.find((fact) => fact.factType === "TRAIT" && fact.factKey === "trait_beauty_good_1");
  const unauthorizedSecret = profileA.facts.find((fact) => fact.factType === "TRAIT" && fact.factKey === "trait_adulterer");
  const knownSecret = profileA.facts.find((fact) => fact.factType === "TRAIT" && fact.factKey === "trait_witch");
  const title = profileA.facts.find((fact) => fact.factType === "TITLE" && fact.factKey === "100");
  assert.equal(bravery.value, "显示:beauty_good_1");
  assert.equal(bravery.status, "UNKNOWN");
  assert.equal(bravery.effectiveKnown, false);
  assert.match(bravery.factSourceSnapshotId, /^fact:[a-f0-9]{64}$/);
  assert.equal(knownSecret.status, "KNOWN");
  assert.equal(knownSecret.effectiveKnown, true);
  assert.match(knownSecret.evidenceSourceSnapshotId, /^campaign-a\|1200\.1\.1\/123\|[a-f0-9]{16}$/);
  assert.equal(unauthorizedSecret, undefined);
  assert.equal(profileA.facts.some((fact) => fact.factKey === "trait_brave" || fact.factKey === "trait_honest"), false);
  assert.equal(title.status, "KNOWN");
  assert.equal(title.source, "WORLDLINE_REALM_PUBLIC");
  assert.ok(title.aliases.includes("k_demo"));
  assert.ok(title.aliases.includes(title.value));

  worldline.currentCheckpoint.snapshot.characters["2"].traits.push("lazy");
  assert.throws(() => service.setManualStatus({ ...profileA.scope, factType: "TRAIT", factKey: bravery.factKey,
    factSourceSnapshotId: bravery.factSourceSnapshotId, status: "MANUAL_KNOWN", expectedRevision: 0 }), /source_changed/);
  worldline.currentCheckpoint.snapshot.characters["2"].traits.pop();

  let disclosure = service.getDisclosureProfile(profileA.scope);
  assert.equal(disclosure.status, "READY");
  assert.deepEqual(disclosure.facts.map((fact) => [fact.factType, fact.factKey]), [["TRAIT", "trait_witch"], ["TITLE", "100"]]);
  assert.equal(disclosure.facts.find((fact) => fact.factKey === "trait_witch").status, "KNOWN");
  assert.match(disclosure.facts.find((fact) => fact.factKey === "trait_witch").sourceSnapshotId,
    /^checkpoint-a\|campaign-a\|1200\.1\.1\/123\|[a-f0-9]{16}$/);
  assert.ok(disclosure.facts.find((fact) => fact.factKey === "trait_witch").aliases.includes("witch"));

  gameData = { ...gameData, date: "1200.1.2", totalDays: 124 };
  assert.equal(service.getDisclosureProfile(profileA.scope).facts.some((fact) => fact.factKey === "trait_witch"), false);
  gameData = { ...gameData, date: "1200.1.1", totalDays: 124 };
  assert.throws(() => service.setManualStatus({ ...profileA.scope, factType: "TRAIT", factKey: "trait_witch",
    factSourceSnapshotId: knownSecret.factSourceSnapshotId, status: "MANUAL_HIDDEN", expectedRevision: 0 }), /source_changed/);
  gameData = { ...gameData, totalDays: 123 };

  now = new Date("2026-10-18T00:01:00.000Z");
  const updatedA = service.setManualStatus({ ...profileA.scope, factType: "TRAIT", factKey: "trait_beauty_good_1",
    factSourceSnapshotId: bravery.factSourceSnapshotId, status: "MANUAL_KNOWN", expectedRevision: bravery.revision });
  assert.equal(updatedA.facts.find((fact) => fact.factKey === "trait_beauty_good_1").status, "MANUAL_KNOWN");
  disclosure = service.getDisclosureProfile(updatedA.scope);
  const manualFact = disclosure.facts.find((fact) => fact.factType === "TRAIT" && fact.factKey === "trait_beauty_good_1");
  assert.equal(manualFact.status, "MANUAL_KNOWN");
  assert.equal(manualFact.effectiveKnown, true);
  assert.equal(manualFact.recordRevision, 1);
  assert.equal(manualFact.sourceSnapshotId, "checkpoint-a");
  assert.equal(manualFact.factSourceSnapshotId, bravery.factSourceSnapshotId);
  assert.throws(() => service.setManualStatus({ ...updatedA.scope, factType: "TRAIT", factKey: "trait_beauty_good_1",
    factSourceSnapshotId: manualFact.factSourceSnapshotId, status: "MANUAL_HIDDEN", expectedRevision: 0 }), /revision_conflict/);

  assert.throws(() => service.setManualStatus({ ...updatedA.scope, factType: "TRAIT", factKey: "trait_adulterer", status: "MANUAL_KNOWN", expectedRevision: 0 }), /fact_not_available/);
  assert.throws(() => service.setManualStatus({ ...updatedA.scope, factType: "TRAIT", factKey: "trait_honest", status: "MANUAL_KNOWN", expectedRevision: 0 }), /fact_not_available/);
  assert.throws(() => service.setManualStatus({ ...updatedA.scope, factType: "TRAIT", factKey: "trait_brave", status: "UNKNOWN", expectedRevision: 0 }), /manual_status_invalid/);

  const ownerB = service.getTargetView({ campaignToken: "campaign-a", ownerRuntimeId: "3", targetRuntimeId: "2", sourceSnapshotId: "checkpoint-a" });
  assert.equal(ownerB.facts.some((fact) => fact.factType === "TRAIT" && fact.factKey === "trait_witch"), false);
  assert.equal(ownerB.facts.some((fact) => fact.factType === "TRAIT" && fact.factKey === "trait_adulterer"), false);
  assert.equal(ownerB.facts.find((fact) => fact.factType === "TITLE" && fact.factKey === "100").status, "UNKNOWN");
  assert.deepEqual(service.getDisclosureProfile(ownerB.scope).facts, []);

  service = createService();
  const reloaded = service.getTargetView(updatedA.scope);
  assert.equal(reloaded.facts.find((fact) => fact.factKey === "trait_beauty_good_1").status, "MANUAL_KNOWN");
  const reloadedTitle = reloaded.facts.find((fact) => fact.factKey === "100");
  const hidden = service.setManualStatus({ ...reloaded.scope, factType: "TITLE", factKey: "100",
    factSourceSnapshotId: reloadedTitle.factSourceSnapshotId, status: "MANUAL_HIDDEN", expectedRevision: 0 });
  assert.equal(hidden.facts.find((fact) => fact.factKey === "100").effectiveKnown, false);
  const hiddenFact = service.getDisclosureProfile(hidden.scope).facts.find((fact) => fact.factKey === "100");
  assert.equal(hiddenFact.status, "MANUAL_HIDDEN");
  assert.equal(hiddenFact.effectiveKnown, false);
  assert.equal(hiddenFact.recordRevision, 1);
  const hiddenSecret = service.setManualStatus({ ...hidden.scope, factType: "TRAIT", factKey: "trait_witch",
    factSourceSnapshotId: knownSecret.factSourceSnapshotId, status: "MANUAL_HIDDEN", expectedRevision: 0 });
  const hiddenSecretFact = service.getDisclosureProfile(hiddenSecret.scope).facts.find((fact) => fact.factKey === "trait_witch");
  assert.equal(hiddenSecretFact.status, "MANUAL_HIDDEN");
  assert.equal(hiddenSecretFact.effectiveKnown, false);

  worldline.currentCheckpoint = fixtureCheckpoint({ ...fixtureSnapshot(), gameDate: "1200.2.1" }, "checkpoint-b");
  const refreshedSource = service.getTargetView({ campaignToken: "campaign-a", ownerRuntimeId: "1", targetRuntimeId: "2", sourceSnapshotId: "checkpoint-b" });
  const staleTrait = refreshedSource.facts.find((fact) => fact.factKey === "trait_beauty_good_1");
  assert.equal(staleTrait.status, "UNKNOWN");
  assert.equal(staleTrait.effectiveKnown, false);
  assert.equal(staleTrait.sourceStatus, "STALE");
  assert.equal(staleTrait.recordedSourceSnapshotId, "checkpoint-a");
  assert.equal(refreshedSource.sourceInvalidatedCount, 3);
  assert.equal(service.getDisclosureProfile(updatedA.scope).status, "BLOCKED");
  gameData = { ...gameData, date: "1200.2.1", totalDays: 153 };
  const reaffirmed = service.setManualStatus({ ...refreshedSource.scope, factType: "TRAIT", factKey: "trait_beauty_good_1",
    factSourceSnapshotId: staleTrait.factSourceSnapshotId, status: "MANUAL_KNOWN", expectedRevision: 0 });
  assert.equal(reaffirmed.facts.find((fact) => fact.factKey === "trait_beauty_good_1").effectiveKnown, true);

  worldline.currentCheckpoint = fixtureCheckpoint(fixtureSnapshot("campaign-b"), "checkpoint-c");
  gameData = { ...gameData, campaignToken: "campaign-b", date: "1200.1.1", totalDays: 123 };
  const newCampaign = service.getTargetView({ campaignToken: "campaign-b", ownerRuntimeId: "1", targetRuntimeId: "2", sourceSnapshotId: "checkpoint-c" });
  assert.equal(newCampaign.facts.find((fact) => fact.factKey === "trait_beauty_good_1").status, "UNKNOWN");
  assert.throws(() => service.getOwnerView({ ownerRuntimeId: "1", campaignToken: "campaign-a" }), /campaign_changed/);
  assert.equal(service.getDisclosureProfile(reaffirmed.scope).status, "BLOCKED");

  const servicePorts = require("../src/app/main/application/service-ports");
  // V9.3.9.1 leaves the checkpoint implementation above as historical proof;
  // production ports now bind the conversation-scoped disclosure adapter.
  const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
  const disclosureStore = new ConversationDisclosureStore({ dataDir: tempDir, getCurrentConversation: () => null });
  const ports = servicePorts.createApplicationServices({
    conversation: { createConversation() {}, getCurrentConversation() {}, sendMessage() {}, endCurrentConversation() {}, flushFinalizations() {}, hasPendingFinalizations() {}, getContextUsageSnapshot() {}, onContextUsageUpdate() {} },
    presence: { getConversationState() {}, joinWaitingCharacter() {}, leavePresentCharacter() {}, temporarilyLeaveCharacter() {}, returnTemporaryCharacter() {} },
    memory: { retrieveForResponder() {}, finalizeConversation() {}, forgetSummaryProjection() {}, recoverPendingFinalizations() {} },
    worldline: { getPromptContext() {}, getSubjectivePromptContextAsync() {}, getCheckpointStatus() {} },
    characterKnowledge: disclosureStore,
    action: { evaluateForCharacter() {}, runInvocation() {} },
    letter: { processLatestLetter() {}, clearLettersFile() {}, getAllLetterStatuses() {} }
  });
  assert.equal(typeof ports.characterKnowledge.getDisclosureProfile, "function");
  assert.equal(ports.characterKnowledge.getConversationView().available, false, "the production adapter requires an active conversation");
  assert.equal(ports.characterKnowledge.getDisclosureProfile({ ownerRuntimeId: "1", targetRuntimeId: "2" }).status, "BLOCKED");

  const source = fs.readFileSync(path.join(__dirname, "../src/app/main/worldline/character-knowledge-service.js"), "utf8");
  assert.doesNotMatch(source, /archiveSidecar|Memory4|Durable Planner|memory4-manager/i);
  process.stdout.write("V9.3.9 Character Knowledge tests passed.\n");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
