"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const appRoot = process.env.VOTC_V923_TEST_SOURCE_ROOT || path.resolve(__dirname, "../src/app");
const appPackagePath = path.resolve(appRoot, "main", "../../package.json");
if (!fs.existsSync(appPackagePath)) {
  const resolveFilename = Module._resolveFilename;
  const versionFile = path.join(appRoot, "main", "version.js");
  const workspacePackage = path.resolve(__dirname, "../package.json");
  Module._resolveFilename = function(request, parent, ...args) {
    if (request === "../../package.json" && parent?.filename === versionFile) return workspacePackage;
    return resolveFilename.call(this, request, parent, ...args);
  };
}
const fromApp = (...parts) => require(path.join(appRoot, ...parts));
const { MemoryStore } = fromApp("main", "memory-system", "memory-store");
const { Memory4Coordinator } = fromApp("main", "memory-system", "memory4-coordinator");
const { Memory4RecallPlanner } = fromApp("main", "memory-system", "memory4-recall-planner");
const { hash } = fromApp("main", "memory-system", "memory4-contract");
const { normalizeGameDate } = fromApp("main", "worldline", "character-temporal-facts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v923-retirement-qa-"));
let checks = 0, failures = 0, sequence = 0;

async function check(name, run) {
  try {
    await run();
    checks++;
    console.log("PASS " + name);
  } catch (error) {
    failures++;
    console.error("FAIL " + name + ": " + (error.stack || error.message));
  }
}

function fixture(name = "fixture") {
  const directory = path.join(root, `${name}-${++sequence}`);
  const summaryFoldersDir = path.join(directory, "summaries");
  for (const id of [1, 2, 3, 4]) fs.mkdirSync(path.join(summaryFoldersDir, `${id}_fixture`), { recursive: true });
  const base = new MemoryStore({ baseDir: path.join(directory, "memory"), summaryFoldersDir });
  return { base, coordinator: new Memory4Coordinator(base), directory, summaryFoldersDir };
}

function contextFor({ campaignToken, conversationId, date, participants = [1, 2], messages }) {
  return { campaignToken, conversationId, finalizationId: `${conversationId}-final`, episodeId: `${conversationId}-episode`,
    date, totalDays: normalizeGameDate(date).serial, participants: participants.map(id => ({ id, name: `人物${id}` })),
    participantPresence: participants.map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null })), messages };
}

function durableResponse(prompt) {
  const payload = JSON.parse(prompt[1].content);
  const entries = payload.fragments.map(fragment => ({ memoryType: "MAJOR_EXPERIENCE", text: fragment.text,
    fragmentIds: [fragment.fragmentId], entityIds: fragment.entityIds, participantIds: fragment.participantIds,
    topics: ["合成经历"], eventTime: { status: "unknown" } }));
  return { content: JSON.stringify({ status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries }), finish_reason: "stop" };
}

function makeThreeOwnerContext() {
  const participants = [1, 2, 3];
  const messages = participants.map((ownerId, index) => {
    const content = `OWNER_${ownerId}_PRIVATE_FACT ` + `人物${ownerId}的私人记录只属于本人。`.repeat(220);
    return { id: index + 1, role: "user", speakerCharacterId: ownerId, content,
      memory4Fragments: [{ start: 0, end: content.length, visibility: "private", sourceType: "spoken", recipientIds: [], entityIds: [] }] };
  });
  return contextFor({ campaignToken: "v923-three-owner-campaign", conversationId: "v923-three-owner-finalization",
    date: "1174.1.1", participants, messages });
}

