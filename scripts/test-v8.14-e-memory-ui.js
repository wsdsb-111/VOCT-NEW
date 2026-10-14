"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createMemoryUiFixture } = require("./v8.14-memory-ui-fixture");
const { createSummariesManager } = require("../src/app/main/summaries/summaries-manager");
const memorySystem = require("../resources/app/out/main/memory-system");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

function assertCurrentRendererContract() {
  const source = fs.readFileSync(path.join(__dirname, "../src/app/renderer/memory4-manager.js"), "utf8");
  const tabs = source.match(/^const TABS = (.*);$/m)?.[1];
  assert.deepStrictEqual(JSON.parse(tabs).map(([, label]) => label), ["人物认知", "官方追忆", "详细长期记忆", "Legacy 对话摘要"]);
  assert(!/年度记忆|人生记忆|updateYear|updateLife|cancelDerived|keepManual/.test(source), "Renderer exposes no retired Year/Life UI or operations");
  assert(source.includes("setManualDisclosure") && source.includes("updateDetail") && source.includes("Legacy 来源关联"),
    "knowledge disclosure, Detail editing, and source coverage remain available");
}

(async () => {
  const root = fs.mkdtempSync(path.join(__dirname, ".votc-e-memory-ui-"));
  try {
    const fixture = await createMemoryUiFixture(root);
    const { engine, scope, summariesDir, conversation } = fixture;
    let current = conversation;
    let providerCalls = 0;
    const manager = createSummariesManager({ fs, path, summariesDir, memoryEngine: engine, memorySystem,
      getCurrentConversation: () => current, requestSummary: async () => { providerCalls++; throw new Error("no_provider"); } });
    const request = { ownerId: 2, expectedCampaignToken: scope.campaignToken };
    const catalogue = await manager.listAllSummaries();
    assert(catalogue.some(row => row.ownerId === 3 && row.memory4Only), "Memory4-only folders must remain navigable");
    let bodyReads = 0;
    const readEntry = engine.memory4.store.readEntry.bind(engine.memory4.store);
    engine.memory4.store.readEntry = (...args) => { bodyReads++; return readEntry(...args); };
    const data = await manager.getMemory4OwnerData(request);
    assert(!Object.hasOwn(data, "derived"), "owner DTO contains no retired Year/Life data");
    assert(bodyReads <= 16, "coverage validates only the bounded committed entries, not the owner’s full index");
    assert.equal(data.detail.total, 2);
    assert.equal(data.official.length, 1);
    assert.equal(data.known.items.find(profile => profile.entityId === 1).relationship.status, "CONFIRMED");
    assert(!JSON.stringify(data).includes("responderRecallCache"), "IPC DTO must not contain conversation runtime objects");
    await assert.rejects(manager.getMemory4OwnerData({ ...request, expectedCampaignToken: "other-campaign" }), /campaign_changed/);
    await assert.rejects(manager.getMemory4OwnerData({ ownerId: 99 }), /owner_not_in_current_campaign/);
    const id = data.detail.items[0].entryId;
    const entry = (await manager.getMemory4Entry({ ...request, entryId: id })).entry;
    assert(!JSON.stringify(data.coverageSummary).includes(entry.text), "coverage DTO never includes Detail body text");
    const source = await manager.getMemory4Sources({ ...request, kind: "detail", entryId: id });
    assert.equal(source.sources.entries[0].entryId, id);
    assert.equal((await manager.getMemory4Entry({ ownerId: 3, expectedCampaignToken: scope.campaignToken, entryId: id })).status, "STALE",
      "a different Owner cannot resolve a Detail body");
    const titleFact = data.known.items.find(profile => profile.entityId === 1).disclosedFacts.find(fact => fact.factType === "TITLE");
    assert(titleFact, "owner-scoped current title disclosure remains visible");
    const disclosure = await manager.mutateMemory4({ ...request, operation: "setManualDisclosure", entityId: 1,
      factRef: { factType: titleFact.factType, factKey: titleFact.factKey, value: titleFact.value },
      status: "MANUAL_KNOWN", expectedRevision: titleFact.revision });
    assert.equal(disclosure.result.status, "MANUAL_KNOWN", "manual disclosure updates remain Owner-scoped");
    await assert.rejects(manager.mutateMemory4({ ...request, operation: "rebuild", kind: "year" }), /memory4_derived_operation_retired/);
    await assert.rejects(manager.mutateMemory4({ ...request, operation: "updateLife", kind: "life" }), /memory4_derived_operation_retired/);
    await assert.rejects(manager.getMemory4Sources({ ...request, kind: "year" }), /memory4_derived_operation_retired/);
    const direct = [{ memory: { memoryId: "frozen-direct" } }], stable = [{ memory: { memoryId: "frozen-stable" } }];
    const cache = { direct, stable, topicPatch: [{ text: "frozen-topic" }], mentionedSnapshots: new Map([[1, ["frozen-mentioned"]]]),
      seenDynamicSummaries: new Set(["retained-dynamic"]), dynamicTurn: 1, memory4Packet: {}, dynamicExtra: ["old"] };
    const otherCache = { direct: ["other-owner"], dynamicExtra: ["other-dynamic"] };
    conversation.memoryState.responderRecallCache.set(2, cache);
    conversation.memoryState.responderRecallCache.set(3, otherCache);
    conversation.dynamicRecallHistory.set(2, new Map([[1, { keys: ["retained-dynamic"] }]]));
    conversation.dynamicRecallHistory.set(3, new Map([[1, { keys: ["other-key"] }]]));
    await manager.mutateMemory4({ ...request, operation: "updateDetail", entryId: id, text: "乙再次核对粮食运送约定。", expectedRevision: entry.revision });
    assert.equal(conversation.memoryState.responderRecallCache.has(2), false,
      "V8.15 invalidates the affected owner's frozen and dynamic memory together");
    assert.equal(conversation.dynamicRecallHistory.has(2), false);
    assert.strictEqual(conversation.memoryState.responderRecallCache.get(3), otherCache);
    assert(conversation.dynamicRecallHistory.has(3));
    const beforeStale = engine.memory4.store.readEntry(scope, id);
    await assert.rejects(manager.mutateMemory4({ ...request, operation: "deleteDetail", entryId: id, expectedRevision: entry.revision }), /edit_stale/);
    assert.deepStrictEqual(engine.memory4.store.readEntry(scope, id), beforeStale);
    assertCurrentRendererContract();
    assert.equal(providerCalls, 0);
    const officialPath = path.join(summariesDir, "2_乙", "官方追忆摘要.json");
    const officialBytes = fs.readFileSync(officialPath);
    assert.equal((await manager.updateSummary(2, 2, 0, "不得改写")).error, "official_recollection_read_only");
    assert.equal((await manager.deleteSummary(2, 2, 0)).error, "official_recollection_read_only");
    assert.equal((await manager.deleteCharacterSummaries(2, 2)).error, "official_recollection_read_only");
    assert.equal((await manager.regenerateSummary(2, 2, 0, JSON.parse(officialBytes)[0].content)).error, "official_recollection_is_not_regenerable");
    assert.deepStrictEqual(fs.readFileSync(officialPath), officialBytes);
    assert.equal(providerCalls, 0);
    const renamedFolder = path.join(summariesDir, "2_乙改名");
    fs.mkdirSync(renamedFolder, { recursive: true });
    const duplicateOfficialPath = path.join(renamedFolder, "官方追忆摘要.json");
    fs.writeFileSync(duplicateOfficialPath, officialBytes);
    const deduplicated = await manager.getMemory4OwnerData(request);
    assert.equal(deduplicated.official.length, 1, "identical Official captures across renamed owner folders should appear once");
    const conflictingOfficial = JSON.parse(officialBytes);
    conflictingOfficial[0].content += " conflicting copy";
    fs.writeFileSync(duplicateOfficialPath, JSON.stringify(conflictingOfficial));
    await assert.rejects(manager.getMemory4OwnerData(request), /memory4_official_capture_conflict/);
    fs.unlinkSync(duplicateOfficialPath);
    fs.rmdirSync(renamedFolder);
    conversation.isActive = false;
    const archived = await manager.getMemory4OwnerData(request);
    assert.equal(archived.readOnlyArchive, true);
    assert.equal(archived.readOnlyReason, "conversation_ended");
    assert.equal(archived.archiveAsOfDate, conversation.gameData.date);
    assert.equal(archived.known.items.find(profile => profile.entityId === 1).relationship.status, "UNKNOWN",
      "archival reads must not present the ended conversation's relationship snapshot as current");
    const archivedSource = await manager.getMemory4Sources({ ...request, kind: "detail", entryId: id });
    assert.equal(archivedSource.readOnlyArchive, true);
    await assert.rejects(manager.mutateMemory4({ ...request, operation: "deleteDetail", entryId: id, expectedRevision: entry.revision }), /conversation_not_active/);
    conversation.isActive = true;
    current = null;
    await assert.rejects(manager.getMemory4OwnerData(request), /conversation_not_active/);
    current = conversation;
    const index = engine.memory4.store.loadIndex(scope), directory = engine.memory4.store.directory(scope);
    const row = index.entries[id];
    for (let i = 0; i < 1100; i++) index.entries[`m4_${hash(["metadata-only", i])}`] = { ...row, legacyRefs: [] };
    engine.memory4.store.reindex(index);
    engine.store.writeJson(path.join(directory, "index.json"), index);
    const metadata = engine.memory4.store.read(path.join(directory, "metadata.json"), null);
    engine.store.writeJson(path.join(directory, "metadata.json"), { ...metadata, indexHash: hash(index) });
    bodyReads = 0;
    const page = await manager.getMemory4OwnerData({ ...request, detailOffset: 40 });
    assert.equal(page.detail.items.length, 40);
    assert.equal(page.detail.total, 1102);
    assert(bodyReads <= 16, "1100+ Detail pagination opens only the bounded current-finalization bodies for coverage");
    assert.equal(fixture.requests, 0);
    console.log("V8.14 E Memory UI: PASS (owner/Campaign DTO, four-tab migration, bounded coverage reads, Detail editing, disclosure, scoped sources, archives, and Official read-only)");
  } finally {
    const target = path.resolve(root);
    assert(target.startsWith(path.resolve(__dirname) + path.sep));
    fs.rmSync(target, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
