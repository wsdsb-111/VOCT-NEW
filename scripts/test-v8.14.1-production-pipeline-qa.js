"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const events = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Handlebars = require("../resources/app/node_modules/handlebars");
const memorySystem = require("../resources/app/out/main/memory-system");
const { MemoryEngine } = memorySystem;
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { Character } = require("../resources/app/out/main/game-data/character");
const { createPromptBuilder } = require("../resources/app/out/main/prompts/prompt-builder");
const { createLetterPromptBuilder } = require("../resources/app/out/main/prompts/letter-prompt-builder");
const { createPromptConfigManager } = require("../resources/app/out/main/prompts/prompt-config-manager");
const { createTemplateEngine } = require("../resources/app/out/main/prompts/template-engine");
const { PromptScriptLoader } = require("../resources/app/out/main/prompts/prompt-script-loader");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { TokenCounter } = require("../resources/app/out/main/provider-service");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");
const traitSelector = require("../resources/app/out/main/prompts/trait-profile-selector");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8141-pipeline-qa-"));
const promptsDir = path.resolve(__dirname, "../resources/app/default_userdata/prompts");
const fingerprint = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const PromptConfigManager = createPromptConfigManager({ fs, path, promptsDir, defaultMainTemplatePath: path.join(promptsDir, "system/default.hbs"),
  defaultLetterTemplatePath: path.join(promptsDir, "system/letter.hbs"), defaultChatInstruction: "请回应本轮对话。" });
const promptConfigManager = new PromptConfigManager();
const TemplateEngine = createTemplateEngine({ Handlebars, fs, path, promptsHelpersDir: path.join(root, "helpers"),
  defaultPromptsDir: path.resolve(__dirname, "../resources/app/default_userdata"), PromptScriptSandbox });
const names = new Map([[1, "玩家"], [2, "甲"], [3, "乙"], [4, "丙"], [99, "九十九郎"]]);
let sequence = 0;
let passed = 0;
let failed = 0;

async function check(name, run) {
  const log = console.log;
  console.log = () => {};
  try {
    await run();
    passed++;
    log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
  } finally { console.log = log; }
}

function makeCharacter(id) {
  const input = Array(28).fill("");
  input[0] = String(id); input[1] = names.get(id); input[2] = names.get(id); input[4] = "he";
  input[5] = "30"; input[6] = "100"; input[7] = "0"; input[18] = names.get(id);
  const character = new Character(input);
  character.troops = { totalOwnedTroops: 0 };
  return character;
}

