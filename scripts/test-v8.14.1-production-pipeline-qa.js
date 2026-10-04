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
const { extractTemporalAnchors } = require("../resources/app/out/main/memory-system/temporal-anchor-extractor");
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
  const sample = { directory, summariesDir, engine, scope, requests: [], durableInputs: [], worldlineRequests: [], reply: () => "我对玩家说：今日所谈的经过和边界，我已经听明白；仍须依据眼前事实谨慎行事。" };
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
        const input = JSON.parse(prompt[1].content);
        sample.durableInputs.push(input);
        if (sample.durableResponse) return JSON.stringify(sample.durableResponse(input));
        const unique = new Map();
        for (const fragment of input.fragments) {
          if (!unique.has(fragment.text) || fragment.fragmentId.startsWith("segment_")) unique.set(fragment.text, fragment);
        }
        const entries = [...unique.values()].slice(0, 8).map(fragment => {
          const time = extractTemporalAnchors(fragment.text, { anchorGameDate: input.conversationDate, messageId: 0 })[0];
          return { memoryType: fragment.text.includes("承诺") ? "COMMITMENT" : "MAJOR_EXPERIENCE", text: fragment.text,
            fragmentIds: [fragment.fragmentId], entityIds: fragment.entityIds, topics: ["往事"],
            eventTime: time ? { from: time.fromGameDate, to: time.toGameDate, precision: time.precision, status: "reported" } : { status: "unknown" } };
        });
        return JSON.stringify({ status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries });
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
  engine.memory4.configureDerived({ isCampaignCurrent: () => true, getProviderSnapshot: async () => null });
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
  for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve));
  return result;
}

function entries(sample, ownerId = 2) {
  const scope = { ...sample.scope, ownerId };
  const index = sample.engine.memory4.store.loadIndex(scope);
  return Object.keys(index.entries).map(id => sample.engine.memory4.store.readEntry(scope, id, index));
}

function packet(sample, ownerId = 2) {
  return sample.conversation.memoryState.responderRecallCache.get(ownerId).memory4Packet;
}

