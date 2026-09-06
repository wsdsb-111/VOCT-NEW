"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { buildSubjectiveWorldTurnRecall } = require("../resources/app/out/main/worldline/subjective-prompt-context");

async function pressureFixture(baseTokens, remainingWorldTokens, memoryExpected = true) {
  const budgets = [];
  const analytics = [];
  const PromptBuilder = { buildMessages: (_history, _npc, _gameData, _summary, memoryContext) => [{ baseTokens, hasTurn: Boolean(memoryContext?.turnRecallText) }] };
  Conversation.configure({
    memoryEngine: { syncRollingStateFromConversationFields() {}, syncConversationRollingFields() {} },
    llmManager: { getCurrentContextLength: async () => 1000 },
    usageAnalytics: { record: (metadata) => analytics.push(metadata) },
    PromptBuilder,
    TokenCounter: { estimateTokens: (value) => String(value || "").startsWith("stable") ? 20 : String(value || "").length }
  });
  Conversation.configure({ worldlineService: {
    isSubjectivePromptIntegrationEnabled: () => true,
    getSubjectivePromptContext: (request) => {
      budgets.push(request.tokenBudget);
      return { worldStableText: "stable-checkpoint", worldTurnRecallText: request.tokenBudget > 0 ? "w".repeat(request.tokenBudget) : null, worldTurnRecallTokens: request.tokenBudget, worldTurnRecallTrimmed: [], metrics: {} };
    }
  } });
  const fake = {
    gameData: { date: "1170.6.6", scene: "court", historicalReferenceInfo: {}, characters: new Map() },
    presentCharacterIds: new Set(), id: "conversation", turnEpoch: 1, memoryState: {},
    getMemoryContextFor: async () => ({ turnRecallText: "memory-turn", turnRecallTokens: 11, worldlineRequest: {} }),
    getPromptHistoryForCharacter: () => [], getPromptSummaryForCharacter: () => "",
    estimateTokenCount: (messages) => messages[0].hasTurn ? baseTokens : baseTokens - 11,
    canUseSharedRollingSummary: () => false
  };
  const result = await Conversation.prototype.checkAndSummarizeIfNeeded.call(fake, { id: 2 });
  assert.equal(Boolean(result.turnRecallText), memoryExpected, "Memory Turn Recall may be removed only when the Memory-only prompt exceeds the hard limit");
  if (remainingWorldTokens < 20) {
    assert.equal(result.worldStableText, null, "the Stable World anchor must yield when it cannot fit remaining context");
    assert.equal(result.worldTurnRecallText, null);
  } else {
    assert.deepEqual(budgets, [remainingWorldTokens, remainingWorldTokens - 20], "Worldline dynamic recall must be regenerated after reserving the stable anchor");
    assert.equal(result.worldTurnRecallTokens, remainingWorldTokens - 20);
  }
  assert.equal(analytics.some((entry) => entry.memoryOutcome === "skipped_context_pressure"), !memoryExpected, "only a hard Memory-only overflow may be reported as a Memory skip");
  if (!memoryExpected) assert(!result.worldStableText && !result.worldTurnRecallText, "Worldline must remain fully omitted after the last-resort Memory trim");
}

(async () => {
  await pressureFixture(900, 100);
  await pressureFixture(990, 10);
  await pressureFixture(1100, 0, false);
  const facts = [
    { factId: "b", entityId: "2", field: "LOCATION", sourceTier: "GAME_TRUTH", value: "乙在临安" },
    { factId: "a", entityId: "1", field: "LOCATION", sourceTier: "GAME_TRUTH", value: "甲在开封" },
    { factId: "s", entityId: "1", field: "SUPPLEMENTAL", sourceTier: "PLAYER_SUPPLEMENTAL", value: "补充" }
  ];
  assert.equal(buildSubjectiveWorldTurnRecall({ allowedFacts: facts }).text, buildSubjectiveWorldTurnRecall({ allowedFacts: [...facts].reverse() }).text, "Worldline formatting must be deterministic for the same fact set");
  const conversationSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/conversation/conversation.js"), "utf8");
  const analyticsSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/analytics/usage-analytics.js"), "utf8");
  for (const field of ["worldRetrievalMs", "worldPolicyMs", "worldFormatMs", "memoryRecallMs", "promptBuildMs", "memoryTurnRecallTokens", "worldTurnRecallTokens", "worldSharedCacheHit", "worldSubjectiveCacheHit"]) {
    assert(conversationSource.includes(field) && analyticsSource.includes(field), `${field} must reach persisted Provider diagnostics`);
  }
  console.log("V8.6.1 Sol Safety: PASS (Memory-first pressure, stable omission, deterministic format and persisted metrics)");
})().catch((error) => { console.error(error); process.exitCode = 1; });
