"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { MemoryEngine, MemoryStore, MemoryTrace } = require(path.join(root, "resources/app/out/main/memory-system"));
const {
  buildPerspectiveSummaryMap,
  validatePerspectiveCoverage,
  validateSummarySegmentPresenceBoundaries
} = require(path.join(root, "resources/app/out/main/memory-system/perspective-projector"));

const participants = [{ id: 1, name: "玩家" }, { id: 2, name: "甲" }, { id: 3, name: "乙" }];

function message(id, name = id % 2 ? "玩家" : "甲", content = `第${id}条对话包含足够明确的角色互动与现场细节。`) {
  return { id, role: id % 2 ? "user" : "assistant", name, content };
}

function segment(id, messageIds, knownBy = [1, 2, 3]) {
  return {
    segmentId: id,
    content: `${id}的完整叙事。`,
    participants: knownBy,
    knownBy,
    visibility: "participants",
    provenance: { messageIds, speakerIds: [1, 2] }
  };
}

function extraction(summarySegments, memories = []) {
  return {
    structured: true,
    sessionSummary: summarySegments.map((entry) => entry.content).join("\n\n") || "短暂插话。",
    summarySegments,
    memories
  };
}

function assertPresenceBoundaryCases() {
  const messages = Array.from({ length: 12 }, (_, index) => message(index + 1));
  const joinedContext = {
    participants,
    messages,
    participantPresence: [
      { characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null },
      { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: null },
      { characterId: 3, joinedAtMessageId: 5, leftAtMessageId: null }
    ]
  };
  const joinFailure = validateSummarySegmentPresenceBoundaries(joinedContext, extraction([segment("join-cross", [3, 6, 7])]));
  assert.strictEqual(joinFailure.success, false, "[3,6,7] must be rejected when participant 3 joins at message 5");
  assert.deepStrictEqual(joinFailure.reasons, ["summary_segment_crosses_presence_boundary"]);

  const leftContext = {
    ...joinedContext,
    participantPresence: [
      { characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null },
      { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: null },
      { characterId: 3, joinedAtMessageId: 0, leftAtMessageId: 10 }
    ]
  };
  assert.strictEqual(validateSummarySegmentPresenceBoundaries(leftContext, extraction([segment("leave-cross", [8, 9, 11])])).success, false);

  const threeSegmentsContext = {
    ...joinedContext,
    participantPresence: [
      { characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null },
      { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: null },
      { characterId: 3, joinedAtMessageId: 5, leftAtMessageId: 10 }
    ]
  };
  const correct = extraction([
    segment("before-join", [1, 2, 3], [1, 2]),
    segment("shared", [6, 7, 8]),
    segment("after-leave", [11, 12], [1, 2])
  ]);
  assert.strictEqual(validateSummarySegmentPresenceBoundaries(threeSegmentsContext, correct).success, true, "segments split at both boundaries must pass");

  const temporaryAbsenceContext = {
    ...joinedContext,
    participantPresence: [
      { characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null },
      { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: null },
      { characterId: 3, joinedAtMessageId: 0, leftAtMessageId: 5 },
      { characterId: 3, joinedAtMessageId: 9, leftAtMessageId: 14 }
    ]
  };
  const gapFailure = validateSummarySegmentPresenceBoundaries(temporaryAbsenceContext, extraction([segment("temporary-gap", [3, 10])]));
  assert.strictEqual(gapFailure.success, false, "the same active IDs before and after a temporary gap must still be rejected");
  assert.deepStrictEqual(gapFailure.failures[0].presenceSignatures, ["1,2,3"]);
  assert.deepStrictEqual(gapFailure.failures[0].crossedBoundaryMessageIds, [5, 9]);

  const engine = new MemoryEngine({ store: {}, trace: new MemoryTrace({ logger: { log() {} } }) });
  const quality = engine.evaluateFinalSummaryQuality(joinedContext, extraction([segment("join-cross", [3, 6, 7])]));
  assert(quality.reasons.includes("summary_segment_crosses_presence_boundary"));
  const retryPrompt = engine.buildSummaryQualityRetryPrompt([{ role: "user", content: "source" }], quality);
  const correction = retryPrompt.find((entry) => entry.role === "system")?.content || "";
  assert(correction.includes("Split the narrative into separate chronological segments"));
  assert(correction.includes("Keep all exact supporting messageIds in the appropriate split segments"));
  assert(correction.includes("temporary-leave"));
}

