"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require.cache[require.resolve("../src/app/main/version")] = { exports: require("../resources/app/out/main/version") };
const { MemoryStore } = require("../src/app/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../src/app/main/memory-system/memory4-coordinator");
const { hash } = require("../src/app/main/memory-system/memory4-contract");
const { estimateTokens } = require("../src/app/main/token-estimator");

const root = fs.mkdtempSync(path.join(__dirname, ".votc-v932-durable-"));
const fragment = (i, text = `第${i}项议和计划已提出。`) => ({ fragmentId: `fragment-${i}`, messageId: i,
  sourceMessageIds: [i], text, speakerId: 1, presentIds: [1, 2, 3], knownBy: [1, 2],
  entityIds: [2], recipientIds: [2], visibility: "participants", sourceType: "spoken", visibilityEvidence: "application_fragment" });
const candidate = f => ({ memoryType: "DURABLE_KNOWLEDGE", text: `角色甲提出${f.text}`, fragmentIds: [f.fragmentId],
  entityIds: [1, 2], participantIds: [1, 2], eventTime: { from: null, to: null, precision: "unknown", status: "reported" } });
const response = entries => ({ content: JSON.stringify({ status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries, commitmentTransitions: [] }), finish_reason: "stop" });
const payload = messages => JSON.parse(messages.findLast(m => m.role === "user").content);
function fixture(label, fragments) {
  const directory = path.join(root, label);
  const folders = path.join(directory, "summaries");
  for (const owner of [1, 2, 3]) fs.mkdirSync(path.join(folders, `${owner}_fixture`), { recursive: true });
  const base = new MemoryStore({ baseDir: path.join(directory, "memory"), summaryFoldersDir: folders });
  const coordinator = new Memory4Coordinator(base);
  coordinator.derived.schedule = async () => ({ status: "SKIPPED_DERIVED_POLICY" });
  const snapshot = { campaignToken: `campaign-${label}`, ownerId: 2, conversationId: `conversation-${label}`,
    finalizationId: `final-${label}`, episodeId: null, date: "1181.1.1", sourceRevision: hash(fragments),
    presentMessageCount: fragments.length, completeness: "complete", counterpartIds: [1], summaryIds: [],
    fragments, entityNameEvidence: [], relationshipEvidence: [], projectionLineages: [], skipKnownEvidence: true };
  return { coordinator, snapshot, base };
}
const cases = [];
const check = (name, fn) => cases.push([name, fn]);

check("prompt enumerates temporal status and distinguishes audience from authorized entities", () => {
  const { coordinator, snapshot } = fixture("enums", [fragment(1)]);
  const prompt = coordinator.buildPrompt(snapshot, snapshot.fragments);
  for (const word of ["observed", "reported", "planned", "unknown"]) assert(prompt[0].content.includes(word));
  assert(prompt[0].content.includes("participantIds are presence evidence only and never authorize entityIds"));
  assert(prompt[0].content.includes("v9.3.2"));
});

check("wire DTO removes repeated local proof metadata without authorizing unseen names", () => {
  const { coordinator, snapshot } = fixture("compact", Array.from({ length: 60 }, (_, i) => fragment(i)));
  for (const f of snapshot.fragments) {
    snapshot.entityNameEvidence.push({ fragmentId: f.fragmentId, entityId: 1, name: "角色甲", evidence: [{ source: "SOURCE_EXPLICIT_NAME", sourceMessageIds: [f.messageId] }] });
    snapshot.entityNameEvidence.push({ fragmentId: f.fragmentId, entityId: 99, name: "未授权人物", evidence: [] });
    snapshot.relationshipEvidence.push({ fragmentId: f.fragmentId, ownerId: 2, entityId: 1, types: ["friend"],
      status: "CONFIRMED", knownToOwner: true, campaignToken: snapshot.campaignToken, source: "CURRENT_RUNTIME_RELATION", asOf: "1181.1.1" });
  }
  const prompt = coordinator.buildPrompt(snapshot, snapshot.fragments);
  const wire = prompt[1].content;
  assert(!wire.includes("未授权人物"));
  assert(!wire.includes("SOURCE_EXPLICIT_NAME"));
  assert(!wire.includes("CURRENT_RUNTIME_RELATION"));
  assert.equal((wire.match(/角色甲/g) || []).length, 1);
  assert(!wire.includes('"ownerId":2', wire.indexOf('"fragments"')));
  assert(wire.indexOf('"fragments"') < wire.indexOf('"activeCommitments"'));
});