function addDetail(sample, { ownerId = 2, campaignToken = "v923-recall-campaign", date = "1169.3.1",
  text = "五年前的粮食会面已按约完成。", memoryType = "MAJOR_EXPERIENCE", topics = ["粮食"], counterpartId = 1 } = {}) {
  const conversationId = `v923-detail-${++sequence}`;
  const context = contextFor({ campaignToken, conversationId, date, participants: [counterpartId, ownerId], messages: [{ id: 1,
    role: "user", speakerCharacterId: ownerId, content: text, memory4Fragments: [{ start: 0, end: text.length,
      visibility: "private", sourceType: "spoken", recipientIds: [], entityIds: [counterpartId] }] }] });
  const snapshot = sample.coordinator.buildOwnerSnapshot(context, ownerId);
  const fragment = snapshot.fragments[0];
  const committed = sample.coordinator.store.commitOwner(snapshot, { status: "STORE", entries: [{ memoryType, text,
    fragmentIds: [fragment.fragmentId], entityIds: [counterpartId], participantIds: fragment.presentIds,
    topics, eventTime: { status: "unknown" } }] });
  return { scope: { campaignToken, ownerId }, snapshot, entryId: committed.entryIds[0], conversationId, content: text };
}

function recallOptions({ campaignToken, date, query }) {
  return { campaignToken, ownerId: 2, currentGameDate: "1174.3.1",
    currentTotalDays: normalizeGameDate("1174.3.1").serial, conversationId: "v923-query", sceneRevision: "v1", turnEpoch: 1,
    querySpeakerId: 1, entityIds: [1], query, topics: ["粮食"], legacyMemories: [],
    memoryEngineRemainingBudget: 1200, providerRemainingSafeBudget: 1200,
    estimateTokens: text => Math.ceil(String(text).length / 2) };
}

