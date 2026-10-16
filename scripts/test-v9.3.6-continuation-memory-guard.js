"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { Conversation } = require("../src/app/main/conversation/conversation");
const { ConversationTurnManager } = require("../src/app/main/conversation/conversation-turn-manager");
const { LLMManager, ProviderRegistry, TokenCounter } = require("../src/app/main/provider-service");

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex").slice(0, 16);
}

function makePromptBuilder() {
  const memoryText = "V936_PLAYER_MEMORY_SOURCE_FACT";
  const promptText = "V936_CURRENT_PROMPT";
  const messages = [
    { role: "system", content: memoryText },
    { role: "user", content: promptText }
  ];
  const blocks = [
    {
      block: { id: "memory-player-ledger-frozen", type: "memory_player_ledger_frozen" },
      content: memoryText,
      tokens: TokenCounter.estimateTokens(memoryText)
    },
    {
      block: { id: "history", type: "history" },
      content: `user: ${promptText}`,
      tokens: TokenCounter.estimateMessageTokens(messages[1])
    }
  ];
  return {
    buildMessagesWithTokenCount: () => ({ messages, blocks }),
    getMemoryBlockTokenCount: promptBuild => promptBuild.blocks.reduce((total, entry) => {
      if (entry.block.id !== "memory-player-ledger-frozen") return total;
      return total + Math.max(Number(entry.tokens) || 0,
        TokenCounter.estimateMessageTokens({ role: "system", content: entry.content })) + 8;
    }, 0)
  };
}

function createRun({ sourceChangesAfterInitial = false, partialContent = "V936_PARTIAL_REPLY", contextWindow = 2048,
  streamInitial = false } = {}) {
  const providerConfig = {
    providerType: "v936-continuation-memory-fixture",
    customName: "V936 Continuation Fixture",
    defaultModel: "v936-continuation-model",
    apiKey: "fixture-only",
    customContextLength: contextWindow,
    customMaxOutputTokens: 128,
    defaultParameters: {}
  };
  const state = { sourceValid: true, validationCalls: 0 };
  const stats = { providerEntries: 0, transports: 0, beforeSendCalls: 0, requests: [] };
  class FixtureProvider {
    async chatCompletion(request, _config, control) {
      stats.providerEntries += 1;
      control.beforeSend();
      stats.transports += 1;
      stats.requests.push(request);
      if (stats.transports === 1) {
        if (sourceChangesAfterInitial) state.sourceValid = false;
        if (request.stream) return (async function* streamLengthResponse() {
          yield { delta: { content: partialContent } };
          return { content: partialContent, finish_reason: "length" };
        })();
        return { content: partialContent, finish_reason: "length" };
      }
      return { content: "V936_COMPLETION_SUFFIX", finish_reason: "stop" };
    }
  }
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(providerConfig.providerType, FixtureProvider);
  const settingsRepository = {
    getActiveProviderConfig: () => providerConfig,
    getGlobalStreamSetting: () => streamInitial,
    getChatPromptV813Layout: () => false,
    getChatPromptV89Settings: () => ({ chatPromptV89OutboundDiagnostics: false })
  };
  const manager = new LLMManager({
    settingsRepository,
    providerRegistry,
    usageAnalytics: { record() {} },
    TokenCounter,
    PromptBuilder: {}
  });
  const sentMetadata = [];
  const llmManager = {
    sendChatRequest(messages, signal, noStream, metadata) {
      sentMetadata.push(metadata);
      return manager.sendChatRequest(messages, signal, noStream, metadata);
    }
  };
  const memoryEngine = {
    validatePlayerMemoryContext() {
      state.validationCalls += 1;
      return state.sourceValid ? { valid: true } : { valid: false, reason: "FORGET" };
    },
    trace: { record() {} }
  };
  const memoryContext = {
    playerCenteredRecallEnabled: true,
    tokenBudget: 256,
    memoryBudgetPlan: { memoryBudgetTokens: 256, providerHeadroomTokens: 512 },
    sourceCampaignToken: "v936-fixture-campaign",
    sourceFolderRevision: 5,
    sourcePairIds: [1],
    playerAnchorId: 1,
    baselineSnapshotId: "v936-fixture-baseline",
    budgetPolicyRevision: "v9.3.6",
    conversationId: "v936-continuation-conversation"
  };
  const npc = { id: 2, shortName: "NPC-B", fullName: "NPC-B" };
  const responseState = { controller: new AbortController(), stale: false };
  const generationManager = {
    start: () => responseState,
    isCurrent: () => true,
    markPhase() {},
    fail() {},
    finish() {}
  };
  const chat = Object.create(Conversation.prototype);
  Object.assign(chat, {
    id: memoryContext.conversationId,
    nextId: 1,
    turnEpoch: 1,
    messages: [],
    generationAttemptsByMessageId: new Map(),
    memoryAttemptDiagnosticsByOwner: new Map(),
    generationManager,
    gameData: {
      scene: "V936_SCENE",
      characters: new Map([[2, npc]]),
      mentionedCharactersInContext: new Set()
    },
    npcQueue: [],
    inactiveParticipantIds: new Map(),
    cacheV2FrozenSnapshots: { prefixByResponder: new Map() },
    memoryState: { rollingState: { segments: [], cacheEpoch: 0 } },
    checkAndSummarizeIfNeeded: async () => memoryContext,
    getPromptHistoryForCharacter: () => [{ role: "user", content: "V936_CURRENT_PROMPT" }],
    getPromptSummaryForCharacter: () => "",
    estimateTokenCount: messages => TokenCounter.calculateTotalTokens(messages),
    isCharacterAvailableForConversation: () => true,
    isResponseCurrent: () => true,
    emitUpdate() {},
    evaluateCompletedActions: async () => {},
    retainDynamicSummaryRecall() {},
    recordGenerationSkipped() {},
    pauseConversation() {}
  });

  chat.turnManager = new ConversationTurnManager(chat);
  Conversation.configure({
    settingsRepository,
    llmManager,
    PromptBuilder: makePromptBuilder(),
    TokenCounter,
    memoryEngine,
    createPromptFingerprint: fingerprint,
    createMessage: message => ({ type: "message", ...message }),
    createError: error => ({ type: "error", ...error }),
    usageAnalytics: { record() {} },
    logVerboseLLM: () => {}
  });
  return { chat, npc, stats, sentMetadata, state, memoryContext };
}

