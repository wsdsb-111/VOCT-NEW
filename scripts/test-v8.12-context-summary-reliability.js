"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveProviderCapabilities, planRequestBudget } = require("../resources/app/out/main/providers/request-budget");
const { validateGenerationOutcome } = require("../resources/app/out/main/providers/generation-outcome");
const { planSummaryRequest } = require("../resources/app/out/main/memory-system/summary-budget-planner");
const { MemoryEngine } = require("../resources/app/out/main/memory-system");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { GenerationManager } = require("../resources/app/out/main/conversation/generation-manager");
const { LLMManager } = require("../resources/app/out/main/provider-service");

async function main() {
  const chat = resolveProviderCapabilities({ instanceId: "chat", providerType: "zhipu", defaultModel: "glm", customContextLength: 12000, customMaxOutputTokens: 3000 }, null, "CHAT");
  const summary = resolveProviderCapabilities({ instanceId: "summary", providerType: "deepseek", defaultModel: "summary", customContextLength: 4000, customMaxOutputTokens: 1000 }, null, "SUMMARY");
  assert.equal(chat.contextWindow, 12000);
  assert.equal(summary.contextWindow, 4000);
  assert.equal(resolveProviderCapabilities({ providerType: "unknown", defaultModel: "x" }).source, "fallback");
  assert.equal(planRequestBudget({ messages: [{ role: "user", content: "x" }], capabilities: summary, requestedOutputTokens: 1000, countTokens: () => 500 }).safe, true);
  assert.equal(planRequestBudget({ messages: [{ role: "user", content: "x" }], capabilities: summary, requestedOutputTokens: 1000, countTokens: () => 3000 }).safe, false);
  assert.equal(validateGenerationOutcome({ finish_reason: "length", content: "partial" }).complete, false);
  assert.equal(validateGenerationOutcome({ finish_reason: "max_tokens", content: "partial" }).complete, false);
  assert.equal(validateGenerationOutcome({ finish_reason: "stop", content: "done" }).complete, true);
  const configs = {
    chat: { instanceId: "chat", providerType: "zhipu", defaultModel: "glm", customContextLength: 12000, customMaxOutputTokens: 3000 },
    summary: { instanceId: "summary", providerType: "deepseek", defaultModel: "summary", customContextLength: 4000, customMaxOutputTokens: 1000 }
  };
  let submitted = null;
  const manager = new LLMManager({
    settingsRepository: { getActiveProviderConfig: () => configs.chat, getSummaryProviderConfig: () => configs.summary,
      getProviderConfigById: id => Object.values(configs).find(config => config.instanceId === id) },
    providerRegistry: { createProvider: () => ({ chatCompletion: async (request, config) => {
      submitted = { request, config };
      return { content: "{}", finish_reason: "stop" };
    } }) },
    usageAnalytics: { record() {} },
    TokenCounter: { calculateTotalTokens: items => items.reduce((sum, item) => sum + String(item.content || "").length / 4, 0), estimateTokens: value => String(value || "").length / 4 },
    PromptBuilder: { prepareSummaryMessages: messages => messages, getSummaryPromptBlocks: () => [] }
  });
  assert.equal((await manager.getProviderCapabilities("CHAT")).contextWindow, 12000);
  const summaryCapabilities = await manager.getProviderCapabilities("SUMMARY");
  assert.equal(summaryCapabilities.contextWindow, 4000, "summary route must not inherit chat context");
  await manager.sendSummaryRequest([{ role: "user", content: "short" }], undefined, { requestType: "final_summary", maxTokens: 768, providerSnapshot: summaryCapabilities });
  assert.equal(submitted.config.instanceId, "summary");
  assert.equal(submitted.request.max_tokens, 768);
  configs.summary = { ...configs.summary, defaultModel: "different" };
  await assert.rejects(manager.sendSummaryRequest([{ role: "user", content: "short" }], undefined, { requestType: "final_summary", providerSnapshot: summaryCapabilities }), /summary_provider_snapshot_unavailable/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-context-summary-"));
  try {
    const engine = new MemoryEngine({ baseDir: root, trace: { record() {} } });
    const participants = [1, 2, 3].map(id => ({ id, name: `P${id}` }));
    const participantPresence = [
      { characterId: 1, joinedAtMessageId: 1, leftAtMessageId: null },
      { characterId: 2, joinedAtMessageId: 1, leftAtMessageId: 9 },
      { characterId: 3, joinedAtMessageId: 9, leftAtMessageId: null }
    ];
    const messages = Array.from({ length: 16 }, (_, index) => ({ id: index + 1, role: index % 2 ? "assistant" : "user", name: index < 8 ? "P2" : "P3", content: `第${index + 1}句：已经确认的具体会谈内容。` }));
    const context = engine.prepareFinalizationContext({ conversationId: "reliable", participants, participantPresence, messages, preferChunkedSummary: true,
      getSummaryCapabilities: async () => summary,
      buildPrompt: chunk => engine.buildFinalizationPrompt(chunk),
      requestSummary: async prompt => {
        const allowed = JSON.parse(prompt.at(-1).content.match(/allowed messageIds are (\[[^\]]+\])/)[1]);
        return { finish_reason: "stop", content: JSON.stringify({ summarySegments: [{ content: "有具体细节的会谈摘要", participants: [1], messageIds: allowed }], memories: [] }) };
      }
    });
    const whole = planSummaryRequest({ prompt: context.buildPrompt(context), context, capabilities: summary, countTokens: list => list.reduce((count, item) => count + String(item.content || "").length / 2, 0) });
    assert.equal(whole.wholeRequestSafe, false, "large source must split before any whole provider call");
    let firstChunkCalls = 0;
    let failuresRemaining = 2;
    const originalRequest = context.requestSummary;
    context.requestSummary = async (prompt, options) => {
      const ids = JSON.parse(prompt.at(-1).content.match(/allowed messageIds are (\[[^\]]+\])/)[1]);
      if (ids.includes(1)) firstChunkCalls++;
      if (ids.includes(9) && failuresRemaining > 0) { failuresRemaining--; throw new Error("fixture_network_failure"); }
      return originalRequest(prompt, options);
    };
    await assert.rejects(engine.requestFinalSummary(context), /fixture_network_failure/);
    assert.ok(context.summaryChunkState?.outputs?.[0], "completed chunk must be checkpointed before a later failure");
    const snapshotPath = path.join(root, "recovery", "conversation_reliable.json");
    assert.ok(fs.existsSync(snapshotPath));
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    assert.ok(snapshot.summaryChunkState?.outputs?.[0]);
    Conversation.configure({ memoryEngine: engine, PromptBuilder: { getFinalSummaryInstructions: () => "玩家摘要重点", getFinalSummaryMaxTokens: () => 8192 } });
    const activeConversation = Object.create(Conversation.prototype);
    activeConversation.getHistory = () => messages;
    activeConversation.buildFinalizationBaseContext = () => ({ conversationId: "active-checkpoint", participants, participantPresence, messages });
    const activeSnapshotPath = activeConversation.checkpointFinalization();
    const activeSnapshot = JSON.parse(fs.readFileSync(activeSnapshotPath, "utf8"));
    assert.equal(activeSnapshot.summaryOutputLimit, 8192, "active checkpoint must retain the player's per-request summary ceiling");
    assert.equal(activeSnapshot.finalInstructions, "玩家摘要重点");
    const beforeResume = firstChunkCalls;
    const resumed = await engine.requestFinalSummary({ ...context, summaryChunkState: snapshot.summaryChunkState });
    assert.equal(firstChunkCalls, beforeResume, "resume must not call provider again for a completed chunk");
    assert.equal(engine.evaluateFinalSummaryQuality(context, engine.extractor.parseOutput(resumed, context)).success, true);

    const longMessages = Array.from({ length: 48 }, (_, index) => ({ id: index + 1, role: "user", name: "P1", content: `第${index + 1}句：这是需要保留的详细事件与决定。`.repeat(3) }));
    let wholeRequests = 0;
    const preflightContext = { ...context, conversationId: "preflight", finalizationId: null, messages: longMessages, participantPresence: [], preferChunkedSummary: false,
      requestSummary: async prompt => {
        const ids = JSON.parse(prompt.at(-1).content.match(/allowed messageIds are (\[[^\]]+\])/)[1]);
        if (ids.length === longMessages.length) wholeRequests++;
        return { finish_reason: "stop", content: JSON.stringify({ summarySegments: [{ content: "保留全部具体事件", participants: [1], messageIds: ids }], memories: [] }) };
      }
    };
    assert.ok((await engine.requestFinalSummary(preflightContext)).includes("保留全部具体事件"));
    assert.equal(wholeRequests, 0, "unsafe whole summary must be partitioned before the first provider request");
    let lowOutputCalls = 0;
    const lowOutputContext = { ...preflightContext, conversationId: "low-output", messages: longMessages.slice(0, 12), participants: [participants[0]],
      getSummaryCapabilities: async () => ({ ...summary, maxOutputTokens: 512 }),
      requestSummary: async prompt => {
        lowOutputCalls++;
        const ids = JSON.parse(prompt.at(-1).content.match(/allowed messageIds are (\[[^\]]+\])/)[1]);
        assert.ok(ids.length < 12, "low output route cannot request the whole dialogue");
        return { finish_reason: "stop", content: JSON.stringify({ summarySegments: [{ content: "低输出模型也保留事件", participants: [1], messageIds: ids }], memories: [] }) };
      }
    };
    assert.ok((await engine.requestFinalSummary(lowOutputContext)).includes("低输出模型也保留事件"));
    assert.ok(lowOutputCalls > 1);

    const state = engine.rolling.createState();
    const history = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, role: "user", content: `message ${index + 1}` }));
    const checkpoint = () => engine.rolling.checkpoint({ state, history, tokensToSummarize: 8, estimateMessageTokens: () => 1,
      buildPrompt: batch => batch, requestSummary: async batch => ({ content: `summary ${batch[0].id}-${batch.at(-1).id}`, finish_reason: "stop" }), participantPresence, minRecentRawMessages: 6 });
    assert.equal((await checkpoint()).committed, true);
    assert.equal((await checkpoint()).committed, true);
    assert.equal(state.cacheEpoch, 2);
    assert.equal(state.committedThroughHistoryIndex, 14);
    const rejectedRolling = await engine.rolling.checkpoint({ state, history, tokensToSummarize: 1, estimateMessageTokens: () => 1,
      buildPrompt: batch => batch, requestSummary: async () => ({ content: "partial", finish_reason: "max_tokens" }), participantPresence, minRecentRawMessages: 5 });
    assert.equal(rejectedRolling.committed, false);
    assert.equal(state.committedThroughHistoryIndex, 14, "truncated rolling output cannot advance the history cursor");
    const conversation = Object.create(Conversation.prototype);
    Object.assign(conversation, { id: "presence", messages: history, presenceInitialized: true, memoryState: { rollingState: state, participantPresence }, lastSummarizedMessageIndex: 14, currentSummary: state.currentSummary });
    Conversation.configure({ memoryEngine: engine });
    assert.ok(conversation.getPromptSummaryForCharacter(2).includes("summary 1-8"));
    assert.ok(!conversation.getPromptSummaryForCharacter(2).includes("summary 9-14"));
    assert.ok(conversation.getPromptSummaryForCharacter(3).includes("summary 9-14"));
    assert.ok(!conversation.getPromptSummaryForCharacter(3).includes("summary 1-8"));
    assert.deepEqual(conversation.getPromptHistoryForCharacter(2), []);
    assert.equal(conversation.getPromptHistoryForCharacter(3).length, 6);
    conversation.messages.push({ id: 21, role: "assistant", content: "partial", isStreaming: true });
    assert.equal(conversation.getHistory().length, 20, "partial response cannot enter Memory or Prompt history");

    const responses = [
      { content: "你好，", finish_reason: "length" },
      { content: "世界。", finish_reason: "stop" },
      { content: "未完", finish_reason: "length" },
      { content: "仍未完", finish_reason: "length" }
    ];
    let streamEnabled = false;
    Conversation.configure({
      settingsRepository: { getActiveProviderConfig: () => ({ providerType: "test" }), getGlobalStreamSetting: () => streamEnabled },
      llmManager: { sendChatRequest: async () => responses.shift() },
      PromptBuilder: { buildMessagesWithTokenCount: () => ({ messages: [{ role: "system", content: "test" }], blocks: [] }) },
      usageAnalytics: { record() {} },
      createMessage: message => ({ type: "message", ...message }),
      createError: error => ({ type: "error", ...error }),
      createPromptFingerprint: () => "fixture",
      logVerboseLLM: () => {}
    });
    const npc = { id: 2, fullName: "甲", shortName: "甲" };
    const createChat = () => {
      const chat = Object.create(Conversation.prototype);
      Object.assign(chat, { id: "chat", messages: [], nextId: 1, turnEpoch: 1, activeResponse: null, currentStreamController: null,
        npcQueue: [], inactiveParticipantIds: new Map(), gameData: { characters: new Map(), mentionedCharactersInContext: new Set() },
        emitUpdate() {}, checkAndSummarizeIfNeeded: async () => ({}), getPromptHistoryForCharacter: () => [], getPromptSummaryForCharacter: () => "",
        estimateTokenCount: () => 1, actionEvaluations: [], evaluateCompletedActions: async function (_npc, _id, message) { this.actionEvaluations.push(message.content); } });
      chat.generationManager = new GenerationManager(chat, { recordSkipped() {} });
      return chat;
    };
    const completeChat = createChat();
    await completeChat.respondAs(npc);
    assert.deepEqual(completeChat.actionEvaluations, ["你好，世界。"], "Action must wait for a complete continuation");
    assert.equal(completeChat.getHistory()[0].content, "你好，世界。");
    const failedChat = createChat();
    await failedChat.respondAs(npc);
    assert.deepEqual(failedChat.actionEvaluations, [], "a second length response cannot trigger Action");
    assert.equal(failedChat.getHistory().length, 0, "failed continuation cannot enter Memory history");
    assert.ok(failedChat.messages.some((entry) => entry.type === "error" && entry.details === "chat_continuation_incomplete"), "failed continuation must surface a specific failure");
    streamEnabled = true;
    responses.push((async function* () { yield { delta: { content: "前段" } }; return { content: "前段", finish_reason: "length" }; })(),
      { content: "后段", finish_reason: "stop" });
    const streamedChat = createChat();
    await streamedChat.respondAs(npc);
    assert.deepEqual(streamedChat.actionEvaluations, ["前段后段"], "stream terminal length must also defer Action until continuation completes");
    assert.equal(streamedChat.getHistory()[0].content, "前段后段");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("V8.12 context-summary reliability: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
