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
    requestSummary: async () => {
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

async function retryNarrativeAndLetters(root) {
  const summariesDir = path.join(root, "narrative-and-letter", "summaries");
  const engine = new MemoryEngine({ baseDir: path.join(root, "narrative-and-letter", "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
  const participants = [{ id: 1, name: "甲" }, { id: 2, name: "乙" }];
  const context = engine.prepareFinalizationContext({ conversationId: "detached-narrative", finalizationId: "detached-narrative-final",
    campaignToken: "detached-campaign", date: "1164.1.1", participants,
    participantPresence: participants.map(person => ({ characterId: person.id, joinedAtMessageId: 1, leftAtMessageId: null })),
    messages: [{ id: 1, role: "user", speakerCharacterId: 1, content: "我向乙承诺，明日送来粮食。" },
      { id: 2, role: "assistant", speakerCharacterId: 2, content: "我应允明日收下粮食。" }] });
  engine.writeRecoverySnapshot(context, { finalizationStage: "request", finalizationStatus: "failed_retryable", providerOutput: null },
    new Error("fixture_narrative_request_failure"));
  let letterPending = 1, durableCalls = 0;
  const letterCalls = [];
  engine.letterSummaryFinalization = {
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
  const manager = createSummariesManager({
    fs,
    path,
    summariesDir,
    memoryEngine: engine,
    memorySystem: {},
    getCurrentConversation: () => ({ id: "another-live-conversation", gameData: { campaignToken: context.campaignToken } }),
    requestSummary: async () => ({ content: validSummary({ ...context, messages: context.messages }), finish_reason: "stop" }),
    requestDurable: async () => { durableCalls++; throw new Error("retired_durable_callback_must_not_run"); },
    persistRecoveredSummary: async () => ({ success: true }),
    buildSummaryPrompt: () => [],
    getSummaryCapabilities: () => ({ contextWindow: 8192, maxOutputTokens: 2048 })
  });
  manager.refreshCurrentConversation = () => {};
  assert.equal(manager.getRecoveryStatus().narrativePending, 1);
  assert.equal(manager.getRecoveryStatus().letterPending, 1);
  const result = await manager.retryFailedSummaries();
  assert.equal(result.recovered, 1, JSON.stringify({ result, recovery: engine.store.readJson(engine.listRecoverySnapshots()[0], null) }));
  assert.equal(result.failed, 1, "letter extraction errors must remain visible in the unified retry result");
  assert.equal(letterCalls.length, 1);
  assert.deepEqual(letterCalls[0], { activeCampaignToken: context.campaignToken, manual: true });
  assert.equal(engine.isCommitted(context)?.finalizationId, context.finalizationId);
  assert.equal(durableCalls, 0);
  assert.equal(Object.hasOwn(engine, "memory4"), false);
}

async function rewriteLegacySummaryWithoutDurable(root) {
  const summariesDir = path.join(root, "legacy-rewrite", "summaries");
  const ownerDir = path.join(summariesDir, "2_乙");
  fs.mkdirSync(ownerDir, { recursive: true });
  const filePath = path.join(ownerDir, "与3的对话.json");
  const initialContent = "1164年，乙在宴席上见到丙。";
  const engine = new MemoryEngine({ baseDir: path.join(root, "legacy-rewrite", "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
  engine.store.writeJson(filePath, [{ playerId: 2, playerName: "乙", characterId: 3, characterName: "丙", perspectiveOwnerId: 2,
    date: "1165.1.1", content: initialContent, perspectiveMemoryIds: [], perspectiveSummarySegmentIds: [], sourceMessageIds: [], sourceSegmentIds: [] }]);
  const outputs = ["1164年乙在宴席上见到丙，双方随后谈及后续安排。", "1164年乙与丙在宴席见面后讨论了后续安排。"];
  let summaryCalls = 0, durableCalls = 0;
  const manager = createSummariesManager({
    fs,
    path,
    summariesDir,
    memoryEngine: engine,
    memorySystem: {},
    requestSummary: async () => ({ content: outputs[summaryCalls++], finish_reason: "stop" }),
    requestDurable: async () => { durableCalls++; throw new Error("retired_durable_callback_must_not_run"); },
    getSummaryOutputLimit: () => 4096
  });
  const first = await manager.regenerateSummary(2, 3, 0, initialContent);
  assert.equal(first.success, true, JSON.stringify(first));
  assert.equal(first.summaryUpdated, true);
  const rewritten = JSON.parse(fs.readFileSync(filePath, "utf8"))[0];
  assert.equal(rewritten.content, outputs[0]);
  const stale = await manager.regenerateSummary(2, 3, 0, initialContent);
  assert.equal(stale.error, "summary_regeneration_stale");
  const second = await manager.regenerateSummary(2, 3, 0, rewritten.content);
  assert.equal(second.success, true, JSON.stringify(second));
  assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8"))[0].content, outputs[1]);
  assert.equal(summaryCalls, 2, "stale Legacy content must be rejected before another Provider request");
  assert.equal(durableCalls, 0);
  assert.equal(Object.hasOwn(engine, "memory4"), false);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-retry-rebuild-"));
  try {
    await retryBadNarrativeOutput(root);
    await retryNarrativeAndLetters(root);
    await rewriteLegacySummaryWithoutDurable(root);
    console.log("V8.14.2 summary retry and rebuild incident: PASS");
  } finally {
    const target = path.resolve(root);
    assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(target, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