async function withBlockedNetwork(operation) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("unexpected_network_access"); };
  try {
    return await operation();
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  }
}

async function testForgetStopsContinuationBeforeSecondTransport() {
  const run = createRun({ sourceChangesAfterInitial: true });
  await run.chat.respondAs(run.npc);
  assert.equal(run.stats.transports, 1,
    "the initial truncated response may send, but a Forget/source mutation must block continuation transport");
  assert.equal(run.stats.providerEntries, 2,
    "the continuation reaches the synthetic provider wrapper but its beforeSend guard must reject before transport");
  assert.equal(run.sentMetadata.length, 2);
  const [initial, continuation] = run.sentMetadata;
  assert.equal(initial.requestType, "chat");
  assert.equal(continuation.requestType, "chat_continuation");
  assert.equal(continuation.memoryBudgetTokens, initial.memoryBudgetTokens);
  assert.equal(continuation.renderedMemoryTokens, initial.renderedMemoryTokens);
  assert.deepEqual(continuation.blocks, initial.blocks,
    "continuation must retain the original memory spans, fingerprints, and budget metadata");
  assert.equal(continuation.beforeSendGuard, initial.beforeSendGuard,
    "continuation must re-use the exact per-turn source/Forget guard closure");
  assert.equal(run.state.validationCalls, 2,
    "the source validator must run before both actual transport attempts");
}