async function main() {
  await check("Durable finalization keeps three private Owner scopes isolated", async () => {
    const sample = fixture("three-owner");
    const context = makeThreeOwnerContext();
    const durableCalls = [];
    const result = await sample.coordinator.finalizeCommitted(context, async (prompt, options) => {
      durableCalls.push(options.ownerId);
      return durableResponse(prompt);
    }, { isNarrativeCommitted: true, isCurrent: () => true });

    assert.equal(result.owners.length, 3);
    assert.deepEqual([...durableCalls].sort((a, b) => a - b), [1, 2, 3]);
    for (const ownerId of [1, 2, 3]) {
      const scope = { campaignToken: context.campaignToken, ownerId };
      const index = sample.coordinator.store.loadIndex(scope);
      const entries = Object.entries(index.entries).filter(([, row]) => !row.deleted);
      assert.equal(entries.length, 1, `owner ${ownerId} has one committed private fact`);
      const entry = sample.coordinator.store.readEntry(scope, entries[0][0], index);
      assert.deepEqual(entry.evidence.knownBy, [ownerId]);
      assert(entry.text.includes(`OWNER_${ownerId}_PRIVATE_FACT`));
      assert.equal(index.finalizations[hash(context.finalizationId)].status, "STORE");
    }
    assert.equal(result.status, "COMPLETE");
    assert(result.owners.every(item => item.status === "STORE" && item.durableStatus === "STORE"),
      "reported outcomes must reflect persisted Durable commits");
  });

  await check("YEAR/LIFE intents recall current Detail and reject retired Year/Life refs", async () => {
    const sample = fixture("detail-recall");
    const detail = addDetail(sample, { campaignToken: "v923-detail-recall", date: "1169.3.1" });
    const planner = new Memory4RecallPlanner(sample.coordinator);
    const index = sample.coordinator.store.loadIndex(detail.scope);
    const row = index.entries[detail.entryId];
    const detailRef = { kind: "detail", id: detail.entryId, bodyHash: row.bodyHash };
    assert.equal(planner.validateHistory(detail.scope, [detailRef], { currentGameDate: "1174.3.1" }), true);

    const options = recallOptions({ campaignToken: detail.scope.campaignToken, date: "1174.3.1" });
    const year = planner.plan({ ...options, query: "1169年我们聊过的粮食会面是什么？" });
    const life = planner.plan({ ...options, query: "此人一生有哪些重要经历？" });
    assert(year.items.some(item => item.sourceRef?.kind === "detail" && item.sourceRef.id === detail.entryId));
    assert(life.items.some(item => item.sourceRef?.kind === "detail" && item.sourceRef.id === detail.entryId));
    for (const kind of ["year", "life"]) {
      assert.equal(planner.validateHistory(detail.scope, [{ kind, id: "old-view", bodyHash: "stale" }],
        { currentGameDate: "1174.3.1" }), false, `retired ${kind} references fail closed`);
    }

    sample.coordinator.store.updateEntry(detail.scope, detail.entryId, "来源被修订后的粮食会面。", { expectedRevision: 1 });
    assert.equal(planner.validateHistory(detail.scope, [detailRef], { currentGameDate: "1174.3.1" }), false,
      "a source-body mutation invalidates an old Detail reference");
    sample.coordinator.store.deleteEntry(detail.scope, detail.entryId, { expectedRevision: 2 });
    assert.equal(planner.validateHistory(detail.scope, [detailRef], { currentGameDate: "1174.3.1" }), false,
      "deleted Detail cannot be revived by an old reference");
  });

  await check("Legacy recall remains owner-scoped and stale source hashes fail closed", async () => {
    const sample = fixture("legacy-recall");
    const campaignToken = "v923-legacy-campaign";
    const ownerFolder = path.join(sample.summaryFoldersDir, "2_fixture");
    const summaryPath = path.join(ownerFolder, "与人物1的对话.json");
    const summary = { date: "1164.3.1", totalDays: normalizeGameDate("1164.3.1").serial,
      content: "旧档记载：1164年人物1与人物2在北境会盟，双方留下粮食纪要。", playerId: 2, playerName: "人物2",
      characterId: 1, characterName: "人物1", campaignToken, campaignBinding: { status: "bound", source: "fixture" },
      finalizationId: "legacy-recall-finalization" };
    fs.writeFileSync(summaryPath, JSON.stringify([summary], null, 2), "utf8");
    sample.base.invalidateFolderSummaryCache([2]);
    const legacyMemories = sample.base.loadFolderSummariesForCharacter(2);
    assert.equal(legacyMemories.length, 1);
    const planner = new Memory4RecallPlanner(sample.coordinator);
    const options = { ...recallOptions({ campaignToken, date: "1174.3.1", query: "1164年我们聊过的粮食纪要是什么？" }),
      legacyMemories };
    const result = planner.plan(options);
    const legacyItem = result.items.find(item => item.sourceRef?.kind === "legacy");
    assert(legacyItem, "historical Legacy summaries remain recallable");
    assert.equal(planner.validateHistory({ campaignToken, ownerId: 2 }, [legacyItem.sourceRef],
      { currentGameDate: "1174.3.1" }), true, "an unchanged owner-scoped Legacy source validates");
    assert.equal(planner.validateHistory({ campaignToken: "foreign-campaign", ownerId: 2 }, [legacyItem.sourceRef],
      { currentGameDate: "1174.3.1" }), false, "Legacy references cannot cross Campaign scope");
    assert.equal(planner.validateHistory({ campaignToken, ownerId: 3 }, [legacyItem.sourceRef],
      { currentGameDate: "1174.3.1" }), false, "Legacy references cannot cross Owner scope");

    summary.content = "篡改后的旧档内容。";
    fs.writeFileSync(summaryPath, JSON.stringify([summary], null, 2), "utf8");
    sample.base.invalidateFolderSummaryCache([2]);
    assert.equal(planner.validateHistory({ campaignToken, ownerId: 2 }, [legacyItem.sourceRef],
      { currentGameDate: "1174.3.1" }), false, "a changed Legacy body invalidates its previously issued reference");
  });

  await check("Year/Life migration requires confirmation and restores bytes on failure", async () => {
    const sample = fixture("migration-safety");
    const { planYearLifeRetirement, executeYearLifeRetirement } = fromApp("main", "memory-system", "memory4-retirement-migration");
    const scope = { campaignToken: "v923-migration-campaign", ownerId: 2 };
    sample.coordinator.store.ensureDisclosureScope(scope);
    const sidecar = sample.coordinator.store.directory(scope);
    const metadataPath = path.join(sidecar, "metadata.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, derivedDirty: true, derivedRevision: 2 }, null, 2), "utf8");
    const yearsDir = path.join(sidecar, "years");
    fs.mkdirSync(yearsDir, { recursive: true });
    const yearPath = path.join(yearsDir, "1169.json");
    const lifePath = path.join(sidecar, "life.json");
    fs.writeFileSync(yearPath, JSON.stringify({ memory4SchemaVersion: 1, ...scope, eventYear: 1169, revision: 1,
      dirty: true, sourceRevisionSet: [], items: [{ itemId: "manual-year", text: "PRIVATE_YEAR_FIXTURE" }],
      generationMode: "manual_override", manual: { mode: "manual_override", editedAt: "2026-10-14T00:00:00.000Z" } }, null, 2), "utf8");
    fs.writeFileSync(lifePath, JSON.stringify({ memory4SchemaVersion: 1, ...scope, revision: 1, dirty: false,
      sourceRevisionSet: [], segments: [], generationMode: "auto", manual: { mode: "auto", editedAt: null } }, null, 2), "utf8");
    const before = [fs.readFileSync(yearPath), fs.readFileSync(lifePath), fs.readFileSync(metadataPath)];
    const indexPath = path.join(sidecar, "index.json");
    const knownPath = path.join(sidecar, "known-entities.json");
    const beforeCanonical = [fs.readFileSync(indexPath), fs.readFileSync(knownPath)];
    const plan = planYearLifeRetirement({ summaryFoldersDir: sample.summaryFoldersDir, ownerIds: [2] });
    assert.equal(plan.counts.yearFiles, 1);
    assert.equal(plan.counts.lifeFiles, 1);
    assert.equal(JSON.stringify(plan).includes("PRIVATE_YEAR_FIXTURE"), false, "dry-run cannot expose view bodies");
    assert.deepEqual([fs.readFileSync(yearPath), fs.readFileSync(lifePath), fs.readFileSync(metadataPath)], before,
      "dry-run preserves all source and metadata bytes");
    assert.throws(() => executeYearLifeRetirement({ store: sample.base, ownerIds: [2] }), /memory4_retirement_confirm_required/);
    assert.throws(() => executeYearLifeRetirement({ store: sample.base, ownerIds: [2], confirmPlanHash: plan.planHash,
      hooks: { beforeCommit: () => { throw new Error("qa_rollback_injection"); } } }), /qa_rollback_injection/);
    assert.deepEqual([fs.readFileSync(yearPath), fs.readFileSync(lifePath), fs.readFileSync(metadataPath)], before,
      "failure before commit restores Year, Life, and metadata byte-for-byte");

    const completed = executeYearLifeRetirement({ store: sample.base, ownerIds: [2], confirmPlanHash: plan.planHash });
    assert.equal(completed.status, "COMPLETED");
    assert.equal(fs.existsSync(yearPath), false);
    assert.equal(fs.existsSync(lifePath), false);
    assert.equal(fs.existsSync(yearsDir), false);
    assert.deepEqual([fs.readFileSync(indexPath), fs.readFileSync(knownPath)], beforeCanonical,
      "retirement cannot alter canonical Durable or known-entity evidence");
    assert.equal(fs.existsSync(sample.base.summaryMutationPath), false, "committed retirement leaves no rollback journal");
    const audit = fs.readFileSync(path.join(sample.base.baseDir, "memory4-retirement-v933.json"), "utf8");
    assert.equal(audit.includes("PRIVATE_YEAR_FIXTURE"), false, "audit must contain no historical body text");
  });
}

main().then(() => {
  console.log(`V9.2.3 retirement compatibility QA: ${checks} PASS, ${failures} FAIL`);
  if (failures) process.exitCode = 1;
}).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(() => {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
