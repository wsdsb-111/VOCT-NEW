"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const events = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createConversationManager } = require("../resources/app/out/main/conversation/conversation-manager");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { FinalizationCoordinator } = require("../resources/app/out/main/memory-system/finalization-coordinator");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8141-memory4-archive-"));
const summariesDir = path.join(root, "summaries");
const campaignToken = "archive-readonly-same-campaign";
const otherCampaignToken = "archive-readonly-other-campaign";
const people = [
  { id: 1, name: "Player", shortName: "Player", fullName: "Player" },
  { id: 4, name: "Zhao Taichu", shortName: "赵太初", fullName: "赵太初" }
];
fs.mkdirSync(path.join(summariesDir, "1_Player"), { recursive: true });
fs.mkdirSync(path.join(summariesDir, "4_赵太初"), { recursive: true });

const memoryEngine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
memoryEngine.memory4.configureDerived({ isCampaignCurrent: token => token === campaignToken, estimateTokens: text => Math.ceil(text.length / 2) });

let currentConversation = null;
let lifecycleManager = null;
const SummariesManager = createSummariesManager({ fs, path, summariesDir, memoryEngine, memorySystem: {},
  getCurrentConversation: () => lifecycleManager ? lifecycleManager.getCurrentConversation() : currentConversation,
  getMemory4ReadConversation: () => lifecycleManager
    ? (lifecycleManager.getMemory4ReadConversation?.() ?? lifecycleManager.getCurrentConversation()) : currentConversation });

function context(id, date, texts) {
  const messages = texts.map(([speakerCharacterId, content], index) => ({ id: index + 1,
    role: speakerCharacterId === 1 ? "user" : "assistant", speakerCharacterId, content }));
  return { campaignToken, conversationId: id, finalizationId: `final-${id}`, episodeId: `episode-${id}`, date,
    totalDays: 400000, finalizationVisibilityV1: true, participants: people,
    participantPresence: people.map(person => ({ characterId: person.id, joinedAtMessageId: 0 })), messages,
    verifiedSummarySegments: messages.map(message => ({ segmentId: `segment-${id}-${message.id}`, content: message.content,
      visibility: "public", source: "spoken", participants: people.map(person => person.id), knownBy: people.map(person => person.id),
      provenance: { messageIds: [message.id], speakerIds: [message.speakerCharacterId] } })) };
}

function conversation({ id, token = campaignToken, active = true, roster = [1, 4] }) {
  return { id, isActive: active, gameData: { campaignToken: token, date: "1038.4.28", playerID: 1,
    characters: new Map(roster.map(id => {
      const person = people.find(item => item.id === id) || { id, shortName: `#${id}`, fullName: `#${id}` };
      return [id, { ...person, relationsToCharacters: [], relationsToPlayer: [] }];
    })) } };
}

async function finalize(id, durable) {
  return memoryEngine.memory4.finalizeCommitted(context(id, "1038.4.28", [
    [1, "我向赵太初承诺把玉印妥善存入内库。"],
    [4, "我听见了这项关于玉印的约定。"]
  ]), async prompt => {
    if (!durable) return JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] });
    const input = JSON.parse(prompt[1].content);
    const fragment = input.fragments[0];
    return JSON.stringify({ status: "STORE", entries: [{ memoryType: "DURABLE_KNOWLEDGE",
      text: "双方约定将玉印保存在内库。", fragmentIds: [fragment.fragmentId], entityIds: [],
      participantIds: fragment.presentIds, topics: ["玉印"], eventTime: { status: "unknown", precision: "unknown" } }] });
  }, { isNarrativeCommitted: true });
}

