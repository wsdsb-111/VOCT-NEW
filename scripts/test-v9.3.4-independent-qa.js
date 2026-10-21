"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sourceVersionPath = require.resolve("../src/app/main/version");
require.cache[sourceVersionPath] = { id: sourceVersionPath, filename: sourceVersionPath, loaded: true,
  exports: require("../resources/app/out/main/version") };
const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
const { createProjectionLineage, hash } = require("../src/app/main/memory-system/legacy-source-lineage");
const { createSummariesManager } = require("../src/app/main/summaries/summaries-manager");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v934-independent-qa-"));
const campaign = "v934-synthetic-campaign";
let sequence = 0;
let passed = 0;
let failed = 0;

async function check(name, run) {
  try {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.stack || error.message || error}`);
  }
}

function fixture(name, owners = [[1, "甲"], [2, "乙"], [3, "丙"], [4, "丁"]]) {
  const directory = path.join(root, `${name}-${++sequence}`);
  const summariesDir = path.join(directory, "summaries");
  for (const [ownerId, ownerName] of owners) fs.mkdirSync(path.join(summariesDir, `${ownerId}_${ownerName}`), { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  return { directory, summariesDir, engine };
}

function summaryPath(sample, ownerId, counterpartName) {
  const ownerName = ({ 1: "甲", 2: "乙", 3: "丙", 4: "丁" })[ownerId] || `人物${ownerId}`;
  return path.join(sample.summariesDir, `${ownerId}_${ownerName}`, `与${counterpartName}的对话.json`);
}

function legacyRecord({ ownerId = 2, counterpartId = 1, campaignToken = campaign,
  finalizationId = `qa-final-${ownerId}-${counterpartId}`, conversationId = null,
  content = "QA_LEGACY historical conversation." } = {}) {
  const date = "1164.1.1";
  return { date, totalDays: normalizeGameDate(date).serial, content,
    playerId: ownerId, playerName: `人物${ownerId}`, characterId: counterpartId, characterName: `人物${counterpartId}`,
    perspectiveOwnerId: ownerId, campaignToken, campaignBinding: { status: "bound", source: "qa-fixture" },
    conversationId: conversationId || `qa-conversation-${finalizationId}`, finalizationId,
    perspectiveMemoryIds: [], perspectiveSummarySegmentIds: [], sourceMessageIds: [], sourceSegmentIds: [] };
}

function seedLegacyFile(sample, ownerId, counterpartId, rows) {
  const file = summaryPath(sample, ownerId, `人物${counterpartId}`);
  sample.engine.store.writeJson(file, rows);
  sample.engine.store.invalidateFolderSummaryCache([ownerId]);
  return file;
}

function seedLegacySidecar(sample, ownerId, campaignToken = campaign) {
  const scope = { campaignToken, ownerId };
  const directory = path.join(sample.summariesDir, ".memory4", String(ownerId), hash(campaignToken));
  const lineage = createProjectionLineage({ campaignToken, ownerId, counterpartId: 99,
    conversationId: `qa-old-sidecar-${ownerId}`, finalizationId: `qa-old-sidecar-${ownerId}`, segmentIds: ["qa-old-segment"] });
  const forgottenPath = path.join(directory, "forgotten-projections.json");
  sample.engine.store.writeJson(forgottenPath, { schemaVersion: 1, ...scope,
    projections: { [lineage.projectionId]: { ...lineage, reason: "qa-synthetic-archive", forgottenAt: "2026-10-15T00:00:00.000Z" } } });
  return { scope, directory, forgottenPath };
}

function snapshotFiles(directory) {
  if (!fs.existsSync(directory)) return null;
  const snapshot = {};
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) snapshot[path.relative(directory, target)] = fs.readFileSync(target).toString("base64");
    }
  };
  visit(directory);
  return snapshot;
}

function isRetiredPath(value, sample) {
  if (typeof value !== "string") return false;
  const target = path.resolve(value).toLowerCase();
  const summaryRoot = path.resolve(sample.summariesDir).toLowerCase();
  const baseRoot = path.resolve(sample.engine.store.baseDir).toLowerCase();
  const sidecarRoot = `${summaryRoot}${path.sep}.memory4`;
  const recoveryRoot = `${baseRoot}${path.sep}memory4-recovery`;
  return target === `${summaryRoot}${path.sep}.memory4` || target.startsWith(`${sidecarRoot}${path.sep}`)
    || target === recoveryRoot || target.startsWith(`${recoveryRoot}${path.sep}`)
    || target.split(path.sep).some(part => part === "memory4");
}

async function trackRetiredAccess(sample, run, { unreadablePath = null } = {}) {
  const reads = new Map();
  const writes = new Map();
  const events = [];
  const wrapped = [];
  const readMethods = ["existsSync", "accessSync", "statSync", "lstatSync", "realpathSync", "readdirSync", "readFileSync", "openSync"];
  const writeMethods = ["mkdirSync", "rmdirSync", "unlinkSync", "writeFileSync", "renameSync", "openSync"];
  const asyncMethods = { reads: ["access", "stat", "lstat", "realpath", "readdir", "readFile", "open"],
    writes: ["mkdir", "rmdir", "unlink", "writeFile", "rename", "rm", "open"] };
  const watch = (target, method, bucket) => {
    if (typeof target[method] !== "function") return;
    const original = target[method];
    target[method] = function(...args) {
      const targets = method === "renameSync" ? args.slice(0, 2) : args.slice(0, 1);
      for (const target of targets) {
        const raw = typeof target === "string" ? target : target?.toString?.();
        if (isRetiredPath(raw, sample)) {
          bucket.set(method, (bucket.get(method) || 0) + 1);
          events.push({ method, path: raw });
        }
      }
      const first = typeof args[0] === "string" ? path.resolve(args[0]) : args[0]?.toString?.();
      if (["readFileSync", "readFile"].includes(method) && unreadablePath && first === path.resolve(unreadablePath)) {
        const error = new Error("qa_injected_unreadable_retired_sidecar");
        error.code = "EACCES";
        throw error;
      }
      return original.apply(this, args);
    };
    wrapped.push([target, method, original]);
    if (typeof original.native === "function") {
      target[method].native = original.native;
      watch(target[method], "native", bucket);
    }
  };
  try {
    readMethods.forEach(method => watch(fs, method, reads));
    writeMethods.forEach(method => watch(fs, method, writes));
    asyncMethods.reads.forEach(method => watch(fs.promises, method, reads));
    asyncMethods.writes.forEach(method => watch(fs.promises, method, writes));
    await run();
  } finally {
    for (const [target, method, original] of wrapped.reverse()) target[method] = original;
  }
  return { reads: Object.fromEntries(reads), writes: Object.fromEntries(writes),
    totalReads: [...reads.values()].reduce((sum, value) => sum + value, 0),
    totalWrites: [...writes.values()].reduce((sum, value) => sum + value, 0), events };
}

function makeFinalizationContext(engine, suffix) {
  const messages = [
    { id: 1, role: "user", speakerCharacterId: 1, content: "甲暗自心想QA_PRIVATE_THOUGHT。" },
    { id: 2, role: "user", speakerCharacterId: 1, content: "甲只对乙低声说QA_WHISPER_SECRET。" },
    { id: 3, role: "assistant", speakerCharacterId: 2, content: "乙公开向众人宣布QA_PREJOIN_SECRET。" },
    { id: 4, role: "user", speakerCharacterId: 3, content: "丙向众人回应QA_AFTER_JOIN_CONTEXT。" },
    { id: 5, role: "assistant", speakerCharacterId: 2, content: "乙公开回应QA_SHARED_AFTER_JOIN。" },
    { id: 6, role: "assistant", speakerCharacterId: 1, content: "甲公开回应QA_AFTER_LEAVE_SECRET。" }
  ];
  const participants = [{ id: 1, name: "甲" }, { id: 2, name: "乙" }, { id: 3, name: "丙" }];
  const presence = [
    { characterId: 1, joinedAtMessageId: 1, leftAtMessageId: null },
    { characterId: 2, joinedAtMessageId: 1, leftAtMessageId: null },
    { characterId: 3, joinedAtMessageId: 4, leftAtMessageId: 6 }
  ];
  const context = engine.prepareFinalizationContext({ campaignToken: `${campaign}-${suffix}`, conversationId: `qa-final-${suffix}`,
    finalizationId: `qa-finalization-${suffix}`, date: "1174.1.1", totalDays: normalizeGameDate("1174.1.1").serial,
    participants, participantPresence: presence, messages, finalizationVisibilityV1: true,
    buildPrompt: () => [], getSummaryCapabilities: () => ({ contextWindow: 8192, maxOutputTokens: 2048,
      providerId: "synthetic", providerType: "synthetic", modelId: "synthetic" }) });
  return context;
}

function adversarialNarrativeOutput(context) {
  return JSON.stringify({ summarySegments: [{
    content: context.messages.map(message => message.content).join("\n"),
    participants: context.participants.map(person => person.id), visibility: "public", source: "spoken",
    messageIds: context.messages.map(message => message.id), speakerIds: [1, 2, 3]
  }], memories: [] });
}

function persistProjectedLegacy(sample) {
  return async (_finalSummary, context) => {
    for (const [key, projection] of context.directedSummaries) {
      const [ownerId, counterpartId] = key.split("->").map(Number);
      const row = legacyRecord({ ownerId, counterpartId, campaignToken: context.campaignToken,
        finalizationId: context.finalizationId, conversationId: context.conversationId, content: projection.content });
      const file = summaryPath(sample, ownerId, `人物${counterpartId}`);
      const rows = sample.engine.store.readJson(file, []);
      rows.push(row);
      sample.engine.store.writeJson(file, rows);
    }
    return { success: true };
  };
}

function makeManager(sample, fileByPair, getCurrentConversation = () => null) {
  const manager = createSummariesManager({ fs, path, summariesDir: sample.summariesDir,
    memoryEngine: sample.engine, memorySystem: {}, getCurrentConversation });
  manager.findSummaryFilePath = (ownerId, counterpartId) => ({
    playerPerspectivePath: fileByPair.get(`${ownerId}->${counterpartId}`) || null
  });
  manager.writeSummaryJsonAtomic = (file, value) => sample.engine.store.writeJson(file, value);
  manager.refreshCurrentConversation = () => {};
  return manager;
}

async function testLegacyFinalizationAndPrivateBoundaries() {
  const sample = fixture("legacy-finalization", [[1, "甲"], [2, "乙"], [3, "丙"]]);
  let summaryCalls = 0;
  let durableCalls = 0;
  const context = makeFinalizationContext(sample.engine, "visibility");
  const oldSidecar = seedLegacySidecar(sample, 2, context.campaignToken);
  sample.engine.store.writeJson(path.join(oldSidecar.directory, "years", "1164.json"), {
    memory4SchemaVersion: 1, campaignToken: context.campaignToken, ownerId: 2, eventYear: 1164,
    items: [{ itemId: "qa-retired-year", text: "QA_YEAR_LIFE_SENTINEL" }]
  });
  sample.engine.store.writeJson(path.join(oldSidecar.directory, "life.json"), {
    memory4SchemaVersion: 1, campaignToken: context.campaignToken, ownerId: 2,
    segments: [{ text: "QA_YEAR_LIFE_SENTINEL" }]
  });
  const oldSidecarBytes = snapshotFiles(oldSidecar.directory);
  context.persistCharacterFolders = persistProjectedLegacy(sample);
  context.requestSummary = async () => {
    summaryCalls++;
    return { content: adversarialNarrativeOutput(context), finish_reason: "stop" };
  };
  context.requestDurable = async () => {
    durableCalls++;
    return { content: JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }), finish_reason: "stop" };
  };
  const access = await trackRetiredAccess(sample, async () => {
    const result = await sample.engine.finalizeConversation(context);
    assert.equal(result.success, true, "final narrative should commit to the normal Legacy path");
    assert(sample.engine.isCommitted(context), "the Narrative/Episode commit must survive Durable retirement");
  });
  assert.equal(summaryCalls, 1, "the synthetic final-summary provider is called once");
  assert.equal(durableCalls, 0, "finalization must never invoke the Durable callback");
  assert.equal(access.totalReads, 0, "finalization must not read retired sidecar or Recovery storage");
  assert.equal(access.totalWrites, 0, "finalization must not write retired sidecar or Recovery storage");
  assert.deepEqual(snapshotFiles(oldSidecar.directory), oldSidecarBytes, "old Year/Life and Sidecar bytes remain inert during finalization");

  const owner2 = sample.engine.store.loadFolderSummariesForCharacter(2)
    .filter(memory => memory.provenance?.campaignToken === context.campaignToken);
  const owner3 = sample.engine.store.loadFolderSummariesForCharacter(3)
    .filter(memory => memory.provenance?.campaignToken === context.campaignToken);
  const pair12 = owner2.find(memory => memory.provenance?.counterpartId === 1)?.content || "";
  const pair31 = owner3.find(memory => memory.provenance?.counterpartId === 1)?.content || "";
  assert(pair12.includes("QA_WHISPER_SECRET"), "the named whisper recipient keeps the Legacy passage");
  assert(!pair12.includes("QA_PRIVATE_THOUGHT"), "private thought is excluded from the other owner's Legacy summary");
  for (const hidden of ["QA_WHISPER_SECRET", "QA_PREJOIN_SECRET", "QA_AFTER_LEAVE_SECRET"]) {
    assert(!pair31.includes(hidden), `Owner 3 cannot receive ${hidden}`);
  }
  assert(pair31.includes("QA_AFTER_JOIN_CONTEXT"), "a present character receives the shared post-join Legacy passage");
  const history = sample.engine.retrieveForResponder({ characterId: 2, query: "我们上次谈过什么？",
    directCounterpartIds: [1], activeParticipantIds: [1, 2], querySpeakerId: 1,
    ownerFolderMemories: owner2, campaignToken: context.campaignToken, currentGameDate: "1174.1.1",
    currentTotalDays: normalizeGameDate("1174.1.1").serial, memory4RecallEnabled: false,
    tokenBudget: 1200, estimateTokens: text => Math.ceil(String(text).length / 2) });
  assert.equal(history.memory4Packet ?? null, null, "Legacy history recall must not construct a Durable packet");
  assert(history.directText.includes("QA_WHISPER_SECRET"), "NPC history recall injects the authorized Legacy narrative");
  assert(!history.directText.includes("QA_YEAR_LIFE_SENTINEL"), "retired Year/Life files cannot re-enter Legacy recall");
}

async function testNarrativeRecoveryIgnoresOldDurableRecovery() {
  const sample = fixture("narrative-recovery", [[1, "甲"], [2, "乙"]]);
  const context = sample.engine.prepareFinalizationContext({ campaignToken: `${campaign}-recovery`,
    conversationId: "qa-committed-narrative-recovery", finalizationId: "qa-committed-narrative-recovery-final",
    date: "1174.1.1", totalDays: normalizeGameDate("1174.1.1").serial,
    participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }],
    participantPresence: [1, 2].map(characterId => ({ characterId, joinedAtMessageId: 1, leftAtMessageId: null })),
    messages: [
      { id: 1, role: "user", speakerCharacterId: 1, content: "甲向乙说明QA_NARRATIVE_RECOVERY。" },
      { id: 2, role: "assistant", speakerCharacterId: 2, content: "乙答应记住QA_NARRATIVE_RECOVERY。" }
    ], finalizationVisibilityV1: true, buildPrompt: () => [],
    persistCharacterFolders: persistProjectedLegacy(sample) });
  const output = JSON.stringify({ summarySegments: context.messages.map(message => ({ content: message.content,
    participants: [1, 2], visibility: "public", source: "spoken", messageIds: [message.id], speakerIds: [message.speakerCharacterId] })), memories: [] });
  const narrativeRecovery = sample.engine.writeRecoverySnapshot(context, { finalizationStage: "persist",
    finalizationStatus: "pending", providerOutput: output });
  const committed = await sample.engine.finalizeWithAvailableOutput(context, { providerOutput: output,
    recoveryPath: narrativeRecovery, deferRecoveryCleanup: true });
  assert.equal(committed.success, true, "fixture first commits the Legacy Narrative");

  const committedEpisode = sample.engine.isCommitted(context);
  const recoveryContext = { ...context, verifiedSummarySegments: committedEpisode.summarySegments };
  const oldSnapshot = { campaignToken: context.campaignToken, ownerId: 2, conversationId: context.conversationId,
    finalizationId: context.finalizationId, verifiedSummarySegments: recoveryContext.verifiedSummarySegments };
  const oldDurableRecovery = path.join(sample.engine.store.baseDir, "memory4-recovery", "qa-retired-pending.json");
  sample.engine.store.writeJson(oldDurableRecovery, { schemaVersion: 1, snapshot: oldSnapshot, status: "PENDING",
    retryCount: 0, lastError: "qa_retired_pending" });
  const beforeRecovery = fs.readFileSync(oldDurableRecovery);
  let summaryCalls = 0;
  let durableCalls = 0;
  const access = await trackRetiredAccess(sample, async () => {
    await sample.engine.recoverPendingFinalizations({ activeCampaignToken: context.campaignToken,
      isConversationActive: () => false, requestSummary: async () => { summaryCalls++; throw new Error("Narrative already committed"); },
      requestDurable: async () => { durableCalls++; throw new Error("retired Durable callback reached"); },
      persistCharacterFolders: persistProjectedLegacy(sample) });
  });
  assert.equal(summaryCalls, 0, "committed Narrative recovery does not request another summary");
  assert.equal(durableCalls, 0, "recovery must not resume an old Durable job");
  assert.equal(fs.existsSync(narrativeRecovery), false, "verified Narrative recovery closes after its Legacy commit");
  assert.equal(fs.existsSync(oldDurableRecovery), true, "the old Durable Recovery stays inert and retained");
  assert.deepEqual(fs.readFileSync(oldDurableRecovery), beforeRecovery, "retirement leaves the old Recovery bytes unchanged");
  assert.equal(access.totalReads, 0, "recovery does not scan retired sidecar or Durable Recovery storage");
  assert.equal(access.totalWrites, 0, "recovery does not write retired sidecar or Durable Recovery storage");
}

async function testPendingNarrativeRecoveryRemainsLegacyOnly() {
  const sample = fixture("pending-narrative-recovery", [[1, "甲"], [2, "乙"]]);
  const context = sample.engine.prepareFinalizationContext({ campaignToken: `${campaign}-pending-recovery`,
    conversationId: "qa-pending-narrative-recovery", finalizationId: "qa-pending-narrative-recovery-final",
    date: "1174.1.1", totalDays: normalizeGameDate("1174.1.1").serial,
    participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }],
    participantPresence: [1, 2].map(characterId => ({ characterId, joinedAtMessageId: 1, leftAtMessageId: null })),
    messages: [
      { id: 1, role: "user", speakerCharacterId: 1, content: "甲向乙解释QA_PENDING_NARRATIVE_RECOVERY的缘由。" },
      { id: 2, role: "assistant", speakerCharacterId: 2, content: "乙记住了QA_PENDING_NARRATIVE_RECOVERY的来龙去脉。" }
    ], finalizationVisibilityV1: true, buildPrompt: () => "Synthetic recovery prompt",
    persistCharacterFolders: persistProjectedLegacy(sample) });
  const recoveryPath = sample.engine.writeRecoverySnapshot(context, { finalizationStage: "request",
    finalizationStatus: "pending", providerOutput: null });
  let summaryCalls = 0;
  let durableCalls = 0;
  let recoveryResults = [];
  const access = await trackRetiredAccess(sample, async () => {
    recoveryResults = await sample.engine.recoverPendingFinalizations({ activeCampaignToken: context.campaignToken,
      isConversationActive: () => false, buildPrompt: () => "Synthetic recovery prompt",
      getSummaryCapabilities: () => ({ contextWindow: 8192, maxOutputTokens: 2048,
        providerId: "synthetic", providerType: "synthetic", modelId: "synthetic" }),
      requestSummary: async () => {
        summaryCalls++;
        const recovered = sample.engine.prepareFinalizationContext({ ...context, finalizationId: context.finalizationId,
          messages: context.messages });
        return { content: adversarialNarrativeOutput(recovered), finish_reason: "stop" };
      },
      requestDurable: async () => { durableCalls++; throw new Error("retired Durable callback reached"); },
      persistCharacterFolders: persistProjectedLegacy(sample) });
  });
  assert(sample.engine.isCommitted(context), `pending Narrative Recovery commits its Narrative/Episode: ${JSON.stringify(recoveryResults.map(result => ({ success: result.success, error: result.error?.message, reason: result.reason, recoveryPath: result.recoveryPath })))}`);
  const rows = sample.engine.store.loadFolderSummariesForCharacter(2);
  assert(rows.some(row => row.content.includes("QA_PENDING_NARRATIVE_RECOVERY")), "recovered Legacy text is independently persisted");
  assert(summaryCalls > 0, "a genuinely pending Narrative still uses the summary callback");
  assert.equal(durableCalls, 0, "a successful Narrative Recovery never resumes Durable extraction");
  assert(recoveryResults.some(result => result.success === true), "Legacy-only Narrative recovery reports success");
  assert.equal(fs.existsSync(recoveryPath), false, "verified Legacy Narrative Recovery closes after commit");
  assert.equal(access.totalReads, 0, "pending Narrative Recovery never reads retired Sidecar or Durable Recovery storage");
  assert.equal(access.totalWrites, 0, "pending Narrative Recovery never writes retired Sidecar or Durable Recovery storage");
}

async function testSidecarStatesAreInertForLegacy() {
  for (const state of ["missing", "corrupt", "unreadable"]) {
    const sample = fixture(`legacy-${state}`, [[1, "甲"], [2, "乙"]]);
    const file = seedLegacyFile(sample, 2, 1, [legacyRecord({ content: `QA_LEGACY_${state}_SUMMARY` })]);
    let unreadablePath = null;
    let oldSidecarBytes = null;
    if (state !== "missing") {
      const sidecar = seedLegacySidecar(sample, 2);
      unreadablePath = sidecar.forgottenPath;
      if (state === "corrupt") sample.engine.store.writeRawFile(unreadablePath, Buffer.from("{retired-sidecar-invalid", "utf8"));
      oldSidecarBytes = snapshotFiles(sidecar.directory);
    }
    sample.engine.memory4 = null;
    sample.engine.memory4Recall = null;
    let legacy = [];
    const access = await trackRetiredAccess(sample, async () => {
      legacy = sample.engine.store.loadFolderSummariesForCharacter(2);
      assert.equal(legacy.length, 1, `${state} old sidecar cannot hide or damage the Legacy summary`);
      assert(legacy[0].content.includes(`QA_LEGACY_${state}_SUMMARY`));
      assert.equal(fs.readFileSync(file, "utf8").includes(`QA_LEGACY_${state}_SUMMARY`), true);
    }, { unreadablePath: state === "unreadable" ? unreadablePath : null });
    assert.equal(access.totalReads, 0, `${state} old sidecar receives no read or metadata probe: ${JSON.stringify(access.events)}`);
    assert.equal(access.totalWrites, 0, `${state} old sidecar receives no write: ${JSON.stringify(access.events)}`);
    if (oldSidecarBytes) assert.deepEqual(snapshotFiles(path.dirname(unreadablePath)), oldSidecarBytes, `${state} old sidecar bytes remain unchanged`);
  }
}

async function testLegacyEditForgetIsIndependentAndScoped() {
  const sample = fixture("legacy-edit-forget");
  const owner2Pair1 = seedLegacyFile(sample, 2, 1, [
    legacyRecord({ ownerId: 2, counterpartId: 1, campaignToken: `${campaign}-A`, finalizationId: "qa-shared-finalization",
      conversationId: "qa-campaign-A-conversation", content: "QA_TARGET_CAMPAIGN_A" }),
    legacyRecord({ ownerId: 2, counterpartId: 1, campaignToken: `${campaign}-B`, finalizationId: "qa-shared-finalization",
      conversationId: "qa-campaign-B-conversation", content: "QA_PRESERVE_CAMPAIGN_B" })
  ]);
  const owner3Pair1 = seedLegacyFile(sample, 3, 1, [legacyRecord({ ownerId: 3, counterpartId: 1,
    campaignToken: `${campaign}-A`, finalizationId: "qa-other-owner-A", content: "QA_PRESERVE_OWNER_3" })]);
  const owner2Pair4 = seedLegacyFile(sample, 2, 4, [legacyRecord({ ownerId: 2, counterpartId: 4,
    campaignToken: `${campaign}-A`, finalizationId: "qa-other-counterpart-A", content: "QA_PRESERVE_COUNTERPART_4" })]);
  sample.engine.store.saveEpisode({ episodeId: "qa-other-campaign-shared-finalization", conversationId: "qa-campaign-B-conversation",
    finalizationId: "qa-shared-finalization", campaignToken: `${campaign}-B`, participants: [{ id: 1 }, { id: 2 }], memoryIds: [],
    summarySegments: [{ segmentId: "qa-campaign-B-segment", content: "QA_PRESERVE_CAMPAIGN_B_EPISODE",
      participants: [1, 2], knownBy: [1, 2], visibility: "participants" }] });
  sample.engine.store.saveEpisode({ episodeId: "qa-target-campaign-shared-finalization", conversationId: "qa-campaign-A-conversation",
    finalizationId: "qa-shared-finalization", campaignToken: `${campaign}-A`, participants: [{ id: 1 }, { id: 2 }], memoryIds: [],
    summarySegments: [{ segmentId: "qa-campaign-A-segment", content: "QA_PRESERVE_CAMPAIGN_A_EPISODE",
      participants: [1, 2], knownBy: [1, 2], visibility: "participants" }] });
  const targetRecord = sample.engine.store.readJson(owner2Pair1, [])[0];
  const targetEpisode = sample.engine.store.listAllEpisodes().find(episode => episode.episodeId === "qa-target-campaign-shared-finalization");
  assert.equal(targetRecord.finalizationId, targetEpisode.finalizationId, "the edited Legacy row maps to the Episode finalization");
  assert.equal(targetRecord.conversationId, targetEpisode.conversationId, "the edited Legacy row maps to the Episode conversation");
  assert.equal(targetRecord.campaignToken, targetEpisode.campaignToken, "the edited Legacy row maps to the Episode Campaign");
  assert.equal(targetRecord.perspectiveOwnerId, 2, "the projection Owner is explicit");
  assert.equal(targetRecord.characterId, 1, "the projection counterpart is explicit");
  assert.deepEqual(targetEpisode.participants.map(person => person.id).sort((a, b) => a - b), [1, 2],
    "the mapped Episode contains the Owner and counterpart");
  const oldA = seedLegacySidecar(sample, 2, `${campaign}-A`);
  const oldB = seedLegacySidecar(sample, 2, `${campaign}-B`);
  const oldOwner3 = seedLegacySidecar(sample, 3, `${campaign}-A`);
  const sidecarBefore = [oldA.directory, oldB.directory, oldOwner3.directory].map(snapshotFiles);
  sample.engine.memory4 = null;
  sample.engine.memory4Recall = null;
  const activeConversation = { memoryState: {}, dynamicRecallHistory: new Map([[
    1, { text: "QA_STALE_DYNAMIC_RECALL", keys: ["qa-stale"] }
  ]]), cacheV2FrozenSnapshots: { prefixByResponder: new Map([[2, "QA_STALE_PREFIX"]]) },
  gameData: { characters: new Map([[2, { conversationSummaries: ["QA_STALE_SUMMARY"], conversationCache: new Map([[1, "stale"]]), dynamicMemoryCache: { stale: true } }]]) } };
  const recallCacheBeforeEdit = sample.engine.ensureConversationState(activeConversation).responderRecallCache;
  const manager = makeManager(sample, new Map([
    ["2->1", owner2Pair1], ["3->1", owner3Pair1], ["2->4", owner2Pair4]
  ]), () => activeConversation);
  const access = await trackRetiredAccess(sample, async () => {
    const edit = await manager.updateSummary(2, 1, 0, "QA_EDITED_CAMPAIGN_A");
    assert.equal(edit.success, true, `Legacy edit without Memory4 instance: ${edit.error || ""}`);
    const unrelatedEpisode = sample.engine.store.listAllEpisodes().find(episode => episode.episodeId === "qa-other-campaign-shared-finalization");
    assert.equal(unrelatedEpisode.summarySegments.length, 1, "Legacy edit cannot append its edited segment to another Campaign's episode even when finalization IDs collide");
    assert.equal(unrelatedEpisode.summarySegments[0].content, "QA_PRESERVE_CAMPAIGN_B_EPISODE");
    const editedEpisode = sample.engine.store.listAllEpisodes().find(episode => episode.episodeId === "qa-target-campaign-shared-finalization");
    assert(editedEpisode.summarySegments.some(segment => segment.content === "QA_EDITED_CAMPAIGN_A"), "Legacy edit updates only the matching Campaign's episode");
    const afterEdit = sample.engine.store.readJson(owner2Pair1, []);
    assert.equal(afterEdit[0].content, "QA_EDITED_CAMPAIGN_A");
    assert.equal(afterEdit[0].campaignToken, `${campaign}-A`);
    assert.equal(afterEdit[1].content, "QA_PRESERVE_CAMPAIGN_B");
    assert.notEqual(activeConversation.memoryState.responderRecallCache, recallCacheBeforeEdit,
      "Legacy editing clears the active responder recall cache");
    assert.equal(activeConversation.dynamicRecallHistory.size, 0, "Legacy editing clears active dynamic recall history");
    assert.equal(activeConversation.cacheV2FrozenSnapshots.prefixByResponder.size, 0, "Legacy editing clears frozen prompt prefixes");

    activeConversation.dynamicRecallHistory.set(2, { text: "QA_EDITED_CAMPAIGN_A", keys: ["qa-edited"] });
    activeConversation.memoryState.responderRecallCache.set(2, { dynamicExtra: [{ memory: { content: "QA_EDITED_CAMPAIGN_A" } }] });

    const fileBeforeFailedForget = fs.readFileSync(owner2Pair1);
    const storeBeforeFailedForget = snapshotFiles(sample.engine.store.baseDir);
    const forgetLedgerBeforeFailedForget = JSON.parse(JSON.stringify(sample.engine.store.index.forgottenSummaryProjections || {}));
    const originalWriter = manager.writeSummaryJsonAtomic;
    const originalConsoleError = console.error;
    manager.writeSummaryJsonAtomic = () => { throw new Error("qa_forget_commit_injected"); };
    console.error = () => {};
    let failedDeletion;
    try { failedDeletion = await manager.deleteSummary(2, 1, 0); }
    finally { manager.writeSummaryJsonAtomic = originalWriter; console.error = originalConsoleError; }
    assert.equal(failedDeletion.success, false, "an injected Legacy writer failure is reported");
    assert.match(failedDeletion.error, /qa_forget_commit_injected/);
    assert.deepEqual(fs.readFileSync(owner2Pair1), fileBeforeFailedForget, "failed Forget rolls back the Legacy file");
    assert.deepEqual(snapshotFiles(sample.engine.store.baseDir), storeBeforeFailedForget, "failed Forget rolls back every MemoryStore file it touched");
    assert.deepEqual(sample.engine.store.index.forgottenSummaryProjections || {}, forgetLedgerBeforeFailedForget,
      "failed Forget rolls back its source ledger");
    const recallCacheBeforeDelete = activeConversation.memoryState.responderRecallCache;
    activeConversation.dynamicRecallHistory.set(2, { text: "QA_EDITED_CAMPAIGN_A", keys: ["qa-edited"] });
    activeConversation.memoryState.responderRecallCache.set(2, { dynamicExtra: [{ memory: { content: "QA_EDITED_CAMPAIGN_A" } }] });
    const deletion = await manager.deleteSummary(2, 1, 0);
    assert.equal(deletion.success, true, `Legacy Forget without Memory4 instance: ${deletion.error || ""}`);
    const campaignAAfterForget = sample.engine.store.listAllEpisodes().find(episode => episode.episodeId === "qa-target-campaign-shared-finalization");
    const campaignBAfterForget = sample.engine.store.listAllEpisodes().find(episode => episode.episodeId === "qa-other-campaign-shared-finalization");
    assert(!campaignAAfterForget.summarySegments.some(segment => segment.content === "QA_EDITED_CAMPAIGN_A"), "Forget revokes the edited projection from its own Campaign episode");
    assert.deepEqual(campaignBAfterForget.summarySegments.map(segment => segment.content), ["QA_PRESERVE_CAMPAIGN_B_EPISODE"], "Forget preserves the other Campaign episode");
    assert.notEqual(activeConversation.memoryState.responderRecallCache, recallCacheBeforeDelete,
      "Legacy Forget clears the active responder recall cache");
    assert.equal(activeConversation.dynamicRecallHistory.size, 0, "Legacy Forget clears active dynamic recall history");
  });
  assert.equal(access.totalReads, 0, `Legacy edit and Forget never read retired Sidecar or Recovery data: ${JSON.stringify(access.events)}`);
  assert.equal(access.totalWrites, 0, `Legacy edit and Forget never write retired Sidecar or Recovery data: ${JSON.stringify(access.events)}`);
  assert.deepEqual(sample.engine.store.readJson(owner2Pair1, []), [
    legacyRecord({ ownerId: 2, counterpartId: 1, campaignToken: `${campaign}-B`, finalizationId: "qa-shared-finalization",
      conversationId: "qa-campaign-B-conversation", content: "QA_PRESERVE_CAMPAIGN_B" })
  ], "Forget removes the edited projection from Owner 2 / Campaign A only");
  assert.equal(sample.engine.store.readJson(owner3Pair1, [])[0].content, "QA_PRESERVE_OWNER_3", "another Owner's Legacy remains");
  assert.equal(sample.engine.store.readJson(owner2Pair4, [])[0].content, "QA_PRESERVE_COUNTERPART_4", "another counterpart's Legacy remains");
  assert.deepEqual([oldA.directory, oldB.directory, oldOwner3.directory].map(snapshotFiles), sidecarBefore,
    "Legacy editing and Forget leave old Sidecar bytes unchanged");
  const owner2 = sample.engine.store.loadFolderSummariesForCharacter(2);
  assert(!owner2.some(memory => memory.content.includes("QA_EDITED_CAMPAIGN_A")), "a forgotten Legacy projection cannot reappear in recall");
  assert(owner2.some(memory => memory.content.includes("QA_PRESERVE_CAMPAIGN_B")), "another Campaign remains recallable");
}

async function main() {
  await check("Legacy finalization and adversarial privacy boundaries", testLegacyFinalizationAndPrivateBoundaries);
  await check("committed Narrative recovery ignores old Durable Recovery", testNarrativeRecoveryIgnoresOldDurableRecovery);
  await check("pending Narrative recovery remains Legacy-only", testPendingNarrativeRecoveryRemainsLegacyOnly);
  await check("missing, corrupt, and unreadable Sidecars are inert; Year/Life stays retired", testSidecarStatesAreInertForLegacy);
  await check("Legacy edit and Forget are independent and scoped", testLegacyEditForgetIsIndependentAndScoped);
}

main().then(() => {
  console.log(`V9.3.4 independent retirement QA: ${passed} PASS, ${failed} FAIL`);
  if (failed) process.exitCode = 1;
}).catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(() => {
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(root, { recursive: true, force: true });
});
