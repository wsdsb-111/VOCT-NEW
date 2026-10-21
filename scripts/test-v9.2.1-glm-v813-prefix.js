"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const events = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const Handlebars = require("../resources/app/node_modules/handlebars");
const memorySystem = require("../resources/app/out/main/memory-system");
const { MemoryEngine } = memorySystem;
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { Character } = require("../resources/app/out/main/game-data/character");
const { createPromptBuilder } = require("../resources/app/out/main/prompts/prompt-builder");
const { createPromptConfigManager } = require("../resources/app/out/main/prompts/prompt-config-manager");
const { createTemplateEngine } = require("../resources/app/out/main/prompts/template-engine");
const { PromptScriptLoader } = require("../resources/app/out/main/prompts/prompt-script-loader");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { TokenCounter } = require("../resources/app/out/main/provider-service");
const { ZhipuProvider } = require("../resources/app/out/main/providers");
const { createProviderDiagnostics } = require("../resources/app/out/main/analytics/provider-diagnostics");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");
const { hash } = require("../resources/app/out/main/memory-system/legacy-source-lineage");
const { createProjectionLineage } = require("../resources/app/out/main/memory-system/legacy-source-lineage");

const MODEL = "glm-5.3-flash";
const names = new Map([[1, "玩家"], [2, "甲"], [3, "乙"], [4, "丙"], [99, "九十九郎"]]);
const fixtures = new Set();
let sequence = 0;
let passed = 0;
let failed = 0;

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function buildRequest(messages, overrides = {}) {
  return {
    model: MODEL,
    messages,
    stream: false,
    temperature: 0.7,
    max_tokens: 4096,
    ...overrides
  };
}

async function captureZhipuRequest(request, config) {
  const provider = new ZhipuProvider();
  provider.createOpenAIClient = () => ({});
  let actualRequest = null;
  provider._nonStreamZhipuChatCompletion = async outboundRequest => {
    actualRequest = outboundRequest;
    return { content: "合成测试回复。", finish_reason: "stop" };
  };
  const response = await provider.chatCompletion(request, config);
  assert(actualRequest, "ZhipuProvider must pass a request body to its transport");
  assert.deepStrictEqual(actualRequest, provider.buildDiagnosticRequest(request, config),
    "the captured Zhipu body must match the provider diagnostic serializer");
  return { actualRequest, response, provider };
}

function makeCharacter(id) {
  const name = names.get(id) || ("人物" + id);
  const input = Array(28).fill("");
  input[0] = String(id);
  input[1] = name;
  input[2] = name;
  input[4] = "he";
  input[5] = "30";
  input[6] = "100";
  input[7] = "0";
  input[18] = name;
  const character = new Character(input);
  character.troops = { totalOwnedTroops: 0 };
  return character;
}

function fixtureMainTemplate() {
  return [
    "{{! VOTC_SEGMENT:stable_global }}仅依据本角色合法所知的事实回应。",
    "{{! VOTC_SEGMENT:world_context }}当前时间：{{gameData.date}}。"
  ].join("\n");
}

