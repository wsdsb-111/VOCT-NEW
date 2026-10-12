"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const main = "../resources/app/out/main/memory-system/";
const { MemoryStore } = require(main + "memory-store");
const { Memory4Store, INDEX_KEYS } = require(main + "memory4-store");
const { ScopedJsonRepository } = require(main + "scoped-json-repository");
const { projectVisibleTranscript } = require(main + "memory4-visibility");
const { hash } = require(main + "memory4-contract");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v92-repository-"));
const folders = path.join(root, "summaries");
for (const id of [1, 2]) fs.mkdirSync(path.join(folders, `${id}_fixture`), { recursive: true });
const base = new MemoryStore({ baseDir: path.join(root, "memory"), summaryFoldersDir: folders });
const store = new Memory4Store(base);
const repo = new ScopedJsonRepository({ memory4Store: store, memoryStore: base });
const scope = { campaignToken: "fixture-campaign", ownerId: 1 };

function commit(number) {
  const text = `1088年1月1日，甲告诉乙第${number}件经历。`;
  const context = { ...scope, conversationId: `conversation-${number}`, finalizationId: `final-${number}`,
    date: "1088.1.1", totalDays: 397120, participants: [{ id: 1 }, { id: 2 }],
    participantPresence: [1, 2].map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null })),
    messages: [{ id: 1, role: "assistant", speakerCharacterId: 1, content: text, memory4Fragments: [
      { start: 0, end: text.length, visibility: "participants", sourceType: "spoken", recipientIds: [2], entityIds: [2] }
    ] }] };
  const snapshot = { ...context, ...projectVisibleTranscript(context, 1), counterpartIds: [2] };
  const entries = [0, 1, 2, 3].map(index => ({ memoryType: "MAJOR_EXPERIENCE", text: `经历${number}之${index}`,
    fragmentIds: [snapshot.fragments[0].fragmentId], entityIds: [2], participantIds: [1, 2], topics: [`topic-${index}`],
    eventTime: { status: "reported", precision: "day", from: "1088.1.1", to: "1088.1.1" } }));
  const result = repo.commitOwner(snapshot, { status: "STORE", entries });
  // Seed an existing range-shaped entry, as in the V8 persisted-index compatibility fixtures.
  const index = store.loadIndex(scope), directory = store.directory(scope);
  const entry = store.readEntry(scope, result.entryIds[0], index);
  entry.eventTime = { status: "reported", precision: "range", from: "1084.1.1", to: "1086.12.31" };
  index.entries[entry.entryId] = store.indexRow(entry);
  store.reindex(index);
  const metadata = store.read(path.join(directory, "metadata.json"), null);
  base.withSummaryMutation(null, () => {
    base.writeJson(store.entryPath(directory, entry.entryId), entry);
    base.writeJson(path.join(directory, "metadata.json"), { ...metadata, indexHash: hash(index) });
    base.writeJson(path.join(directory, "index.json"), index);
  });
  return result;
}

// The V9.1 selector is kept as an independent oracle, including index insertion order.
function oldIds(index, filters) {
  let selected = new Set(index.byOwner[String(scope.ownerId)] || []);
  const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
  for (const [axis, value] of Object.entries(filters)) {
    const allowed = new Set(Object.hasOwn(index[axis], String(value)) ? index[axis][String(value)] : []);
    if (axis === "byEventDate") {
      const target = normalizeGameDate(value);
      for (const [id, row] of Object.entries(index.entries)) {
        if (!row.deleted && row.eventTime.precision === "range"
          && normalizeGameDate(row.eventTime.from)?.serial <= target.serial
          && normalizeGameDate(row.eventTime.to)?.serial >= target.serial) allowed.add(id);
      }
    }
    selected = new Set([...selected].filter(id => allowed.has(id)));
  }
  return [...selected];
}

