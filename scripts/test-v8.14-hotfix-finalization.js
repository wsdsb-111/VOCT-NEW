"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { repairVisibilityBoundaries, validateSourceItem, rebuildSourceNarrative } = require("../resources/app/out/main/memory-system/finalization-visibility");
const { buildIncidentDiagnostics } = require("../resources/app/out/main/memory-system/incident-diagnostics");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-hotfix-finalization-"));
const participants = [1, 2, 3].map(id => ({ id, name: `NPC${id}` }));
const message = (id, speakerCharacterId, content) => ({ id, speakerCharacterId, role: speakerCharacterId === 1 ? "user" : "assistant", name: `NPC${speakerCharacterId}`, content });
const messages = [message(1, 1, "我提出明日于城门交换玄鹤铜牌。"), message(2, 2, "我心里另有打算。\n我答应明日在城门交换玄鹤铜牌。"),
  { id: 3, role: "system", kind: "presence_join", characterId: 3, content: "NPC3入内。" },
  message(4, 1, "我向刚入场的人说明明日城门见。"), message(5, 2, "我确认明日城门见。")];
const segment = (ids, content = "已经商定明日见面。") => ({ content, participants: [1, 2], visibility: "public", source: "spoken", messageIds: ids, speakerIds: [1, 2] });
const safeOutput = context => JSON.stringify({ summarySegments: context.messages.filter(m => ["user", "assistant"].includes(m.role)).map(m => {
  const speakerId = Number(m.speakerCharacterId);
  const publicContent = String(m.content || "").split(/\r?\n/).map(text => text.trim()).filter(text => !/心想|心里|心底|心下|暗想|内心|暗自|默念|没(?:有)?说出口|腹诽|偷偷决定|无人察觉|趁人不注意|私下盘算|秘密决定/.test(text)).at(-1);
  return { ...segment([m.id], publicContent), participants: [speakerId], speakerIds: [speakerId] };
}).concat(context.messages.filter(m => m.role === "system" && m.kind === "presence_join").map(m => ({
  content: m.content, participants: context.participantPresence.filter(window => Number(window.joinedAtMessageId) <= Number(m.id)
    && (window.leftAtMessageId == null || Number(m.id) < Number(window.leftAtMessageId))).map(window => Number(window.characterId)),
  visibility: "participants", source: "game_fact", messageIds: [m.id], speakerIds: []
}))).sort((left, right) => left.messageIds[0] - right.messageIds[0]), memories: [] });

