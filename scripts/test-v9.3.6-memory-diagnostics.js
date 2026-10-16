"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { MemoryTrace } = require("../src/app/main/memory-system/memory-trace");
const { createUsageAnalytics } = require("../src/app/main/analytics/usage-analytics");

const secretText = "PLAYER_MEMORY_PRIVATE_TEXT_SENTINEL";
const secretPath = "C:\\Users\\97330\\AppData\\Local\\secret-summary.json";
const secretCredential = "sk-player-memory-secret-sentinel";

function serialized(value) {
  return JSON.stringify(value);
}

function assertNoSecrets(value, label) {
  const text = typeof value === "string" ? value : serialized(value);
  for (const secret of [secretText, secretPath, secretCredential]) {
    assert(!text.includes(secret), `${label} must not retain ${secret}`);
  }
}

function testTraceProjection() {
  const trace = new MemoryTrace({ logger: { log() {} } });
  const recorded = trace.record("player_memory_retrieval", {
    responderId: 985,
    playerAnchorId: 1,
    conversationId: secretText,
    campaignToken: secretCredential,
    content: secretText,
    sourcePath: secretPath,
    memoryBudget: 640,
    memoryBudgetPlan: {
      policyRevision: "v9.3.6",
      participantCount: 4,
      contextWindow: 32000,
      nonMemoryInputTokens: 14000,
      providerHeadroomTokens: 7100,
      memoryBudgetTokens: 640,
      reservedOutputTokens: 4096,
      safetyMarginTokens: 1024,
      protocolOverheadTokens: 48,
      apiKey: secretCredential
    },
    playerLedgerAvailableCount: 5,
    playerLedgerInjectedCount: 3,
    playerLedgerOmittedCount: 2,
    frozenSnapshotIdHash: "A".repeat(64),
    frozenSnapshotReuse: true,
    frozenInvalidationReason: "FIRST_PROMPT",
    baselineBudgetUsed: 260,
    dynamicBudgetUsed: 180,
    finalInjectedTokens: 440,
    thirdPersonIntentLevel: "L1",
    thirdPersonTargetCount: 1,
    thirdPersonIndexHitCount: 2,
    thirdPersonInjectedItems: 1,
    thirdPersonSourceOpenedCount: 1,
    thirdPersonFallbackStatus: "INDEX_HIT_SOURCE",
    candidatePairCount: 8,
    actualIndexReadCount: 16,
    indexCacheHits: 8,
    indexCacheMisses: 8,
    indexCacheHit: false,
    legacySourceResolvedCount: 1,
    legacyBudgetOmittedCount: 0,
    dynamicCacheHit: true,
    privateExtra: { text: secretText, path: secretPath, credential: secretCredential }
  });

  assert.equal(recorded.stage, "player_memory_retrieval");
  assert.equal(recorded.playerMemory.version, "9.3.6");
  assert.equal(recorded.playerMemory.playerLedgerAvailableCount, 5);
  assert.equal(recorded.playerMemory.frozenSnapshotIdHash, "a".repeat(64));
  assert.equal(recorded.playerMemory.providerHeadroomTokens, 7100);
  assert.equal(recorded.playerMemory.maxOutputTokens, 4096);
  assert.equal(recorded.playerMemory.legacySourceResolvedCount, 1);
  assert.equal(recorded.playerMemory.candidatePairCount, 8);
  assert.equal(recorded.playerMemory.actualIndexReadCount, 16);
  assert.equal(recorded.playerMemory.indexCacheHits, 8);
  assert.equal(recorded.playerMemory.indexCacheMisses, 8);
  assert.equal(recorded.playerMemory.indexCacheHit, false, "a mixed cold/warm scope lookup is not an all-cache-hit retrieval");
  assert.equal(recorded.playerMemory.dynamicCacheHit, true);
  assert.equal(recorded.playerMemory.playerLedgerCacheHit, null, "unknown ledger cache status must remain null");
  assert.equal(recorded.playerMemory.conversationIdHash, null, "raw conversation identity must not be projected");
  assert.deepEqual(Object.keys(recorded).sort(), ["playerMemory", "stage", "timestamp"]);
  assertNoSecrets(recorded, "MemoryTrace record");
  assertNoSecrets(trace.list(), "MemoryTrace list");

  const invalid = trace.record("player_memory_retrieval", {
    fallbackStatus: secretText,
    frozenInvalidationReason: secretText,
    thirdPersonIntentLevel: "private-level",
    dynamicCacheHit: undefined,
    finalInjectedTokens: Infinity
  });
  assert.equal(invalid.playerMemory.fallbackStatus, null);
  assert.equal(invalid.playerMemory.frozenInvalidationReason, null);
  assert.equal(invalid.playerMemory.thirdPersonIntentLevel, null);
  assert.equal(invalid.playerMemory.dynamicCacheHit, null);
  assert.equal(invalid.playerMemory.finalMemoryTokenCount, null);
  assertNoSecrets(invalid, "invalid MemoryTrace record");
}

