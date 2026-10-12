"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { createProjectionLineage } = require("../resources/app/out/main/memory-system/memory4-forget");
const { hash, validateEntry } = require("../resources/app/out/main/memory-system/memory4-contract");
const { buildRuntime } = require("./build-runtime");
const { bootstrapDeploymentReceipt, recoverPendingDeployment, statePaths } = require("./deploy-runtime-build");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v92-independent-qa-"));
const crashHelper = path.join(__dirname, "v9.2-qa-child.js");
const ENTRY_TEXT = "甲承认借用银币，并答应归还。";
const OWNER_ID = 2;
const COUNTERPART_ID = 1;
const CAMPAIGN = "v92-fixture-campaign";
let passed = 0;
let failed = 0;
let nativeUnavailable = 0;
let requiredNativeUnavailable = 0;
let simulatedPass = 0;

function record(name, test) {
  try {
    test();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.stack || error.message || error}`);
  }
}

async function recordAsync(name, test) {
  try {
    await test();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.stack || error.message || error}`);
  }
}

function recordSimulated(name, test) {
  try {
    test();
    simulatedPass++;
    console.log(`SIMULATED_PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`SIMULATED_FAIL ${name}: ${error.stack || error.message || error}`);
  }
}

function fixtureSnapshot(finalizationId, campaignToken = CAMPAIGN, ownerId = OWNER_ID) {
  const conversationId = `conversation-${finalizationId}`;
  const fragmentId = `fragment-${finalizationId}`;
  const fragment = {
    fragmentId,
    messageId: 1,
    sourceMessageIds: [1],
    text: ENTRY_TEXT,
    speakerId: ownerId,
    speakerIds: [ownerId],
    sourceTextVerified: true,
    sourceRole: "user",
    presentIds: [ownerId, COUNTERPART_ID],
    knownBy: [ownerId, COUNTERPART_ID],
    visibility: "participants",
    sourceType: "spoken",
    recipientIds: [COUNTERPART_ID],
    entityIds: [COUNTERPART_ID],
    visibilityEvidence: "application_fragment"
  };
  const projectionLineage = createProjectionLineage({
    campaignToken,
    ownerId,
    conversationId,
    finalizationId,
    counterpartId: COUNTERPART_ID,
    segmentIds: [fragmentId],
    sourceMessageIds: [1]
  });
  const snapshot = {
    campaignToken,
    ownerId,
    conversationId,
    finalizationId,
    episodeId: `episode-${finalizationId}`,
    date: "1164.1.1",
    totalDays: 425000,
    presentMessageCount: 1,
    completeness: "complete",
    legacyRetained: false,
    visibilityEvidence: "application_fragment",
    sourceRevision: hash([campaignToken, ownerId, finalizationId, "source"]),
    summaryIds: [],
    counterpartIds: [COUNTERPART_ID],
    fragments: [fragment],
    projectionLineages: [projectionLineage]
  };
  const candidate = {
    memoryType: "DURABLE_KNOWLEDGE",
    text: `已核实 ${finalizationId}：${ENTRY_TEXT}`,
    fragmentIds: [fragmentId],
    participantIds: [ownerId, COUNTERPART_ID],
    entityIds: [COUNTERPART_ID],
    topics: ["loan", finalizationId],
    eventTime: { status: "unknown" }
  };
  return { snapshot, candidate, projectionLineage };
}

function snapshotTree(directory) {
  if (!fs.existsSync(directory)) return null;
  const rows = [];
  const visit = (current, relative = "") => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, item.name);
      const childRelative = path.join(relative, item.name);
      if (item.isSymbolicLink()) rows.push([childRelative, `link:${fs.readlinkSync(child)}`]);
      else if (item.isDirectory()) {
        rows.push([childRelative, "directory"]);
        visit(child, childRelative);
      } else rows.push([childRelative, `file:${fs.readFileSync(child).toString("base64")}`]);
    }
  };
  visit(directory);
  return rows.sort(([left], [right]) => left.localeCompare(right));
}

function snapshotRoots(fixture) {
  return {
    memory: snapshotTree(fixture.baseDir),
    summaries: snapshotTree(fixture.summariesDir)
  };
}

function seedFixture(name, { seedExistingEntry = true, withDerived = false, withTombstone = false } = {}) {
  const directory = path.join(root, name);
  const baseDir = path.join(directory, "memory");
  const summariesDir = path.join(directory, "summaries");
  const ownerFolder = path.join(summariesDir, `${OWNER_ID}_fixture`);
  fs.mkdirSync(ownerFolder, { recursive: true });
  const store = new MemoryStore({ baseDir, summaryFoldersDir: summariesDir });
  const coordinator = new Memory4Coordinator(store);
  const scope = { campaignToken: CAMPAIGN, ownerId: OWNER_ID };
  const seed = fixtureSnapshot(`${name}-seed`);
  let seededEntry = null;
  if (seedExistingEntry) {
    coordinator.store.commitOwner(seed.snapshot, { status: "STORE", entries: [seed.candidate] });
    seededEntry = coordinator.store.query(scope)[0];
    assert.ok(seededEntry, "seed fixture must create one canonical Memory4 body");
  }
  const scopeDirectory = coordinator.store.directory(scope);
  if (withTombstone) {
    const forgotten = createProjectionLineage({
      campaignToken: CAMPAIGN,
      ownerId: OWNER_ID,
      conversationId: "unrelated-forgotten-conversation",
      finalizationId: "unrelated-forgotten-finalization",
      counterpartId: 3,
      segmentIds: ["unrelated-forgotten-segment"],
      sourceMessageIds: [99]
    });
    coordinator.store.persistForgottenProjection(scope, forgotten);
  }
  if (withDerived && seededEntry) {
    store.writeJson(path.join(scopeDirectory, "years", "1164.json"), {
      memory4SchemaVersion: 1,
      campaignToken: CAMPAIGN,
      ownerId: OWNER_ID,
      revision: 4,
      eventYear: 1164,
      sourceHash: "old-year-source",
      sourceRevisionSet: [`${seededEntry.entryId}@${seededEntry.revision}`],
      dirty: false,
      items: [{ text: "旧年度视图。", sourceEntryIds: [seededEntry.entryId] }],
      tokens: 3
    });
    store.writeJson(path.join(scopeDirectory, "life.json"), {
      memory4SchemaVersion: 1,
      campaignToken: CAMPAIGN,
      ownerId: OWNER_ID,
      revision: 2,
      sourceHash: "old-life-source",
      sourceRevisionSet: [`${seededEntry.entryId}@${seededEntry.revision}`],
      dirty: false,
      segments: [{ period: { fromYear: 1164, toYear: 1164 }, text: "旧生平视图。", sourceEntryIds: [seededEntry.entryId] }]
    });
  }
  const legacyFile = path.join(ownerFolder, "legacy-summary.json");
  store.writeJson(legacyFile, [{
    playerId: OWNER_ID,
    characterId: COUNTERPART_ID,
    content: "保留的 Legacy 摘要。",
    provenance: { campaignToken: CAMPAIGN, folderOwnerId: OWNER_ID }
  }]);
  const recovery = fixtureSnapshot(`${name}-recovery`);
  coordinator.saveRecovery(recovery.snapshot, { status: "PENDING", retryCount: 1, lastError: "fixture" });
  const pending = fixtureSnapshot(`${name}-crash-target`);
  const prepared = validateEntry(pending.candidate, pending.snapshot);
  return {
    directory,
    baseDir,
    summariesDir,
    ownerFolder,
    legacyFile,
    store,
    coordinator,
    scope,
    seedSnapshot: seed.snapshot,
    seedEntry: seededEntry,
    snapshot: pending.snapshot,
    candidate: pending.candidate,
    candidateEntry: prepared,
    targetProjectionLineage: pending.projectionLineage
  };
}

function restartFixture(fixture) {
  const store = new MemoryStore({ baseDir: fixture.baseDir, summaryFoldersDir: fixture.summariesDir });
  return new Memory4Coordinator(store);
}

function runCrashChild(fixture, target) {
  const requestPath = path.join(fixture.directory, `crash-${target}.json`);
  fs.writeFileSync(requestPath, JSON.stringify({
    baseDir: fixture.baseDir,
    summaryFoldersDir: fixture.summariesDir,
    snapshot: fixture.snapshot,
    result: { status: "STORE", entries: [fixture.candidate] },
    entryId: fixture.candidateEntry.entryId,
    target
  }), "utf8");
  return childProcess.spawnSync(process.execPath, [crashHelper, requestPath], {
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true
  });
}

function crashThenRecoverAt(target) {
  const fixture = seedFixture(`crash-${target}`, { withDerived: true, withTombstone: true });
  const before = snapshotRoots(fixture);
  const child = runCrashChild(fixture, target);
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null, `child did not exit by signal: ${child.stderr || child.stdout}`);
  assert.equal(child.status, 73, `child did not stop at ${target}: ${child.stderr || child.stdout}`);
  assert.equal(fs.existsSync(path.join(fixture.baseDir, "summary-mutation.json")), true,
    "a hard stop must leave the durable journal for restart recovery");

  let restarted = restartFixture(fixture);
  assert.equal(fs.existsSync(path.join(fixture.baseDir, "summary-mutation.json")), false,
    "startup recovery must retire the journal only after restoring its old values");
  assert.deepEqual(snapshotRoots(fixture), before,
    `restart after ${target} must restore every Memory4, recovery, derived, tombstone and Legacy byte`);
  assert.deepEqual(restarted.store.query(fixture.scope).map(entry => entry.entryId), [fixture.seedEntry.entryId],
    `restart after ${target} must not expose the interrupted entry`);
  assert.equal(restarted.store.loadIndex(fixture.scope).finalizations[hash(fixture.snapshot.finalizationId)], undefined,
    `restart after ${target} must not retain an interrupted finalization`);

  restarted = restartFixture(fixture);
  assert.equal(fs.existsSync(path.join(fixture.baseDir, "summary-mutation.json")), false);
  assert.deepEqual(snapshotRoots(fixture), before,
    `a second recovery startup after ${target} must be byte-identical and idempotent`);
  assert.deepEqual(restarted.store.query(fixture.scope).map(entry => entry.entryId), [fixture.seedEntry.entryId]);
}

function fixtureModule(fixture) {
  return require("../resources/app/out/main/memory-system/scoped-json-repository").ScopedJsonRepository
    ? new (require("../resources/app/out/main/memory-system/scoped-json-repository").ScopedJsonRepository)({
      memory4Store: fixture.coordinator.store,
      memoryStore: fixture.store
    })
    : null;
}

function bodyReadCounter(memory4) {
  const original = memory4.read.bind(memory4);
  const state = { count: 0 };
  memory4.read = (file, fallback) => {
    if (path.dirname(file).endsWith("entries")) state.count++;
    return original(file, fallback);
  };
  return {
    state,
    restore() { memory4.read = original; }
  };
}

function createDirectoryLink(target, link) {
  try {
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"].includes(error.code)) return false;
    throw error;
  }
}

function createFileLink(target, link) {
  try {
    fs.symlinkSync(target, link, "file");
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"].includes(error.code)) return false;
    throw error;
  }
}

function linkUnavailable(name, { hasSimulation = false } = {}) {
  nativeUnavailable++;
  if (!hasSimulation) requiredNativeUnavailable++;
  console.error(`NATIVE_UNVERIFIED ${name}: this host denied creating the isolated fixture link`);
}

function withLinkStat(targetPath, callback, { missing = false } = {}) {
  const originalLstat = fs.lstatSync;
  const target = path.resolve(targetPath);
  const fallback = missing ? originalLstat.call(fs, __filename) : null;
  const asLink = stats => new Proxy(stats, {
    get(object, property) {
      if (property === "isSymbolicLink") return () => true;
      return Reflect.get(object, property, object);
    }
  });
  fs.lstatSync = function (candidate, ...args) {
    const resolved = path.resolve(candidate);
    try {
      const stats = originalLstat.call(fs, candidate, ...args);
      return resolved === target ? asLink(stats) : stats;
    } catch (error) {
      if (resolved === target && missing && error.code === "ENOENT") return asLink(fallback);
      throw error;
    }
  };
  try { return callback(); }
  finally { fs.lstatSync = originalLstat; }
}

function withTargetIoCounter(targetPath, callback) {
  const target = path.resolve(targetPath);
  const originals = {
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync
  };
  const counts = { reads: 0, writes: 0, renames: 0, unlinks: 0 };
  const matches = candidate => typeof candidate === "string" && path.resolve(candidate) === target;
  fs.readFileSync = function (file, ...args) {
    if (matches(file)) counts.reads++;
    return originals.readFileSync.call(fs, file, ...args);
  };
  fs.writeFileSync = function (file, ...args) {
    if (matches(file)) counts.writes++;
    return originals.writeFileSync.call(fs, file, ...args);
  };
  fs.renameSync = function (source, destination, ...args) {
    if (matches(source) || matches(destination)) counts.renames++;
    return originals.renameSync.call(fs, source, destination, ...args);
  };
  fs.unlinkSync = function (file, ...args) {
    if (matches(file)) counts.unlinks++;
    return originals.unlinkSync.call(fs, file, ...args);
  };
  try {
    callback();
    return counts;
  } finally {
    fs.readFileSync = originals.readFileSync;
    fs.writeFileSync = originals.writeFileSync;
    fs.renameSync = originals.renameSync;
    fs.unlinkSync = originals.unlinkSync;
  }
}

function simulateFileLinkGuard(name, fixture, targetPath, { missing = false, audit = false } = {}) {
  const repository = fixtureModule(fixture);
  const before = snapshotRoots(fixture);
  const bodyCounter = bodyReadCounter(fixture.coordinator.store);
  const io = withTargetIoCounter(targetPath, () => withLinkStat(targetPath, () => {
    if (audit) {
      const report = repository.audit(fixture.scope);
      assert.equal(report.result, "BLOCKED");
      assert.equal(report.reasonCodes.includes("memory4_symlink_path"), true);
    } else {
      assert.throws(() => repository.queryCandidates(fixture.scope, {}),
        error => error.message === "memory4_symlink_path");
    }
    assert.throws(() => fixture.store.writeJson(targetPath, { fixtureWrite: true }),
      error => error.message === "unsafe_summary_mutation_path");
  }, { missing }));
  bodyCounter.restore();
  assert.deepEqual(io, { reads: 0, writes: 0, renames: 0, unlinks: 0 },
    `${name} link metadata must be rejected before reading or writing its target`);
  assert.equal(bodyCounter.state.count, 0, `${name} link rejection must not open any Memory4 detail body`);
  assert.deepEqual(snapshotRoots(fixture), before, `${name} link rejection must preserve the complete source tree`);
}

function expectRepositoryBlock(callback, label) {
  let result;
  let error;
  try { result = callback(); }
  catch (caught) { error = caught; }
  assert.ok(error || result?.result === "BLOCKED" || result?.status === "BLOCKED",
    `${label} must be rejected or reported BLOCKED`);
}

function copyFixtureTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, item.name);
    const to = path.join(destination, item.name);
    if (item.isDirectory()) copyFixtureTree(from, to);
    else if (item.isFile()) fs.copyFileSync(from, to);
    else throw new Error("fixture_copy_non_file");
  }
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function makeDeployRecoveryFixture() {
  const rootDir = path.join(root, "deploy-recovery-read-race");
  const outputDir = path.join(rootDir, ".build", "runtime");
  const files = [
    ["package.json", "package.json", JSON.stringify({ name: "votc-fixture", version: "9.2.0", main: "out/main/main.js" })],
    ["main/main.js", "out/main/main.js", '"use strict";\nmodule.exports = "old-main";\n'],
    ["preload/preload.js", "out/preload/preload.js", '"use strict";\nmodule.exports = "old-preload";\n'],
    ["renderer/index.html", "out/renderer/index.html", "<!doctype html><title>fixture</title>\n"],
    ["default_userdata/prompts/system/default.hbs", "default_userdata/prompts/system/default.hbs", "fixture prompt\n"]
  ];
  fs.mkdirSync(path.join(rootDir, "build"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "build", "runtime-inputs.json"), JSON.stringify({ schemaVersion: 1,
    files: files.map(([source, target]) => ({ source, target })) }, null, 2) + "\n", "utf8");
  for (const [source, , contents] of files) {
    const sourcePath = path.join(rootDir, "src", "app", ...source.split("/"));
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, contents, "utf8");
  }

  const initialManifest = buildRuntime({ rootDir, outputDir });
  const appDir = path.join(rootDir, "resources", "app");
  copyFixtureTree(path.join(outputDir, "app"), appDir);
  bootstrapDeploymentReceipt({ rootDir, outputDir });
  const previousReceipt = JSON.parse(fs.readFileSync(statePaths(rootDir).receiptPath, "utf8"));

  fs.writeFileSync(path.join(rootDir, "src", "app", "main", "main.js"),
    '"use strict";\nmodule.exports = "new-main";\n', "utf8");
  fs.writeFileSync(path.join(rootDir, "src", "app", "preload", "preload.js"),
    '"use strict";\nmodule.exports = "new-preload";\n', "utf8");
  const targetManifest = buildRuntime({ rootDir, outputDir });
  const previousFiles = previousReceipt.files;
  const targetFiles = targetManifest.files.map(item => ({ path: item.path, sha256: item.sha256 }));
  const previousByPath = new Map(previousFiles.map(item => [item.path, item.sha256]));
  const targetByPath = new Map(targetFiles.map(item => [item.path, item.sha256]));
  const paths = [...new Set([...previousByPath.keys(), ...targetByPath.keys()])].sort();
  const actions = paths.filter(file => previousByPath.get(file) !== targetByPath.get(file)).map(file => {
    const previousSha256 = previousByPath.get(file) ?? null;
    const targetSha256 = targetByPath.get(file) ?? null;
    return { path: file, previousSha256, targetSha256,
      backupPath: previousSha256 !== null ? `files/${file}` : null };
  });
  assert.ok(actions.length >= 2, "the recovery fixture must change multiple managed targets");

  const transactionId = crypto.randomUUID();
  const transactionDir = path.join(statePaths(rootDir).backupRoot, transactionId);
  const backupRows = [];
  for (const action of actions) {
    if (!action.backupPath) continue;
    const sourcePath = path.join(appDir, ...action.path.split("/"));
    const bytes = fs.readFileSync(sourcePath);
    assert.equal(sha256Bytes(bytes), action.previousSha256, `fixture backup source hash for ${action.path}`);
    const backupPath = path.join(transactionDir, ...action.backupPath.split("/"));
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, bytes);
    backupRows.push({ path: action.path, sha256: action.previousSha256, backupPath: action.backupPath });
  }
  const backupManifest = { schemaVersion: 1, transactionId, files: backupRows };
  const backupManifestBytes = Buffer.from(JSON.stringify(backupManifest, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(transactionDir, "backup-manifest.json"), backupManifestBytes);
  const receipt = {
    schemaVersion: 1,
    status: "IN_PROGRESS",
    transactionId,
    previousPayloadSha256: initialManifest.payloadSha256,
    targetPayloadSha256: targetManifest.payloadSha256,
    previousFiles,
    targetFiles,
    actions,
    backupManifestSha256: sha256Bytes(backupManifestBytes)
  };
  const receiptPath = statePaths(rootDir).receiptPath;
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");

  const firstAction = actions[0];
  const targetPath = path.join(appDir, ...firstAction.path.split("/"));
  const targetBytes = fs.readFileSync(path.join(outputDir, "app", ...firstAction.path.split("/")));
  assert.equal(sha256Bytes(targetBytes), firstAction.targetSha256, "the partially deployed target matches its journal hash");
  fs.writeFileSync(targetPath, targetBytes);
  return { rootDir, appDir, receiptPath, receipt, firstAction, targetPath };
}

function testDeployRecoveryReadInterleave() {
  const fixture = makeDeployRecoveryFixture();
  const unknownBytes = Buffer.from("unknown concurrent deployment edit", "utf8");
  const receiptBefore = fs.readFileSync(fixture.receiptPath);
  const appBefore = snapshotTree(fixture.appDir);
  const relativeTarget = path.relative(fixture.appDir, fixture.targetPath);
  const expectedApp = appBefore.map(([relative, bytes]) => relative === relativeTarget
    ? [relative, `file:${unknownBytes.toString("base64")}`] : [relative, bytes]);
  assert.equal(expectedApp.some(([relative]) => relative === relativeTarget), true,
    "the journal action must correspond to an existing managed target");

  const originalReadFileSync = fs.readFileSync;
  let targetReads = 0;
  let injected = false;
  const normalizedTarget = path.resolve(fixture.targetPath).toLowerCase();
  fs.readFileSync = function (candidate, ...args) {
    const bytes = originalReadFileSync.call(fs, candidate, ...args);
    if (typeof candidate === "string" && path.resolve(candidate).toLowerCase() === normalizedTarget) {
      targetReads++;
      if (!injected) {
        fs.writeFileSync(fixture.targetPath, unknownBytes);
        injected = true;
      }
    }
    return bytes;
  };
  let recoveryError;
  try {
    try { recoverPendingDeployment({ rootDir: fixture.rootDir }); }
    catch (error) { recoveryError = error; }
  } finally {
    fs.readFileSync = originalReadFileSync;
  }

  assert.equal(injected, true, "the target is changed immediately after recovery preflight reads its old bytes");
  assert.ok(targetReads >= 2, "recovery must perform the preflight and subsequent restore reads");
  assert.match(recoveryError?.message || "", /build_deploy_recovery_unknown_target/,
    "the restore read must reject bytes changed after preflight");
  assert.deepEqual(fs.readFileSync(fixture.targetPath), unknownBytes,
    "recovery must preserve the concurrent unknown bytes");
  assert.deepEqual(snapshotTree(fixture.appDir), expectedApp,
    "recovery must leave every other deployed byte and path unchanged");
  assert.deepEqual(fs.readFileSync(fixture.receiptPath), receiptBefore,
    "blocked recovery must preserve the exact IN_PROGRESS receipt bytes");
  assert.equal(JSON.parse(receiptBefore.toString("utf8")).status, "IN_PROGRESS");
}

async function testCrashRecovery() {
  for (const target of ["journal", "body", "known", "metadata", "index"]) {
    await recordAsync(`Memory4 journal hard stop after ${target} rename restores old tree twice`, () => crashThenRecoverAt(target));
  }
}

async function testScopeChangeDuringProviderWait() {
  await recordAsync("Campaign change while Provider is pending prevents cross-scope commit", async () => {
    const fixture = seedFixture("provider-scope-change", { seedExistingEntry: false });
    const campaignB = { campaignToken: "v92-other-campaign", ownerId: OWNER_ID };
    let activeCampaignToken = fixture.scope.campaignToken;
    let announceStart;
    let releaseProvider;
    const started = new Promise(resolve => { announceStart = resolve; });
    const response = new Promise(resolve => { releaseProvider = resolve; });
    const current = () => activeCampaignToken === fixture.scope.campaignToken;
    const running = fixture.coordinator.finishOwner(fixture.snapshot, async () => {
      announceStart();
      return response;
    }, null, current);
    await started;
    activeCampaignToken = campaignB.campaignToken;
    releaseProvider(JSON.stringify({ status: "STORE", entries: [fixture.candidate] }));
    const result = await running;
    assert.equal(result.status, "CANCELLED");
    assert.deepEqual(restartFixture(fixture).store.query(fixture.scope), []);
    assert.deepEqual(restartFixture(fixture).store.query(campaignB), []);
    assert.equal(restartFixture(fixture).store.loadIndex(fixture.scope).finalizations[hash(fixture.snapshot.finalizationId)], undefined);
  });
}

async function testCasAndSourceHashes() {
  await recordAsync("stale Memory4 update and delete revisions preserve the newer edit byte-for-byte", () => {
    const fixture = seedFixture("cas-stale", { withDerived: true });
    const Repository = require("../resources/app/out/main/memory-system/scoped-json-repository").ScopedJsonRepository;
    const repository = new Repository({ memory4Store: fixture.coordinator.store, memoryStore: fixture.store });
    const entry = fixture.seedEntry;
    assert.equal(entry.revision, 1);
    const update = repository.updateEntry(fixture.scope, entry.entryId, "用户的新修订。", { expectedRevision: entry.revision });
    assert.equal(update.revision, entry.revision + 1);
    const beforeStaleWrites = snapshotRoots(fixture);
    assert.throws(() => repository.updateEntry(fixture.scope, entry.entryId, "旧页面覆盖。", { expectedRevision: entry.revision }),
      error => error.message === "memory4_entry_edit_stale");
    assert.throws(() => repository.deleteEntry(fixture.scope, entry.entryId, { expectedRevision: entry.revision }),
      error => error.message === "memory4_entry_edit_stale");
    assert.deepEqual(snapshotRoots(fixture), beforeStaleWrites,
      "rejected stale revisions must leave body, index, metadata and derived files unchanged");
    const current = restartFixture(fixture).store.readEntry(fixture.scope, entry.entryId);
    assert.equal(current.text, "用户的新修订。");
    assert.equal(current.revision, entry.revision + 1);
  });

  await recordAsync("same-scope body text tampering fails its index bodyHash", () => {
    const fixture = seedFixture("body-hash-tamper");
    const memory4 = fixture.coordinator.store;
    const entry = fixture.seedEntry;
    const file = memory4.entryPath(memory4.directory(fixture.scope), entry.entryId);
    const body = memory4.read(file, null);
    body.text = "篡改正文但保留 Scope。";
    fs.writeFileSync(file, JSON.stringify(body), "utf8");
    assert.throws(() => memory4.query(fixture.scope), error => error.message === "memory4_index_body_mismatch");
  });
}

function testIndexCorruptionPreservesBytes() {
  const primary = seedFixture("primary-index-corrupt");
  const primaryPath = primary.store.paths.index;
  const invalidPrimary = Buffer.from('{"schemaVersion":1,"memories":', "utf8");
  fs.writeFileSync(primaryPath, invalidPrimary);
  assert.throws(() => new MemoryStore({ baseDir: primary.baseDir, summaryFoldersDir: primary.summariesDir }));
  assert.deepEqual(fs.readFileSync(primaryPath), invalidPrimary,
    "constructor must not replace an unreadable authoritative legacy index with an empty fallback");

  const indexFixture = seedFixture("memory4-index-corrupt");
  const indexFile = path.join(indexFixture.coordinator.store.directory(indexFixture.scope), "index.json");
  const invalidIndex = Buffer.from('{"memory4SchemaVersion":1,"entries":', "utf8");
  fs.writeFileSync(indexFile, invalidIndex);
  assert.throws(() => indexFixture.coordinator.store.queryCandidates(indexFixture.scope, {}));
  assert.deepEqual(fs.readFileSync(indexFile), invalidIndex,
    "candidate lookup must not silently rebuild or overwrite an unreadable canonical index");

  const bindingFixture = seedFixture("memory4-index-hash-mismatch");
  const store = bindingFixture.coordinator.store;
  const directory = store.directory(bindingFixture.scope);
  const indexPath = path.join(directory, "index.json");
  const index = store.read(indexPath, null);
  index.revision++;
  fs.writeFileSync(indexPath, JSON.stringify(index), "utf8");
  const changedIndex = fs.readFileSync(indexPath);
  assert.throws(() => store.queryCandidates(bindingFixture.scope, {}),
    error => error.message === "memory4_metadata_index_mismatch");
  assert.deepEqual(fs.readFileSync(indexPath), changedIndex,
    "index and metadata hash disagreement must fail closed without rewriting the damaged index");
}

function testLegacyQueryForgetRace() {
  const fixture = seedFixture("query-forget-race", { seedExistingEntry: false });
  fixture.coordinator.store.commitOwner(fixture.snapshot, { status: "STORE", entries: [fixture.candidate] });
  const memory4 = fixture.coordinator.store;
  const original = memory4.entryPath.bind(memory4);
  let injected = false;
  memory4.entryPath = (directory, id) => {
    const file = original(directory, id);
    if (!injected) {
      injected = true;
      memory4.persistForgottenProjection(fixture.scope, fixture.targetProjectionLineage);
    }
    return file;
  };
  const result = memory4.query(fixture.scope);
  memory4.entryPath = original;
  assert.equal(injected, true, "the stale tombstone must land after query captured its first Forget view");
  assert.deepEqual(result, [], "query must revalidate Forget before exposing a selected body");
}

function testRepositoryFrames() {
  const fixture = seedFixture("candidate-frames");
  const Repository = require("../resources/app/out/main/memory-system/scoped-json-repository").ScopedJsonRepository;
  const repository = new Repository({ memory4Store: fixture.coordinator.store, memoryStore: fixture.store });
  const memory4 = fixture.coordinator.store;
  const entry = fixture.seedEntry;
  const frame = repository.queryCandidates(fixture.scope, { byTopic: entry.topics[0] });
  assert.deepEqual(frame.scope, fixture.scope);
  assert.equal(Number.isSafeInteger(frame.revision), true);
  assert.match(frame.indexHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(frame.entryIds, [entry.entryId]);
  assert.deepEqual(Object.keys(frame).sort(), ["entryIds", "indexHash", "revision", "scope"].sort());
  assert.equal(JSON.stringify(frame).includes(entry.text), false, "candidate frame must never contain entry text");
  assert.equal(repository.readEntry(fixture.scope, entry.entryId, { candidates: frame }).text, entry.text);
  assert.deepEqual(repository.readCandidateEntries(fixture.scope, frame, [entry.entryId]).map(value => value.entryId), [entry.entryId]);

  const counter = bodyReadCounter(memory4);
  const empty = repository.queryCandidates(fixture.scope, { byTopic: "no-such-topic" });
  assert.deepEqual(empty.entryIds, []);
  assert.equal(counter.state.count, 0, "empty candidate query must not open any detail body");
  counter.restore();

  const otherScope = { campaignToken: "v92-frame-other-campaign", ownerId: OWNER_ID };
  const crossCounter = bodyReadCounter(memory4);
  assert.throws(() => repository.readCandidateEntries(otherScope, frame),
    error => error.message === "memory4_candidate_scope_mismatch");
  assert.equal(crossCounter.state.count, 0, "cross-scope frame rejection must happen before body reads");
  crossCounter.restore();
  assert.throws(() => repository.readCandidateEntries(fixture.scope, frame, ["m4_" + "f".repeat(64)]),
    error => error.message === "memory4_candidate_not_selected");

  const staleFrame = repository.queryCandidates(fixture.scope, { byTopic: entry.topics[0] });
  repository.updateEntry(fixture.scope, entry.entryId, "frame 被新修订。", { expectedRevision: entry.revision });
  const staleCounter = bodyReadCounter(memory4);
  assert.throws(() => repository.readCandidateEntries(fixture.scope, staleFrame),
    error => error.message === "memory4_candidate_stale");
  assert.equal(staleCounter.state.count, 0, "stale frame must be rejected before body reads");
  staleCounter.restore();
  assert.throws(() => repository.readEntry(fixture.scope, entry.entryId, { candidates: staleFrame }),
    error => error.message === "memory4_candidate_stale");
}

function testFreshForgetBlocksCandidate() {
  const fixture = seedFixture("candidate-forget");
  const Repository = require("../resources/app/out/main/memory-system/scoped-json-repository").ScopedJsonRepository;
  const repository = new Repository({ memory4Store: fixture.coordinator.store, memoryStore: fixture.store });
  const frame = repository.queryCandidates(fixture.scope, { byTopic: fixture.seedEntry.topics[0] });
  fixture.coordinator.store.persistForgottenProjection(fixture.scope, fixture.seedEntry.source.projectionLineages[0]);
  const counter = bodyReadCounter(fixture.coordinator.store);
  let result;
  let error;
  try { result = repository.readCandidateEntries(fixture.scope, frame); }
  catch (caught) { error = caught; }
  counter.restore();
  assert.equal(result, undefined, "a candidate blocked by fresh Forget must not return entry content");
  assert.equal(error?.message, "memory4_projection_forgotten",
    "fresh Forget must return the specific fail-closed reason rather than authorize a stale frame");
  assert.equal(JSON.stringify(result || []).includes(fixture.seedEntry.text), false);
}

function testRepositoryForgetRace() {
  const fixture = seedFixture("repository-forget-race");
  const Repository = require("../resources/app/out/main/memory-system/scoped-json-repository").ScopedJsonRepository;
  const repository = new Repository({ memory4Store: fixture.coordinator.store, memoryStore: fixture.store });
  const memory4 = fixture.coordinator.store;
  const frame = repository.queryCandidates(fixture.scope, {});
  const original = memory4.entryPath.bind(memory4);
  let injected = false;
  memory4.entryPath = (directory, id) => {
    if (!injected) {
      injected = true;
      memory4.persistForgottenProjection(fixture.scope, fixture.seedEntry.source.projectionLineages[0]);
    }
    return original(directory, id);
  };
  let result;
  let error;
  try { result = repository.readCandidateEntries(fixture.scope, frame); }
  catch (caught) { error = caught; }
  finally { memory4.entryPath = original; }
  assert.equal(injected, true, "Forget must land after candidate frame validation and before canonical body read");
  assert.equal(result, undefined, "a body read racing with Forget must not be returned");
  assert.equal(error?.message, "memory4_projection_forgotten");
}

function testKnownByReadGuard() {
  const fixture = seedFixture("known-by-read-guard");
  const Repository = require("../resources/app/out/main/memory-system/scoped-json-repository").ScopedJsonRepository;
  const repository = new Repository({ memory4Store: fixture.coordinator.store, memoryStore: fixture.store });
  const memory4 = fixture.coordinator.store;
  const entry = memory4.readEntry(fixture.scope, fixture.seedEntry.entryId);
  entry.evidence.knownBy = [3];
  const index = memory4.loadIndex(fixture.scope);
  index.revision++;
  index.entries[entry.entryId] = memory4.indexRow(entry);
  memory4.reindex(index);
  const directory = memory4.directory(fixture.scope);
  const metadata = memory4.read(path.join(directory, "metadata.json"), null);
  fs.writeFileSync(memory4.entryPath(directory, entry.entryId), JSON.stringify(entry), "utf8");
  fs.writeFileSync(path.join(directory, "index.json"), JSON.stringify(index), "utf8");
  fs.writeFileSync(path.join(directory, "metadata.json"), JSON.stringify({
    ...metadata,
    revision: index.revision,
    indexHash: hash(index)
  }), "utf8");
  const frame = repository.queryCandidates(fixture.scope, { byTopic: entry.topics[0] });
  assert.throws(() => repository.readCandidateEntries(fixture.scope, frame),
    error => error.message === "memory4_entry_denied",
    "a validly hashed body that omits its Owner from knownBy must not reach the caller");
}

function testAuditReadOnly() {
  const fixture = seedFixture("anonymous-audit");
  const Repository = require("../resources/app/out/main/memory-system/scoped-json-repository").ScopedJsonRepository;
  const repository = new Repository({ memory4Store: fixture.coordinator.store, memoryStore: fixture.store });
  const before = snapshotRoots(fixture);
  const report = repository.audit(fixture.scope);
  assert.ok(report && typeof report === "object");
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(CAMPAIGN), false, "audit must anonymize Campaign scope");
  assert.equal(serialized.includes(String(OWNER_ID)), false, "audit must anonymize Owner ID");
  assert.equal(serialized.includes(fixture.seedEntry.text), false, "audit must not copy memory text");
  for (const value of Object.values(report.counts || {})) {
    assert.equal(Number.isSafeInteger(value) && value >= 0 && value <= 1000, true,
      "audit counts must be bounded nonnegative integers");
  }
  assert.equal(Array.isArray(report.reasonCodes), true);
  assert.equal(report.reasonCodes.every(code => /^[A-Za-z0-9_]+$/.test(code) && code.length <= 64), true,
    "audit exposes only bounded reason codes");
  assert.deepEqual(snapshotRoots(fixture), before, "read-only audit must not rewrite or clean any file");
}

function testPendingMutationBlocksRepositoryReads() {
  const fixture = seedFixture("pending-mutation-read-guard");
  const Repository = require("../resources/app/out/main/memory-system/scoped-json-repository").ScopedJsonRepository;
  const repository = new Repository({ memory4Store: fixture.coordinator.store, memoryStore: fixture.store });
  const frame = repository.queryCandidates(fixture.scope, {});
  const counter = bodyReadCounter(fixture.coordinator.store);
  fixture.store.withSummaryMutation(null, () => {
    assert.throws(() => repository.readCandidateEntries(fixture.scope, frame),
      error => error.message === "summary_mutation_in_progress");
    assert.throws(() => repository.queryCandidates(fixture.scope, {}),
      error => error.message === "summary_mutation_in_progress");
  });
  counter.restore();
  assert.equal(counter.state.count, 0, "in-process mutation blocks candidate and detail reads before body I/O");

  fs.writeFileSync(fixture.store.summaryMutationPath, JSON.stringify({ version: 1, files: {} }), "utf8");
  const journalCounter = bodyReadCounter(fixture.coordinator.store);
  assert.throws(() => repository.readCandidateEntries(fixture.scope, frame),
    error => error.message === "summary_mutation_in_progress");
  journalCounter.restore();
  assert.equal(journalCounter.state.count, 0, "a durable pending journal blocks reads before body I/O");
  fs.unlinkSync(fixture.store.summaryMutationPath);
}

function testSymlinkRejectionAndJournalEscape() {
  const rootTarget = path.join(root, "symlink-root-target");
  const rootLink = path.join(root, "symlink-root-link");
  const ownerFolder = path.join(rootTarget, `${OWNER_ID}_fixture`);
  fs.mkdirSync(ownerFolder, { recursive: true });
  if (!createDirectoryLink(rootTarget, rootLink)) {
    linkUnavailable("summary-root junction rejection");
  } else {
    record("summary root junction is rejected by Repository", () => {
      const store = new MemoryStore({ baseDir: path.join(root, "symlink-root-memory"), summaryFoldersDir: rootLink });
      const coordinator = new Memory4Coordinator(store);
      const Repository = require("../resources/app/out/main/memory-system/scoped-json-repository").ScopedJsonRepository;
      const repository = new Repository({ memory4Store: coordinator.store, memoryStore: store });
      expectRepositoryBlock(() => repository.queryCandidates({ campaignToken: CAMPAIGN, ownerId: OWNER_ID }, {}), "root junction");
    });
  }

  const escapeRoot = path.join(root, "journal-escape");
  const allowedSummaries = path.join(escapeRoot, "summaries");
  const outside = path.join(escapeRoot, "outside");
  const link = path.join(allowedSummaries, `${OWNER_ID}_fixture`);
  fs.mkdirSync(allowedSummaries, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const sentinel = path.join(outside, "summary.json");
  const originalSentinel = Buffer.from("outside sentinel must remain unchanged", "utf8");
  fs.writeFileSync(sentinel, originalSentinel);
  if (!createDirectoryLink(outside, link)) {
    linkUnavailable("summary mutation path escape rejection");
  } else {
    record("summary-mutation path cannot follow an in-root junction outside its root", () => {
      const store = new MemoryStore({ baseDir: path.join(escapeRoot, "memory"), summaryFoldersDir: allowedSummaries });
      const linkedPath = path.join(link, "summary.json");
      assert.throws(() => store.withSummaryMutation(linkedPath, () => store.writeJson(linkedPath, { content: "outside write" })), /symlink|path|root|unsafe/i);
      assert.deepEqual(fs.readFileSync(sentinel), originalSentinel, "failed mutation must preserve the external sentinel");
    });
  }

  const recoveryRoot = path.join(root, "journal-restore-escape");
  const recoverySummaries = path.join(recoveryRoot, "summaries");
  const recoveryOutside = path.join(recoveryRoot, "outside");
  const recoveryLink = path.join(recoverySummaries, `${OWNER_ID}_fixture`);
  const recoveryMemory = path.join(recoveryRoot, "memory");
  fs.mkdirSync(recoverySummaries, { recursive: true });
  fs.mkdirSync(recoveryOutside, { recursive: true });
  fs.mkdirSync(recoveryMemory, { recursive: true });
  const restoreSentinel = path.join(recoveryOutside, "summary.json");
  const restoreOriginal = Buffer.from("restore target sentinel", "utf8");
  fs.writeFileSync(restoreSentinel, restoreOriginal);
  if (!createDirectoryLink(recoveryOutside, recoveryLink)) {
    linkUnavailable("summary journal restore escape rejection");
  } else {
    record("startup journal recovery cannot restore through an in-root junction", () => {
      const linkedFile = path.join(recoveryLink, "summary.json");
      fs.writeFileSync(path.join(recoveryMemory, "summary-mutation.json"), JSON.stringify({
        version: 1,
        files: { [linkedFile]: Buffer.from("journal must not overwrite outside", "utf8").toString("base64") }
      }), "utf8");
      assert.throws(() => new MemoryStore({ baseDir: recoveryMemory, summaryFoldersDir: recoverySummaries }), /symlink|path|root|unsafe/i);
      assert.deepEqual(fs.readFileSync(restoreSentinel), restoreOriginal, "rejected recovery must preserve external bytes");
    });
  }

  for (const fileName of ["index.json", "metadata.json", "known-entities.json"]) {
    const fixture = seedFixture(`file-link-${fileName.replace(/[^a-z]/g, "-")}`);
    const memory4 = fixture.coordinator.store;
    const repository = fixtureModule(fixture);
    const file = path.join(memory4.directory(fixture.scope), fileName);
    const outsideCopy = path.join(fixture.directory, `outside-${fileName}`);
    fs.copyFileSync(file, outsideCopy);
    const backup = `${file}.link-backup`;
    fs.renameSync(file, backup);
    const nativeLinkCreated = createFileLink(outsideCopy, file);
    if (!nativeLinkCreated) {
      fs.renameSync(backup, file);
      linkUnavailable(`${fileName} symlink rejection`, { hasSimulation: true });
    } else {
      record(`${fileName} symlink is rejected without following the external copy`, () => {
        expectRepositoryBlock(() => repository.audit(fixture.scope), fileName);
      });
      fs.unlinkSync(file);
      fs.renameSync(backup, file);
    }
    recordSimulated(`${fileName} lstat link signal blocks reads and writes`, () =>
      simulateFileLinkGuard(fileName, fixture, file, { audit: fileName === "known-entities.json" }));
  }

  const danglingFixture = seedFixture("dangling-forgotten-link");
  const danglingMemory4 = danglingFixture.coordinator.store;
  const danglingPath = danglingMemory4.forgottenProjectionsPath(danglingFixture.scope);
  const nativeDanglingLink = createFileLink(path.join(danglingFixture.directory, "missing-forgotten-target.json"), danglingPath);
  if (!nativeDanglingLink) {
    linkUnavailable("dangling Forget symlink rejection", { hasSimulation: true });
  } else {
    record("dangling forgotten-projections symlink is rejected instead of treated as an empty set", () => {
      const repository = fixtureModule(danglingFixture);
      expectRepositoryBlock(() => repository.audit(danglingFixture.scope), "dangling Forget link");
    });
    fs.unlinkSync(danglingPath);
  }
  recordSimulated("dangling forgotten-projections lstat link signal blocks reads and writes", () =>
    simulateFileLinkGuard("dangling forgotten-projections", danglingFixture, danglingPath, { missing: true }));
}

async function run() {
  try {
    await testCrashRecovery();
    await testScopeChangeDuringProviderWait();
    await recordAsync("query rechecks a Forget tombstone written after candidate selection", testLegacyQueryForgetRace);
    if (!process.argv.includes("--crash-only")) {
      await recordAsync("deployment recovery preserves an unknown edit injected after preflight read", testDeployRecoveryReadInterleave);
      await testCasAndSourceHashes();
      await recordAsync("corrupt primary and Memory4 indexes fail closed without overwriting bytes", testIndexCorruptionPreservesBytes);
      await recordAsync("repository candidate frames are scoped, revision-bound and text-free", testRepositoryFrames);
      await recordAsync("fresh Forget blocks an older candidate frame before output", testFreshForgetBlocksCandidate);
      await recordAsync("Forget racing between frame validation and body read suppresses the canonical entry", testRepositoryForgetRace);
      await recordAsync("active or durable summary mutation blocks repository reads before body I/O", testPendingMutationBlocksRepositoryReads);
      await recordAsync("Repository enforces Owner knownBy on validly hashed bodies", testKnownByReadGuard);
      await recordAsync("Repository audit is anonymous, bounded and read-only", testAuditReadOnly);
      await recordAsync("symlink and journal path escapes fail closed", testSymlinkRejectionAndJournalEscape);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(`V9.2 independent QA: ${passed} PASS, ${failed} FAIL, ${nativeUnavailable} NATIVE_UNVERIFIED, ${simulatedPass}/4 SIMULATED_PASS`);
  if (failed || simulatedPass !== 4 || requiredNativeUnavailable > 0) process.exitCode = 1;
}

run().catch(error => {
  console.error(error);
  fs.rmSync(root, { recursive: true, force: true });
  process.exitCode = 1;
});