(async () => {
  try {
    const engine = new MemoryEngine({ store: new MemoryStore({ baseDir: root }), trace: { record() {} } });
    for (const count of [2, 3]) {
      const context = { conversationId: `hotfix-${count}`, campaignToken: "hotfix", participants: participants.slice(0, count),
        messages: count === 2 ? messages.slice(0, 2) : messages,
        participantPresence: participants.slice(0, count).map(p => ({ characterId: p.id, joinedAtMessageId: p.id === 3 ? 3 : 1, leftAtMessageId: null })),
        finalizationVisibilityV1: true, buildPrompt: () => [], persistCharacterFolders: async () => ({ success: true }) };
      let calls = 0;
      const output = { summarySegments: [segment(context.messages.map(m => m.id))],
        memories: [{ content: "无效候选没有 source", participants: [1, 2], visibility: "public", messageIds: [1] }] };
      const result = await engine.finalizeConversation({ ...context, requestSummary: async () => { calls++; return { content: calls === 1 ? JSON.stringify(output) : safeOutput(context) }; },
        requestDurable: async () => ({ content: "malformed durable" }) });
      assert.equal(result.success, true, result.error?.message);
      assert.equal(calls, 1, "source-bounded visibility repair must not force a second model request");
      assert.equal(result.durable.status, "PARTIAL_FAILURE", "malformed durable cannot cancel committed Narrative");
      assert(result.directedSummaries.get("1->2"));
      assert(!result.directedSummaries.get("1->2").content.includes("心里"));
      if (count === 3) assert(!result.directedSummaries.get("3->1").content.includes("铜牌"), "late arrival cannot read prior negotiation");
    }
    const scene = { conversationId: "overlap", participants: participants.slice(0, 2), messages: messages.slice(0, 2),
      participantPresence: participants.slice(0, 2).map(p => ({ characterId: p.id, joinedAtMessageId: 1 })), finalizationVisibilityV1: true };
    const extraction = engine.extractor.parseOutput(JSON.stringify({ summarySegments: [segment([2]), segment([1, 2])], memories: [] }), scene);
    repairVisibilityBoundaries(scene, extraction);
    assert.deepEqual([...new Set(extraction.summarySegments.flatMap(s => s.provenance.messageIds))].sort(), [1, 2], "overlap repair preserves every supporting message");
    assert.deepEqual(extraction.summarySegments.map(s => s.provenance.messageIds[0]), [1, 2, 2], "overlap repair preserves chronological order");
    assert(extraction.summarySegments.every(s => validateSourceItem(s, scene).success));
    const ambiguousScene = { ...scene, messages: [message(1, 1, "（终究会骗过他。）")] };
    const ambiguous = { summarySegments: [{ content: "（终究会骗过他。）", visibility: "private", source: "spoken", participants: [1],
      provenance: { messageIds: [1], speakerIds: [2] } }], memories: [] };
    repairVisibilityBoundaries(ambiguousScene, ambiguous);
    assert.deepEqual(validateSourceItem(ambiguous.summarySegments[0], ambiguousScene).audience, [1], "repair must not widen an uncertain restricted paragraph");
    assert.equal(rebuildSourceNarrative(ambiguousScene, ambiguous).summarySegments[0].visibility, "private", "recovery retains known restrictions too");

    const gapMessages = [message(1, 1, "众人先谈城防安排。"), message(2, 2, "我先离开片刻。"),
      { id: 3, role: "system", kind: "presence_temporary_leave", characterId: 2, content: "NPC2暂时离开。" },
      message(4, 1, "我告诉NPC3锦囊秘令藏在北门。"),
      { id: 5, role: "system", kind: "presence_temporary_return", characterId: 2, content: "NPC2返回。" },
      message(6, 2, "我回来了，可以继续商议。")];
    let gapRequests = 0;
    const gap = await engine.finalizeConversation({ ...scene, conversationId: "temporary-gap", participants, messages: gapMessages,
      participantPresence: [{ characterId: 1, joinedAtMessageId: 1 }, { characterId: 3, joinedAtMessageId: 1 },
        { characterId: 2, joinedAtMessageId: 1, leftAtMessageId: 3 }, { characterId: 2, joinedAtMessageId: 5 }],
      buildPrompt: () => [], persistCharacterFolders: async () => ({ success: true }),
      requestSummary: async () => ({ content: JSON.stringify({ summarySegments: ++gapRequests === 1 ? [segment(gapMessages.map(m => m.id))] : [
        { ...segment([1], "众人先谈城防安排。"), participants: [1, 2, 3], speakerIds: [1] },
        { ...segment([2], "NPC2先离开片刻。"), participants: [1, 2, 3], speakerIds: [2] },
        { content: "NPC2暂时离开。", participants: [1, 3], visibility: "participants", source: "game_fact", messageIds: [3], speakerIds: [] },
        { ...segment([4], "NPC1告诉NPC3锦囊秘令藏在北门。"), participants: [1, 3], speakerIds: [1] },
        { content: "NPC2返回。", participants: [1, 2, 3], visibility: "participants", source: "game_fact", messageIds: [5], speakerIds: [] },
        { ...segment([6], "NPC2回来后继续商议。"), participants: [1, 2, 3], speakerIds: [2] }
      ], memories: [] }) }) });
    assert.equal(gap.success, true, gap.error?.message);
    assert(!gap.directedSummaries.get("2->1").content.includes("锦囊秘令"), "return cannot reveal the absence gap");
    assert(gap.directedSummaries.get("3->1").content.includes("锦囊秘令"), "present observer retains the event");

    const relationshipChanges = [{ source: "ck3_readback", actorId: 1, targetId: 2, relationship: "friend" }];
    const prepared = engine.prepareFinalizationContext({ ...scene, conversationId: "recovery", relationshipChanges });
    const file = engine.writeRecoverySnapshot(prepared, { finalizationStage: "request", finalizationStatus: "failed_retryable" }, new Error("final_summary_quality_failed:visibility_source_incomplete"));
    assert.deepEqual(engine.store.readJson(file).relationshipChanges, relationshipChanges, "B evidence survives Narrative recovery checkpoint");
    let recoveryCalls = 0;
    const recoveryOutput = JSON.stringify({ summarySegments: [
      { ...segment([1], "NPC1提出次日在城门交换玄鹤铜牌。"), participants: [1], speakerIds: [1] },
      { ...segment([2], "我答应明日在城门交换玄鹤铜牌。"), participants: [2], speakerIds: [2] }
    ], memories: [] });
    const options = { requestSummary: async () => { recoveryCalls++; return { content: recoveryOutput }; }, buildPrompt: () => [], persistCharacterFolders: async () => ({ success: true }) };
    const result = await engine.recoverFailedFinalization(file, options);
    assert.equal(result.success, true, result.error?.message);
    assert.equal(recoveryCalls, 1, "failed raw extraction must be regenerated through the summary model");
    assert(engine.isCommitted(prepared));
    assert.equal(engine.isCommitted(prepared).sessionSummary, "NPC1提出次日在城门交换玄鹤铜牌。\n\n我答应明日在城门交换玄鹤铜牌。", "recovery must commit the model's narrative rather than reconstructed source messages");
    const duplicate = await engine.finalizeConversation({ ...prepared, ...options });
    assert.equal(duplicate.alreadyCommitted, true);
    assert.equal(recoveryCalls, 1);

    const rawPrepared = engine.prepareFinalizationContext({ ...scene, conversationId: "raw-recovery" });
    const verbatimSegments = rawPrepared.messages.filter(m => ["user", "assistant"].includes(m.role)).map(m =>
      ({ ...segment([m.id], m.content), speakerIds: [m.speakerCharacterId] }));
    const verbatimOutput = JSON.stringify({ summarySegments: verbatimSegments, memories: [] });
    const verbatimFile = engine.writeRecoverySnapshot(rawPrepared, { finalizationStage: "parse", finalizationStatus: "failed_retryable",
      providerOutput: verbatimOutput, parsedExtraction: null },
    new Error("provider_timeout"));
    const verbatimRecovery = await engine.recoverFailedFinalization(verbatimFile, options);
    assert.equal(verbatimRecovery.success, true, verbatimRecovery.error?.message);
    assert.equal(recoveryCalls, 2, "a persisted verbatim transcript must be discarded and regenerated");
    assert.equal(engine.isCommitted(rawPrepared).sessionSummary, "NPC1提出次日在城门交换玄鹤铜牌。\n\n我答应明日在城门交换玄鹤铜牌。");

    const blocked = engine.prepareFinalizationContext({ ...scene, conversationId: "repeated", messages: [{ id: 1, role: "assistant", content: "未知作者。" }] });
    const failure = new Error("final_summary_quality_failed:visibility_source_incomplete");
    const blockedFile = engine.writeRecoverySnapshot(blocked, { providerOutput: "same malformed output" }, failure);
    engine.writeRecoverySnapshot(blocked, { providerOutput: "same malformed output" }, failure);
    const snapshot = engine.store.readJson(blockedFile);
    assert.equal(snapshot.sameFailureCount, 2);
    assert.equal(snapshot.lastOutputFingerprint.length, 64);
    assert.equal((await engine.recoverFailedFinalization(blockedFile, { ...options, automatic: true })).reason, "recovery_repeated_failure_requires_review");
    assert.equal(recoveryCalls, 2);
    const diagnostics = buildIncidentDiagnostics({ memoryEngine: engine, conversation: null, providerDiagnostics: { getRecent: () => [{
      requestType: "chat", provider: "zhipu", rawUsage: { prompt_tokens: 12000, prompt_tokens_details: { cached_tokens: 0 } },
      normalizedUsage: { prompt_cache_hit_tokens: 0 }, secret: "never expose", messages: [{ content: "private raw transcript" }]
    }] } });
    assert.equal(diagnostics.providerCache[0].rawCachedTokens, 0);
    assert.equal(diagnostics.providerCache[0].normalizedCachedTokens, 0);
    assert(!JSON.stringify(diagnostics).includes("private raw transcript"));
    assert(!JSON.stringify(diagnostics).includes("never expose"));
    assert(diagnostics.recovery.some(row => row.sameFailureCount === 2));
    let manualRecoveryCalls = 0;
    const manualRetry = await engine.recoverFailedFinalization(blockedFile, { ...options,
      requestSummary: async () => { manualRecoveryCalls++; throw new Error("manual_retry_dispatched"); } });
    assert.notEqual(manualRetry.reason, "recovery_repeated_failure_requires_review");
    assert(manualRecoveryCalls > 0, "manual retries must be allowed through the automatic repeated-failure guard");
    let attempts = 0;
    await assert.rejects(engine.requestFinalSummary({ ...scene, buildPrompt: () => [], requestSummary: async () => {
      if (++attempts === 1) return { content: "malformed" };
      throw new Error("402 insufficient balance");
    } }), error => error.message.includes("402") && error.providerOutput === null,
    "transport failure cannot inherit the previous attempt's output fingerprint");
    console.log("V8.14 Hotfix Finalization: PASS (2P/3P, single-call source repair, private/presence boundaries, Narrative/Durable independence, saved-output recovery, manual retry)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
