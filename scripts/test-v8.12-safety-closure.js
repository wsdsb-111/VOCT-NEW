"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system");
const { createProjectionLineage } = require("../resources/app/out/main/memory-system/memory4-forget");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");
const { buildSubjectiveWorldView } = require("../resources/app/out/main/worldline/subjective-world-builder");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v812-safety-"));
try {
  const summaryFoldersDir = path.join(root, "summaries");
  fs.mkdirSync(path.join(summaryFoldersDir, "1_owner"), { recursive: true });
  const engine = new MemoryEngine({ baseDir: root, summaryFoldersDir });
  const campaignToken = "campaign-v812-pair-safety";
  const conversationId = "conversation-v812-pair-safety";
  const projection2 = createProjectionLineage({ campaignToken, ownerId: 1, counterpartId: 2, conversationId,
    finalizationId: "multi", segmentIds: ["s2"], sourceSegmentIds: ["m4-source-s2"], sourceMessageIds: [2] });
  const projection3 = createProjectionLineage({ campaignToken, ownerId: 1, counterpartId: 3, conversationId,
    finalizationId: "multi", segmentIds: ["s3"], sourceSegmentIds: ["m4-source-s3"], sourceMessageIds: [3] });
  const fragments = [
    { fragmentId: "m4-source-s2", messageId: 2, sourceMessageIds: [2], text: "Memory4 source for pair 1-2.",
      speakerId: 1, speakerIds: [1], sourceTextVerified: true, sourceRole: "assistant", presentIds: [1, 2], knownBy: [1, 2],
      visibility: "participants", sourceType: "spoken", recipientIds: [2], entityIds: [2], visibilityEvidence: "application_fragment" },
    { fragmentId: "m4-source-s3", messageId: 3, sourceMessageIds: [3], text: "Memory4 source for pair 1-3.",
      speakerId: 1, speakerIds: [1], sourceTextVerified: true, sourceRole: "assistant", presentIds: [1, 3], knownBy: [1, 3],
      visibility: "participants", sourceType: "spoken", recipientIds: [3], entityIds: [3], visibilityEvidence: "application_fragment" }
  ];
  engine.memory4.store.commitOwner({ campaignToken, ownerId: 1, conversationId, finalizationId: "multi", episodeId: "multi-m4",
    date: "1164.1.1", totalDays: 425000, sourceRevision: hash([campaignToken, "multi", "source"]), presentMessageCount: 2,
    completeness: "complete", summaryIds: [], counterpartIds: [2, 3], fragments,
    projectionLineages: [projection2, projection3] }, { status: "STORE", entries: [
    { memoryType: "DURABLE_KNOWLEDGE", text: "Memory4 source for pair 1-2.", fragmentIds: ["m4-source-s2"],
      participantIds: [1, 2], entityIds: [2], topics: ["pair-2"], eventTime: { status: "unknown" } },
    { memoryType: "DURABLE_KNOWLEDGE", text: "Memory4 source for pair 1-3.", fragmentIds: ["m4-source-s3"],
      participantIds: [1, 3], entityIds: [3], topics: ["pair-3"], eventTime: { status: "unknown" } }
  ] });
  for (const counterpart of [2, 3]) {
    engine.store.saveMemory({ memoryId: `m${counterpart}`, content: `pair 1-${counterpart}`, participants: [1, 2, 3], subjects: [counterpart], knownBy: [1, counterpart], visibility: "known_group", provenance: { finalizationId: "multi" } });
    engine.store.markKnownBy(1, `m${counterpart}`);
  }
  engine.store.saveEpisode({ episodeId: "multi", finalizationId: "multi", memoryIds: ["m2", "m3", "missing"], summarySegments: [
    { segmentId: "s2", participants: [1, 2], knownBy: [1, 2] },
    { segmentId: "s3", participants: [1, 3], knownBy: [1, 3] },
    { segmentId: "empty", knownBy: [] },
    { segmentId: "audit", knownBy: [], auditRequired: true }
  ] });
  engine.forgetSummaryProjection({ playerId: 1, perspectiveOwnerId: 1, characterId: 2, campaignToken, conversationId,
    finalizationId: "multi", segmentIds: ["s2"], sourceSegmentIds: ["m4-source-s2"], sourceMessageIds: [2],
    projectionId: projection2.projectionId });
  assert.deepEqual(engine.store.getMemory("m3").knownBy, [1, 3], "other counterpart must survive");
  assert.deepEqual(engine.store.getMemory("m2").knownBy, [2], "shared observer must survive");
  let episode = engine.store.listAllEpisodes()[0];
  assert.deepEqual(episode.summarySegments.find(item => item.segmentId === "s3").knownBy, [1, 3]);
  assert(!episode.memoryIds.includes("missing"));
  assert(!episode.summarySegments.some(item => item.segmentId === "empty"));
  assert(episode.summarySegments.some(item => item.segmentId === "audit"));
  assert.throws(() => engine.forgetSummaryProjection({ playerId: 1, finalizationId: "multi" }), /LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE/);
  const recoveryFile = path.join(engine.store.paths.recovery, "retain.json");
  engine.store.saveEpisode({ episodeId: "retained", finalizationId: "pending", memoryIds: ["absent"], summarySegments: [{ segmentId: "pending-empty", knownBy: [] }] });
  engine.store.writeJson(recoveryFile, { finalizationId: "pending" });
  engine.compactEpisodeReferences();
  assert.deepEqual(engine.store.listAllEpisodes().find(item => item.episodeId === "retained").memoryIds, ["absent"]);
  engine.store.saveEpisode({ episodeId: "ambiguous", finalizationId: "multi", memoryIds: [], summarySegments: [{ knownBy: [1, 2, 3], content: "pair unknown" }] });
  assert.throws(() => engine.forgetSummaryProjection({ playerId: 1, characterId: 3, finalizationId: "multi" }), /LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE/);
  assert.deepEqual(engine.store.getMemory("m3").knownBy, [1, 3], "ambiguous segment must block before memory writes");
  const base = { entityId: "2", sourceTier: "GAME_TRUTH", temporalSafe: true, public: true };
  for (const observedField of ["LOCATION", "PRESENCE"]) {
    const view = buildSubjectiveWorldView({ responder: { id: "1" }, scope: { closeKnowledge: "FRIEND" }, candidates: [
      { ...base, factId: "old", field: "LOCATION", value: "旧军营", knowledgeLevel: "COURT_PUBLIC" },
      { ...base, factId: "seen", field: observedField, value: "本轮厅堂", knowledgeLevel: "DIRECT_OBSERVATION", directObserverIds: ["1"] }
    ] });
    assert(view.promptFacts.some(fact => fact.value === "本轮厅堂"));
    assert(!view.promptFacts.some(fact => fact.value === "旧军营"), "observation must suppress checkpoint whereabouts");
  }
  const authority = (id, verificationMode, value) => ({ entityId: "1", factId: id, field: "LOCATION", sourceTier: "GAME_TRUTH", knowledgeLevel: "SELF", temporalSafe: true, selfKnowledgeVerified: true, verificationMode, value });
  const currentFacts = [authority("checkpoint", "CHECKPOINT", "旧地点"), authority("self", "SELF_CURRENT", "本人实时"), authority("runtime", "LIVE_RUNTIME", "游戏实时")];
  for (const [count, expected] of [[1, "旧地点"], [2, "本人实时"], [3, "游戏实时"]]) {
    const view = buildSubjectiveWorldView({ responder: { id: "1" }, candidates: currentFacts.slice(0, count) });
    assert.deepEqual(view.promptFacts.map(item => item.value), [expected]);
  }
  console.log("V8.12 Safety Closure: PASS");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