function sourceEntry(fragment, memoryType = "MAJOR_EXPERIENCE") {
  return { memoryType, text: fragment.text, fragmentIds: [fragment.fragmentId], entityIds: fragment.entityIds,
    topics: ["往事"], eventTime: { status: "unknown" } };
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
  await check("2P: Conversation finalization derives canonical direct counterparts without test-side assignment", async () => {
    direct = await fixture();
    direct.reply = () => "我对玩家说：1164年5月20日是我们第一次见面，我承诺归还地图；这张地图所记的是渡口道路，须妥善保存。";
    await send(direct, "甲，1164年5月20日这是我们第一次见面，我把一张地图交给你，请你记住渡口的道路和归还地图的约定。" );
    await finalize(direct);
    const canonical = entries(direct);
    assert(canonical.length);
    assert(canonical.every(entry => entry.counterpartIds.includes(1)), "the actual production snapshot must supply the direct player counterpart");
    assert.equal(canonical.some(entry => entry.counterpartIds.includes(99)), false);
  });
  await check("Known Entity: native full Presence and validated visibility report complete direct evidence", () => {
    const profile = direct.engine.memory4.getKnownEntityProfile(direct.scope, 1, { currentGameDate: "1164.5.20" });
    assert.equal(profile.recognition.level, "DIRECT_INTERACTION");
    assert.equal(profile.recognition.directConversationCount, 1);
    assert.equal(profile.recognition.evidenceCompleteness, "complete");
    assert.equal(direct.engine.memory4.store.getKnownEntityEvidence(direct.scope, 1).completeness, "complete");
  });
  await check("Known Entity: a legacy row without conversation evidence remains partial", async () => {
    const sample = await fixture();
    const store = sample.engine.memory4.store;
    const directory = store.directory(sample.scope);
    fs.mkdirSync(directory, { recursive: true });
    store.store.writeJson(path.join(directory, "known-entities.json"), { campaignToken: sample.scope.campaignToken,
      ownerId: sample.scope.ownerId, revision: 1, entities: { 1: { entityId: 1, evidenceTypes: ["direct_conversation"],
        directConversationCount: 1, sharedSceneCount: 0, mentionCount: 0, evidenceByConversation: {} } } });
    const known = store.getKnownEntityEvidence(sample.scope, 1);
    assert.equal(known.status, "DIRECT_INTERACTION");
    assert.equal(known.completeness, "legacy_partial");
  });
  await check("first meeting: real Planner selection reaches Prompt and only a successful response commits Seen", async () => {
    await direct.open("1170.1.1");
    direct.reply = () => "我记得那时初见，须依获准的原始记忆回答，不添加未曾知道的细节。";
    await send(direct, "我们第一次见面时，你对我说过什么？" );
    const state = direct.conversation.memoryState.responderRecallCache.get(2);
    assert(state.memory4Packet.details.length > 0, "First Meeting must recall the canonical production entry");
    const request = direct.requests.at(-1);
    const payload = request.messages.map(message => message.content).join("\n");
    for (const detail of state.memory4Packet.details) assert(payload.includes(detail.memory.memoryId));
    assert(direct.conversation.dynamicRecallHistory.get(2)?.size > 0);
    assert(state.seenDynamicSummaries.size > 0);
    await direct.open("1170.1.1");
    direct.failChat = true;
    await send(direct, "我们第一次见面时，你对我说过什么？" );
    assert.equal(direct.conversation.dynamicRecallHistory?.get(2)?.size || 0, 0);
    assert.equal(direct.conversation.memoryState.responderRecallCache.get(2).seenDynamicSummaries.size, 0);
  });
  await check("3P: late join, temporary absence and private paragraphs stay bounded through canonical finalization", async () => {
    const sample = await fixture({ roster: [1, 2, 3] });
    sample.reply = id => id === 2 ? "我对玩家说：PUBLIC_A_REPLY，所闻须谨慎保存。\n甲心想：PRIVATE_A_SENTINEL，应只留在我的心中。"
      : "我听见此刻公开谈话 PUBLIC_B_REPLY。\n乙心想：PRIVATE_B_SENTINEL，应只留在我的心中。";
    await send(sample, "我对甲说：BEFORE_JOIN_SENTINEL，这段旧事只在乙尚未入内时公开谈及。" );
    assert((await sample.conversation.joinWaitingCharacter(3)).success);
    await send(sample, "我对甲说：AFTER_JOIN_SENTINEL，现在公开说出城门的旧事。" );
    const firstB = sample.requests.find(request => request.options.responderId === 3).messages.map(message => message.content).join("\n");
    assert(!firstB.includes("BEFORE_JOIN_SENTINEL"), "late join history must not replay the earlier dialogue");
    assert((await sample.conversation.temporarilyLeaveCharacter(3, "asleep")).success);
    await send(sample, "我对甲说：WHILE_ASLEEP_SENTINEL，此段旧事只在乙睡着后说出。" );
    assert((await sample.conversation.returnTemporaryCharacter(3)).success);
    await send(sample, "我对甲说：AFTER_RETURN_SENTINEL，此刻只说乙醒来后的公开旧事。" );
    const lastB = sample.requests.filter(request => request.options.responderId === 3).at(-1).messages.map(message => message.content).join("\n");
    assert(!lastB.includes("WHILE_ASLEEP_SENTINEL"), "returned history must not replay the absent interval");
    await finalize(sample);
    const a = entries(sample, 2), b = entries(sample, 3);
    const aText = a.map(entry => entry.text).join("\n"), bText = b.map(entry => entry.text).join("\n");
    assert(aText.includes("BEFORE_JOIN_SENTINEL") && aText.includes("WHILE_ASLEEP_SENTINEL"));
    assert(bText.includes("AFTER_JOIN_SENTINEL") && bText.includes("AFTER_RETURN_SENTINEL"));
    assert(!bText.includes("BEFORE_JOIN_SENTINEL") && !bText.includes("WHILE_ASLEEP_SENTINEL"));
    assert(aText.includes("PRIVATE_A_SENTINEL") && !aText.includes("PRIVATE_B_SENTINEL"));
    assert(bText.includes("PRIVATE_B_SENTINEL") && !bText.includes("PRIVATE_A_SENTINEL"));
    assert(a.every(entry => !entry.counterpartIds.includes(3)));
    assert(a.some(entry => entry.text.includes("PUBLIC_A_REPLY") && entry.counterpartIds.includes(1)));
    assert(a.filter(entry => entry.text.includes("PUBLIC_B_REPLY")).every(entry => !entry.counterpartIds.length));
    assert(a.filter(entry => entry.evidence.visibility === "private").every(entry => !entry.counterpartIds.length));
    assert(b.every(entry => !entry.counterpartIds.includes(1) && !entry.counterpartIds.includes(2)), "an observer in 3P is not an inferred direct addressee");
    const profile = sample.engine.memory4.getKnownEntityProfile({ ...sample.scope, ownerId: 3 }, 1, { currentGameDate: "1164.5.20" });
    assert.equal(profile.recognition.directConversationCount, 0);
    assert.equal(profile.recognition.sharedSceneCount, 1);
  });
  await check("third party: literal live GameData identity reaches Memory4 without granting Presence or a counterpart", async () => {
    const sample = await fixture();
    sample.reply = () => "我对玩家说：我记住九十九郎于1162年迁居北城的转述，但尚未亲自见过九十九郎。";
    await send(sample, "我对甲说：九十九郎于1162年迁居北城；这是我转述的旧事，不代表九十九郎现在在此处。" );
    const context = sample.conversation.buildFinalizationBaseContext();
    assert(context.mentionedEntities.some(person => person.id === 99));
    assert(!context.participants.some(person => person.id === 99));
    await finalize(sample);
    const canonical = entries(sample);
    assert(canonical.some(entry => entry.entityIds.includes(99)));
    assert(canonical.every(entry => !entry.counterpartIds.includes(99)));
    const profile = sample.engine.memory4.getKnownEntityProfile(sample.scope, 99, { currentGameDate: "1164.5.20" });
    assert.equal(profile.recognition.directConversationCount, 0);
    assert.equal(profile.recognition.sharedSceneCount, 0);
    assert.equal(profile.recognition.mentionCount, 1);
    await sample.open("1170.1.1");
    await send(sample, "1162年九十九郎发生了什么？" );
    assert(packet(sample).items.some(item => item.memory.content.includes("九十九郎")));
  });
  let dated;
  await check("exact date: original event year, short follow-up and rewind knowledge use the actual production chain", async () => {
    dated = await fixture({ date: "1170.1.1" });
    dated.reply = () => "我对玩家说：1142年6月3日我在渡口收到地图，记得第一件往事。\n我对玩家说：1142年6月3日我保管地图，记得第二件往事。\n我对玩家说：1143年1月1日我修补地图，记得第三件往事。\n我对玩家说：1143年2月1日我携带地图，记得第四件往事。";
    await send(dated, "我对甲说：1142年6月3日我在渡口交给你地图，这是往事，不是1170年刚刚发生的事。" );
    await finalize(dated);
    await dated.engine.memory4.derived.rebuild(dated.scope, { kind: "all" });
    const years = dated.engine.memory4.derived.list(dated.scope).years.map(view => view.eventYear);
    assert(years.includes(1142) && years.includes(1143));
    assert(!years.includes(1170), "the extraction may not relabel the event as the conversation year");
    await dated.open("1170.1.2");
    await send(dated, "1142年6月3日发生了什么？" );
    const first = packet(dated);
    assert.equal(first.query.granularity, "EXACT_DATE");
    assert(first.details.length && first.details.every(item => item.reason.from === "1142.6.3" && item.reason.precision === "day"));
    await send(dated, "后来呢？" );
    const followUp = packet(dated);
    assert.equal(followUp.query.granularity, "FOLLOW_UP");
    assert.equal(followUp.diagnostics.blockedReason, null);
    assert(followUp.items.length, "the short follow-up must reuse only the valid same-conversation focus chain");
    await dated.open("1144.1.1");
    await send(dated, "1142年6月3日发生了什么？" );
    assert.equal(packet(dated).items.length, 0, "an old event cannot grant knowledge acquired in a future conversation");
    assert.equal(dated.conversation.dynamicRecallHistory?.get(2)?.size || 0, 0);
  });
  await check("edit/delete: real canonical revisions dirty Year/Life and discard stale Prompt history and Seen", async () => {
    await dated.open("1170.1.2");
    await send(dated, "1142年6月3日发生了什么？" );
    const selected = packet(dated).details[0].memory.memoryId;
    const old = dated.engine.memory4.store.readEntry(dated.scope, selected);
    assert(dated.conversation.dynamicRecallHistory.get(2).size);
    dated.engine.memory4.store.updateEntry(dated.scope, selected, old.text + " MANUAL_EDIT_SENTINEL", { expectedRevision: old.revision });
    const views = dated.engine.memory4.derived.list(dated.scope);
    assert(views.years.find(view => view.eventYear === 1142).dirty && views.life.dirty);
    dated.conversation.getPromptHistoryForCharacter(2);
    assert.equal(dated.conversation.dynamicRecallHistory.get(2).size, 0);
    assert.equal(dated.conversation.memoryState.responderRecallCache.get(2).seenDynamicSummaries.size, 0);
    await send(dated, "1142年6月3日发生了什么？" );
    assert(packet(dated).details.some(item => item.memory.memoryId === selected && item.memory.content.includes("MANUAL_EDIT_SENTINEL")));
    const edited = dated.engine.memory4.store.readEntry(dated.scope, selected);
    assert(dated.engine.memory4.store.deleteEntry(dated.scope, selected, { expectedRevision: edited.revision }));
    dated.conversation.getPromptHistoryForCharacter(2);
    assert.equal(dated.conversation.dynamicRecallHistory.get(2).size, 0);
    await send(dated, "1142年6月3日发生了什么？" );
    assert(!packet(dated).items.some(item => item.memory.memoryId === selected));
    assert(dated.engine.memory4.store.readEntry(dated.scope, selected).deleted);
  });
  await check("commitment: Conversation fulfillment closes only an exact sourced active promise and dirties derived views", async () => {
    const sample = await fixture();
    const promise = "我对玩家说：1164年5月20日我承诺归还玉印。";
    sample.reply = () => promise;
    sample.durableResponse = input => ({ status: "STORE", entries: [{ ...sourceEntry(input.fragments.find(fragment => fragment.text === promise), "COMMITMENT"),
      eventTime: { from: "1164.5.20", to: "1164.5.20", precision: "day", status: "reported" } }] });
    await send(sample, "我对甲说：请记住归还玉印的约定。" );
    await finalize(sample);
    const original = entries(sample).find(entry => entry.memoryType === "COMMITMENT");
    assert(original && original.state.status === "active");
    await sample.engine.memory4.derived.rebuild(sample.scope, { kind: "all" });
    const beforeViews = sample.engine.memory4.derived.list(sample.scope);
    assert(beforeViews.years.length && beforeViews.life.segments.length);
    const dirtyPublications = [];
    const markDirty = sample.engine.memory4.derived.markDirty.bind(sample.engine.memory4.derived);
    sample.engine.memory4.derived.markDirty = (scope, options) => {
      const result = markDirty(scope, options);
      if (scope.ownerId === 2 && options.entryIds.includes(original.entryId)) dirtyPublications.push({ result,
        year: sample.engine.memory4.derived.read(scope, "year", 1164), life: sample.engine.memory4.derived.read(scope, "life") });
      return result;
    };
    await sample.open("1165.1.1");
    const completed = "我对玩家说：我已经归还玉印，履行了归还玉印的承诺。";
    sample.reply = () => completed;
    sample.durableResponse = input => {
      const target = input.activeCommitments.find(entry => entry.text === promise);
      assert(target, "the production extraction prompt must carry authorized active commitments");
      const fragment = input.fragments.find(entry => entry.text === completed);
      return { status: "NO_DURABLE_CONTENT", entries: [], commitmentTransitions: [{ entryId: target.entryId,
        expectedRevision: target.expectedRevision, status: "fulfilled", fragmentIds: [fragment.fragmentId],
        commitmentQuote: "归还玉印", evidenceQuote: completed }] };
    };
    await send(sample, "我对甲说：你归还玉印的旧约现在如何？" );
    await finalize(sample);
    const fulfilled = sample.engine.memory4.store.readEntry(sample.scope, original.entryId);
    assert.equal(fulfilled.state.status, "fulfilled");
    assert.equal(fulfilled.revision, original.revision + 1);
    assert.equal(fulfilled.state.changedGameDate, "1165.1.1");
    assert.equal(fulfilled.state.source.sourceType, "reported");
    assert(fulfilled.state.sourceMessageIds.length && fulfilled.state.source.finalizationId);
    assert(dirtyPublications.some(publication => publication.result.derivedDirty && publication.year.dirty && publication.life.dirty),
      "the canonical state transition must publish dirty before its scheduled rebuild clears it");
    await sample.open("1166.1.1");
    await send(sample, "还有哪些未完成的承诺？" );
    assert(!packet(sample).items.some(item => item.memory.memoryId === original.entryId));
    await send(sample, "你以前答应过什么？" );
    assert(packet(sample).items.some(item => item.memory.memoryId === original.entryId && item.annotation.includes("fulfilled")));
  });
  await check("commitment: same object cannot bind a different duty; cancellation, replacement and conditions stay exact", async () => {
    const sample = await fixture({ date: "1164.5.20" });
    const people = [sample.conversation.gameData.getPlayer(), sample.conversation.gameData.getAi()].map(person => ({ id: person.id,
      name: person.name, shortName: person.shortName, fullName: person.fullName }));
    const makeContext = (id, date, content) => {
      const messages = [{ id: 1, role: "assistant", speakerCharacterId: 2, name: names.get(2), content }];
      return { ...sample.scope, conversationId: id, finalizationId: `final-${id}`, episodeId: id, date,
        totalDays: normalizeGameDate(date).serial, participants: people,
        participantPresence: people.map(person => ({ characterId: person.id, joinedAtMessageId: 0 })), messages,
        finalizationVisibilityV1: true,
        verifiedSummarySegments: messages.map(message => ({ segmentId: `${id}-${message.id}`, content: message.content,
          visibility: "public", source: "spoken", participants: [1, 2], knownBy: [1, 2],
          provenance: { messageIds: [message.id], speakerIds: [2] } })) };
    };
    let originalId = null;
    const finishSnapshot = async (id, date, content, transition = null, replacementText = null) => {
      const snapshot = sample.engine.memory4.buildOwnerSnapshot(makeContext(id, date, content), 2);
      const result = await sample.engine.memory4.finishOwner(snapshot, async prompt => {
        const input = JSON.parse(prompt[1].content);
        const fragment = input.fragments.find(item => item.text === content);
        assert(fragment, "Coordinator must supply the exact source fragment");
        const source = snapshot.fragments.find(item => item.fragmentId === fragment.fragmentId);
        if (!transition) return JSON.stringify({ status: "STORE", entries: [{ ...sourceEntry(source, "COMMITMENT"),
          fragmentIds: [fragment.fragmentId], entityIds: source.entityIds, participantIds: [1, 2], topics: ["约定"] }], commitmentTransitions: [] });
        const targetId = transition.entryId || originalId;
        const target = input.activeCommitments.find(item => item.entryId === targetId);
        assert(target, "Coordinator must offer the current active commitment");
        const entries = replacementText ? [{ ...sourceEntry(source, "COMMITMENT"), text: replacementText,
          fragmentIds: [fragment.fragmentId], entityIds: source.entityIds, participantIds: [1, 2], topics: ["约定"] }] : [];
        return JSON.stringify({ status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries,
          commitmentTransitions: [{ entryId: targetId, expectedRevision: target.expectedRevision,
            fragmentIds: [fragment.fragmentId], status: transition.status,
            commitmentQuote: transition.binding, evidenceQuote: content,
            ...(replacementText ? { replacementEntryIndex: 0 } : {}) }] });
      });
      return { snapshot, result };
    };
    const readStatus = entryId => sample.engine.memory4.store.readEntry(sample.scope, entryId).state.status;
    const original = "我对玩家说：我承诺把玉印封入国库。";
    const initial = await finishSnapshot("binding-start", "1164.5.20", original);
    assert.equal(initial.result.status, "STORE");
    originalId = initial.result.entryIds[0];
    assert.equal(readStatus(originalId), "active");

    const wrongDutyWithQuotedPromise = "我对玩家说：我承诺把玉印封入国库但我已经把玉印归还给玩家，履行了归还玉印的承诺。";
    const rejectedWrongAction = await finishSnapshot("binding-wrong-action", "1165.1.1", wrongDutyWithQuotedPromise,
      { status: "fulfilled", binding: "把玉印封入国库" });
    assert.equal(rejectedWrongAction.result.status, "EXTRACTION_FAILED");
    assert.equal(readStatus(originalId), "active", "quoting the original promise beside a different completed action is not fulfillment");

    const wrongDuty = "我对玩家说：我已经归还玉印，履行了归还玉印的承诺。";
    const rejectedDuty = await finishSnapshot("binding-wrong-duty", "1165.1.1", wrongDuty,
      { status: "fulfilled", binding: "玉印" });
    assert.equal(rejectedDuty.result.status, "EXTRACTION_FAILED");
    assert.equal(readStatus(originalId), "active", "returning the same seal does not fulfill the duty to place it in the treasury");

    const unfulfilledQuote = "我对玩家说：我仍未履行‘把玉印封入国库’的旧约。";
    const rejectedQuote = await finishSnapshot("binding-quote-only", "1165.1.2", unfulfilledQuote,
      { status: "fulfilled", binding: "把玉印封入国库" });
    assert.equal(rejectedQuote.result.status, "EXTRACTION_FAILED");
    assert.equal(readStatus(originalId), "active", "repeating the exact obligation without completion cannot fulfill it");

    const contradictedFulfillment = "我对玩家说：我已经把玉印封入国库，但其实从未封入国库。";
    const rejectedContradiction = await finishSnapshot("binding-contradicted-fulfillment", "1165.1.2", contradictedFulfillment,
      { status: "fulfilled", binding: "把玉印封入国库" });
    assert.equal(rejectedContradiction.result.status, "EXTRACTION_FAILED");
    assert.equal(readStatus(originalId), "active", "a later explicit denial invalidates an earlier completion claim");

    const newPromise = "我对玩家说：我承诺把玉印封入国库，也承诺把玉印归还给玩家。";
    const rejectedReplacement = await finishSnapshot("binding-unmarked-replacement", "1165.1.3", newPromise,
      { status: "superseded", binding: "把玉印封入国库" }, "我承诺把玉印归还给玩家");
    assert.equal(rejectedReplacement.result.status, "EXTRACTION_FAILED");
    assert.equal(readStatus(originalId), "active", "a different predicate does not replace the old promise without explicit supersession");

    const explicitReplacement = "我对玩家说：我现将‘把玉印封入国库’的旧约改为‘我承诺把玉印归还给玩家’。";
    const acceptedReplacement = await finishSnapshot("binding-marked-replacement", "1165.1.4", explicitReplacement,
      { status: "superseded", binding: "把玉印封入国库" }, "我承诺把玉印归还给玩家");
    assert.equal(acceptedReplacement.result.status, "STORE");
    assert.equal(readStatus(originalId), "superseded");
    assert.equal(readStatus(acceptedReplacement.result.entryIds[0]), "active");

    const conditional = "我对玩家说：我承诺把银契交给王太后，但须先释放俘虏。";
    const conditionalStart = await finishSnapshot("binding-conditional-start", "1166.1.1", conditional);
    const conditionalId = conditionalStart.result.entryIds[0];
    const missingCondition = "我对玩家说：我已把银契交给王太后，履行了把银契交给王太后的承诺。";
    const rejectedCondition = await finishSnapshot("binding-conditional-missing", "1166.1.2", missingCondition,
      { entryId: conditionalId, status: "fulfilled", binding: "把银契交给王太后" });
    assert.equal(rejectedCondition.result.status, "EXTRACTION_FAILED");
    assert.equal(readStatus(conditionalId), "active");
    const satisfiedCondition = "我对玩家说：我已释放俘虏，已把银契交给王太后，履行了把银契交给王太后的承诺。";
    const acceptedCondition = await finishSnapshot("binding-conditional-complete", "1166.1.3", satisfiedCondition,
      { entryId: conditionalId, status: "fulfilled", binding: "把银契交给王太后" });
    assert.equal(acceptedCondition.result.status, "NO_DURABLE_CONTENT");
    assert.equal(readStatus(conditionalId), "fulfilled");

    const cancellable = "我对玩家说：我承诺把军令交给玩家。";
    const cancellationStart = await finishSnapshot("binding-cancel-start", "1167.1.1", cancellable);
    const cancellationId = cancellationStart.result.entryIds[0];
    const cancellation = "我对玩家说：我已正式取消把军令交给玩家的原约。";
    const acceptedCancellation = await finishSnapshot("binding-cancel", "1167.1.2", cancellation,
      { entryId: cancellationId, status: "cancelled", binding: "把军令交给玩家" });
    assert.equal(acceptedCancellation.result.status, "NO_DURABLE_CONTENT");
    assert.equal(readStatus(cancellationId), "cancelled");
  });
  await check("Legacy fallback: real finalization with zero canonical entries remains recallable without fabricating Detail", async () => {
    const sample = await fixture();
    sample.reply = () => "我对玩家说：LEGACY_ONLY_SENTINEL，旧日渡口谈话的细节仍须遵从来源。";
    sample.durableResponse = () => ({ status: "NO_DURABLE_CONTENT", entries: [] });
    await send(sample, "我对甲说：LEGACY_ONLY_SENTINEL，这是一段应保留而尚未转换的渡口往事。" );
    await finalize(sample);
    assert.equal(entries(sample).length, 0);
    for (const year of [1165, 1166, 1167]) {
      await sample.open(`${year}.1.1`);
      sample.reply = () => `我对玩家说：RECENT_LEGACY_${year}，这是最近交谈的另一件旧事。`;
      await send(sample, "我对甲说：请记住这次公开交谈。" );
      await finalize(sample);
    }
    await sample.open("1170.1.1");
    await send(sample, "1164年5月20日我们聊过什么？" );
    const recalled = packet(sample);
    assert(recalled.items.some(item => item.sourceRef.kind === "legacy"));
    assert(sample.requests.at(-1).messages.some(message => message.content.includes("LEGACY_ONLY_SENTINEL")));
    assert(sample.conversation.dynamicRecallHistory.get(2).size > 0);
  });
  await check("Letter: default blocks reject player-private and wrong-campaign/future history", async () => {
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
    assert(chat.includes("SELF=天才,") && chat.includes("PLAYER=眉清目秀,|"), JSON.stringify(chat.match(/SELF=[^\n]*|PLAYER=[^\n]*/g)));
    for (const secret of ["PLAYER=天才", "MOD_UNKNOWN_CHARACTER_TRAIT", "PLAYER_PRIVATE_PERSONALITY_SENTINEL"]) assert(!chat.includes(secret));
    sample.settings.getLetterPromptSettings = () => ({ mainTemplate: "SELF={{#each ai.traits}}{{name}},{{/each}}|PLAYER={{#each player.traits}}{{name}},{{/each}}|{{player.personality}}",
      blocks: [{ type: "main", enabled: true }, { type: "custom", enabled: true, template: "{{#each gameData.characters}}{{#each this.traits}}{{name}},{{/each}}|{{this.personality}}{{/each}}" }] });
    const letter = letterBuilder(sample).buildMessages(data, { content: "请回信。" }).map(message => message.content).join("\n");
    assert(letter.includes("SELF=天才,|PLAYER=眉清目秀,|"));
    assert(!letter.includes("MOD_UNKNOWN_CHARACTER_TRAIT") && !letter.includes("PLAYER_PRIVATE_PERSONALITY_SENTINEL"));
    assert.equal(data.getPlayer().traits.length, 6);
  });
  await check("Traits: familiar recognition never promotes negative/future/hypothetical canonical claims", async () => {
    const sample = await fixture();
    const data = sample.conversation.gameData;
    data.getPlayer().traits = [{ name: "天才", category: "ALL" }, { name: "MOD_UNKNOWN_CHARACTER_TRAIT", category: "ALL" }];
    data.getAi().relationsToPlayer = ["friend"];
    const proof = text => ({ campaignToken: sample.scope.campaignToken, ownerId: 2, entityIds: [1], acquiredDate: "1160.1.1",
      conversationDate: "1160.1.1", text, evidence: { knownBy: [2], visibility: "participants", sourceType: "witnessed", epistemicStatus: "observed" },
      source: { conversationId: "trait-proof", finalizationId: "trait-proof-final", messageIds: [1] } });
    for (const text of ["玩家并不是天才。", "玩家是天才，将来才会确定。", "如果玩家是天才，这只是设想。", "玩家是天才吗？", "玩家是天才，并不属实。", "玩家是 MOD_UNKNOWN_CHARACTER_TRAIT，这是谣言。"] ) {
      const view = traitSelector.createTraitProfileView(data, data.getAi(), { memory4Packet: { details: [{ traitKnowledgeEvidence: proof(text) }] },
        knownEntities: [{ entityId: 1, recognition: { level: "DIRECT_INTERACTION" } }] });
      assert.equal(view.gameData.getPlayer().traits.length, 0, text);
    }
    const permitted = traitSelector.createTraitProfileView(data, data.getAi(), { memory4Packet: { details: [{ traitKnowledgeEvidence: proof("玩家是天才。") }] } });
    assert.deepEqual(permitted.gameData.getPlayer().traits.map(trait => trait.name), ["天才"]);
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
