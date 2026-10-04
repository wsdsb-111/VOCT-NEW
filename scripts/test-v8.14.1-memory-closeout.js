"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { Memory4RecallPlanner } = require("../resources/app/out/main/memory-system/memory4-recall-planner");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8141-memory-"));
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }
async function checkAsync(name, run) { await run(); checks++; console.log(`PASS ${name}`); }
const participants = [{ id: 1, name: "Player" }, { id: 2, name: "Alice" }, { id: 3, name: "Bob" }];

function fixture(name, count = 2) {
  const summaryFoldersDir = path.join(root, name, "summaries");
  for (const person of participants.slice(0, count)) fs.mkdirSync(path.join(summaryFoldersDir, `${person.id}_old`), { recursive: true });
  const base = new MemoryStore({ baseDir: path.join(root, name, "memory"), summaryFoldersDir });
  const coordinator = new Memory4Coordinator(base);
  return { base, coordinator, planner: new Memory4RecallPlanner(coordinator), scope: { campaignToken: name, ownerId: 2 } };
}

function context(f, name, texts, { date = "1180.1.1", count = 2 } = {}) {
  const messages = texts.map(([speakerCharacterId, content], index) => ({ id: index + 1,
    role: speakerCharacterId === 1 ? "user" : "assistant", speakerCharacterId, content }));
  return { ...f.scope, conversationId: name, finalizationId: `final-${name}`, episodeId: `episode-${name}`, date,
    finalizationVisibilityV1: true, participants: participants.slice(0, count),
    participantPresence: participants.slice(0, count).map(person => ({ characterId: person.id, joinedAtMessageId: 0 })), messages,
    verifiedSummarySegments: messages.map(message => ({ segmentId: `s-${message.id}`, content: message.content,
      visibility: "public", source: "spoken", participants: participants.slice(0, count).map(person => person.id),
      knownBy: participants.slice(0, count).map(person => person.id),
      provenance: { messageIds: [message.id], speakerIds: [message.speakerCharacterId] } })) };
}

function storeText(f, source, text = source.messages[0].content, type = "COMMITMENT") {
  const snapshot = f.coordinator.buildOwnerSnapshot(source, 2);
  const fragment = snapshot.fragments.find(item => item.visibility !== "private");
  const committed = f.coordinator.store.commitOwner(snapshot, { status: "STORE", entries: [{ memoryType: type, text,
    fragmentIds: [fragment.fragmentId], entityIds: [1], participantIds: [1, 2], topics: ["promise"] }] });
  return { snapshot, entryId: committed.entryIds[0] };
}