async function testValidContinuationKeepsBudgetAndChecksEveryTransport() {
  const run = createRun();
  await run.chat.respondAs(run.npc);
  assert.equal(run.stats.transports, 2, "a valid initial answer and continuation each use one transport");
  assert.equal(run.sentMetadata.length, 2);
  const [initial, continuation] = run.sentMetadata;
  assert.equal(continuation.requestType, "chat_continuation");
  assert.equal(continuation.beforeSendGuard, initial.beforeSendGuard);
  assert.deepEqual(continuation.blocks, initial.blocks);
  assert.equal(run.state.validationCalls, 2,
    "the same source validator must run before both actual transports");
  assert.equal(run.stats.requests[1].messages.length, run.stats.requests[0].messages.length + 2,
    "the continuation must append the partial assistant and continuation instruction");
  assert.equal(run.stats.requests[1].max_tokens, 128);
}

async function testStreamLengthContinuesWithMemoryGuard() {
  const run = createRun({ streamInitial: true });
  await run.chat.respondAs(run.npc);
  assert.equal(run.stats.transports, 2, "a streamed LENGTH response must continue through one additional transport");
  assert.equal(run.stats.requests[0].stream, true, "the initial request must use the real streaming path");
  assert.equal(run.stats.requests[1].stream, false, "continuation remains a non-streaming request");
  assert.equal(run.sentMetadata.length, 2);
  const [initial, continuation] = run.sentMetadata;
  assert.equal(continuation.requestType, "chat_continuation");
  assert.equal(continuation.memoryBudgetTokens, initial.memoryBudgetTokens);
  assert.equal(continuation.renderedMemoryTokens, initial.renderedMemoryTokens);
  assert.deepEqual(continuation.blocks, initial.blocks,
    "stream continuation must retain the original memory spans and fingerprints");
  assert.equal(continuation.beforeSendGuard, initial.beforeSendGuard,
    "stream continuation must retain the exact per-turn memory guard closure");
  assert.equal(run.state.validationCalls, 2, "source validation must run before each streamed/continuation transport");
}

async function testStreamLengthForgetStopsContinuationTransport() {
  const run = createRun({ streamInitial: true, sourceChangesAfterInitial: true });
  await run.chat.respondAs(run.npc);
  assert.equal(run.stats.requests[0].stream, true, "the initial request must use the real streaming path");
  assert.equal(run.stats.transports, 1, "Forget after streamed LENGTH must block the continuation transport");
  assert.equal(run.stats.providerEntries, 2,
    "the rejected continuation may enter the wrapper but must fail before provider transport");
  assert.equal(run.sentMetadata.length, 2);
  assert.equal(run.sentMetadata[1].requestType, "chat_continuation");
  assert.equal(run.sentMetadata[1].beforeSendGuard, run.sentMetadata[0].beforeSendGuard);
  assert.deepEqual(run.sentMetadata[1].blocks, run.sentMetadata[0].blocks);
  assert.equal(run.state.validationCalls, 2, "Forget must be revalidated before the continuation send");
}

async function testContinuationPartialCannotOverflowContext() {
  const run = createRun({ partialContent: `V936_PARTIAL_${"x".repeat(12000)}` });
  await run.chat.respondAs(run.npc);
  assert.equal(run.stats.transports, 1,
    "the full continuation request must be re-budgeted and rejected before a second transport when partial content overflows");
  assert.equal(run.stats.providerEntries, 1,
    "an over-budget continuation must fail before entering provider transport code");
  assert.equal(run.sentMetadata.length, 2,
    "the continuation call must still carry its memory guard metadata even when preflight rejects it");
  assert.equal(run.sentMetadata[1].requestType, "chat_continuation");
  assert.equal(run.sentMetadata[1].memoryBudgetTokens, run.sentMetadata[0].memoryBudgetTokens);
  assert.deepEqual(run.sentMetadata[1].blocks, run.sentMetadata[0].blocks);
}

async function main() {
  await withBlockedNetwork(async () => {
    await testForgetStopsContinuationBeforeSecondTransport();
    await testValidContinuationKeepsBudgetAndChecksEveryTransport();
    await testStreamLengthContinuesWithMemoryGuard();
    await testStreamLengthForgetStopsContinuationTransport();
    await testContinuationPartialCannotOverflowContext();
  });
  console.log("V9.3.6 continuation memory guard: PASS (Forget, valid resend guard, full-request budget)");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