function assertProjectionCoverageCases() {
  const longContext = {
    participants,
    messages: Array.from({ length: 7 }, (_, index) => message(index + 1, index % 3 === 2 ? "乙" : undefined, "这是一段超过覆盖阈值的多人角色扮演正文，包含明确事实、态度变化、行动条件与后续约定。".repeat(3))),
    participantPresence: participants.map((entry) => ({ characterId: entry.id, joinedAtMessageId: 1, leftAtMessageId: null }))
  };
  const memoryOnly = {
    memoryId: "memory-only",
    type: "promise",
    content: "乙答应继续参与后续安排。",
    participants: [1, 3],
    subjects: [1],
    knownBy: [1, 3],
    importance: 0.9,
    provenance: { messageIds: [3], speakerIds: [3] }
  };
  const projectedExtraction = extraction([segment("pair-12-only", [1, 2, 4], [1, 2])], [memoryOnly]);
  const projections = buildPerspectiveSummaryMap(longContext, projectedExtraction);
  const coverage = validatePerspectiveCoverage(longContext, projectedExtraction, projections);
  const thirdToPlayer = coverage.invalidPairs.find((entry) => entry.ownerId === 3 && entry.counterpartId === 1);
  assert.strictEqual(coverage.success, false);
  assert(thirdToPlayer, "substantive participant with a memory-only projection must fail coverage");
  assert(thirdToPlayer.visibleDialogueMessageCount >= 7);
  assert(thirdToPlayer.visibleDialogueChars > 500);
  assert.strictEqual(thirdToPlayer.projectionSegmentCount, 0);
  assert.strictEqual(thirdToPlayer.projectionMemoryCount, 1);

  const shortContext = { ...longContext, messages: [message(1, "玩家", "嗯。"), message(2, "乙", "好。")] };
  const shortProjections = buildPerspectiveSummaryMap(shortContext, extraction([], [memoryOnly]));
  assert.strictEqual(validatePerspectiveCoverage(shortContext, extraction([], [memoryOnly]), shortProjections).success, true, "one or two short lines must not trigger P1 coverage failure");
}

async function assertCoverageFailureRecoversWithRegeneration() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v793-presence-p1-"));
  const store = new MemoryStore({ baseDir: path.join(tempDir, "memory") });
  const trace = new MemoryTrace({ logger: { log() {} } });
  const engine = new MemoryEngine({ store, trace });
  let folderWrites = 0;
  const messages = Array.from({ length: 7 }, (_, index) => message(index + 1, index === 1 ? "乙" : undefined, "多人对话正文包含明确的事实、互动、条件、态度与后续安排。".repeat(4)));
  const context = {
    conversationId: "v793-p1-coverage",
    participants,
    messages,
    participantPresence: [
      { characterId: 1, joinedAtMessageId: 1, leftAtMessageId: null },
      { characterId: 2, joinedAtMessageId: 1, leftAtMessageId: null },
      { characterId: 3, joinedAtMessageId: 2, leftAtMessageId: null }
    ],
    buildPrompt: () => [],
    persistCharacterFolders: async () => { folderWrites++; return { success: true }; }
  };
  const memory = {
    type: "promise",
    subtype: "participation",
    participants: [1, 3],
    subjects: [1],
    content: "乙答应继续参与后续安排。",
    canonicalText: "乙答应继续参与后续安排",
    importance: 0.9,
    confidence: 1,
    visibility: "private",
    source: "spoken",
    status: "open",
    messageIds: [2],
    speakerIds: [3]
  };
  const incomplete = JSON.stringify({
    summarySegments: [{ content: "乙加入前，玩家与甲确定了会谈主题。", participants: [1, 2], visibility: "participants", messageIds: [1], speakerIds: [1] }],
    memories: [memory]
  });
  const corrected = JSON.stringify({
    summarySegments: [
      { content: "乙加入前，玩家与甲确定了会谈主题。", participants: [1, 2], visibility: "participants", messageIds: [1], speakerIds: [1] },
      { content: "乙加入后，三人完整讨论了事实、条件、态度变化与后续安排。", participants: [1, 2, 3], visibility: "participants", messageIds: [2, 3, 4, 5, 6, 7], speakerIds: [1, 2, 3] }
    ],
    memories: [memory]
  });
  try {
    const failed = await engine.finalizeConversation({ ...context, requestSummary: async () => ({ content: incomplete }) });
    assert.strictEqual(failed.success, false);
    assert(String(failed.error?.message).startsWith("projection_narrative_coverage_missing:"));
    assert.strictEqual(folderWrites, 0, "coverage failure must happen before character-folder persistence");
    const coverageTrace = trace.list().find((entry) => entry.stage === "projection_narrative_coverage_missing" && entry.characterId === 3 && entry.counterpartId === 1);
    assert(coverageTrace);
    assert.strictEqual(coverageTrace.participantId, 3);
    assert.strictEqual(coverageTrace.projectionMemoryCount, 1);
    assert(trace.list().some((entry) => entry.stage === "projection_memory_only_fallback"));
    const [snapshotPath] = engine.listRecoverySnapshots();
    const snapshot = store.readJson(snapshotPath, null);
    assert.strictEqual(snapshot.finalizationStage, "request");
    assert.strictEqual(snapshot.providerOutput, null);
    assert.strictEqual(snapshot.parsedExtraction, null);
    assert(!store.findEpisodeByFinalization(context.conversationId, engine.getFinalizationId(context))?.commitMarker, "coverage failure must not commit finalization");

    let regenerationCalls = 0;
    const recovered = await engine.recoverFailedFinalization(snapshotPath, {
      buildPrompt: () => [],
      requestSummary: async () => { regenerationCalls++; return { content: corrected }; },
      persistCharacterFolders: context.persistCharacterFolders
    });
    assert.strictEqual(recovered.success, true);
    assert.strictEqual(regenerationCalls, 1, "coverage recovery must regenerate the final summary once");
    assert.strictEqual(folderWrites, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

(async () => {
  assertPresenceBoundaryCases();
  assertProjectionCoverageCases();
  await assertCoverageFailureRecoversWithRegeneration();
  console.log("PASS v7.9.3 P1 presence-boundary summary and projection coverage");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