async function fixture({ roster = [1, 2], date = "1164.5.20", mainTemplate = null, decorateData = null } = {}) {
  const directory = path.join(root, String(++sequence));
  const summariesDir = path.join(directory, "summaries");
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const scope = { campaignToken: "votc8c-pipeline-fixture", ownerId: 2 };
  const GameData = createGameData({ fs, path, memorySystem, memoryEngine: engine, summariesDir, getHistoricalReferenceByYear: () => null });
  const sample = { directory, summariesDir, engine, scope, requests: [], worldlineRequests: [], durableCalls: 0,
    reply: () => "我对玩家说：今日所谈的经过和边界，我已经听明白；仍须依据眼前事实谨慎行事。" };
  sample.createGameData = (currentDate = date, currentRoster = roster) => {
    const data = new GameData(["1", "玩家", "2", "甲", currentDate, "conversationcourt", "临安", "玩家", String(normalizeGameDate(currentDate).serial)]);
    data.campaignToken = scope.campaignToken;
    currentRoster.forEach(id => data.characters.set(id, makeCharacter(id)));
    data.characters.set(99, makeCharacter(99));
    if (decorateData) decorateData(data);
    for (const character of data.characters.values()) fs.mkdirSync(data.getCharacterFolderPath(character.id, character.shortName), { recursive: true });
    return data;
  };
  const promptSettings = { mainTemplate: mainTemplate || "{{! VOTC_SEGMENT:stable_global }}仅依据本角色合法所知的事实回应。\n{{! VOTC_SEGMENT:world_context }}当前时间：{{gameData.date}}。",
    blocks: [{ id: "main", type: "main", enabled: true, role: "system" }, { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "请回应本轮对话。" }] };
  sample.promptSettings = promptSettings;
  sample.settings = {
    getCK3DebugLogPath: () => path.join(directory, "fixture-debug.log"),
    getPromptSettings: () => promptSettings,
    getLetterPromptSettings: () => ({ blocks: promptConfigManager.getDefaultLetterBlocks(), mainTemplate: fs.readFileSync(path.join(promptsDir, "system/letter.hbs"), "utf8") }),
    getSummaryPromptSettings: () => ({ finalPrompt: "保留来源、人物和知情边界。", finalSummaryMaxTokens: 4096 }),
    getActiveProviderConfig: () => ({ providerType: "openai-compatible", defaultModel: "deterministic-fixture", defaultParameters: { max_tokens: 4096 } }),
    getChatPromptV813Layout: () => true,
    getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89RuntimeProfileSplit: true, chatPromptV810ProviderAdapter: true }),
    getGlobalStreamSetting: () => false,
    getActionApprovalSettings: () => ({ pauseOnApproval: false })
  };
  sample.PromptBuilder = createPromptBuilder({ TemplateEngine, PromptScriptLoader, promptConfigManager, settingsRepository: sample.settings,
    path, TokenCounter, createPromptFingerprint: fingerprint, defaultChatInstruction: "请回应本轮对话。" });
  sample.llm = {
    getCurrentContextLength: async () => 65536,
    getProviderCapabilities: async () => ({ providerType: "fixture", modelId: "fixture", contextWindow: 65536, maxOutputTokens: 4096 }),
    sendChatRequest: async (messages, _signal, _callback, options) => {
      sample.requests.push({ messages, options });
      if (sample.failChat) throw new Error("fixture_chat_failure");
      return { content: sample.reply(options.responderId), finish_reason: "stop" };
    },
    sendSummaryRequest: async (prompt, _signal, options) => {
      if (options.requestType === "memory4_durable") {
        sample.durableCalls++;
        throw new Error("retired_durable_request_must_not_be_sent");
      }
      const text = prompt.find(message => message.content.startsWith("Full conversation:"))?.content || "";
      const segments = [];
      const pattern = /\[messageId=(\d+)(?:; kind=([^\]]+))?\] ([^:]+): ([\s\S]*?)(?=\n\[messageId=|$)/g;
      for (const match of text.matchAll(pattern)) {
        const id = Number(match[1]), speakerId = [...names].find(([, name]) => name === match[3])?.[0];
        if (!speakerId || match[2]) continue;
        for (const paragraph of match[4].split("\n").filter(Boolean)) {
          const privateText = /心想|内心/.test(paragraph);
          segments.push({ content: paragraph, participants: [speakerId], source: "spoken", visibility: privateText ? "private" : "public",
            messageIds: [id], speakerIds: [speakerId] });
        }
      }
      return { content: JSON.stringify({ summarySegments: segments, memories: [] }), finish_reason: "stop" };
    }
  };
  sample.worldline = {
    isSubjectivePromptIntegrationEnabled: () => false,
    isPromptIntegrationEnabled: () => false,
    getSettings: () => ({ v812MemoryEngine3Enabled: true, v812TemporalSummaryRecallEnabled: true }),
    getPromptContext: async request => { sample.worldlineRequests.push(request); return null; }
  };
  sample.open = async (currentDate = date, currentRoster = roster) => {
    const gameData = sample.createGameData(currentDate, currentRoster);
    fs.writeFileSync(sample.settings.getCK3DebugLogPath(), "deterministic fixture only", "utf8");
    Conversation.configure({ memoryEngine: engine, settingsRepository: sample.settings, parseLog: async () => gameData,
      llmManager: sample.llm, PromptBuilder: sample.PromptBuilder, TokenCounter, createPromptFingerprint: fingerprint,
      runFileManager: { isAvailable: () => true, write: () => { throw new Error("fixture must not write RunFile"); } },
      createMessage: input => ({ type: "message", ...input }), createError: input => ({ type: "error", ...input }),
      ActionEngine: { evaluateForCharacter: async () => ({ autoApproved: [], needsApproval: [] }) }, usageAnalytics: { record() {} },
      events, uuid: { v4: () => `pipeline-conversation-${++sequence}` }, path, worldlineService: sample.worldline, logVerboseLLM: () => {} });
    const conversation = new Conversation();
    await conversation.gameDataReady;
    await conversation.worldlinePrefetchPromise;
    await conversation.memoryRecoveryPromise;
    assert(conversation.isActive, "real Conversation initialization must succeed");
    sample.conversation = conversation;
    return conversation;
  };
  await sample.open();
  return sample;
}

