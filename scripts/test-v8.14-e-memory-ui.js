"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("node:vm");
const { createMemoryUiFixture } = require("./v8.14-memory-ui-fixture");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");
const memorySystem = require("../resources/app/out/main/memory-system");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

async function renderRetiredControls(manager, ownerId) {
  const slots = [], effects = [];
  let cursor = 0, tree, confirmCalls = 0;
  const react = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: initial };
      return [slots[index].value, value => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ||= { current: initial };
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, position) => value !== slots[index].dependencies[position])) {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies };
        effects.push(() => { slots[index].cleanup = callback(); });
      }
    }
  };
  const sandbox = { window: { conversationAPI: {
    getMemory4OwnerData: request => manager.getMemory4OwnerData(request),
    getMemory4Sources: request => manager.getMemory4Sources(request),
    mutateMemory4: request => manager.mutateMemory4(request)
  }, confirm: () => { confirmCalls++; return true; } }, setTimeout, clearTimeout };
  const source = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/memory4-manager.js"), "utf8")
    .replace("export function Memory4Manager", "function Memory4Manager");
  vm.runInNewContext(`${source}\nthis.component = Memory4Manager;`, sandbox);
  const render = () => {
    cursor = 0;
    tree = sandbox.component({ react, ownerId, refreshKey: 0 });
    while (effects.length) effects.shift()();
  };
  const nodes = (node, predicate) => {
    if (!node || typeof node !== "object") return [];
    return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => nodes(child, predicate))];
  };
  const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
  render();
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
    render();
  }
  const tabs = nodes(tree, node => node.type === "button" && node.props.role === "tab");
  tabs.find(node => text(node) === "年度记忆").props.onClick();
  render();
  const yearControls = nodes(tree, node => node.type === "button").filter(node =>
    ["从长期记忆生成年度与人生记忆", "从 Detail 重新生成", "从来源重新生成", "重新生成并覆盖"].includes(text(node)));
  assert(yearControls.length > 0 && yearControls.every(node => node.props.disabled), "retired Year controls are disabled in the rendered UI");
  const rebuildButton = yearControls.find(node => text(node) === "从长期记忆生成年度与人生记忆");
  rebuildButton.props.onClick();
  render();
  assert.equal(confirmCalls, 0, "retired generation does not show a paid-model confirmation");
  tabs.find(node => text(node) === "人生记忆").props.onClick();
  render();
  const lifeControls = nodes(tree, node => node.type === "button").filter(node =>
    ["从年度记忆生成人生记忆", "重新生成当前阶段", "重新生成并覆盖"].includes(text(node)));
  assert(lifeControls.length > 0 && lifeControls.every(node => node.props.disabled), "retired Life controls are disabled in the rendered UI");
  return { confirmCalls };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-e-memory-ui-"));
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
    assert.equal(data.derived.generationPolicy, "RETIRED");
    assert.equal(bodyReads, 0, "owner navigation must not open canonical Detail bodies");
    assert.equal(data.detail.total, 2);
    assert.equal(data.official.length, 1);
    assert.equal(data.known.items.find(profile => profile.entityId === 1).relationship.status, "CONFIRMED");
    assert(data.derived.years.some(year => year.dirty && year.generationMode === "manual_override"));
    assert(!JSON.stringify(data).includes("responderRecallCache"), "IPC DTO must not contain conversation runtime objects");
    assert(!Object.hasOwn(data.derived, "gameData"));
    await assert.rejects(manager.getMemory4OwnerData({ ...request, expectedCampaignToken: "other-campaign" }), /campaign_changed/);
    await assert.rejects(manager.getMemory4OwnerData({ ownerId: 99 }), /owner_not_in_current_campaign/);
    const id = data.detail.items[0].entryId;
    const entry = (await manager.getMemory4Entry({ ...request, entryId: id })).entry;
    const source = await manager.getMemory4Sources({ ...request, kind: "detail", entryId: id });
    assert.equal(source.sources.entries[0].entryId, id);
    await assert.rejects(manager.getMemory4Entry({ ownerId: 3, expectedCampaignToken: scope.campaignToken, entryId: id }), /index_body_mismatch/);
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
    const year = engine.memory4.derived.list(scope).years.find(view => view.generationMode === "manual_override");
    assert(year, "the historical fixture must retain its manually edited Year view");
    await manager.mutateMemory4({ ...request, operation: "keepManual", kind: "year", eventYear: year.eventYear, expectedRevision: year.revision });
    const kept = engine.memory4.derived.list(scope).years.find(view => view.eventYear === year.eventYear);
    assert.equal(kept.items[0].text, year.items[0].text);
    assert.equal(kept.dirty, true);
    const changedSources = await manager.getMemory4Sources({ ...request, kind: "year", eventYear: year.eventYear });
    assert.equal(changedSources.sources.changed, true);
    await manager.mutateMemory4({ ...request, operation: "cancelDerived" });
    const rebuild = engine.memory4.derived.rebuild.bind(engine.memory4.derived);
    let rebuildCalls = 0, derivedProviderCalls = 0;
    engine.memory4.configureDerived({ requestCompression: async () => { derivedProviderCalls++; throw new Error("retired_derived_provider_must_not_run"); } });
    engine.memory4.derived.rebuild = async (receivedScope, options) => {
      rebuildCalls++;
      assert.deepStrictEqual(receivedScope, scope);
      assert.deepStrictEqual(Object.keys(options).sort(), ["eventYear", "expectedRevision", "kind", "overwriteManual", "segmentId"]);
      assert.equal(options.committedFinalization, undefined);
      assert.equal(options.providerSnapshot, undefined);
      return await rebuild(receivedScope, options);
    };
    const retired = await manager.mutateMemory4({ ...request, operation: "rebuild", kind: "year", eventYear: year.eventYear,
      expectedRevision: year.revision, overwriteManual: false, committedFinalization: true, providerSnapshot: { apiKey: "never-forward" } });
    engine.memory4.derived.rebuild = rebuild;
    assert.equal(retired.result.status, "SKIPPED_DERIVED_POLICY");
    assert.equal(retired.result.providerRequests, 0);
    assert.equal(rebuildCalls, 1);
    assert.equal(derivedProviderCalls, 0);
    assert.equal(engine.memory4.derived.list(scope).generationPolicy, "RETIRED");
    await renderRetiredControls(manager, scope.ownerId);
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
    assert.equal(bodyReads, 0, "1100+ Detail metadata pagination must not open nonselected files");
    const sidecar = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/memory4-manager.js"), "utf8");
    assert(sidecar.includes('UNKNOWN: "未知（证据不足）"'));
    assert(sidecar.includes('data?.derived?.generationPolicy === "RETIRED"'));
    assert(sidecar.includes('operation: "cancelDerived"'));
    assert(sidecar.includes('window.confirm("删除这条长期记忆？'));
    assert(!sidecar.includes("从未认识"));
    assert.equal(fixture.requests, 0);
    console.log("V8.14 E Memory UI: PASS (owner/Campaign DTO, metadata-only paging, protected frozen lanes, scoped sources, revisions, manual conflict, cancellation and Official read-only)");
  } finally {
    const target = path.resolve(root);
    assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(target, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