function createFixture({ campaignToken = "votc-v921-glm-campaign-A", date = "1164.5.20", roster = [1, 2],
  mainTemplate = null } = {}) {
  const directory = fs.mkdtempSync(path.join(__dirname, ".tmp-votc-v921-glm-v813-"));
  const summariesDir = path.join(directory, "summaries");
  const promptsDir = path.resolve(__dirname, "../resources/app/default_userdata/prompts");
  const promptConfigManager = new (createPromptConfigManager({
    fs,
    path,
    promptsDir,
    defaultMainTemplatePath: path.join(promptsDir, "system/default.hbs"),
    defaultLetterTemplatePath: path.join(promptsDir, "system/letter.hbs"),
    defaultChatInstruction: "请依据本轮对话回应。"
  }))();
  const templateEngine = createTemplateEngine({
    Handlebars,
    fs,
    path,
    promptsHelpersDir: path.join(directory, "helpers"),
    defaultPromptsDir: path.resolve(__dirname, "../resources/app/default_userdata"),
    PromptScriptSandbox
  });
  const promptSettings = {
    mainTemplate: mainTemplate || fixtureMainTemplate(),
    blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "请回应本轮对话。" }
    ]
  };
  const providerConfig = {
    providerType: "zhipu",
    apiKey: "synthetic-fixture-key",
    baseUrl: "https://example.invalid/api/paas/v4",
    defaultModel: MODEL,
    defaultParameters: { temperature: 0.7, max_tokens: 4096 },
    glmReasoningEffort: "low",
    glmClearThinking: true
  };
  const scope = { campaignToken, ownerId: 2 };
  const sample = {
    directory,
    summariesDir,
    scope,
    providerConfig,
    promptSettings,
    requests: [],
    reply: () => "我会依据当前可见事实谨慎回应。"
  };
  sample.settings = {
    getCK3DebugLogPath: () => path.join(directory, "fixture-debug.log"),
    getPromptSettings: () => promptSettings,
    getLetterPromptSettings: () => ({
      blocks: promptConfigManager.getDefaultLetterBlocks(),
      mainTemplate: fs.readFileSync(path.join(promptsDir, "system/letter.hbs"), "utf8")
    }),
    getSummaryPromptSettings: () => ({ finalPrompt: "保留来源、人物和知情边界。", finalSummaryMaxTokens: 4096 }),
    getActiveProviderConfig: () => providerConfig,
    getChatPromptV813Layout: () => true,
    getChatPromptV89Settings: () => ({
      chatPromptV89Layout: true,
      chatPromptV89RuntimeProfileSplit: true,
      chatPromptV810ProviderAdapter: true,
      chatPromptV89OutboundDiagnostics: true
    }),
    getGlobalStreamSetting: () => false,
    getActionApprovalSettings: () => ({ pauseOnApproval: false })
  };
  sample.PromptBuilder = createPromptBuilder({
    TemplateEngine: templateEngine,
    PromptScriptLoader,
    promptConfigManager,
    settingsRepository: sample.settings,
    path,
    TokenCounter,
    createPromptFingerprint: fingerprint,
    defaultChatInstruction: "请依据本轮对话回应。"
  });
  const buildMessagesWithTokenCount = sample.PromptBuilder.buildMessagesWithTokenCount.bind(sample.PromptBuilder);
  sample.PromptBuilder.buildMessagesWithTokenCount = (...args) => buildMessagesWithTokenCount(
    ...args.slice(0, 6), { ...(args[6] || {}), promptPlanMode: "legacy" }
  );
  sample.engine = new MemoryEngine({
    baseDir: path.join(directory, "memory"),
    summaryFoldersDir: summariesDir,
    trace: { record() {} }
  });

  sample.worldline = {
    isSubjectivePromptIntegrationEnabled: () => false,
    isPromptIntegrationEnabled: () => false,
    getSettings: () => ({ v812MemoryEngine3Enabled: true, v812TemporalSummaryRecallEnabled: true }),
    getPromptContext: async () => null
  };
  sample.diagnostics = new (createProviderDiagnostics({
    fs,
    path,
    dataDir: directory,
    diagnosticsFile: path.join(directory, "provider-diagnostics.jsonl"),
    settingsRepository: sample.settings,
    providerRegistry: {},
    TokenCounter
  }))();
  sample.createGameData = (currentDate = date, currentRoster = roster) => {
    const serial = normalizeGameDate(currentDate)?.serial;
    const data = new (createGameData({
      fs,
      path,
      memorySystem,
      memoryEngine: sample.engine,
      summariesDir,
      getHistoricalReferenceByYear: () => null
    }))(["1", "玩家", "2", "甲", currentDate, "conversationcourt", "临安", "玩家", String(serial)]);
    data.campaignToken = scope.campaignToken;
    for (const id of currentRoster) data.characters.set(id, makeCharacter(id));
    data.characters.set(99, makeCharacter(99));
    for (const character of data.characters.values()) {
      fs.mkdirSync(data.getCharacterFolderPath(character.id, character.shortName), { recursive: true });
    }
    return data;
  };
  sample.prepareDiagnostic = (request, options, config = providerConfig) => sample.diagnostics.prepareOutboundRequest({
    provider: "zhipu",
    model: request.model,
    requestType: "chat",
    request,
    blocks: options.blocks || [],
    conversationId: options.conversationId || null,
    responderId: options.responderId || null,
    baseUrl: config.baseUrl,
    promptProfile: options.promptProfile || null,
    staticTokens: options.staticTokens,
    dynamicTokens: options.dynamicTokens,
    prefixFingerprint: options.prefixFingerprint,
    globalStaticTokens: options.globalStaticTokens,
    conversationFrozenTokens: options.conversationFrozenTokens,
    responderFrozenTokens: options.responderFrozenTokens,
    stableKinshipTokens: options.stableKinshipTokens,
    actualStablePrefixTokens: options.actualStablePrefixTokens,
    declaredStaticTokens: options.declaredStaticTokens,
    dynamicTailTokens: options.dynamicTailTokens
  });
  sample.capturePrompt = async (messages, options = {}, config = providerConfig) => {
    const request = buildRequest(messages);
    const captured = await captureZhipuRequest(request, config);
    const diagnostic = sample.prepareDiagnostic(captured.actualRequest, options, config);
    const record = {
      messages: captured.actualRequest.messages,
      actualRequest: captured.actualRequest,
      response: captured.response,
      provider: captured.provider,
      options,
      diagnostic
    };
    sample.requests.push(record);
    return record;
  };
  sample.llm = {
    getCurrentContextLength: async () => 65536,
    getProviderCapabilities: async () => ({
      providerType: "zhipu",
      modelId: MODEL,
      contextWindow: 65536,
      maxOutputTokens: 4096
    }),
    sendChatRequest: async (messages, _signal, _callback, options) => {
      const captured = await sample.capturePrompt(messages, options);
      return { ...captured.response, content: sample.reply(options.responderId) };
    },
    sendSummaryRequest: async () => ({
      content: JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [], summarySegments: [], memories: [] }),
      finish_reason: "stop"
    })
  };
  sample.open = async (currentDate = date, currentRoster = roster) => {
    const gameData = sample.createGameData(currentDate, currentRoster);
    sample.gameData = gameData;
    fs.writeFileSync(sample.settings.getCK3DebugLogPath(), "synthetic fixture only", "utf8");
    Conversation.configure({
      memoryEngine: sample.engine,
      settingsRepository: sample.settings,
      parseLog: async () => gameData,
      llmManager: sample.llm,
      PromptBuilder: sample.PromptBuilder,
      TokenCounter,
      createPromptFingerprint: fingerprint,
      runFileManager: {
        isAvailable: () => true,
        write: () => { throw new Error("fixture must not write a RunFile"); }
      },
      createMessage: input => ({ type: "message", ...input }),
      createError: input => ({ type: "error", ...input }),
      ActionEngine: { evaluateForCharacter: async () => ({ autoApproved: [], needsApproval: [] }) },
      usageAnalytics: { record() {} },
      events,
      uuid: { v4: () => "glm-v813-conversation-" + (++sequence) },
      path,
      worldlineService: sample.worldline,
      logVerboseLLM: () => {}
    });
    sample.conversation = new Conversation();
    await sample.conversation.gameDataReady;
    await sample.conversation.worldlinePrefetchPromise;
    await sample.conversation.memoryRecoveryPromise;
    assert(sample.conversation.isActive, "real Conversation initialization must succeed");
    return sample.conversation;
  };
  sample.send = async content => {
    const conversation = sample.conversation;
    await conversation.sendMessage(content);
    const timeout = Date.now() + 10000;
    while (conversation.activeResponse || conversation.npcQueue.length) {
      assert(Date.now() < timeout, "real Conversation response queue stalled");
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(conversation.messages.filter(message => message.type === "error").length, 0);
  };
  sample.buildActualSample = async ({ history = null, responderId = 2, currentDate = null, campaign = null } = {}) => {
    assert(sample.conversation, "open the fixture Conversation before building a sample");
    if (currentDate) {
      sample.gameData.date = currentDate;
      sample.gameData.year = normalizeGameDate(currentDate)?.year ?? sample.gameData.year;
    }
    if (campaign) {
      sample.scope.campaignToken = campaign;
      sample.gameData.campaignToken = campaign;
    }
    const conversation = sample.conversation;
    const character = sample.gameData.characters.get(Number(responderId));
    assert(character, "requested fixture responder must exist in GameData");
    const promptHistory = history || conversation.getPromptHistoryForCharacter(Number(responderId));
    const memoryContext = await conversation.getMemoryContextFor(character, 65536);
    const promptBuild = sample.PromptBuilder.buildMessagesWithTokenCount(
      promptHistory,
      character,
      sample.gameData,
      conversation.getPromptSummaryForCharacter(Number(responderId)),
      memoryContext,
      providerConfig,
      { promptPlanMode: "legacy" }
    );
    const metadata = Conversation.buildPromptBlockMetadata(promptBuild);
    const options = {
      conversationId: conversation.id,
      responderId: Number(responderId),
      blocks: metadata.blocks,
      promptProfile: promptBuild.promptProfile,
      staticTokens: promptBuild.staticTokens,
      dynamicTokens: promptBuild.dynamicTokens,
      globalStaticTokens: promptBuild.globalStaticTokens,
      conversationFrozenTokens: promptBuild.conversationFrozenTokens,
      responderFrozenTokens: promptBuild.responderFrozenTokens,
      stableKinshipTokens: promptBuild.stableKinshipTokens,
      actualStablePrefixTokens: promptBuild.actualStablePrefixTokens,
      declaredStaticTokens: promptBuild.declaredStaticTokens,
      dynamicTailTokens: promptBuild.dynamicTailTokens,
      prefixFingerprint: metadata.prefixFingerprint
    };
    const captured = await sample.capturePrompt(promptBuild.messages, options);
    return { ...captured, promptBuild, memoryContext, metadata };
  };
  sample.commitMemoryFact = ({ text, counterpartId = 1, finalizationId = "glm-v813-finalization",
    conversationId = "glm-v813-source-conversation", segmentId = "glm-v813-summary-segment" } = {}) => {
    const campaign = sample.scope.campaignToken;
    const fragmentId = finalizationId + "-fragment";
    const lineage = createProjectionLineage({
      campaignToken: campaign,
      ownerId: 2,
      counterpartId,
      conversationId,
      finalizationId,
      segmentIds: [segmentId],
      sourceSegmentIds: [fragmentId],
      sourceMessageIds: [10]
    });
    const committed = sample.engine.store.saveMemory({
      type: "information", content: text, canonicalText: text, importance: 0.95,
      participants: [2, Number(counterpartId)], subjects: [Number(counterpartId)], knownBy: [2], visibility: "known_group",
      eventDate: date, totalDays: normalizeGameDate(date)?.serial,
      provenance: { campaignToken: campaign, finalizationId, conversationId, folderOwnerId: 2, counterpartId,
        projectionId: lineage.projectionId, segmentIds: [segmentId] }
    });
    sample.engine.store.markKnownBy(2, committed.memoryId, { awareness: "direct" });
    return {
      lineage,
      summaryRecord: {
        playerId: 2,
        campaignToken: campaign,
        perspectiveOwnerId: 2,
        characterId: Number(counterpartId),
        conversationId,
        finalizationId,
        perspectiveSummarySegmentIds: [segmentId],
        sourceSegmentIds: [fragmentId],
        sourceMessageIds: [10],
        perspectiveMemoryIds: [committed.memoryId],
        projectionId: lineage.projectionId,
        date,
        content: text
      },
      committed
    };
  };
  sample.close = () => {
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
    fixtures.delete(sample);
  };
  fixtures.add(sample);
  return sample;
}