function createLifecycleHarness() {
  let nextConversationConfig = null;
  let sequence = 0;
  const finalizationCalls = [];
  class LifecycleConversation {
    constructor({ conversationEpoch }) {
      const config = nextConversationConfig || {};
      nextConversationConfig = null;
      this.id = config.id || `manager-conversation-${++sequence}`;
      this.conversationEpoch = conversationEpoch;
      this.isActive = true;
      this.messages = [];
      this.gameData = config.gameData;
      this.gameDataReady = config.gameDataReady || Promise.resolve();
      this.finalizeConversation = async options => {
        this.isActive = false;
        finalizationCalls.push({ id: this.id, closeGameScene: options.closeGameScene, reason: options.reason });
        if (this.gameData?.campaignToken === campaignToken && this.gameData.characters instanceof Map) {
          return memoryEngine.memory4.finalizeCommitted(context(this.id, this.gameData.date || this.gameData.normalizedDate || "1038.4.28", [
            [1, "我向赵太初承诺把玉印妥善存入内库。"],
            [4, "我听见了这项关于玉印的约定。"]
          ]), async () => JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }), { isNarrativeCommitted: true });
        }
        return { success: true };
      };
    }
    onConversationUpdate() {}
  }
  const Manager = createConversationManager({ events, memorySystem: { FinalizationCoordinator }, Conversation: LifecycleConversation,
    PromptBuilder: {}, createActionFeedback: () => null, logVerboseLLM: () => {} });
  const manager = new Manager();
  return { manager, finalizationCalls, setNextConversation(config) { nextConversationConfig = config; } };
}

function treeHash(directory) {
  const rows = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name), relative = path.relative(root, file);
      if (entry.isSymbolicLink()) rows.push([relative, "symlink"]);
      else if (entry.isDirectory()) visit(file);
      else rows.push([relative, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
    }
  };
  visit(directory);
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, error => error?.message === code, `expected ${code}`);
}

