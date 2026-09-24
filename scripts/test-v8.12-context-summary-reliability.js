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
  assert.equal(planSummaryRequest({ prompt: [{ role: "user", content: "x" }], context: { messages: [{ content: "x" }] }, capabilities: summary, countTokens: () => 10 }).reservedOutputTokens, summary.maxOutputTokens,
    "structured summaries reserve the configured output ceiling instead of clipping the model to the estimated narrative size");
  const constrainedMessages = [{ content: "small source" }];
  const constrainedBudget = planSummaryRequest({ prompt: [{ role: "user", content: "larger prompt" }], context: { messages: constrainedMessages },
    capabilities: { contextWindow: 4000, maxOutputTokens: 3500 }, countTokens: items => items === constrainedMessages ? 100 : 2500 });
  assert.equal(constrainedBudget.safe, true, "a tight context may reduce the output reservation only enough to fit the request");
  assert(constrainedBudget.reservedOutputTokens > 256 && constrainedBudget.reservedOutputTokens < 3500);
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
    const outputBudgetContext = engine.prepareFinalizationContext({ conversationId: "output-budget", participants: [{ id: 1, name: "P1" }, { id: 2, name: "P2" }],
      messages: [{ id: 1, role: "user", name: "P1", content: "双方讨论了具体安排并确认执行次序。" }, { id: 2, role: "assistant", name: "P2", content: "我认可此安排，并承担约定的后续事务。" }],
      participantPresence: [], getSummaryCapabilities: async () => summary,
      buildPrompt: context => engine.buildFinalizationPrompt(context), requestSummary: async (prompt, options) => {
        assert.equal(options.maxTokens, summary.maxOutputTokens, "the provider receives its configured summary output budget");
        const allowedIds = JSON.parse(prompt.at(-1).content.match(/allowed messageIds are (\[[^\]]+\])/)[1]);
        return { finish_reason: "stop", content: JSON.stringify({ summarySegments: [{ content: "双方核对了安排，确认执行次序并约定由P2承担后续事务。", participants: [1, 2], messageIds: allowedIds }], memories: [] }) };
      }
    });
    assert.ok((await engine.requestFinalSummary(outputBudgetContext)).includes("确认执行次序"));

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

    let rightLeafFailures = 2;
    const nestedCalls = [];
    const nestedParticipants = [participants[0], participants[1]];
    const nestedMessages = Array.from({ length: 16 }, (_, index) => ({ id: index + 1, role: "user", name: "P1", content: `第${index + 1}条需要完整记录的谈话事实。` }));
    const nestedContext = engine.prepareFinalizationContext({ conversationId: "nested-resume", participants: nestedParticipants,
      participantPresence: nestedParticipants.map(participant => ({ characterId: participant.id, joinedAtMessageId: 1, leftAtMessageId: null })),
      messages: nestedMessages, preferChunkedSummary: true, getSummaryCapabilities: async () => summary,
      buildPrompt: chunk => engine.buildFinalizationPrompt(chunk), requestSummary: async prompt => {
        const ids = JSON.parse(prompt.at(-1).content.match(/allowed messageIds are (\[[^\]]+\])/)[1]);
        nestedCalls.push(ids);
        if (ids.length > 4) return { finish_reason: "length", content: "partial" };
        if (ids.includes(9) && rightLeafFailures > 0) { rightLeafFailures--; throw new Error("fixture_network_failure"); }
        return { finish_reason: "stop", content: JSON.stringify({ summarySegments: [{ content: `保留第${ids[0]}至${ids.at(-1)}条事实`, participants: [1, 2], messageIds: ids }], memories: [] }) };
      }
    });
    await assert.rejects(engine.requestFinalSummary(nestedContext), /fixture_network_failure/);
    const nestedSnapshot = JSON.parse(fs.readFileSync(path.join(root, "recovery", "conversation_nested-resume.json"), "utf8"));
    assert(nestedSnapshot.summaryChunkState.splits["0"], "failed recursive chunk stores its split decision");
    assert(nestedSnapshot.summaryChunkState.outputs["0.0"], "successful nested leaves are checkpointed immediately");
    const completedLeftCalls = nestedCalls.filter(ids => ids.at(-1) <= 8).length;
    const nestedOutput = await engine.requestFinalSummary({ ...nestedContext, summaryChunkState: nestedSnapshot.summaryChunkState });
    assert(nestedOutput.includes("保留第9至12条事实"));
    assert.equal(nestedCalls.filter(ids => ids.at(-1) <= 8).length, completedLeftCalls, "retry reuses completed nested leaves instead of regenerating them");

    const repairEngine = new MemoryEngine({ baseDir: path.join(root, "coverage-repair"), trace: { record() {} } });
    repairEngine.partitionSummaryMessages = chunk => chunk.messages.length === 8
      ? [chunk.messages.slice(0, 4), chunk.messages.slice(4)]
      : [chunk.messages.slice(0, 3), chunk.messages.slice(3)].filter(messages => messages.length > 0);
    const repairContext = repairEngine.prepareFinalizationContext({ conversationId: "coverage-repair", participants: [participants[0]],
      messages: Array.from({ length: 8 }, (_, index) => ({ id: index + 1, role: "user", name: "P1", content: `第${index + 1}条有具体细节的谈话事实。` })),
      participantPresence: [], getSummaryCapabilities: async () => summary,
      buildPrompt: chunk => repairEngine.buildFinalizationPrompt(chunk), requestSummary: async prompt => {
        const ids = JSON.parse(prompt.at(-1).content.match(/allowed messageIds are (\[[^\]]+\])/)[1]);
        const coveredIds = ids.length === 4 ? ids.slice(0, 1) : ids;
        return { finish_reason: "stop", content: JSON.stringify({ summarySegments: [{ content: `保留消息${coveredIds.join("、")}的事实`, participants: [1], messageIds: coveredIds }], memories: [] }) };
      }
    });
    const repaired = repairEngine.extractor.parseOutput(await repairEngine.requestChunkedSummary(repairContext, summary), repairContext);
    assert.deepEqual([...new Set(repaired.summarySegments.flatMap(segment => segment.provenance.messageIds))].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert(repairContext.summaryChunkState.outputs["repair.0"] && repairContext.summaryChunkState.outputs["repair.1"],
      "each coverage-repair chunk needs a distinct resumable checkpoint key");
    const smallGapContext = repairEngine.prepareFinalizationContext({ ...repairContext, conversationId: "small-coverage-gap",
      requestSummary: async prompt => {
        const ids = JSON.parse(prompt.at(-1).content.match(/allowed messageIds are (\[[^\]]+\])/)[1]);
        const coveredIds = ids.length === 4 ? ids.slice(0, 3) : ids;
        return { finish_reason: "stop", content: JSON.stringify({ summarySegments: [{ content: `保留消息${coveredIds.join("、")}的事实`, participants: [1], messageIds: coveredIds }], memories: [] }) };
      }
    });
    const smallGap = repairEngine.extractor.parseOutput(await repairEngine.requestChunkedSummary(smallGapContext, summary), smallGapContext);
    assert.deepEqual([...new Set(smallGap.summarySegments.flatMap(segment => segment.provenance.messageIds))].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8],
      "even one or two substantive omissions must be repaired");
    let rootChunkCalls = 0;
    let firstRepairCalls = 0;
    let failedRepairOnce = false;
    const resumableRepairContext = repairEngine.prepareFinalizationContext({ ...repairContext, conversationId: "resumable-coverage-repair",
      requestSummary: async prompt => {
        const ids = JSON.parse(prompt.at(-1).content.match(/allowed messageIds are (\[[^\]]+\])/)[1]);
        let coveredIds = ids;
        if (ids.length === 4) { rootChunkCalls++; coveredIds = ids.slice(0, 1); }
        if (ids[0] === 2) firstRepairCalls++;
        if (ids[0] === 6 && !failedRepairOnce) { failedRepairOnce = true; coveredIds = ids.slice(0, 1); }
        return { finish_reason: "stop", content: JSON.stringify({ summarySegments: [{ content: `保留消息${coveredIds.join("、")}的事实`, participants: [1], messageIds: coveredIds }], memories: [] }) };
      }
    });
    await assert.rejects(repairEngine.requestChunkedSummary(resumableRepairContext, summary), /summary_coverage_repair_failed/);
    assert(resumableRepairContext.summaryChunkState.outputs["repair.0"]);
    assert.equal(resumableRepairContext.summaryChunkState.outputs["repair.1"], undefined, "incomplete repair output cannot be checkpointed as successful");
    const resumedRepair = repairEngine.extractor.parseOutput(await repairEngine.requestChunkedSummary(resumableRepairContext, summary), resumableRepairContext);
    assert.deepEqual([...new Set(resumedRepair.summarySegments.flatMap(segment => segment.provenance.messageIds))].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(rootChunkCalls, 2, "resuming a failed repair must reuse the completed root chunks");
    assert.equal(firstRepairCalls, 1, "resuming a failed repair must reuse earlier successful repair chunks");

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

    for (const scenario of [
      { conversationId: "four-person-final-summary", participantCount: 4, messageCount: 36 },
      { conversationId: "multi-round-two-person-final-summary", participantCount: 2, messageCount: 64 }
    ]) {
      const scenarioEngine = new MemoryEngine({ baseDir: path.join(root, scenario.conversationId), trace: { record() {} } });
      const scenarioParticipants = Array.from({ length: scenario.participantCount }, (_, index) => ({ id: index + 1, name: `角色${index + 1}` }));
      const scenarioMessages = Array.from({ length: scenario.messageCount }, (_, index) => ({
        id: index + 1, role: index % 2 ? "assistant" : "user", name: scenarioParticipants[index % scenarioParticipants.length].name,
        speakerCharacterId: scenarioParticipants[index % scenarioParticipants.length].id,
        content: `第${index + 1}轮：双方确认具体事件、人物立场与后续安排。`
      }));
      let scenarioCalls = 0;
      const result = await scenarioEngine.finalizeConversation({
        conversationId: scenario.conversationId, participants: scenarioParticipants,
        participantPresence: scenarioParticipants.map(participant => ({ characterId: participant.id, joinedAtMessageId: 1, leftAtMessageId: null })),
        messages: scenarioMessages, getSummaryCapabilities: async () => ({ ...summary, contextWindow: 90000, maxOutputTokens: 4096 }),
        buildPrompt: context => scenarioEngine.buildFinalizationPrompt(context),
        requestSummary: async (prompt, options) => {
          scenarioCalls++;
          assert.equal(options.maxTokens, 4096, "every chunk uses the complete configured output ceiling");
          const allowedIds = JSON.parse(prompt.at(-1).content.match(/allowed messageIds are (\[[^\]]+\])/)[1]);
          const participantIds = JSON.parse(prompt.at(-1).content.match(/allowed participant\/speaker IDs are (\[[^\]]+\])/)[1]);
          return { finish_reason: "stop", content: JSON.stringify({ summarySegments: [{
            content: `完整保留第${allowedIds[0]}至${allowedIds.at(-1)}轮的交谈过程、立场和约定。`,
            participants: participantIds, messageIds: allowedIds, speakerIds: []
          }], memories: [] }) };
        },
        persistCharacterFolders: async () => ({ success: true })
      });
      assert.equal(result.success, true, `${scenario.conversationId} must produce and commit a structured summary`);
      assert(scenarioCalls > 0 && scenarioCalls <= 64, "group and multi-round summaries stay within the provider-call hard limit");
      assert.equal(scenarioEngine.store.listAllEpisodes().length, 1);
      assert.equal(result.extraction.summarySegments.flatMap(segment => segment.provenance.messageIds).length, scenario.messageCount);
    }

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