function blockText(record, id) {
  const block = record.options.blocks?.find(entry => entry.id === id);
  if (!block || !Number.isInteger(block.messageStartPosition)) return "";
  return record.actualRequest.messages
    .slice(block.messageStartPosition, block.messageStartPosition + block.messageCount)
    .map(message => String(message.content || ""))
    .join("\n");
}

function cachePrefixBlocks(record) {
  const frozen = new Set(["GLOBAL_STATIC", "CONVERSATION_FROZEN", "RESPONDER_FROZEN"]);
  return (record.options.blocks || []).filter(block => frozen.has(block.lifecycle)).map(block => ({
    id: block.id,
    lifecycle: block.lifecycle,
    messages: record.actualRequest.messages.slice(block.messageStartPosition, block.messageStartPosition + block.messageCount)
  }));
}

function recordUsage(sample, record, { rawUsage, normalizedUsage } = {}) {
  sample.diagnostics.recordResponse({
    provider: "zhipu",
    model: MODEL,
    requestType: "chat",
    response: { finish_reason: "stop", usage_debug: { raw_usage: rawUsage, normalized_usage: normalizedUsage } },
    usage: normalizedUsage,
    metadata: {
      realRequestDiff: record.diagnostic,
      blocks: record.options.blocks,
      messages: record.actualRequest.messages
    }
  });
  return sample.diagnostics.getRecent(1)[0];
}

