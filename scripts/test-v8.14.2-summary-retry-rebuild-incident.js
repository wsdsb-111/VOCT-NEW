"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");

function validSummary(context) {
  return JSON.stringify({
    summarySegments: context.messages.filter(message => ["user", "assistant"].includes(message.role)).map(message => ({
      content: message.content,
      participants: [message.speakerCharacterId],
      visibility: "participants",
      source: "spoken",
      messageIds: [message.id],
      speakerIds: [message.speakerCharacterId]
    })),
    memories: []
  });
}

function durableOutput(prompt) {
  const payload = JSON.parse(prompt[1].content);
  return JSON.stringify({ status: "STORE", entries: payload.fragments.map(fragment => ({
    memoryType: "MAJOR_EXPERIENCE",
    text: fragment.text,
    fragmentIds: [fragment.fragmentId],
    entityIds: fragment.allowedEntityIds,
    participantIds: [],
    topics: ["粮食"],
    eventTime: { status: "unknown" }
  })) });
}

function validatedLetterDatesReachDurablePrompt(root) {
  const engine = new MemoryEngine({ baseDir: path.join(root, "letter-prompt", "memory") });
  const snapshot = { ownerId: 2, campaignToken: "letter-date-campaign", date: "1038.4.4", completeness: "partial" };
  const prompt = engine.memory4.buildPrompt(snapshot, [
    { fragmentId: "letter_original", text: "原信内容。", speakerId: 1, sourceType: "reported", entityIds: [1, 2],
      presentIds: [], knownBy: [1, 2], eventDate: "1038.4.1", acquiredDate: "1038.4.4", visibilityEvidence: "validated_letter" },
    { fragmentId: "letter_reply", text: "回信内容。", speakerId: 2, sourceType: "reported", entityIds: [1, 2],
      presentIds: [], knownBy: [1, 2], eventDate: "not-a-date", acquiredDate: "1038.4.4", visibilityEvidence: "validated_letter" }
  ]);
  const fragments = JSON.parse(prompt[1].content).fragments;
  assert.equal(fragments[0].eventDate, "1038.4.1");
  assert.equal(fragments[0].acquiredDate, "1038.4.4");
  assert.equal(Object.hasOwn(fragments[1], "eventDate"), false, "invalid source dates must not reach durable extraction");
  assert.equal(fragments[1].acquiredDate, "1038.4.4");
}