check("bounded schema repair accepts legal facts while refusing invented entities", async () => {
  const f = fragment(1);
  const { coordinator, snapshot } = fixture("repair", [f]);
  let sends = 0;
  const result = await coordinator.finishOwner(snapshot, async (_messages, metadata) => {
    metadata.beforeSendGuard();
    sends++;
    return response([{ ...candidate(f), eventTime: { status: sends === 1 ? "past" : "reported" } }]);
  });
  assert.equal(sends, 2);
  assert.equal(result.status, "STORE");
  assert.equal(result.entryIds.length, 1);
  const bad = fixture("unknown", [f]);
  let refusedSends = 0;
  const refused = await bad.coordinator.finishOwner(bad.snapshot, async (_messages, metadata) => {
    metadata.beforeSendGuard(); refusedSends++;
    return response([{ ...candidate(f), entityIds: [99] }]);
  });
  assert.equal(refusedSends, 2);
  assert.equal(refused.status, "EXTRACTION_FAILED");
  assert.equal(Object.keys(bad.coordinator.store.loadIndex(bad.snapshot).entries).length, 0);
});

check("event-date repair distinguishes conversation context from dated source evidence", async () => {
  const f = fragment(1, "甲说明多年前曾为边境百姓筹粮，具体日期未明。");
  const { coordinator, snapshot } = fixture("date-repair", [f]);
  let sends = 0;
  const result = await coordinator.finishOwner(snapshot, async (messages, metadata) => {
    metadata.beforeSendGuard();
    sends++;
    const value = payload(messages);
    if (sends === 1) return response([{ ...candidate(f), eventTime: {
      from: value.conversationDate, to: value.conversationDate, precision: "day", status: "reported" } }]);
    assert(value.repair.validationCodes.includes("memory4_unsupported_event_date"));
    assert(value.repair.eventTimeHint.includes("conversationDate and acquiredDate are not event-date evidence"));
    assert(value.repair.eventTimeHint.includes("from:null, to:null, precision:unknown"));
    assert.equal(value.fragments[0].text, f.text);
    return response([candidate(f)]);
  });
  assert.equal(sends, 2);
  assert.equal(result.status, "STORE");
  const stored = coordinator.store.query(snapshot);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].eventTime.from, null);
  assert.equal(stored[0].eventTime.to, null);
});

check("large source is split by input budget and recovery does not resend accepted leaves", async () => {
  const fragments = [fragment(1, "议和证据。".repeat(1000)), fragment(2, "承诺证据。".repeat(1000)), fragment(3)];
  const { coordinator, snapshot, base } = fixture("resume", fragments);
  const firstSent = [];
  const first = await coordinator.finishOwner(snapshot, async (messages, metadata) => {
    metadata.beforeSendGuard();
    const value = payload(messages);
    assert(estimateTokens(JSON.stringify(messages)) <= 8192);
    firstSent.push(value.fragments.map(f => f.fragmentId));
    if (firstSent.length === 2) throw new Error("provider_error");
    return response([candidate(fragments.find(f => f.fragmentId === value.fragments[0].fragmentId))]);
  });
  assert.equal(first.status, "EXTRACTION_FAILED");
  assert(firstSent.length >= 2);
  const recovered = new Memory4Coordinator(base);
  recovered.derived.schedule = async () => ({ status: "SKIPPED_DERIVED_POLICY" });
  const resumedSent = [];
  const prior = recovered.readRecovery(recovered.recoveryPath(snapshot));
  const final = await recovered.finishOwner(prior.snapshot, async (messages, metadata) => {
    metadata.beforeSendGuard();
    const value = payload(messages);
    resumedSent.push(...value.fragments.map(f => f.fragmentId));
    return response([candidate(fragments.find(f => f.fragmentId === value.fragments[0].fragmentId))]);
  }, prior);
  assert.equal(final.status, "STORE");
  for (const id of firstSent[0]) assert(!resumedSent.includes(id), `accepted leaf ${id} was resent`);
  assert(final.entryIds.length >= 2);
});

(async () => {
  let failed = 0;
  try {
    for (const [name, fn] of cases) {
      try { await fn(); console.log(`PASS ${name}`); }
      catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(`V9.3.2 Durable pipeline: ${cases.length - failed}/${cases.length} PASS`);
  if (failed) process.exitCode = 1;
})();