async function check(name, run) {
  const log = console.log;
  console.log = () => {};
  try {
    await run();
    passed++;
    log("PASS " + name);
  } catch (error) {
    failed++;
    console.error("FAIL " + name + ": " + (error.stack || error.message));
  } finally {
    console.log = log;
  }
}

async function main() {
  try {
    await check("G-01 production GLM configuration selects the real V813 layout", async () => {
      const sample = createFixture();
      await sample.open();
      await sample.send("请依当前所知回应。");
      const record = sample.requests.find(request => request.options.responderId === 2);
      assert(record);
      assert.equal(sample.settings.getChatPromptV813Layout(), true);
      assert.equal(record.options.promptProfile.layoutId, "v813");
      assert.equal(record.diagnostic.promptProfile.layoutId, "v813");
      assert.equal(sample.diagnostics.getStatus().layoutId, "v813");
      assert.equal(record.actualRequest.messages[0].content.includes("VOTC_CACHE_ANCHOR_v8.13"), true);
      assert.equal(record.actualRequest.messages[0].content.includes("VOTC_CACHE_BLOCK_v8.10.2"), false);
      assert.equal(record.actualRequest.reasoning_effort, "low");
      assert.equal(record.actualRequest.thinking.clear_thinking, true);
    });

    await check("G-02 unrelated history append leaves actual global and frozen blocks unchanged", async () => {
      const sample = createFixture();
      await sample.open();
      await sample.send("第一轮只谈公开的城门修缮。");
      const first = sample.requests.filter(request => request.options.responderId === 2).at(-1);
      await sample.send("第二轮继续谈公开的城门修缮。");
      const second = sample.requests.filter(request => request.options.responderId === 2).at(-1);
      assert.deepStrictEqual(cachePrefixBlocks(second), cachePrefixBlocks(first));
      assert.notDeepStrictEqual(second.actualRequest.messages, first.actualRequest.messages);
      assert(second.actualRequest.messages.some(message => String(message.content || "").includes("第二轮继续谈公开的城门修缮")));
      assert.equal(second.diagnostic.stablePrefixUnchanged, true);
    });

    await check("G-03 alternating NPCs never reuse the other responder's frozen profile", async () => {
      const sample = createFixture({ roster: [1, 2, 3] });
      await sample.open();
      const joined = await sample.conversation.joinWaitingCharacter(3);
      assert.equal(joined.success, true, "the second NPC must enter through the Conversation presence API");
      await sample.send("请各自说明自己的姓名。");
      const firstA = sample.requests.find(request => request.options.responderId === 2);
      const firstB = sample.requests.find(request => request.options.responderId === 3);
      assert(firstA && firstB, "both active NPCs must produce captured requests");
      const frozenA = blockText(firstA, "responder-frozen-profile");
      const frozenB = blockText(firstB, "responder-frozen-profile");
      assert(frozenA.includes("姓名：甲"));
      assert(frozenB.includes("姓名：乙"));
      assert.equal(frozenA.includes("姓名：乙"), false);
      assert.equal(frozenB.includes("姓名：甲"), false);
      await sample.send("现在仍请各自介绍自己。");
      const secondA = sample.requests.filter(request => request.options.responderId === 2).at(-1);
      const secondB = sample.requests.filter(request => request.options.responderId === 3).at(-1);
      assert.equal(blockText(secondA, "responder-frozen-profile"), frozenA);
      assert.equal(blockText(secondB, "responder-frozen-profile"), frozenB);
    });

    await check("G-04 campaign change with the same numeric owner cannot leak private memory", async () => {
      const sample = createFixture({ campaignToken: "glm-v813-campaign-A" });
      await sample.open();
      sample.commitMemoryFact({ text: "CAMPAIGN_A_PRIVATE_SENTINEL 只在第一战役中由甲得知。" });
      const history = [{ role: "user", content: "关于北境守门之约，我从前听过什么？" }];
      const campaignA = await sample.buildActualSample({ history, responderId: 2 });
      assert(campaignA.actualRequest.messages.some(message => String(message.content || "").includes("CAMPAIGN_A_PRIVATE_SENTINEL")),
        "the seeded private fact must first traverse the actual Legacy-to-Conversation-to-Provider path");
      const campaignB = await sample.buildActualSample({ history, responderId: 2, campaign: "glm-v813-campaign-B" });
      assert.equal(campaignB.actualRequest.messages.some(message => String(message.content || "").includes("CAMPAIGN_A_PRIVATE_SENTINEL")), false,
        "the same owner and responder in another Campaign must not receive Campaign A memory");
    });

    await check("G-05 real Legacy Forget ledger clears the next actual outgoing Prompt", async () => {
      const sample = createFixture();
      await sample.open();
      const source = sample.commitMemoryFact({
        text: "FORGET_V813_SENTINEL 甲曾听闻北境守门之约。",
        finalizationId: "glm-v813-forget-finalization",
        conversationId: "glm-v813-forget-source"
      });
      const history = [{ role: "user", content: "关于北境守门之约，我从前听过什么？" }];
      const before = await sample.buildActualSample({ history, responderId: 2 });
      assert(before.actualRequest.messages.some(message => String(message.content || "").includes("FORGET_V813_SENTINEL")),
        "the fact must be present before Forget in actual outbound messages");
      const forgotten = sample.engine.forgetSummaryProjection(source.summaryRecord, {
        ownerId: 2,
        counterpartId: 1,
        invalidateConversations: [sample.conversation]
      });
      assert.equal(forgotten.status, "FORGOTTEN");
      assert.equal(sample.engine.store.isSummaryProjectionForgotten(source.summaryRecord, { ownerId: 2, counterpartId: 1 }), true);
      const after = await sample.buildActualSample({ history, responderId: 2 });
      assert.equal(after.actualRequest.messages.some(message => String(message.content || "").includes("FORGET_V813_SENTINEL")), false,
        "a tombstoned fact and its frozen recall prefix must not return on the next request");
    });

    await check("G-06 current date, age, office, wealth, opinion and relationship arrive dynamically", async () => {
      const sample = createFixture({ date: "1164.5.20" });
      await sample.open();
      const character = sample.gameData.characters.get(2);
      character.age = 30;
      character.primaryTitle = "旧封号";
      character.heldCourtAndCouncilPositions = "旧职位";
      character.gold = 100;
      character.opinionOfPlayer = 5;
      character.relationsToPlayer = ["rival"];
      await sample.send("请说明当前日期以及你的年龄、头衔、财富、好感与关系。");
      const oldRecord = sample.requests.filter(request => request.options.responderId === 2).at(-1);
      sample.gameData.date = "1165.1.1";
      sample.gameData.year = 1165;
      character.age = 42;
      character.primaryTitle = "当前封号标记";
      character.heldCourtAndCouncilPositions = "当前职位标记";
      character.gold = 777;
      character.opinionOfPlayer = 91;
      character.relationsToPlayer = ["friend"];
      await sample.send("请再次说明当前日期以及你的年龄、头衔、财富、好感与关系。");
      const current = sample.requests.filter(request => request.options.responderId === 2).at(-1);
      const live = blockText(current, "live-character-state");
      const currentFacts = blockText(current, "responder-game-facts");
      const currentDate = blockText(current, "main-world_context");
      const currentRelationships = blockText(current, "live-relationships");
      const oldLive = blockText(oldRecord, "live-character-state");
      const oldFacts = blockText(oldRecord, "responder-game-facts");
      const oldRelationships = blockText(oldRecord, "live-relationships");
      assert(oldFacts.includes("30岁"));
      assert(oldRelationships.includes("rival"));
      assert(oldLive.includes("100"));
      assert(oldLive.includes("5"));
      assert(oldFacts.includes("旧封号"));
      assert(currentDate.includes("1165.1.1"));
      assert(currentFacts.includes("42岁"));
      assert(currentFacts.includes("当前封号标记"));
      assert(live.includes("777"));
      assert(live.includes("91"));
      assert(live.includes("当前职位标记"));
      assert(currentRelationships.includes("friend"));
      assert.equal(currentRelationships.includes("rival"), false);
      assert.equal(blockText(current, "conversation-frozen").includes("1164.5.20"), true,
        "the opening date remains a labeled frozen snapshot while the current date is supplied separately");
    });

    await check("G-07 reopening the same NPC starts a new conversation snapshot", async () => {
      const sample = createFixture({ date: "1164.5.20" });
      await sample.open();
      await sample.send("第一场会话。");
      const first = sample.requests.filter(request => request.options.responderId === 2).at(-1);
      const oldSnapshots = sample.conversation.cacheV2FrozenSnapshots;
      await sample.open("1166.2.3");
      await sample.send("重新进入后的新会话。");
      const next = sample.requests.filter(request => request.options.responderId === 2).at(-1);
      assert.notStrictEqual(sample.conversation.cacheV2FrozenSnapshots, oldSnapshots);
      assert.deepStrictEqual(cachePrefixBlocks(next).filter(block => block.lifecycle === "GLOBAL_STATIC"),
        cachePrefixBlocks(first).filter(block => block.lifecycle === "GLOBAL_STATIC"));
      assert(blockText(first, "conversation-frozen").includes("1164.5.20"));
      assert(blockText(next, "conversation-frozen").includes("1166.2.3"));
    });

    await check("G-08 dynamic stable_history_rp placeholders are rendered after frozen blocks, not hoisted", async () => {
      const mainTemplate = [
        "{{! VOTC_SEGMENT:stable_global }}固定通用规则。",
        "{{! VOTC_SEGMENT:stable_history_rp }}历史角色规则，当前日期是{{gameData.date}}。",
        "{{! VOTC_SEGMENT:world_context }}动态日期：{{gameData.date}}。"
      ].join("\n");
      const sample = createFixture({ mainTemplate, date: "1164.5.20" });
      await sample.open();
      await sample.send("第一日期请求。");
      const first = sample.requests.filter(request => request.options.responderId === 2).at(-1);
      sample.gameData.date = "1165.1.1";
      sample.gameData.year = 1165;
      await sample.send("第二日期请求。");
      const second = sample.requests.filter(request => request.options.responderId === 2).at(-1);
      const historyIndex = second.actualRequest.messages.findIndex(message => String(message.content || "").includes("历史角色规则"));
      const frozenIndex = second.actualRequest.messages.findIndex(message => String(message.content || "").includes("Responder Frozen Profile v2"));
      assert(historyIndex > frozenIndex, "template-variable history rules must follow the responder-frozen section");
      assert(blockText(first, "main-stable_history_rp").includes("1164.5.20"));
      assert(blockText(second, "main-stable_history_rp").includes("1165.1.1"));
      assert.equal(second.actualRequest.messages.some(message => String(message.content || "").includes("{{gameData.date}}")), false);
      assert.deepStrictEqual(
        cachePrefixBlocks(second).filter(block => block.id !== "main-stable_history_rp"),
        cachePrefixBlocks(first).filter(block => block.id !== "main-stable_history_rp")
      );
    });

    await check("G-09 Unicode, newlines, message roles and names participate in the real-prefix hash", async () => {
      const mainTemplate = [
        "{{! VOTC_SEGMENT:stable_global }}稳定规则：汉字𠮷🙂，第一行。",
        "第二行保留原始换行。",
        "{{! VOTC_SEGMENT:world_context }}当前时间：{{gameData.date}}。"
      ].join("\n");
      const sample = createFixture({ mainTemplate });
      await sample.open();
      await sample.send("Unicode、换行和消息名称。");
      const baseline = sample.requests.filter(request => request.options.responderId === 2).at(-1);
      assert(baseline.actualRequest.messages.some(message => String(message.content || "").includes("汉字𠮷🙂")));
      const firstSystem = baseline.actualRequest.messages.findIndex(message => message.role === "system");
      const renamedMessages = baseline.actualRequest.messages.map(message => ({ ...message }));
      renamedMessages[firstSystem].name = "缓存测试角色名";
      const renamed = await sample.capturePrompt(renamedMessages, baseline.options);
      assert.notEqual(renamed.diagnostic.serializedPrefixSha256, baseline.diagnostic.serializedPrefixSha256);
      const rerolledMessages = baseline.actualRequest.messages.map(message => ({ ...message }));
      rerolledMessages[firstSystem].role = "developer";
      const rerolled = await sample.capturePrompt(rerolledMessages, baseline.options);
      assert.notEqual(rerolled.diagnostic.serializedPrefixSha256, baseline.diagnostic.serializedPrefixSha256);
      assert.equal(renamed.diagnostic.promptProfile.layoutId, "v813");
      assert.equal(rerolled.actualRequest.messages[firstSystem].role, "developer");
    });

    let usageFixture;
    let zeroRecord;
    let endpointZero;
    await check("G-10 a known native zero stays zero and endpoint mismatch is not a cache anomaly", async () => {
      const repeatedStaticRules = "固定通用缓存规则，严格遵循实际游戏事实。".repeat(1900);
      usageFixture = createFixture({
        mainTemplate: [
          "{{! VOTC_SEGMENT:stable_global }}" + repeatedStaticRules,
          "{{! VOTC_SEGMENT:world_context }}当前时间：{{gameData.date}}。"
        ].join("\n")
      });
      await usageFixture.open();
      await usageFixture.send("缓存零值请求甲。");
      await usageFixture.send("缓存零值请求乙。");
      const second = usageFixture.requests.filter(request => request.options.responderId === 2).at(-1);
      assert(second.diagnostic.estimatedCommonPrefixTokens >= 8000,
        "the fixture needs a genuinely large identical serialized prefix before the dynamic tail");
      assert.equal(second.diagnostic.sameEndpoint, true);
      assert.equal(second.diagnostic.sameEffectiveParameters, true);
      zeroRecord = recordUsage(usageFixture, second, {
        rawUsage: {
          prompt_tokens: 24000,
          completion_tokens: 12,
          total_tokens: 24012,
          prompt_tokens_details: { cached_tokens: 0 }
        },
        normalizedUsage: {
          prompt_tokens: 24000,
          completion_tokens: 12,
          total_tokens: 24012,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 24000,
          cache_reporting_status: "reported"
        }
      });
      assert.equal(zeroRecord.rawUsage.prompt_tokens_details.cached_tokens, 0);
      assert.equal(zeroRecord.normalizedUsage.prompt_cache_hit_tokens, 0);
      assert.equal(zeroRecord.providerUsage.cachedTokens, 0);
      assert.equal(zeroRecord.alignmentStatus, "provider_zero_despite_large_prefix");

      const alternateConfig = { ...usageFixture.providerConfig, baseUrl: "https://alternate.invalid/api/paas/v4" };
      const alternate = await captureZhipuRequest(second.actualRequest, alternateConfig);
      const alternateDiff = usageFixture.prepareDiagnostic(alternate.actualRequest, second.options, alternateConfig);
      assert.equal(alternateDiff.sameEndpoint, false);
      assert.equal(alternateDiff.sameEffectiveParameters, true);
      const alternateRecord = { ...second, actualRequest: alternate.actualRequest, diagnostic: alternateDiff };
      endpointZero = recordUsage(usageFixture, alternateRecord, {
        rawUsage: {
          prompt_tokens: 24000,
          completion_tokens: 12,
          total_tokens: 24012,
          prompt_tokens_details: { cached_tokens: 0 }
        },
        normalizedUsage: {
          prompt_tokens: 24000,
          completion_tokens: 12,
          total_tokens: 24012,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 24000,
          cache_reporting_status: "reported"
        }
      });
      assert.equal(endpointZero.providerUsage.cachedTokens, 0);
      assert.equal(endpointZero.alignmentStatus, "insufficient");
      assert.equal(endpointZero.realRequestDiff.highValueAnomaly, false);
    });

    await check("G-11 absent native cache fields remain UNKNOWN instead of zero or estimated hit", async () => {
      assert(usageFixture && zeroRecord);
      const previous = usageFixture.requests.filter(request => request.options.responderId === 2).at(-1);
      const request = await captureZhipuRequest(previous.actualRequest, usageFixture.providerConfig);
      const diagnostic = usageFixture.prepareDiagnostic(request.actualRequest, previous.options);
      const record = recordUsage(usageFixture, {
        ...previous,
        actualRequest: request.actualRequest,
        diagnostic
      }, {
        rawUsage: { prompt_tokens: 24000, completion_tokens: 12, total_tokens: 24012 },
        normalizedUsage: {
          prompt_tokens: 24000,
          completion_tokens: 12,
          total_tokens: 24012,
          prompt_cache_hit_tokens: null,
          prompt_cache_miss_tokens: null,
          cache_reporting_status: "not_reported"
        }
      });
      assert.equal(record.providerUsage.cachedTokens, null);
      assert.equal(record.providerUsage.cacheMissTokens, null);
      assert.equal(record.normalizedUsage.prompt_cache_hit_tokens, undefined);
      assert.equal(record.alignmentStatus, "insufficient");
      assert.equal(record.realRequestDiff.highValueAnomaly, false);
    });
  } finally {
    for (const sample of [...fixtures]) sample.close();
  }
  if (failed > 0) {
    console.error("G-12 FAIL: " + failed + " safety regression(s) failed; test process exits nonzero.");
    process.exitCode = 1;
    return;
  }
  console.log("PASS G-12 any failed safety regression blocks the test process with a nonzero exit.");
  passed++;
  console.log("V9.2.1 GLM V813 prefix: " + passed + "/12 passed.");
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { createFixture, buildRequest, captureZhipuRequest };