async function main() {
  let checks = 0;
  const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };
  try {
    const emptyResult = await finalize("first-meeting-no-durable", false);
    assert.equal(emptyResult.status, "COMPLETE");
    assert(emptyResult.owners.every(owner => owner.status === "NO_DURABLE_CONTENT"));
    await new Promise(resolve => setTimeout(resolve, 5));
    const durableResult = await finalize("lasting-knowledge", true);
    assert.equal(durableResult.status, "COMPLETE");
    assert(durableResult.owners.every(owner => owner.status === "STORE"));
    const storedEvidence = memoryEngine.memory4.store.getKnownEntityEvidence({ ownerId: 4, campaignToken }, 1,
      { currentGameDate: "1038.4.28" });
    assert.equal(storedEvidence.status, "DIRECT_INTERACTION", JSON.stringify({ status: storedEvidence.status,
      directConversationCount: storedEvidence.directConversationCount, sharedSceneCount: storedEvidence.sharedSceneCount,
      mentionCount: storedEvidence.mentionCount, completeness: storedEvidence.completeness }));

    const officialFile = path.join(summariesDir, "4_赵太初", "官方追忆摘要.json");
    fs.writeFileSync(officialFile, JSON.stringify([
      { memoryId: "same-campaign-official", playerId: 4, sourceType: "CK3_OFFICIAL_RECOLLECTION", campaignToken,
        captureGameDate: "1038.4.28", content: "同一战役的官方追忆。" },
      { memoryId: "other-campaign-official", playerId: 4, sourceType: "CK3_OFFICIAL_RECOLLECTION", campaignToken: otherCampaignToken,
        captureGameDate: "1038.4.28", content: "另一战役的追忆不得泄露。" }
    ]), "utf8");

    currentConversation = conversation({ id: "latest-loaded-context", roster: [1, 3] });
    const expectedContextId = currentConversation.id;
    const readBefore = treeHash(root);
    const data = await SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: campaignToken, expectedContextId });
    assert.equal(data.readOnlyArchive, true);
    assert.equal(data.readOnlyReason, "owner_not_in_current_roster");
    assert.equal(data.contextId, expectedContextId);
    assert.equal(data.known.total, 1);
    assert.equal(data.known.items[0].recognition.level, "DIRECT_INTERACTION");
    assert.equal(data.known.items[0].relationship.status, "UNKNOWN");
    assert.equal(data.known.items[0].currentTruth.alive, undefined);
    assert.equal(data.detail.total, 1);
    assert.equal(data.official.length, 1);
    assert.equal(data.official[0].memoryId, "same-campaign-official");
    assert.equal(data.generation.finalizationCount, 2);
    assert.equal(data.generation.noDurableContentCount, 1);
    assert.equal(data.generation.lastStatus, "STORE");
    assert.equal(treeHash(root), readBefore, "archive reads must not write or create Memory4 files");
    const beforeRosterDeniedWrites = treeHash(root);
    await rejectsWith(SummariesManager.mutateMemory4({ ownerId: 4, expectedCampaignToken: campaignToken,
      operation: "updateDetail", entryId: data.detail.items[0].entryId, text: "当前 roster 外不得编辑。",
      expectedRevision: data.detail.items[0].revision }), "legacy_summary_binding_owner_not_in_current_campaign");
    await rejectsWith(SummariesManager.mutateMemory4({ ownerId: 4, expectedCampaignToken: campaignToken,
      operation: "rebuild", kind: "all", overwriteManual: false, expectedRevision: data.derived.derivedRevision || 0 }),
    "legacy_summary_binding_owner_not_in_current_campaign");
    assert.equal(treeHash(root), beforeRosterDeniedWrites, "an active but off-roster archive must remain read-only");
    checks++;
    console.log("PASS same-campaign off-roster archive reads Known, Detail, Official and generation diagnostics without writes; edits and rebuilds remain server-blocked");

    const entryId = data.detail.items[0].entryId;
    const entry = await SummariesManager.getMemory4Entry({ ownerId: 4, entryId, expectedCampaignToken: campaignToken, expectedContextId });
    assert.equal(entry.readOnlyArchive, true);
    assert.equal(entry.entry.evidence.knownBy.includes(4), true);
    const sources = await SummariesManager.getMemory4Sources({ ownerId: 4, kind: "detail", entryId,
      expectedCampaignToken: campaignToken, expectedContextId });
    assert.equal(sources.readOnlyArchive, true);
    assert.equal(sources.sources.changed, false);
    assert.equal(sources.sources.entries[0].sourceValid, true);
    checks++;
    console.log("PASS off-roster archive entry and source reads preserve exact owner/campaign scope");

    currentConversation = null;
    const lifecycle = createLifecycleHarness();
    lifecycleManager = lifecycle.manager;
    const endedGameData = conversation({ id: "production-ended-conversation", roster: [1, 4] }).gameData;
    lifecycle.setNextConversation({ id: "production-ended-conversation", gameData: endedGameData });
    const liveConversation = lifecycle.manager.createConversation();
    const finalized = await lifecycle.manager.endCurrentConversation({ closeGameScene: false, reason: "archive_read_test" });
    assert.equal(finalized.status, "COMPLETE");
    assert.equal(lifecycle.finalizationCalls.length, 1);
    assert.equal(lifecycle.finalizationCalls[0].id, "production-ended-conversation");
    assert.equal(lifecycle.finalizationCalls[0].reason, "archive_read_test");
    assert.equal(lifecycle.manager.getCurrentConversation(), null);
    assert.equal(lifecycle.manager.getConversationEntries().length, 0);
    assert.equal(lifecycle.manager.hasActiveConversation(), false);

    const futureEvidence = await memoryEngine.memory4.finalizeCommitted(context("future-evidence-after-loaded-save", "1039.4.28", [
      [1, "我向赵太初承诺把玉印妥善存入内库。"],
      [4, "我听见了这项关于玉印的约定。"]
    ]), async () => JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }), { isNarrativeCommitted: true });
    assert.equal(futureEvidence.status, "COMPLETE");
    const endedArchive = await SummariesManager.getMemory4OwnerData({ ownerId: 4,
      expectedCampaignToken: campaignToken, expectedContextId: liveConversation.id });
    assert.equal(endedArchive.readOnlyArchive, true);
    assert.equal(endedArchive.readOnlyReason, "conversation_ended");
    assert.equal(endedArchive.contextId, liveConversation.id);
    assert.equal(endedArchive.archiveAsOfDate, "1038.4.28");
    assert.equal(endedArchive.detail.total, 1);
    assert.equal(endedArchive.known.items[0].relationship.status, "UNKNOWN");
    assert.equal(endedArchive.known.items[0].currentTruth.alive, undefined);
    assert.equal(endedArchive.known.items[0].recognition.lastSeen, "1038.4.28",
      "archive recognition must be bounded by the loaded save date, not newer same-campaign evidence");
    assert.equal(endedArchive.generation.finalizationCount, 4);
    assert.equal(endedArchive.generation.noDurableContentCount, 3);
    assert.equal(endedArchive.generation.lastStatus, "NO_DURABLE_CONTENT");
    const endedSnapshot = lifecycle.manager.getMemory4ReadConversation();
    assert.notEqual(endedSnapshot, liveConversation, "archive view must not retain the ended Conversation object");
    assert.deepEqual(Object.keys(endedSnapshot).sort(), ["gameData", "id", "isActive"]);
    assert.deepEqual(Object.keys(endedSnapshot.gameData).sort(), ["campaignToken", "characters", "date"]);
    assert.equal(endedSnapshot.id, liveConversation.id);
    assert.equal(endedSnapshot.isActive, false);
    assert.equal(endedSnapshot.gameData.campaignToken, campaignToken);
    assert.equal(endedSnapshot.gameData.date, "1038.4.28");
    assert.equal(endedSnapshot.messages, undefined);
    assert.deepEqual([...endedSnapshot.gameData.characters.values()].map(character => Object.keys(character).sort()),
      [["fullName", "id", "shortName"], ["fullName", "id", "shortName"]]);
    const beforeEndedMutation = treeHash(root);
    await rejectsWith(SummariesManager.mutateMemory4({ ownerId: 4, expectedCampaignToken: campaignToken,
      expectedContextId: liveConversation.id, operation: "updateDetail", entryId,
      text: "结束后的对话不能编辑。", expectedRevision: endedArchive.detail.items[0].revision }),
    "legacy_binding_conversation_not_active");
    assert.equal(treeHash(root), beforeEndedMutation);
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: campaignToken,
      expectedContextId: "stale-production-context" }), "legacy_binding_conversation_changed");

    lifecycle.setNextConversation({ id: "new-pending-conversation", gameData: null, gameDataReady: Promise.resolve() });
    const pendingConversation = lifecycle.manager.createConversation();
    assert.equal(lifecycle.manager.getCurrentConversation(), pendingConversation);
    assert.equal(lifecycle.manager.getMemory4ReadConversation(), pendingConversation,
      "an uninitialized current conversation must take precedence over the prior archive snapshot");
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: campaignToken }), "legacy_binding_game_data_unavailable");
    await lifecycle.manager.endCurrentConversation({ closeGameScene: false, reason: "unloaded_context_test" });
    assert.equal(lifecycle.manager.getCurrentConversation(), null);
    assert.equal(lifecycle.manager.getMemory4ReadConversation(), null,
      "ending an invalid new conversation must clear, not resurrect, the prior archive snapshot");

    const newCampaignToken = "archive-readonly-new-campaign";
    const newCampaignGameData = conversation({ id: "new-campaign-conversation", token: newCampaignToken, roster: [1, 4] }).gameData;
    lifecycle.setNextConversation({ id: "new-campaign-conversation", gameData: newCampaignGameData });
    const newCampaignConversation = lifecycle.manager.createConversation();
    const newCampaignView = await SummariesManager.getMemory4OwnerData({ ownerId: 4,
      expectedCampaignToken: newCampaignToken, expectedContextId: newCampaignConversation.id });
    assert.equal(newCampaignView.readOnlyArchive, false);
    assert.equal(newCampaignView.detail.total, 0, "a new campaign must not fall back to the older campaign's entries");
    assert.equal(newCampaignView.generation.finalizationCount, 0);
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4,
      expectedCampaignToken: newCampaignToken, expectedContextId: liveConversation.id }), "legacy_binding_conversation_changed");
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4,
      expectedCampaignToken: campaignToken }), "memory4_campaign_changed");

    const duplicateOwnerGameData = conversation({ id: "duplicate-owner-conversation", token: newCampaignToken, roster: [1, 4] }).gameData;
    duplicateOwnerGameData.characters.set(44, { ...people[1], id: 4, relationsToCharacters: [], relationsToPlayer: [] });
    lifecycle.setNextConversation({ id: "duplicate-owner-conversation", gameData: duplicateOwnerGameData });
    const duplicateOwnerConversation = lifecycle.manager.createConversation();
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: newCampaignToken,
      expectedContextId: duplicateOwnerConversation.id }),
      "legacy_summary_binding_owner_not_unique_in_current_campaign");
    await lifecycle.manager.endCurrentConversation({ closeGameScene: false, reason: "duplicate_owner_test" });
    assert.equal(lifecycle.manager.getMemory4ReadConversation(), null,
      "duplicate-owner evidence cannot replace or retain a prior read context");

    const tokenlessGameData = conversation({ id: "tokenless-conversation", token: newCampaignToken, roster: [1, 4] }).gameData;
    delete tokenlessGameData.campaignToken;
    lifecycle.setNextConversation({ id: "tokenless-conversation", gameData: tokenlessGameData });
    lifecycle.manager.createConversation();
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: campaignToken }), "legacy_binding_campaign_not_loaded");
    await lifecycle.manager.endCurrentConversation({ closeGameScene: false, reason: "tokenless_test" });
    assert.equal(lifecycle.manager.getMemory4ReadConversation(), null,
      "a context without a loaded campaign token cannot restore older archive data");

    lifecycleManager = null;
    currentConversation = conversation({ id: "scope-mismatch-context", roster: [1, 3] });
    checks++;
    console.log("PASS real ConversationManager end/finalization exposes only a minimal same-campaign archive snapshot; pending, new-campaign, duplicate-owner and tokenless contexts never fall back to it");

    const archiveHash = treeHash(root);
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: otherCampaignToken }), "memory4_campaign_changed");
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: campaignToken, expectedContextId: "old-context" }), "legacy_binding_conversation_changed");
    assert.equal(treeHash(root), archiveHash);
    checks++;
    console.log("PASS token and context changes reject before reading or changing the archive");

    currentConversation = conversation({ id: "finished-loaded-context", active: false, roster: [1, 4] });
    const ended = await SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: campaignToken, expectedContextId: currentConversation.id });
    assert.equal(ended.readOnlyArchive, true);
    assert.equal(ended.readOnlyReason, "conversation_ended");
    const endedEntry = await SummariesManager.getMemory4Entry({ ownerId: 4, entryId, expectedCampaignToken: campaignToken, expectedContextId: currentConversation.id });
    assert.equal(endedEntry.readOnlyArchive, true);
    const beforeDeniedWrites = treeHash(root);
    await rejectsWith(SummariesManager.mutateMemory4({ ownerId: 4, expectedCampaignToken: campaignToken,
      operation: "updateDetail", entryId, text: "不得在归档上下文修改。", expectedRevision: endedEntry.entry.revision }), "legacy_binding_conversation_not_active");
    await rejectsWith(SummariesManager.mutateMemory4({ ownerId: 4, expectedCampaignToken: campaignToken,
      operation: "rebuild", kind: "all", overwriteManual: false, expectedRevision: ended.derived.derivedRevision || 0 }), "legacy_binding_conversation_not_active");
    assert.equal(treeHash(root), beforeDeniedWrites);
    checks++;
    console.log("PASS ended-context archive remains readable while update and rebuild stay server-blocked");

    currentConversation = conversation({ id: "same-campaign-active-context", roster: [1, 4] });
    const live = await SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: campaignToken, expectedContextId: currentConversation.id });
    assert.equal(live.readOnlyArchive, false);
    const updated = await SummariesManager.mutateMemory4({ ownerId: 4, expectedCampaignToken: campaignToken,
      operation: "updateDetail", entryId, text: "当前有效战役中允许按版本编辑。", expectedRevision: live.detail.items[0].revision });
    assert.equal(updated.success, true);
    checks++;
    console.log("PASS active in-roster owner can still edit the current scoped entry");

    currentConversation = conversation({ id: "other-campaign-context", token: otherCampaignToken, active: false, roster: [1, 3] });
    const otherScopePath = path.join(summariesDir, ".memory4", "4", hash(otherCampaignToken));
    const beforeOtherScope = treeHash(root);
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: otherCampaignToken }), "memory4_archive_scope_not_persisted");
    assert.equal(fs.existsSync(otherScopePath), false);
    assert.equal(treeHash(root), beforeOtherScope, "a missing foreign campaign scope must not create an empty sidecar");
    checks++;
    console.log("PASS foreign campaign without its own persisted sidecar cannot reuse this owner's prior archive");

    currentConversation = conversation({ id: "active-new-campaign-context", token: otherCampaignToken, roster: [1, 4] });
    const emptyScopePath = path.join(summariesDir, ".memory4", "4", hash(otherCampaignToken));
    const beforeEmptyScope = treeHash(root);
    const empty = await SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: otherCampaignToken });
    assert.equal(empty.readOnlyArchive, false);
    assert.equal(empty.detail.total, 0);
    assert.equal(fs.existsSync(emptyScopePath), false, "default empty reads must not create a sidecar");
    assert.equal(treeHash(root), beforeEmptyScope);
    checks++;
    console.log("PASS a live owner in a new campaign sees an empty scoped view without leaking prior detail or creating a sidecar");

    currentConversation = conversation({ id: "active-missing-context", roster: [1, 3] });
    const beforeMissing = treeHash(root);
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 99 }), "legacy_summary_binding_owner_not_in_current_campaign");
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4, contextOnly: true, expectedCampaignToken: "wrong-token" }), "memory4_campaign_changed");
    currentConversation = null;
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4 }), "legacy_binding_conversation_not_active");
    assert.equal(treeHash(root), beforeMissing);
    checks++;
    console.log("PASS absent owner sidecar, stale expected scope and absent loaded context fail closed without writes");

    currentConversation = conversation({ id: "corrupt-sidecar-context", active: false, roster: [1, 4] });
    const sidecar = memoryEngine.memory4.store.directory({ ownerId: 4, campaignToken });
    const metadataPath = path.join(sidecar, "metadata.json");
    const originalMetadata = fs.readFileSync(metadataPath);
    const metadata = JSON.parse(originalMetadata.toString("utf8"));
    metadata.indexHash = "0".repeat(64);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata), "utf8");
    const corruptHash = treeHash(root);
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: campaignToken }), "memory4_metadata_index_mismatch");
    assert.equal(treeHash(root), corruptHash, "a failed metadata proof must leave the corrupt evidence untouched");
    fs.writeFileSync(metadataPath, originalMetadata);

    const indexPath = path.join(sidecar, "index.json");
    const originalIndex = fs.readFileSync(indexPath);
    const index = JSON.parse(originalIndex.toString("utf8"));
    index.ownerId = 99;
    fs.writeFileSync(indexPath, JSON.stringify(index), "utf8");
    const mismatchedIndexHash = treeHash(root);
    await rejectsWith(SummariesManager.getMemory4OwnerData({ ownerId: 4, expectedCampaignToken: campaignToken }), "memory4_index_invalid");
    assert.equal(treeHash(root), mismatchedIndexHash, "a failed index proof must not repair or overwrite sidecar data");
    fs.writeFileSync(indexPath, originalIndex);
    checks++;
    console.log("PASS corrupted metadata and mismatched owner index are rejected without automatic repair or writes");

    console.log(`V8.14.1 Memory4 archive read-only integration: ${checks} checks passed`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