async function send(sample, content) {
  const conversation = sample.conversation;
  await conversation.sendMessage(content);
  const timeout = Date.now() + 10000;
  while (conversation.activeResponse || conversation.npcQueue.length) {
    assert(Date.now() < timeout, "real Conversation response queue stalled");
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(conversation.messages.filter(message => message.type === "error").length, sample.failChat ? 1 : 0);
}

async function finalize(sample) {
  const result = await sample.conversation.createFinalSummary();
  assert(result.success, `real finalization failed: ${result.error || result.status}`);
  assert.equal(sample.durableCalls, 0, "conversation finalization must send no Durable request");
  for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve));
  return result;
}

function legacySummaries(sample, ownerId = 2) {
  return sample.engine.loadOwnerFolderMemories(ownerId);
}

function letterBuilder(sample) {
  const Builder = createLetterPromptBuilder({ TemplateEngine, PromptScriptLoader, settingsRepository: sample.settings,
    promptConfigManager, memoryEngine: sample.engine, PromptBuilder: sample.PromptBuilder, TokenCounter });
  return new Builder();
}

async function main() {
  await check("opening: selected waiting characters never become active or synthetic mentions", async () => {
    const sample = await fixture({ roster: [1, 2, 3, 4] });
    const opening = sample.worldlineRequests.find(request => request.responderId === 2);
    assert(opening);
    assert.deepEqual(opening.activeParticipantIds.sort(), [2]);
    assert.deepEqual(opening.mentionedEntityIds, []);
    assert.deepEqual(opening.runtimeContext.activeParticipantIds, [2]);
    await send(sample, "这里还有别人吗？请只依眼前所见回答，不猜测尚未来到此处的人。" );
    const prompt = sample.requests.find(request => request.options.responderId === 2).messages.map(message => message.content).join("\n");
    assert.equal(prompt.includes("丙"), false, "waiting C must not leak through another production Prompt channel");
    assert.equal(prompt.includes("乙"), false, "waiting B must not leak through another production Prompt channel");
  });
  let direct;
  await check("2P: Conversation finalization persists the Legacy counterpart narrative without Durable", async () => {
    direct = await fixture();
    direct.reply = () => "我对玩家说：1164年5月20日是我们第一次见面，我承诺归还地图；这张地图所记的是渡口道路，须妥善保存。";
    await send(direct, "甲，1164年5月20日这是我们第一次见面，我把一张地图交给你，请你记住渡口的道路和归还地图的约定。");
    const result = await finalize(direct);
    const ownerRows = legacySummaries(direct, 2);
    assert(result.directedSummaries.size > 0);
    assert(ownerRows.some(row => row.content.includes("归还地图")));
    assert(ownerRows.every(row => Number(row.provenance.folderOwnerId) === 2));
    assert(ownerRows.every(row => !Number(row.provenance.counterpartId) || Number(row.provenance.counterpartId) !== 99));
  });
  await check("first meeting: Legacy summary reaches chat Prompt and failed replies do not commit dynamic recall", async () => {
    await direct.open("1170.1.1");
    direct.reply = () => "我记得那时初见，须依获准的原始记忆回答，不添加未曾知道的细节。";
    await send(direct, "我们第一次见面时，你对我说过什么？");
    const state = direct.conversation.memoryState.responderRecallCache.get(2);
    const payload = direct.requests.at(-1).messages.map(message => message.content).join("\n");
    assert(payload.includes("归还地图"), "the Legacy source narrative must reach the real chat Prompt");
    assert.equal(Object.hasOwn(state, "memory4Packet"), false);
    assert.equal(direct.durableCalls, 0);
    await direct.open("1170.1.1");
    direct.failChat = true;
    await send(direct, "我们第一次见面时，你对我说过什么？");
    assert.equal(direct.conversation.dynamicRecallHistory?.get(2)?.size || 0, 0);
    assert.equal(direct.conversation.memoryState.responderRecallCache.get(2).seenDynamicSummaries?.size || 0, 0);
  });
  await check("3P: late join, temporary absence and private Narrative stay bounded", async () => {
    const sample = await fixture({ roster: [1, 2, 3] });
    sample.reply = id => id === 2 ? "我对玩家说：PUBLIC_A_REPLY，所闻须谨慎保存。\n甲心想：PRIVATE_A_SENTINEL，应只留在我的心中。"
      : "我听见此刻公开谈话 PUBLIC_B_REPLY。\n乙心想：PRIVATE_B_SENTINEL，应只留在我的心中。";
    await send(sample, "我对甲说：BEFORE_JOIN_SENTINEL，这段旧事只在乙尚未入内时公开谈及。");
    assert((await sample.conversation.joinWaitingCharacter(3)).success);
    await send(sample, "我对甲说：AFTER_JOIN_SENTINEL，现在公开说出城门的旧事。");
    const firstB = sample.requests.find(request => request.options.responderId === 3).messages.map(message => message.content).join("\n");
    assert(!firstB.includes("BEFORE_JOIN_SENTINEL"), "late join history must not replay the earlier dialogue");
    assert((await sample.conversation.temporarilyLeaveCharacter(3, "asleep")).success);
    await send(sample, "我对甲说：WHILE_ASLEEP_SENTINEL，此段旧事只在乙睡着后说出。");
    assert((await sample.conversation.returnTemporaryCharacter(3)).success);
    await send(sample, "我对甲说：AFTER_RETURN_SENTINEL，此刻只说乙醒来后的公开旧事。");
    const lastB = sample.requests.filter(request => request.options.responderId === 3).at(-1).messages.map(message => message.content).join("\n");
    assert(!lastB.includes("WHILE_ASLEEP_SENTINEL"), "returned history must not replay the absent interval");
    const result = await finalize(sample);
    const aText = legacySummaries(sample, 2).map(row => row.content).join("\n");
    const bText = legacySummaries(sample, 3).map(row => row.content).join("\n");
    assert(result.directedSummaries.size > 0);
    assert(aText.includes("BEFORE_JOIN_SENTINEL") && aText.includes("WHILE_ASLEEP_SENTINEL"));
    assert(bText.includes("AFTER_JOIN_SENTINEL") && bText.includes("AFTER_RETURN_SENTINEL"));
    assert(!bText.includes("BEFORE_JOIN_SENTINEL") && !bText.includes("WHILE_ASLEEP_SENTINEL"));
    const episode = sample.engine.store.listAllEpisodes().find(item => item.conversationId === sample.conversation.id);
    assert(episode);
    const privateA = episode.summarySegments.find(segment => segment.content.includes("PRIVATE_A_SENTINEL"));
    const privateB = episode.summarySegments.find(segment => segment.content.includes("PRIVATE_B_SENTINEL"));
    assert(privateA && privateB, "private utterance boundaries must remain explicit in Narrative source evidence");
    assert.deepEqual(privateA.knownBy, [2]);
    assert.deepEqual(privateB.knownBy, [3]);
  });
  await check("third-party names stay outside participants while Legacy history remains queryable", async () => {
    const sample = await fixture();
    sample.reply = () => "我对玩家说：我记住九十九郎于1162年迁居北城的转述，但尚未亲自见过九十九郎。";
    await send(sample, "我对甲说：九十九郎于1162年迁居北城；这是我转述的旧事，不代表九十九郎现在在此处。");
    const context = sample.conversation.buildFinalizationBaseContext();
    assert(context.mentionedEntities.some(person => person.id === 99));
    assert(!context.participants.some(person => person.id === 99));
    await finalize(sample);
    const ownerRows = legacySummaries(sample, 2);
    assert(ownerRows.some(row => row.content.includes("九十九郎")));
    assert(ownerRows.every(row => Number(row.provenance.counterpartId) !== 99));
    await sample.open("1170.1.1");
    await send(sample, "1162年九十九郎发生了什么？");
    assert(sample.requests.at(-1).messages.some(message => message.content.includes("九十九郎")));
  });
  await check("Legacy finalization remains recallable with zero Durable requests", async () => {
    const sample = await fixture();
    sample.reply = () => "我对玩家说：LEGACY_ONLY_SENTINEL，旧日渡口谈话的细节仍须遵从来源。";
    await send(sample, "我对甲说：LEGACY_ONLY_SENTINEL，这是一段应保留的渡口往事。");
    await finalize(sample);
    assert(sample.durableCalls === 0);
    assert(legacySummaries(sample, 2).some(row => row.content.includes("LEGACY_ONLY_SENTINEL")));
    await sample.open("1170.1.1");
    await send(sample, "1164年5月20日我们聊过什么？");
    assert(sample.requests.at(-1).messages.some(message => message.content.includes("LEGACY_ONLY_SENTINEL")));
    assert.equal(Object.hasOwn(sample.conversation.memoryState.responderRecallCache.get(2), "memory4Packet"), false);
  });  await check("Letter: default blocks reject player-private and wrong-campaign/future history", async () => {
    const sample = await fixture();
    const data = sample.conversation.gameData, player = data.getPlayer(), ai = data.getAi();
    player.memories = [{ creationDate: "1160.1.1", desc: "PLAYER_PRIVATE_MEMORY_SENTINEL" }];
    ai.memories = [{ creationDate: "1160.1.1", desc: "RECIPIENT_OWN_MEMORY_SENTINEL" }];
    const playerFile = data.getConversationFilePath(1, player.shortName, 2, ai.shortName);
    sample.engine.store.writeJson(playerFile, [{ playerId: 1, characterId: 2, perspectiveOwnerId: 1,
      knownBy: [1], date: "1160.1.1", content: "PLAYER_PERSPECTIVE_PRIVATE_SENTINEL", campaignToken: sample.scope.campaignToken }]);
    const ownerFile = data.getConversationFilePath(2, ai.shortName, 1, player.shortName);
    sample.engine.store.writeJson(ownerFile, [
      { playerId: 2, characterId: 1, perspectiveOwnerId: 2, knownBy: [2], date: "1160.1.1", content: "RECIPIENT_LEGAL_HISTORY_SENTINEL", campaignToken: sample.scope.campaignToken },
      { playerId: 2, characterId: 1, perspectiveOwnerId: 2, knownBy: [2], date: "1160.1.1", content: "OTHER_CAMPAIGN_LETTER_SENTINEL", campaignToken: "other-campaign" },
      { playerId: 2, characterId: 1, perspectiveOwnerId: 2, knownBy: [2], date: "1190.1.1", content: "FUTURE_LETTER_SENTINEL", campaignToken: sample.scope.campaignToken }
    ]);
    data.loadCharactersSummaries();
    assert(ai.conversationSummaries.some(summary => summary.content === "PLAYER_PERSPECTIVE_PRIVATE_SENTINEL"), "the fixture must reproduce real GameData's player-side raw copy");
    const payload = letterBuilder(sample).buildMessages(data, { content: "来客来信：请只谈你合法知道的往事。" }).map(message => message.content).join("\n");
    for (const secret of ["PLAYER_PRIVATE_MEMORY_SENTINEL", "PLAYER_PERSPECTIVE_PRIVATE_SENTINEL", "OTHER_CAMPAIGN_LETTER_SENTINEL", "FUTURE_LETTER_SENTINEL"]) {
      assert.equal(payload.includes(secret), false, `recipient must not receive ${secret}`);
    }
    assert(payload.includes("RECIPIENT_LEGAL_HISTORY_SENTINEL"));
    assert(payload.includes("RECIPIENT_OWN_MEMORY_SENTINEL"));
  });
  await check("Letter: unknown/late acquisition, stale ACL and unresolved campaign cannot bypass read-only scoped routing", async () => {
    const sample = await fixture();
    const data = sample.conversation.gameData;
    const day = normalizeGameDate(data.date).serial;
    const save = (id, content, acquiredAt, knownBy = [2]) => {
      sample.engine.store.saveMemory({ memoryId: id, type: "secret", content, knownBy, visibility: "private", importance: 0.99,
        eventDate: "1160.1.1", totalDays: day - 1000, provenance: { campaignToken: sample.scope.campaignToken } });
      sample.engine.store.markKnownBy(2, id, { awareness: "told", acquiredAt });
    };
    save("legal-internal", "LEGAL_ACQUIRED_INTERNAL_SENTINEL", day - 20);
    save("unknown-acquired", "UNKNOWN_ACQUISITION_SENTINEL", null);
    save("future-acquired", "FUTURE_ACQUISITION_SENTINEL", day + 20);
    save("wrong-owner", "STALE_ACL_SENTINEL", day - 20, [1]);
    const indexBefore = JSON.stringify(sample.engine.store.index);
    const knowledgeBefore = JSON.stringify(sample.engine.store.getCharacterKnowledge(2));
    const runtimeBefore = JSON.stringify([...data.characters]);
    for (const method of ["saveMemory", "updateMemory", "markKnownBy"]) sample.engine.store[method] = () => { throw new Error("letter_prompt_must_not_write"); };
    const builder = letterBuilder(sample);
    const text = builder.buildMessages(data, { content: "请回忆旧事。", totalDays: day }).map(message => message.content).join("\n");
    assert(text.includes("LEGAL_ACQUIRED_INTERNAL_SENTINEL"));
    for (const secret of ["UNKNOWN_ACQUISITION_SENTINEL", "FUTURE_ACQUISITION_SENTINEL", "STALE_ACL_SENTINEL"]) assert(!text.includes(secret), secret);
    const prior = builder.buildMessages(data, { content: "请回忆旧事。", totalDays: day - 30 }).map(message => message.content).join("\n");
    assert(!prior.includes("LEGAL_ACQUIRED_INTERNAL_SENTINEL"), "the letter send day also bounds knowledge acquisition");
    const unresolved = Object.create(data);
    unresolved.campaignToken = null;
    assert(!builder.buildMessages(unresolved, { content: "请回忆旧事。" }).some(message => message.content.includes("LEGAL_ACQUIRED_INTERNAL_SENTINEL")));
    assert.equal(JSON.stringify(sample.engine.store.index), indexBefore);
    assert.equal(JSON.stringify(sample.engine.store.getCharacterKnowledge(2)), knowledgeBefore);
    assert.equal(JSON.stringify([...data.characters]), runtimeBefore);
  });
  await check("Traits: real custom Prompt and Letter templates preserve self but hide unknown/ALL/Chinese private traits", async () => {
    const trait = (name, category = "ALL") => ({ name, category, desc: `TARGET_${name}_PRIVATE_DETAIL` });
    const sample = await fixture({ mainTemplate: "{{! VOTC_SEGMENT:character_base }}SELF={{#each traits}}{{name}},{{/each}}\n{{! VOTC_SEGMENT:world_context }}{{#each (otherCharacters gameData.characters character.id)}}{{#if (eq id 1)}}PLAYER={{#each traits}}{{name}},{{/each}}|{{personality}}{{/if}}{{/each}}",
      decorateData: data => {
        data.getPlayer().traits = [trait("眉清目秀"), trait("天才"), trait("聪慧"), trait("欺诈"), trait("私生子"), trait("MOD_UNKNOWN_CHARACTER_TRAIT")];
        data.getPlayer().personality = "PLAYER_PRIVATE_PERSONALITY_SENTINEL";
        data.getAi().traits = [trait("天才")]; data.getAi().relationsToPlayer = ["friend"];
      } });
    const data = sample.conversation.gameData;
    await send(sample, "请只依眼前所见，不读取旁人的隐秘性格。" );
    const chat = sample.requests.at(-1).messages.map(message => message.content).join("\n");
    assert(chat.includes("SELF=天才,") && chat.includes("PLAYER=|"), JSON.stringify(chat.match(/SELF=[^\n]*|PLAYER=[^\n]*/g)));
    for (const secret of ["PLAYER=天才", "MOD_UNKNOWN_CHARACTER_TRAIT", "PLAYER_PRIVATE_PERSONALITY_SENTINEL"]) assert(!chat.includes(secret));
    sample.settings.getLetterPromptSettings = () => ({ mainTemplate: "SELF={{#each ai.traits}}{{name}},{{/each}}|PLAYER={{#each player.traits}}{{name}},{{/each}}|{{player.personality}}",
      blocks: [{ type: "main", enabled: true }, { type: "custom", enabled: true, template: "{{#each gameData.characters}}{{#each this.traits}}{{name}},{{/each}}|{{this.personality}}{{/each}}" }] });
    const letter = letterBuilder(sample).buildMessages(data, { content: "请回信。" }).map(message => message.content).join("\n");
    assert(letter.includes("SELF=天才,|PLAYER=|"));
    assert(!letter.includes("MOD_UNKNOWN_CHARACTER_TRAIT") && !letter.includes("PLAYER_PRIVATE_PERSONALITY_SENTINEL"));
    assert.equal(data.getPlayer().traits.length, 6);
  });
  await check("Traits: familiar recognition never promotes negative/future/hypothetical canonical claims", async () => {
    const sample = await fixture();
    const data = sample.conversation.gameData;
    data.getPlayer().traits = [{ name: "天才", category: "ALL" }, { name: "私生子", category: "ALL" },
      { name: "MOD_UNKNOWN_CHARACTER_TRAIT", category: "ALL" }];
    data.getAi().relationsToPlayer = ["friend"];
    for (const text of ["玩家并不是天才。", "玩家是天才，将来才会确定。", "如果玩家是天才，这只是设想。", "玩家是天才吗？", "玩家是天才，并不属实。", "玩家是 MOD_UNKNOWN_CHARACTER_TRAIT，这是谣言。"] ) {
      const view = traitSelector.createTraitProfileView(data, data.getAi(), { memory4Packet: { details: [{ traitKnowledgeEvidence: { text } }] } });
      assert.equal(view.gameData.getPlayer().traits.length, 0, text);
    }
    data.getAi().knownSecrets = [{ ownerId: 1, type: "secret_bastard" }];
    const permitted = traitSelector.createTraitProfileView(data, data.getAi(), {});
    assert.deepEqual(permitted.gameData.getPlayer().traits.map(trait => trait.name), ["私生子"], "only a matching CK3 secret readback may reveal the secret trait");
  });
}

main().then(() => {
  console.log(`V8.14.1 independent production pipeline QA: ${passed} PASS, ${failed} FAIL (deterministic Provider fixtures, no live API/CK3)`);
  if (failed) process.exitCode = 1;
}).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(() => {
  const resolved = path.resolve(root);
  assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("votc-v8141-pipeline-qa-"));
  fs.rmSync(resolved, { recursive: true, force: true });
});