function testAnalyticsPersistence() {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "v936-memory-diagnostics-"));
  try {
    const dataDirectory = path.join(tempDirectory, "data");
    const analyticsFile = path.join(dataDirectory, "usage-analytics.json");
    const retention = {
      DEFAULT_MAX_USAGE_ENTRIES: 100,
      DEFAULT_MAX_DIAGNOSTIC_ENTRIES: 100,
      retainUsageAnalyticsEntries: entries => entries
    };
    const UsageAnalytics = createUsageAnalytics({
      fs,
      dataDir: dataDirectory,
      analyticsFile,
      retention,
      createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex")
    });
    const analytics = new UsageAnalytics();
    analytics.record({
      requestType: "chat",
      providerType: "synthetic",
      model: "fixture-model",
      pairMemoryMetrics: {
        playerLedgerAvailableCount: 4,
        playerLedgerInjectedCount: 2,
        playerLedgerOmittedCount: 2,
        frozenSnapshotIdHash: "B".repeat(64),
        frozenSnapshotReuse: true,
        baselineBudgetUsed: 250,
        dynamicBudgetUsed: 140,
        finalInjectedTokens: 390,
        thirdPersonIntentLevel: "L2",
        thirdPersonTargetCount: 1,
        thirdPersonSourceOpenedCount: 1,
        thirdPersonFallbackStatus: "INDEX_HIT_SOURCE",
        candidatePairCount: 8,
        actualIndexReadCount: 16,
        indexCacheHits: 8,
        indexCacheMisses: 8,
        indexCacheHit: false,
        legacySourceResolvedCount: 1,
        legacyBudgetOmittedCount: 0,
        dynamicCacheHit: true,
        content: secretText,
        campaignToken: secretCredential,
        sourcePath: secretPath,
        unknownPrivateObject: { content: secretText, key: secretCredential }
      },
      memoryBudgetPlan: {
        policyRevision: "v9.3.6",
        participantCount: 3,
        contextWindow: 16000,
        nonMemoryInputTokens: 6800,
        providerHeadroomTokens: 2500,
        memoryBudgetTokens: 2500,
        reservedOutputTokens: 2048,
        safetyMarginTokens: 512,
        protocolOverheadTokens: 36,
        sourcePath: secretPath,
        apiKey: secretCredential
      },
      renderedMemoryTokens: 390,
      memoryPlayerLedgerTokens: 130,
      memoryOfficialTokens: 50,
      memoryRecentTokens: 210,
      memoryTemporalExtraTokens: 0,
      blocks: [
        { id: "memory-player-ledger-frozen", type: "memory_player_ledger_frozen", tokens: 130, content: secretText },
        { id: "memory-official-recollection", type: "memory_official_recollection", tokens: 50, content: secretPath },
        { id: "memory-topic-patch", type: "memory_topic_patch", tokens: 77, content: secretCredential }
      ]
    }, { prompt_tokens: 900, completion_tokens: 80 });

    const reloaded = analytics.read();
    assert.equal(reloaded.entries.length, 1, "record must be persisted and retrievable through read()");
    const entry = reloaded.entries[0];
    assert.equal(entry.pairMemoryMetrics.playerLedgerInjectedCount, 2);
    assert.equal(entry.pairMemoryMetrics.frozenSnapshotIdHash, "b".repeat(64));
    assert.equal(entry.pairMemoryMetrics.playerLedgerCacheHit, null, "unknown ledger cache status must remain null");
    assert.equal(entry.pairMemoryMetrics.dynamicCacheHit, true);
    assert.equal(entry.pairMemoryMetrics.candidatePairCount, 8);
    assert.equal(entry.pairMemoryMetrics.actualIndexReadCount, 16);
    assert.equal(entry.pairMemoryMetrics.indexCacheHits, 8);
    assert.equal(entry.pairMemoryMetrics.indexCacheMisses, 8);
    assert.equal(entry.pairMemoryMetrics.indexCacheHit, false);
    assert.equal(entry.memoryBudgetPlan.providerHeadroomTokens, 2500);
    assert.equal(entry.memoryBudgetPlan.reservedOutputTokens, 2048);
    assert.equal(entry.renderedMemoryTokens, 390);
    assert.equal(entry.memoryPlayerLedgerTokens, 130);
    assert.equal(entry.memoryOfficialTokens, 50);
    assert.deepEqual(entry.memoryBlockTokens, {
      stableTokens: 0,
      directTokens: 0,
      playerLedgerTokens: 130,
      officialRecollectionTokens: 50,
      mentionedSnapshotTokens: 0,
      temporalExtraTokens: 0,
      sessionTopicAnchorTokens: 0,
      topicPatchTokens: 77,
      thirdPartyEvidenceTokens: 0
    });
    assert.equal(entry.cacheHitTokens, null, "provider cache usage not reported must remain null");
    assertNoSecrets(entry, "UsageAnalytics read");
    assertNoSecrets(fs.readFileSync(analyticsFile, "utf8"), "UsageAnalytics file");
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

testTraceProjection();
testAnalyticsPersistence();
console.log("VOTC V9.3.6 memory diagnostics: PASS (safe trace projection and persisted analytics whitelist)");