async function retryBadNarrativeOutput(root) {
  const summariesDir = path.join(root, "retry", "summaries");
  const engine = new MemoryEngine({ baseDir: path.join(root, "retry", "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
  const participants = [{ id: 1, name: "甲" }, { id: 2, name: "乙" }];
  const context = engine.prepareFinalizationContext({
    conversationId: "retry-bad-parse",
    finalizationId: "retry-bad-parse-finalization",
    campaignToken: "retry-campaign",
    date: "1164.1.1",
    participants,
    participantPresence: participants.map(person => ({ characterId: person.id, joinedAtMessageId: 1, leftAtMessageId: null })),
    messages: [
      { id: 1, role: "user", speakerCharacterId: 1, content: "我向乙承诺，明日送来粮食。" },
      { id: 2, role: "assistant", speakerCharacterId: 2, content: "我应允明日收下粮食。" }
    ],
    finalizationVisibilityV1: true
  });
  const recoveryPath = engine.writeRecoverySnapshot(context, {
    finalizationStage: "parse",
    finalizationStatus: "failed_retryable",
    providerOutput: "{ partial provider response"
  }, new Error("invalid_final_summary_response"));
  let modelCalls = 0;
  const manager = createSummariesManager({
    fs,
    path,
    summariesDir,
    memoryEngine: engine,
    memorySystem: {},
    requestSummary: async prompt => {
      modelCalls++;
      const requestContext = engine.store.readJson(recoveryPath);
      return { content: validSummary({ ...requestContext, messages: requestContext.rawMessages }), finish_reason: "stop" };
    },
    persistRecoveredSummary: async () => ({ success: true }),
    buildSummaryPrompt: () => [],
    getSummaryCapabilities: () => ({ contextWindow: 8192, maxOutputTokens: 2048 })
  });
  manager.refreshCurrentConversation = () => {};
  const result = await manager.retryFailedSummaries();
  assert.equal(modelCalls, 1, "a parse-stage partial response must be discarded and requested again");
  assert.equal(result.recovered, 1);
  assert.equal(engine.isCommitted(context)?.finalizationId, context.finalizationId);
}

async function retryDetachedMemory4AndLetters(root) {
  const summariesDir = path.join(root, "detached", "summaries");
  fs.mkdirSync(path.join(summariesDir, "1_甲"), { recursive: true });
  fs.mkdirSync(path.join(summariesDir, "2_乙"), { recursive: true });
  const traceRows = [];
  const engine = new MemoryEngine({ baseDir: path.join(root, "detached", "memory"), summaryFoldersDir: summariesDir,
    trace: { record: (...args) => traceRows.push(args) } });
  const participants = [{ id: 1, name: "甲" }, { id: 2, name: "乙" }];
  const context = {
    conversationId: "detached-durable-retry",
    finalizationId: "detached-durable-retry-finalization",
    campaignToken: "detached-campaign",
    date: "1164.1.1",
    totalDays: 420000,
    participants,
    participantPresence: participants.map(person => ({ characterId: person.id, joinedAtMessageId: 1, leftAtMessageId: null })),
    finalizationVisibilityV1: true,
    messages: [
      { id: 1, role: "user", speakerCharacterId: 1, content: "我向乙承诺，明日送来粮食。" },
      { id: 2, role: "assistant", speakerCharacterId: 2, content: "我应允明日收下粮食。" }
    ],
    buildPrompt: () => [],
    persistCharacterFolders: async () => ({ success: true }),
    requestSummary: async () => ({ content: validSummary({ ...context, messages: context.messages }), finish_reason: "stop" })
  };
  engine.memory4.configureDerived({
    isCampaignCurrent: token => token === "detached-campaign",
    requestExtraction: async () => { throw new Error("fixture_initial_extraction_failure"); }
  });
  const finalized = await engine.finalizeConversation({
    ...context,
    requestDurable: async () => { throw new Error("fixture_initial_extraction_failure"); }
  });
  assert.equal(finalized.success, true);
  assert.equal(finalized.durable.status, "PARTIAL_FAILURE");
  const endedReadContext = { id: context.conversationId, isActive: false, gameData: {
    campaignToken: context.campaignToken, date: context.date,
    characters: new Map(participants.map(person => [person.id, person]))
  } };
  const durableSnapshots = fs.readdirSync(engine.memory4.recoveryDir).map(name => engine.memory4.readRecovery(path.join(engine.memory4.recoveryDir, name)).snapshot);
  assert(durableSnapshots.every(snapshot => engine.isMemory4NarrativeCommitted(snapshot)),
    `fixture durable snapshots must have committed source narratives: ${JSON.stringify(durableSnapshots.map(snapshot => ({ownerId:snapshot.ownerId,conversationId:snapshot.conversationId,finalizationId:snapshot.finalizationId,campaignToken:snapshot.campaignToken,episode:engine.isCommitted(snapshot)})))}`);
  let letterPending = 1;
  const letterCalls = [];
  engine.letterMemoryFinalization = {
    getRecoveryStatus: token => {
      assert.equal(token, context.campaignToken);
      return { pending: letterPending, manual: letterPending, balanceBlocked: 0 };
    },
    retryPending: async options => {
      letterCalls.push(options);
      letterPending = 0;
      return [{ letterId: "failed-letter", status: "EXTRACTION_FAILED", error: "fixture_letter_failure" }];
    }
  };
  engine.memory4.configureDerived({
    isCampaignCurrent: token => token === "detached-campaign",
    requestExtraction: async prompt => ({ content: durableOutput(prompt), finish_reason: "stop" })
  });
  const durableRetryCalls = [];
  const manager = createSummariesManager({
    fs,
    path,
    summariesDir,
    memoryEngine: engine,
    memorySystem: {},
    getCurrentConversation: () => null,
    getMemory4ReadConversation: () => endedReadContext,
    requestSummary: async () => { throw new Error("no narrative retry expected"); },
    requestDurable: async (prompt, options) => { durableRetryCalls.push(options); return { content: durableOutput(prompt), finish_reason: "stop" }; },
    persistRecoveredSummary: async () => ({ success: true }),
    buildSummaryPrompt: () => [],
    getSummaryCapabilities: () => ({ contextWindow: 8192, maxOutputTokens: 2048 })
  });
  manager.refreshCurrentConversation = () => {};
  assert.equal(manager.getRecoveryStatus().durablePending, 2, "trusted detached campaign must expose its own durable retry queue");
  const result = await manager.retryFailedSummaries();
  assert.equal(result.recovered, 2, `manual retry should recover both committed owner extractions: ${JSON.stringify({ result, durableRetryCalls, durableTrace: traceRows.filter(([name]) => name === "memory4_durable") })}`);
  assert.equal(result.failed, 1, "letter extraction errors must not disappear from the unified retry result");
  assert.equal(letterCalls.length, 1);
  assert.deepEqual(letterCalls[0], { activeCampaignToken: context.campaignToken, manual: true });
  assert.equal(engine.memory4.getRecoveryStatus(context.campaignToken).pending, 0);
}

async function retryPersistedLegacyExtractionAndDerivedFailures(root) {
  const summariesDir = path.join(root, "legacy-recovery", "summaries");
  const ownerDir = path.join(summariesDir, "2_乙");
  fs.mkdirSync(ownerDir, { recursive: true });
  const filePath = path.join(ownerDir, "与丙的对话.json");
  const campaignToken = "legacy-recovery-campaign";
  const initialContent = "1164年，乙在宴席上见到丙。";
  const longContent = Array(240).fill("1164年乙在宫廷宴席中见到丙。").join("");
  fs.writeFileSync(filePath, JSON.stringify([{
    playerId: 2, playerName: "乙", characterId: 3, characterName: "丙", date: "1165.1.1", totalDays: 430000,
    campaignToken, campaignBinding: { status: "bound", source: "native" }, content: initialContent
  }]), "utf8");
  const engine = new MemoryEngine({ baseDir: path.join(root, "legacy-recovery", "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
  const conversation = { id: "legacy-recovery-conversation", isActive: true, gameData: {
    campaignToken, date: "1165.1.1", characters: new Map([[2, { id: 2, shortName: "乙" }], [3, { id: 3, shortName: "丙" }]])
  }, memoryState: engine.createConversationState("legacy-recovery-conversation"), dynamicRecallHistory: new Map() };
  let requestExtractionCalls = 0, durableRetryCalls = 0, compressionCalls = 0, failCompressionCount = 1;
  engine.memory4.configureDerived({
    isCampaignCurrent: token => token === campaignToken,
    estimateTokens: text => Math.ceil(text.length / 2),
    requestExtraction: async () => { requestExtractionCalls++; throw new Error("fixture_extraction_failure"); },
    requestCompression: async prompt => {
      compressionCalls++;
      if (failCompressionCount > 0) {
        failCompressionCount--;
        throw new Error("fixture_derived_failure");
      }
      const payload = JSON.parse(prompt[1].content);
      const sourceEntryIds = [...new Set(payload.items.flatMap(item => item.sourceEntryIds))];
      return { content: JSON.stringify({ items: [{ text: "乙在宫廷宴席中见到丙。", sourceEntryIds }] }), finish_reason: "stop" };
    }
  });
  const manager = createSummariesManager({
    fs, path, summariesDir, memoryEngine: engine, memorySystem: {},
    getCurrentConversation: () => conversation,
    getMemory4ReadConversation: () => conversation,
    requestSummary: async () => ({ content: longContent, finish_reason: "stop" }),
    requestDurable: async prompt => {
      durableRetryCalls++;
      const fragment = JSON.parse(prompt[1].content).fragments[0];
      return { content: JSON.stringify({ status: "STORE", entries: [{
        memoryType: "MAJOR_EXPERIENCE", text: fragment.text, fragmentIds: [fragment.fragmentId],
        entityIds: fragment.allowedEntityIds, participantIds: [], topics: ["宴席"],
        eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" }
      }] }), finish_reason: "stop" };
    },
    getSummaryOutputLimit: () => 4096
  });
  const rewritten = await manager.regenerateSummary(2, 3, 0, initialContent);
  assert.equal(rewritten.success, false);
  assert.equal(rewritten.summaryUpdated, true);
  assert.equal(rewritten.memoryRebuild.canonical.status, "EXTRACTION_FAILED");
  assert.equal(engine.memory4.getRecoveryStatus(campaignToken).pending, 1, "failed legacy extraction must persist in the ordinary Memory4 recovery queue");
  assert.equal(requestExtractionCalls, 1);

  const canonicalRetry = await manager.retryFailedSummaries();
  assert.equal(canonicalRetry.failed, 1, "a canonical success with failed derived rebuild must remain a visible failure");
  assert.equal(durableRetryCalls, 1, "retry must recover the saved legacy snapshot without re-running summary extraction");
  assert.equal(engine.memory4.getRecoveryStatus(campaignToken).pending, 1, "derived failure must keep the same recovery snapshot pending");

  const derivedRetry = await manager.retryFailedSummaries();
  assert.equal(derivedRetry.success, true);
  assert.equal(derivedRetry.recovered, 1);
  assert.equal(derivedRetry.failed, 0);
  assert.equal(requestExtractionCalls, 1, "a successful canonical owner must not be extracted again to retry Year/Life");
  assert.equal(durableRetryCalls, 1, "derived-only retry must not replay a successful owner extraction");
  assert.equal(compressionCalls, 2);
  assert.equal(engine.memory4.getRecoveryStatus(campaignToken).pending, 0);
  const derived = engine.memory4.derived.list({ campaignToken, ownerId: 2 });
  assert(JSON.stringify(derived.years).includes("乙在宫廷宴席中见到丙。"));
  assert(JSON.stringify(derived.life).includes("乙在宫廷宴席中见到丙。"));

  const summary = JSON.parse(fs.readFileSync(filePath, "utf8"))[0];
  const sourceMemory = engine.store.getMemory(summary.perspectiveMemoryIds[0]);
  const scope = { campaignToken, ownerId: 2 };
  const coverage = engine.memory4.getLegacyCoverage(scope, [sourceMemory]).items[0];
  assert.equal(coverage.eligible, false, "the fixture must enter the already-covered canonical path");
  const canonicalEntries = engine.memory4.store.query(scope);
  const index = engine.memory4.store.loadIndex(scope);
  const metadata = engine.store.readJson(path.join(engine.memory4.store.directory(scope), "metadata.json"), null);
  engine.memory4.derived.markDirty(scope, { index, metadata, entryIds: canonicalEntries.map(entry => entry.entryId) });
  failCompressionCount = 1;
  const coveredRebuild = await engine.memory4.recompressLegacy(scope, {
    memoryId: sourceMemory.memoryId, expectedSourceHash: coverage.sourceHash, rebuildDerived: true
  });
  assert.equal(coveredRebuild.status, "ALREADY_CONVERTED");
  assert.equal(coveredRebuild.derived.status, "FAILED");
  assert.equal(engine.memory4.getRecoveryStatus(campaignToken).pending, 1,
    "derived-only failure for an already-covered canonical must persist in the same recovery queue");
  const coveredRetry = await manager.retryFailedSummaries();
  assert.equal(coveredRetry.success, true);
  assert.equal(coveredRetry.recovered, 1);
  assert.equal(requestExtractionCalls, 1, "a covered canonical retry must not extract its source again");
  assert.equal(durableRetryCalls, 1, "a covered canonical retry must not replay durable extraction");
  assert.equal(engine.memory4.getRecoveryStatus(campaignToken).pending, 0);
}

async function regenerateRebuildsCurrentLegacySource(root) {
  const summariesDir = path.join(root, "regenerate", "summaries");
  const ownerDir = path.join(summariesDir, "2_乙");
  fs.mkdirSync(ownerDir, { recursive: true });
  const filePath = path.join(ownerDir, "与丙的对话.json");
  const campaignToken = "regenerate-campaign";
  const initialContent = "1164年乙答应秋收后向丙送粮。";
  fs.writeFileSync(filePath, JSON.stringify([{
    playerId: 2, playerName: "乙", characterId: 3, characterName: "丙", date: "1165.1.1", totalDays: 420000,
    campaignToken, campaignBinding: { status: "bound", source: "native" }, content: initialContent
  }]), "utf8");
  const engine = new MemoryEngine({ baseDir: path.join(root, "regenerate", "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
  const conversation = { id: "regenerate-active", isActive: true, gameData: {
    campaignToken, date: "1165.1.1", characters: new Map([[2, { id: 2, shortName: "乙", fullName: "乙" }], [3, { id: 3, shortName: "丙", fullName: "丙" }]])
  }, memoryState: engine.createConversationState("regenerate-active"), dynamicRecallHistory: new Map() };
  const extractionContents = [];
  engine.memory4.configureDerived({
    isCampaignCurrent: token => token === campaignToken,
    estimateTokens: text => Math.ceil(text.length / 2),
    requestExtraction: async prompt => {
      const text = JSON.parse(prompt[1].content).fragments[0].text;
      extractionContents.push(text);
      if (text.includes("无可确认")) return { content: JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }), finish_reason: "stop" };
      const yearMatch = text.match(/(\d{4})年/);
      const year = Number(yearMatch?.[1] || 1164);
      return { content: JSON.stringify({ status: "STORE", entries: [{
        memoryType: "DURABLE_KNOWLEDGE", text, fragmentIds: [JSON.parse(prompt[1].content).fragments[0].fragmentId],
        entityIds: [3], participantIds: [], topics: ["粮食"],
        eventTime: { from: `${year}.1.1`, to: `${year}.12.31`, precision: "year", status: "reported" }
      }] }), finish_reason: "stop" };
    }
  });
  const expectedOutputs = ["1164年乙改为承诺秋收后分批向丙送粮。", "1164年乙确认秋收后仍会向丙送粮。", "1164年乙无可确认的长期内容。"];
  const outputs = [...expectedOutputs];
  const manager = createSummariesManager({
    fs, path, summariesDir, memoryEngine: engine, memorySystem: {},
    getCurrentConversation: () => conversation,
    getMemory4ReadConversation: () => conversation,
    requestSummary: async () => ({ content: outputs.shift(), finish_reason: "stop" }),
    getSummaryOutputLimit: () => 4096
  });
  const first = await manager.regenerateSummary(2, 3, 0, initialContent);
  assert.equal(first.success, true, JSON.stringify(first));
  assert.equal(first.memoryRebuild.canonical.status, "COMPLETE");
  assert.equal(first.memoryRebuild.derived.status, "COMPLETE");
  const scope = { campaignToken, ownerId: 2 };
  const firstEntry = engine.memory4.store.query(scope)[0];
  assert(firstEntry.text.includes("改为承诺"));
  const firstViews = engine.memory4.derived.list(scope);
  assert(firstViews.years.some(view => view.eventYear === 1164));
  assert(firstViews.life.segments.length > 0);
  engine.memory4.store.updateEntry(scope, firstEntry.entryId, "手工保留的旧来源长期记忆。", { expectedRevision: firstEntry.revision });
  await engine.memory4.derived.rebuild(scope, { kind: "all" });
  const current = JSON.parse(fs.readFileSync(filePath, "utf8"))[0].content;
  conversation.isActive = false;
  const second = await manager.regenerateSummary(2, 3, 0, current);
  assert.equal(second.success, true);
  assert.equal(second.memoryRebuild.canonical.status, "COMPLETE");
  assert.equal(second.memoryRebuild.derived.status, "COMPLETE");
  const currentEntries = engine.memory4.store.query(scope);
  assert(currentEntries.some(entry => entry.text.includes("确认秋收后")));
  assert(!currentEntries.some(entry => entry.text.includes("改为承诺")), "old canonicals bound to the replaced Legacy source must become ineligible");
  const preservedManual = engine.memory4.store.readEntry(scope, firstEntry.entryId);
  assert.equal(preservedManual.text, "手工保留的旧来源长期记忆。");
  assert.equal(preservedManual.edit.mode, "manual_override");
  const rebuilt = engine.memory4.derived.list(scope);
  assert(rebuilt.years.some(view => view.eventYear === 1164));
  assert(rebuilt.life.segments.length > 0);
  assert(JSON.stringify(rebuilt.years).includes(expectedOutputs[1]), "year memories must contain the newly rewritten source");
  assert(JSON.stringify(rebuilt.life).includes(expectedOutputs[1]), "life memories must contain the newly rewritten source");
  assert(!JSON.stringify(rebuilt.years).includes("改为承诺"));
  assert(!JSON.stringify(rebuilt.life).includes("改为承诺"));

  const third = await manager.regenerateSummary(2, 3, 0, expectedOutputs[1]);
  assert.equal(third.success, true);
  assert.equal(third.memoryRebuild.canonical.status, "NO_DURABLE_CONTENT");
  assert.equal(third.memoryRebuild.derived.status, "COMPLETE");
  assert(!engine.memory4.store.query(scope).some(entry => entry.text.includes("无可确认")), "NO_DURABLE_CONTENT must not fabricate a Detail entry");
  assert(!JSON.stringify(engine.memory4.derived.list(scope)).includes(expectedOutputs[1]), "Year/Life must drop the superseded source when no durable replacement exists");
  assert(Object.values(engine.memory4.store.loadIndex(scope).finalizations).some(record => record.status === "NO_DURABLE_CONTENT"),
    "the empty extraction outcome must remain explicit and source-bound");
  assert.deepEqual(extractionContents, expectedOutputs, "each successful rewrite must extract exactly its new source body");
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-retry-rebuild-"));
  try {
    validatedLetterDatesReachDurablePrompt(root);
    await retryBadNarrativeOutput(root);
    await retryDetachedMemory4AndLetters(root);
    await retryPersistedLegacyExtractionAndDerivedFailures(root);
    await regenerateRebuildsCurrentLegacySource(root);
    console.log("V8.14.2 summary retry and rebuild incident: PASS");
  } finally {
    const target = path.resolve(root);
    assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(target, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