try {
  for (let number = 0; number < 12; number++) commit(number);
  const index = store.loadIndex(scope);
  const actualRead = store.read.bind(store);
  let bodyReads = 0, bodyBytes = 0;
  store.read = (file, fallback) => {
    if (path.basename(path.dirname(file)) === "entries") { bodyReads++; bodyBytes += fs.statSync(file).size; }
    return actualRead(file, fallback);
  };
  const cases = [{}, { byEventDate: "1085.6.1" }, { byTopic: "topic-1", byEntity: 2 }, { byTopic: "absent" }];
  for (const axis of INDEX_KEYS) for (const value of Object.keys(index[axis])) cases.push({ [axis]: value });
  for (const filters of cases) {
    bodyReads = 0;
    const frame = repo.queryCandidates(scope, filters);
    assert.equal(bodyReads, 0, "candidate lookup opens no bodies");
    assert.deepEqual(frame.entryIds, oldIds(index, filters));
    assert.deepEqual(Object.keys(frame).sort(), ["entryIds", "indexHash", "revision", "scope"]);
    assert(Object.isFrozen(frame) && Object.isFrozen(frame.scope) && Object.isFrozen(frame.entryIds));
    const entries = repo.readCandidateEntries(scope, frame);
    assert.equal(bodyReads, frame.entryIds.length);
    assert.deepEqual(entries.map(entry => entry.entryId), frame.entryIds);
    assert.equal(hash(store.query(scope, filters)), hash(entries), "legal query result and order remain identical");
  }
  const frame = repo.queryCandidates(scope);
  assert.throws(() => repo.readEntry({ ...scope, ownerId: 2 }, frame.entryIds[0], { candidates: frame }), /candidate.*scope|scope.*mismatch/);
  assert.throws(() => repo.queryCandidates({ campaignToken: "", ownerId: 1 }), /scope_required/);
  assert.throws(() => repo.queryCandidates(scope, { path: "../" }), /invalid_index_axis/);
  assert.throws(() => repo.readEntry(scope, "../../outside"), /invalid_entry_id|index_body_mismatch/);
  assert.deepEqual(repo.queryCandidates({ ...scope, campaignToken: "another-campaign" }).entryIds, []);
  assert.deepEqual(repo.queryCandidates({ ...scope, ownerId: 2 }).entryIds, []);
  const selected = repo.queryCandidates(scope, { byTopic: "topic-0" });
  bodyReads = 0;
  assert.throws(() => repo.readEntry(scope, frame.entryIds[1], { candidates: selected }), /candidate_not_selected/);
  assert.equal(bodyReads, 0, "out-of-set IDs rejected before body I/O");
  const before = JSON.stringify(repo.audit(scope));
  assert.equal(JSON.parse(before).result, "OK");
  for (const secret of [scope.campaignToken, "ownerId", folders, "经历"]) assert(!before.includes(secret));
  const source = store.readEntry(scope, frame.entryIds[0]);
  repo.updateEntry(scope, source.entryId, "手动修改", { expectedRevision: source.revision });
  assert.throws(() => repo.readCandidateEntries(scope, frame), /candidate_stale/);
  assert.throws(() => repo.updateEntry(scope, source.entryId, "覆盖", { expectedRevision: source.revision }), /edit_stale/);
  const filters = { byTopic: "topic-1" }, oldTimes = [], lazyTimes = [];
  let oldReads = 0, lazyReads = 0, oldBytes = 0, lazyBytes = 0;
  for (let sample = 0; sample < 30; sample++) {
    bodyReads = 0; bodyBytes = 0; let start = performance.now();
    const all = store.query(scope, filters);
    oldTimes.push(performance.now() - start); oldReads += bodyReads; oldBytes += bodyBytes;
    bodyReads = 0; bodyBytes = 0; start = performance.now();
    const candidates = repo.queryCandidates(scope, filters);
    const subset = repo.readCandidateEntries(scope, candidates, candidates.entryIds.slice(0, 2));
    lazyTimes.push(performance.now() - start); lazyReads += bodyReads; lazyBytes += bodyBytes;
    assert.deepEqual(subset, all.slice(0, 2));
  }
  assert(lazyReads <= oldReads);
  const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
  const evidence = { fixture: "synthetic-48-entries", samples: 30, candidateCount: 12, resultHash: hash(store.query(scope, filters).slice(0, 2)),
    old: { bodyReads: oldReads, bodyBytes: oldBytes, p50Ms: percentile(oldTimes, 0.5), p95Ms: percentile(oldTimes, 0.95) },
    lazy: { bodyReads: lazyReads, bodyBytes: lazyBytes, p50Ms: percentile(lazyTimes, 0.5), p95Ms: percentile(lazyTimes, 0.95) } };
  if (process.argv.includes("--evidence")) {
    const output = path.resolve(__dirname, "../.build/v9.2-repository-performance.json");
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
  }
  console.log(`V9.2 scoped JSON: PASS (${cases.length} filter/oracle cases, candidate zero-body I/O, bounded reads, CAS, anonymous audit) ${JSON.stringify(evidence)}`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