async function main() {
  try {
    check("production snapshot records a validated two-person exchange", () => {
      const f = fixture("pair");
      const saved = storeText(f, context(f, "pair-chat", [[1, "I promise to return the seal."], [2, "I accept your promise."]]));
      assert.deepEqual(saved.snapshot.counterpartIds, [1]);
      assert.deepEqual(f.coordinator.store.readEntry(f.scope, saved.entryId).counterpartIds, [1]);
      assert.equal(f.coordinator.store.getKnownEntityEvidence(f.scope, 1).directConversationCount, 1);
    });
    check("shared scene and third-party mention do not become counterparts", () => {
      const f = fixture("group", 3);
      const snapshot = f.coordinator.buildOwnerSnapshot(context(f, "group-chat", [[1, "All of us share this room."], [2, "Bob is here."]], { count: 3 }), 2);
      assert.deepEqual(snapshot.counterpartIds, []);
      const directed = f.coordinator.buildOwnerSnapshot(context(f, "direct-chat", [[1, "我对Alice说承诺归还玉印。"], [2, "我答应收好玉印。"]], { count: 3 }), 2);
      assert.deepEqual(directed.counterpartIds, [1]);
      assert.equal(directed.counterpartIds.includes(3), false);
    });
    check("native verified evidence is complete and old contributions remain explainable", () => {
      const f = fixture("complete");
      const saved = storeText(f, context(f, "complete-chat", [[1, "We met today."], [2, "Indeed."]]));
      const known = f.coordinator.store.getKnownEntityEvidence(f.scope, 1, { currentGameDate: "1180.1.1" });
      assert.equal(known.completeness, "complete");
      assert.equal(f.coordinator.getKnownEntityProfile(f.scope, 1, { currentGameDate: "1180.1.1" }).recognition.evidenceCompleteness, "complete");
      const directory = f.coordinator.store.directory(f.scope);
      const file = path.join(directory, "known-entities.json"), rows = JSON.parse(fs.readFileSync(file, "utf8"));
      delete rows.entities[1].evidenceByConversation[saved.snapshot.conversationId].completeness;
      f.base.writeJson(file, rows);
      assert.equal(f.coordinator.store.getKnownEntityEvidence(f.scope, 1, { currentGameDate: "1180.1.1" }).completeness, "legacy_partial");
    });
    check("empty and missing legacy evidence stay partial without erasing recorded recognition counts", () => {
      for (const state of ["empty", "missing"]) {
        const f = fixture(`empty-known-${state}`);
        storeText(f, context(f, `empty-known-${state}-chat`, [[1, "I promise to return the seal."], [2, "I accept your promise."]]));
        const directory = f.coordinator.store.directory(f.scope), file = path.join(directory, "known-entities.json");
        const known = f.coordinator.store.read(file), row = known.entities["1"];
        assert.equal(row.directConversationCount, 1);
        if (state === "empty") row.evidenceByConversation = {};
        else delete row.evidenceByConversation;
        f.base.writeJson(file, known);
        const evidence = f.coordinator.store.getKnownEntityEvidence(f.scope, 1);
        assert.equal(evidence.status, "DIRECT_INTERACTION");
        assert.equal(evidence.directConversationCount, 1);
        assert.equal(evidence.completeness, "legacy_partial");
      }
    });
    check("name changes leave the owner sidecar address stable", () => {
      const f = fixture("folders");
      const saved = storeText(f, context(f, "folder-chat", [[1, "A lasting promise."], [2, "Understood."]]));
      const before = f.coordinator.store.directory(f.scope);
      fs.mkdirSync(path.join(f.base.summaryFoldersDir, "2_new"));
      assert.equal(f.coordinator.store.directory(f.scope), before);
      assert.equal(f.coordinator.store.readEntry(f.scope, saved.entryId).ownerId, 2);
      assert.equal(before.includes(`${path.sep}2_old${path.sep}`), false);
    });
    check("one existing legacy sidecar stays readable among renamed folders", () => {
      const f = fixture("legacy-folder");
      const saved = storeText(f, context(f, "legacy-folder-chat", [[1, "A promise."], [2, "I heard it."]]));
      const current = f.coordinator.store.directory(f.scope);
      const legacy = path.join(f.base.summaryFoldersDir, "2_old", "memory4", hash(f.scope.campaignToken));
      fs.mkdirSync(path.dirname(legacy), { recursive: true });
      fs.renameSync(current, legacy);
      fs.mkdirSync(path.join(f.base.summaryFoldersDir, "2_new"));
      assert.equal(f.coordinator.store.readEntry(f.scope, saved.entryId).ownerId, 2);
      assert.equal(f.coordinator.store.directory(f.scope), legacy);
    });
    const newPromise = (f, name, text = "我承诺归还玉印。") => storeText(f,
      context(f, `${name}-start`, [[1, text], [2, "我记住了这个承诺。"]]));
    const transition = async (f, saved, name, quote, status, extras = {}) => {
      const snapshot = f.coordinator.buildOwnerSnapshot(context(f, name, [[1, quote], [2, "我听见了。"]], { date: "1181.1.1" }), 2);
      return f.coordinator.finishOwner(snapshot, async prompt => {
        const body = JSON.parse(prompt[1].content);
        assert(body.activeCommitments.some(entry => entry.entryId === saved.entryId && entry.expectedRevision === 1));
        const fragment = body.fragments.find(item => item.text === quote);
        return JSON.stringify({ status: extras.entries?.length ? "STORE" : "NO_DURABLE_CONTENT", entries: extras.entries || [],
          commitmentTransitions: [{ entryId: saved.entryId, expectedRevision: 1, status, fragmentIds: [fragment.fragmentId],
            commitmentQuote: "归还玉印", evidenceQuote: quote, ...extras.transition }] });
      });
    };
    await checkAsync("a shared object cannot bind fulfillment to a different promised action", async () => {
      const cases = [
        ["noun-only", "玉印", "我已经归还玉印，履行了我归还玉印的承诺。"],
        ["other-action-completed", "把玉印封入国库", "我已经归还玉印；旧约是把玉印封入国库。"],
        ["contradicted-completion", "把玉印封入国库", "我已经把玉印封入国库，但其实从未封入国库。"],
        ["contradicted-not-ever", "把玉印封入国库", "我已经把玉印封入国库，但其实不曾封入国库。"],
        ["contradicted-false", "把玉印封入国库", "我已经把玉印封入国库，但这并非事实。"],
        ["contradicted-untrue", "把玉印封入国库", "我已经把玉印封入国库，但这不是真的。"],
        ["original-obligation-only", "把玉印封入国库", "我承诺把玉印封入国库。"]
      ];
      for (const [name, binding, quote] of cases) {
        const f = fixture(`commitment-core-${name}`), saved = newPromise(f, `commitment-core-${name}`, "我承诺把玉印封入国库。");
        const result = await transition(f, saved, `commitment-core-${name}-end`, quote, "fulfilled", { transition: { commitmentQuote: binding } });
        assert.equal(result.status, "EXTRACTION_FAILED", name);
        assert.equal(f.coordinator.store.readEntry(f.scope, saved.entryId).state.status, "active", name);
      }
    });
    await checkAsync("production fulfillment persists evidence, game time and revisions without CK3 confirmation", async () => {
      const f = fixture("fulfilled"), saved = newPromise(f, "fulfilled");
      const result = await transition(f, saved, "fulfilled-end", "我已经归还玉印，履行了归还玉印的承诺。", "fulfilled");
      assert.equal(result.commitmentTransitionCount, 1);
      const entry = f.coordinator.store.readEntry(f.scope, saved.entryId);
      assert.equal(entry.state.status, "fulfilled"); assert.equal(entry.revision, 2); assert.equal(entry.state.revision, 2);
      assert.equal(entry.state.changedGameDate, "1181.1.1"); assert(entry.state.changedAt);
      assert.deepEqual(entry.state.sourceMessageIds, [1]); assert.equal(entry.state.source.sourceType, "reported");
      assert.equal(entry.state.source.finalizationId, "final-fulfilled-end");
      const options = { ...f.scope, currentGameDate: "1182.1.1", entityIds: [1], querySpeakerId: 1,
        memoryEngineRemainingBudget: 1200, providerRemainingSafeBudget: 1200, legacyMemories: [] };
      assert.equal(f.planner.plan({ ...options, query: "还有哪些未完成的承诺？" }).items.length, 0);
      assert(f.planner.plan({ ...options, query: "你以前答应过什么？" }).text.includes("fulfilled"));
      assert.equal(f.planner.plan({ ...options, currentGameDate: "1180.1.1", query: "你以前答应过什么？" }).items.length, 0);
      const metadata = f.coordinator.store.read(path.join(f.coordinator.store.directory(f.scope), "metadata.json"));
      assert.equal(metadata.derivedDirty, true);
    });
    await checkAsync("explicit cancellation closes only the original active promise", async () => {
      const f = fixture("cancelled"), saved = newPromise(f, "cancelled");
      const result = await transition(f, saved, "cancelled-end", "我已经取消归还玉印的原约。", "cancelled");
      assert.equal(result.commitmentTransitionCount, 1);
      assert.equal(f.coordinator.store.readEntry(f.scope, saved.entryId).state.status, "cancelled");
    });
    await checkAsync("silence, negation, questions, plans, hearsay and ambiguous bindings keep the promise active", async () => {
      const cases = ["我还没有归还玉印。", "我明天将会归还玉印。", "我已经归还玉印了吗？", "听说我已经归还玉印。", "如果我已经归还玉印，你会高兴。",
        "我已经许下归还玉印的承诺。", "我已经取消归还玉印的原约。", "我未归还玉印，但我已经履行了承诺。"];
      for (const [index, quote] of cases.entries()) {
        const f = fixture(`uncertain-${index}`), saved = newPromise(f, `uncertain-${index}`);
        const result = await transition(f, saved, `uncertain-${index}-end`, quote, "fulfilled");
        assert.equal(result.status, "EXTRACTION_FAILED");
        assert.equal(f.coordinator.store.readEntry(f.scope, saved.entryId).state.status, "active");
      }
      const f = fixture("silence"), saved = newPromise(f, "silence");
      const snapshot = f.coordinator.buildOwnerSnapshot(context(f, "silence-later", [[1, "又过了许多年。"], [2, "今日天气很好。"]], { date: "1220.1.1" }), 2);
      await f.coordinator.finishOwner(snapshot, async () => JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }));
      assert.equal(f.coordinator.store.readEntry(f.scope, saved.entryId).state.status, "active");
      const packet = f.planner.plan({ ...f.scope, currentGameDate: "1220.1.1", query: "还有哪些未完成的承诺？", entityIds: [1], querySpeakerId: 1,
        memoryEngineRemainingBudget: 1200, providerRemainingSafeBudget: 1200, legacyMemories: [] });
      assert.deepEqual(packet.details.map(item => item.memory.memoryId), [saved.entryId]);
    });
    await checkAsync("conditional fulfillment needs explicit satisfaction of the original condition", async () => {
      const f = fixture("conditional"), saved = newPromise(f, "conditional", "我承诺归还玉印，但须先释放俘虏。");
      const unproven = await transition(f, saved, "conditional-missing", "我已经归还玉印，履行了归还玉印的承诺。", "fulfilled");
      assert.equal(unproven.status, "EXTRACTION_FAILED");
      assert.equal(f.coordinator.store.readEntry(f.scope, saved.entryId).state.status, "active");
      const proven = await transition(f, saved, "conditional-end", "我已经释放俘虏，已经归还玉印，履行了归还玉印的承诺。", "fulfilled");
      assert.equal(proven.commitmentTransitionCount, 1);
      assert.equal(f.coordinator.store.readEntry(f.scope, saved.entryId).state.status, "fulfilled");
    });
    await checkAsync("replacement binds a new source-backed commitment and preserves the original history", async () => {
      const f = fixture("superseded"), saved = newPromise(f, "superseded");
      const replacementText = "我承诺三日后归还玉印";
      const quote = `我已经废止归还玉印的原约，现改为${replacementText}。`;
      const snapshot = f.coordinator.buildOwnerSnapshot(context(f, "superseded-end", [[1, quote], [2, "我记住了新约。"]], { date: "1181.1.1" }), 2);
      const result = await f.coordinator.finishOwner(snapshot, async prompt => {
        const fragment = JSON.parse(prompt[1].content).fragments.find(item => item.text === quote);
        return JSON.stringify({ status: "STORE", entries: [{ memoryType: "COMMITMENT", text: replacementText, fragmentIds: [fragment.fragmentId],
          entityIds: [1], participantIds: [1, 2], topics: ["promise"] }], commitmentTransitions: [{ entryId: saved.entryId,
          expectedRevision: 1, status: "superseded", commitmentQuote: "归还玉印", evidenceQuote: quote,
          fragmentIds: [fragment.fragmentId], replacementEntryIndex: 0 }] });
      });
      assert.equal(result.commitmentTransitionCount, 1);
      const old = f.coordinator.store.readEntry(f.scope, saved.entryId), replacement = f.coordinator.store.readEntry(f.scope, result.entryIds[0]);
      assert.equal(old.state.status, "superseded"); assert.equal(old.state.supersededByEntryId, replacement.entryId);
      assert.equal(replacement.state.status, "active"); assert.deepEqual(replacement.state.supersedesEntryIds, [old.entryId]);
      assert.deepEqual(old.state.evidenceEntryIds, [replacement.entryId]); assert.equal(old.text, "我承诺归还玉印。");
    });
    await checkAsync("duplicate commitments and unrelated bindings cannot choose a target by guess", async () => {
      const f = fixture("duplicate-binding"), saved = newPromise(f, "duplicate-one");
      newPromise(f, "duplicate-two", "我也承诺归还玉印。");
      const result = await transition(f, saved, "duplicate-end", "我已经归还玉印，履行了归还玉印的承诺。", "fulfilled");
      assert.equal(result.status, "EXTRACTION_FAILED");
      assert.equal(f.coordinator.store.readEntry(f.scope, saved.entryId).state.status, "active");
    });
    await checkAsync("another speaker cannot fulfill the original promisor's promise", async () => {
      const f = fixture("wrong-promisor"), saved = newPromise(f, "wrong-promisor");
      const quote = "我已经归还玉印，履行了归还玉印的承诺。";
      const snapshot = f.coordinator.buildOwnerSnapshot(context(f, "wrong-promisor-end", [[2, quote]], { date: "1181.1.1" }), 2);
      const result = await f.coordinator.finishOwner(snapshot, async prompt => {
        const fragment = JSON.parse(prompt[1].content).fragments.find(item => item.text === quote);
        return JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [], commitmentTransitions: [{ entryId: saved.entryId,
          expectedRevision: 1, status: "fulfilled", commitmentQuote: "归还玉印", evidenceQuote: quote, fragmentIds: [fragment.fragmentId] }] });
      });
      assert.equal(result.status, "EXTRACTION_FAILED");
      assert.equal(f.coordinator.store.readEntry(f.scope, saved.entryId).state.status, "active");
    });
    await checkAsync("changed transition evidence invalidates recall and previously retained source references", async () => {
      const f = fixture("state-source"), saved = newPromise(f, "state-source");
      await transition(f, saved, "state-source-end", "我已经归还玉印，履行了归还玉印的承诺。", "fulfilled");
      const options = { ...f.scope, currentGameDate: "1182.1.1", query: "你以前答应过什么？", entityIds: [1], querySpeakerId: 1,
        memoryEngineRemainingBudget: 1200, providerRemainingSafeBudget: 1200, legacyMemories: [] };
      const retained = f.planner.plan(options);
      assert(retained.text.includes("fulfilled")); assert(f.planner.validateHistory(f.scope, retained.sourceRefs, options));
      const revised = f.coordinator.buildOwnerSnapshot(context(f, "state-source-end", [[1, "我尚未履行归还玉印的承诺。"]], { date: "1181.1.1" }), 2);
      f.coordinator.store.recordKnownEvidence(revised);
      assert.equal(f.planner.validateHistory(f.scope, retained.sourceRefs, options), false);
      assert.equal(f.planner.plan(options).items.length, 0);
      const index = f.coordinator.store.loadIndex(f.scope);
      const metadata = f.coordinator.store.read(path.join(f.coordinator.store.directory(f.scope), "metadata.json"));
      assert.equal(f.coordinator.derived.sourceValid(f.scope, index.entries[saved.entryId], index, metadata), false);
    });
    await checkAsync("a failed transition transaction rolls back the canonical status and body", async () => {
      const f = fixture("transition-rollback"), saved = newPromise(f, "transition-rollback");
      const original = f.coordinator.store.readEntry(f.scope, saved.entryId);
      const write = f.base.writeJson.bind(f.base);
      f.base.writeJson = (file, value) => {
        if (path.basename(file) === "index.json" && Object.values(value.entries || {}).some(row => row.status === "fulfilled")) throw new Error("fixture-index-write-failure");
        return write(file, value);
      };
      const result = await transition(f, saved, "rollback-end", "我已经归还玉印，履行了归还玉印的承诺。", "fulfilled");
      f.base.writeJson = write;
      assert.equal(result.status, "EXTRACTION_FAILED");
      assert.deepEqual(f.coordinator.store.readEntry(f.scope, saved.entryId), original);
      assert.equal(Object.values(f.coordinator.store.loadIndex(f.scope).entries).some(row => row.status === "fulfilled"), false);
    });
    check("only visible literal third-party mentions create entity evidence", () => {
      const f = fixture("third-party");
      const c = context(f, "third-party-public", [[1, "I heard that Carol crossed the river."], [2, "I will remember Carol."]]);
      c.mentionedEntities = [{ id: 99, name: "Carol" }, { id: 98, name: "Waiting" }];
      const snapshot = f.coordinator.buildOwnerSnapshot(c, 2);
      assert(snapshot.fragments.some(fragment => fragment.entityIds.includes(99)));
      assert.equal(snapshot.fragments.some(fragment => fragment.entityIds.includes(98)), false);
      assert.deepEqual(snapshot.counterpartIds, [1]);
      f.coordinator.store.commitOwner(snapshot, { status: "NO_DURABLE_CONTENT", entries: [] });
      const known = f.coordinator.store.getKnownEntityEvidence(f.scope, 99);
      assert.equal(known.status, "MENTION_ONLY"); assert.equal(known.directConversationCount, 0);
    });
    check("conflicting legacy sidecars fail closed instead of picking a renamed folder", () => {
      const f = fixture("duplicate-sidecar");
      storeText(f, context(f, "duplicate-sidecar-chat", [[1, "A lasting promise."], [2, "Understood."]]));
      fs.mkdirSync(path.join(f.base.summaryFoldersDir, "2_new", "memory4", hash(f.scope.campaignToken)), { recursive: true });
      assert.throws(() => f.coordinator.store.loadIndex(f.scope), /memory4_owner_sidecar_not_unique/);
    });
    console.log(`V8.14.1 memory closeout: ${checks} checks passed`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
