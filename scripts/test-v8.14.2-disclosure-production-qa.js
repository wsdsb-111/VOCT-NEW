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
const { createPromptConfigManager } = require("../resources/app/out/main/prompts/prompt-config-manager");
const { createTemplateEngine } = require("../resources/app/out/main/prompts/template-engine");
const { createLetterPromptBuilder } = require("../resources/app/out/main/prompts/letter-prompt-builder");
const { PromptScriptLoader } = require("../resources/app/out/main/prompts/prompt-script-loader");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { TokenCounter } = require("../resources/app/out/main/provider-service");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-disclosure-qa-"));
const promptsDir = path.resolve(__dirname, "../resources/app/default_userdata/prompts");
const fingerprint = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const names = new Map([[1, "玩家"], [2, "甲"], [3, "乙"], [4, "丙"], [99, "无关人物"]]);
const PromptConfigManager = createPromptConfigManager({ fs, path, promptsDir,
  defaultMainTemplatePath: path.join(promptsDir, "system/default.hbs"),
  defaultLetterTemplatePath: path.join(promptsDir, "system/letter.hbs"), defaultChatInstruction: "请回应本轮对话。" });
const promptConfigManager = new PromptConfigManager();
const TemplateEngine = createTemplateEngine({ Handlebars, fs, path, promptsHelpersDir: path.join(root, "helpers"),
  defaultPromptsDir: path.resolve(__dirname, "../resources/app/default_userdata"), PromptScriptSandbox });

let sequence = 0;
let passed = 0;
let failed = 0;

async function check(name, run) {
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    await run();
    passed++;
    log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
  } finally { console.log = log; console.warn = warn; }
}

function makeCharacter(id, { name = names.get(id), title = "", nickname = "", traits = [] } = {}) {
  const input = Array(28).fill("");
  input[0] = String(id); input[1] = name; input[2] = name; input[3] = title;
  input[4] = "he"; input[5] = "30"; input[6] = "100"; input[7] = "0"; input[18] = name; input[27] = nickname;
  const character = new Character(input);
  character.troops = { totalOwnedTroops: 0 };
  character.traits = traits.map(value => typeof value === "string" ? { name: value, category: "Other" } : { ...value });
  return character;
}

function findSpeakerId(message, participants) {
  const direct = Number(message.speakerCharacterId ?? message.characterId);
  if (Number.isSafeInteger(direct) && direct > 0) return direct;
  const match = participants.find(person => [person.name, person.fullName, person.shortName].includes(message.name));
  return match ? Number(match.id) : null;
}

function summarizeVisibleSource(sample) {
  const context = sample.conversation.buildFinalizationBaseContext();
  const people = context.participants || [];
  const idsAt = messageId => [...new Set(context.participantPresence.filter(window =>
    Number(window.joinedAtMessageId) <= messageId && (window.leftAtMessageId == null || messageId < Number(window.leftAtMessageId)))
    .map(window => Number(window.characterId)))];
  const segments = [];
  for (const message of context.messages || []) {
    if (!Number.isSafeInteger(message.id) || !["user", "assistant"].includes(message.role)) continue;
    const speakerId = findSpeakerId(message, people);
    if (!speakerId) continue;
    const present = idsAt(message.id);
    for (const text of String(message.content || "").split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
      const override = sample.classifySource(text, message, { speakerId, present, people });
      let visibility = override.visibility || "public";
      let participants = visibility === "private" ? [speakerId] : present;
      if (visibility === "known_group") participants = [speakerId, override.recipientId];
      segments.push({ content: text, participants, visibility, source: override.source || "spoken",
        messageIds: [message.id], speakerIds: [speakerId] });
    }
  }
  return { sessionSummary: "人物在场范围内结束了谈话。", summarySegments: segments, memories: [] };
}

async function fixture({ date = "1164.5.20", campaignToken = "votc-v8142-qa-campaign", responderId = 2,
  titleById = {}, nicknameById = {}, traitsById = {}, nameById = {}, noSummaryFolders = [], openConversation = true,
  mainTemplate = null } = {}) {
  const directory = path.join(root, String(++sequence));
  const summariesDir = path.join(directory, "summaries");
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const scope = { campaignToken, ownerId: responderId };
  const GameData = createGameData({ fs, path, memorySystem, memoryEngine: engine, summariesDir, getHistoricalReferenceByYear: () => null });
  const sample = { directory, summariesDir, engine, scope, titleById, nicknameById, traitsById, nameById,
    requests: [], summaryRequests: [], failDurable: false, response: () => "我听见了，仍依眼前可知之事谨慎作答。",
    classifySource: text => /心想|内心|暗想|默念/.test(text) ? { visibility: "private" }
      : /^旁白[：:]/.test(text) ? { source: "witnessed" } : ({}) };
  sample.createGameData = (currentDate = date, nextResponderId = responderId) => {
    const playerId = 1;
    const data = new GameData([String(playerId), names.get(playerId), String(nextResponderId), names.get(nextResponderId), currentDate,
      "conversationcourt", "临安", names.get(playerId), String(normalizeGameDate(currentDate).serial)]);
    data.campaignToken = sample.scope.campaignToken;
    for (const id of [1, 2, 3, 4, 99]) data.characters.set(id, makeCharacter(id, {
      name: sample.nameById[id] || names.get(id), title: sample.titleById[id] || "", nickname: sample.nicknameById[id] || "", traits: sample.traitsById[id] || []
    }));
    for (const character of data.characters.values()) if (!noSummaryFolders.includes(Number(character.id))) {
      fs.mkdirSync(data.getCharacterFolderPath(character.id, character.shortName), { recursive: true });
    }
    return data;
  };
  const diagnosticTemplate = "{{! VOTC_SEGMENT:character_base }}SELF={{#each traits}}{{name}},{{/each}}\n"
    + "{{! VOTC_SEGMENT:world_context }}{{#each (otherCharacters gameData.characters character.id)}}"
    + "{{#if (eq id 1)}}PLAYER_TITLE={{primaryTitle}}|PLAYER_NICK={{nickname}}|PLAYER_TRAITS={{#each traits}}{{name}},{{/each}}|{{personality}}"
    + "{{/if}}{{#if (eq id 2)}}A_TITLE={{primaryTitle}}|A_NICK={{nickname}}|A_TRAITS={{#each traits}}{{name}},{{/each}}"
    + "{{/if}}{{/each}}";
  const promptSettings = { mainTemplate: mainTemplate || diagnosticTemplate,
    blocks: [{ id: "main", type: "main", enabled: true, role: "system" }, { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "请依据你合法知道的事实回应。" }] };
  sample.settings = {
    getCK3DebugLogPath: () => path.join(directory, "fixture-debug.log"),
    getPromptSettings: () => promptSettings,
    getLetterPromptSettings: () => ({ blocks: promptConfigManager.getDefaultLetterBlocks(),
      mainTemplate: fs.readFileSync(path.join(promptsDir, "system/letter.hbs"), "utf8") }),
    getSummaryPromptSettings: () => ({ finalPrompt: "忠实记录原话、来源与在场边界。", finalSummaryMaxTokens: 4096 }),
    getActiveProviderConfig: () => ({ providerType: "openai-compatible", defaultModel: "deterministic-fixture", defaultParameters: { max_tokens: 4096 } }),
    getChatPromptV813Layout: () => true,
    getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89RuntimeProfileSplit: true, chatPromptV810ProviderAdapter: true }),
    getGlobalStreamSetting: () => false,
    getActionApprovalSettings: () => ({ pauseOnApproval: false })
  };
  sample.PromptBuilder = createPromptBuilder({ TemplateEngine, PromptScriptLoader, promptConfigManager,
    settingsRepository: sample.settings, path, TokenCounter, createPromptFingerprint: fingerprint, defaultChatInstruction: "请回应本轮对话。" });
  sample.llm = {
    getCurrentContextLength: async () => 65536,
    getProviderCapabilities: async () => ({ providerType: "fixture", modelId: "fixture", contextWindow: 65536, maxOutputTokens: 4096 }),
    sendChatRequest: async (messages, _signal, _callback, options) => {
      sample.requests.push({ messages, options });
      return { content: sample.response(options.responderId), finish_reason: "stop" };
    },
    sendSummaryRequest: async (_prompt, _signal, options) => {
      sample.summaryRequests.push(options.requestType);
      if (options.requestType === "memory4_durable") {
        if (sample.failDurable) throw new Error("deterministic_fixture_recovery");
        return JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] });
      }
      return { content: JSON.stringify(summarizeVisibleSource(sample)), finish_reason: "stop" };
    }
  };
  sample.worldline = {
    isSubjectivePromptIntegrationEnabled: () => false,
    isPromptIntegrationEnabled: () => false,
    getSettings: () => ({ v812MemoryEngine3Enabled: true, v812TemporalSummaryRecallEnabled: true }),
    getPromptContext: async () => null
  };
  engine.memory4.configureDerived({ isCampaignCurrent: () => true, getProviderSnapshot: async () => null });
  sample.open = async (currentDate = date, nextResponderId = responderId) => {
    const gameData = sample.createGameData(currentDate, nextResponderId);
    fs.writeFileSync(sample.settings.getCK3DebugLogPath(), "deterministic fixture only", "utf8");
    Conversation.configure({ memoryEngine: engine, settingsRepository: sample.settings, parseLog: async () => gameData,
      llmManager: sample.llm, PromptBuilder: sample.PromptBuilder, TokenCounter, createPromptFingerprint: fingerprint,
      runFileManager: { isAvailable: () => true, write: () => { throw new Error("fixture must not write RunFile"); } },
      createMessage: input => ({ type: "message", ...input }), createError: input => ({ type: "error", ...input }),
      ActionEngine: { evaluateForCharacter: async () => ({ autoApproved: [], needsApproval: [] }) }, usageAnalytics: { record() {} },
      events, uuid: { v4: () => `v8142-disclosure-${++sequence}` }, path, worldlineService: sample.worldline, logVerboseLLM: () => {} });
    const conversation = new Conversation();
    await conversation.gameDataReady;
    await conversation.worldlinePrefetchPromise;
    await conversation.memoryRecoveryPromise;
    assert(conversation.isActive, "real Conversation initialization must succeed");
    sample.conversation = conversation;
    return conversation;
  };
  if (openConversation) await sample.open();
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
  assert.equal(conversation.messages.filter(message => message.type === "error").length, 0);
}

async function finalize(sample, onOwnerSnapshot = null) {
  const coordinator = sample.engine.memory4;
  const originalFinishOwner = coordinator.finishOwner;
  if (onOwnerSnapshot) coordinator.finishOwner = function (snapshot, ...args) {
    onOwnerSnapshot(snapshot);
    return originalFinishOwner.call(this, snapshot, ...args);
  };
  try {
    const result = await sample.conversation.createFinalSummary();
    sample.lastFinalizationResult = result;
    assert(result.success, `real finalization failed: ${result.error || result.status}`);
    assert(sample.summaryRequests.includes("final_summary"), "fixture must exercise the real final summary boundary");
    assert(sample.summaryRequests.includes("memory4_durable"), "fixture must exercise the real Memory4 commit boundary");
    return result;
  } finally {
    coordinator.finishOwner = originalFinishOwner;
  }
}

function currentDisclosureRows(sample, ownerId, entityId, gameData = sample.conversation.gameData, campaignToken = sample.scope.campaignToken) {
  const scope = { campaignToken, ownerId };
  return sample.engine.memory4.getCurrentDisclosures(scope, entityId, gameData);
}

function disclosureRecords(sample, ownerId, entityId, gameData = sample.conversation.gameData, campaignToken = sample.scope.campaignToken) {
  return currentDisclosureRows(sample, ownerId, entityId, gameData, campaignToken).filter(record => record.status);
}

function storedDisclosureRecords(sample, ownerId, entityId, campaignToken = sample.scope.campaignToken) {
  const scope = { campaignToken, ownerId };
  const file = path.join(sample.engine.memory4.store.directory(scope), "known-entities.json");
  if (!fs.existsSync(file)) return [];
  const known = JSON.parse(fs.readFileSync(file, "utf8"));
  return Object.values(known.entities?.[String(entityId)]?.disclosedFacts || {});
}

function frozenDisclosureRows(sample, responderId, entityId) {
  const key = `${sample.scope.campaignToken}:${responderId}`;
  return sample.conversation.disclosureProfilesByResponder.get(key)?.get(Number(entityId)) || [];
}

function promptText(sample, responderId) {
  const request = sample.requests.filter(item => Number(item.options.responderId) === Number(responderId)).at(-1);
  assert(request, `expected a real Prompt request for responder ${responderId}`);
  return request.messages.map(message => message.content).join("\n");
}

function profileLine(sample, responderId, label) {
  const match = promptText(sample, responderId).match(new RegExp(`${label}=[^\\n]*`));
  assert(match, `expected ${label} in the real Prompt profile`);
  return match[0];
}

async function main() {
  let positive;
  await check("2P: explicit self title and hidden Trait persist only for the listening Owner", async () => {
    positive = await fixture({ titleById: { 1: "明王" }, traitsById: { 1: [{ id: "trait_bastard", name: "私生子", category: "Other" }] } });
    await send(positive, "我乃明王。我是私生子。" );
    await finalize(positive);
    const records = disclosureRecords(positive, 2, 1);
    assert(records.some(item => item.factType === "TITLE" && item.value === "明王"), JSON.stringify(positive.lastFinalizationResult.durable));
    assert(records.some(item => item.factType === "TRAIT" && item.factKey === "trait_bastard"));
    assert.deepEqual(disclosureRecords(positive, 3, 1), [], "a non-listening Owner receives no disclosure");
  });

  await check("3P: all present Owners learn the same public Fact, but self facts are not stored", async () => {
    const sample = await fixture({ titleById: { 2: "枢密使" } });
    await sample.conversation.joinWaitingCharacter(3);
    sample.response = id => Number(id) === 2 ? "我乃枢密使。" : "乙听见了。";
    await send(sample, "甲，请告诉众人你的身份。" );
    await finalize(sample);
    assert(disclosureRecords(sample, 3, 2).some(item => item.factType === "TITLE" && item.value === "枢密使"));
    assert.deepEqual(storedDisclosureRecords(sample, 2, 2), [], "the speaker already knows their Self Profile");
  });

  await check("whisper: only the named recipient receives the private Title", async () => {
    const sample = await fixture({ titleById: { 1: "明王" } });
    await sample.conversation.joinWaitingCharacter(3);
    sample.classifySource = (text, _message, { present, people }) => {
      if (!text.includes("凑到甲耳边")) return {};
      return { visibility: "known_group", recipientId: 2 };
    };
    await send(sample, "我凑到甲耳边，低声说：我乃明王。" );
    await finalize(sample);
    assert(disclosureRecords(sample, 2, 1).some(item => item.value === "明王"));
    assert.deepEqual(disclosureRecords(sample, 3, 1), [], "the third participant is outside the whisper ACL");
  });

  await check("3P: a late joiner does not receive earlier disclosure but does receive later disclosure", async () => {
    const sample = await fixture({ titleById: { 1: "明王" }, traitsById: { 1: [{ id: "intellect_good_3", name: "天才", category: "Other" }] } });
    await send(sample, "我乃明王。" );
    await sample.conversation.joinWaitingCharacter(3);
    await send(sample, "我乃天才。" );
    await finalize(sample);
    assert(disclosureRecords(sample, 3, 1).some(item => item.factType === "TRAIT" && item.value === "天才"));
    assert(!disclosureRecords(sample, 3, 1).some(item => item.factType === "TITLE" && item.value === "明王"),
      "the earlier source message predates the Owner's join window");
  });

  await check("3P: a departed participant does not receive a later public disclosure", async () => {
    const sample = await fixture({ titleById: { 1: "明王" } });
    await sample.conversation.joinWaitingCharacter(3);
    assert((await sample.conversation.temporarilyLeaveCharacter(3, "asleep")).success);
    await send(sample, "我乃明王。" );
    await finalize(sample);
    assert.deepEqual(disclosureRecords(sample, 3, 1), []);
  });

  await check("third-party claim: an exact unique character alias binds to that entity", async () => {
    const sample = await fixture({ titleById: { 2: "枢密使" } });
    await sample.conversation.joinWaitingCharacter(3);
    await send(sample, "甲是枢密使。" );
    await finalize(sample);
    assert(disclosureRecords(sample, 3, 2).some(item => item.factType === "TITLE" && item.value === "枢密使"));
  });

  await check("Chinese attributed speech does not disclose a third party's Title", async () => {
    const sample = await fixture({ titleById: { 3: "明王" }, nameById: { 3: "赵祯" } });
    await send(sample, "钟馗说赵祯是明王。" );
    await finalize(sample);
    assert.deepEqual(disclosureRecords(sample, 2, 3), [], "reported speech is not the speaker's firsthand assertion");
  });

  await check("quoted third-party speech does not disclose a Title", async () => {
    for (const text of ["钟馗说：‘赵祯是明王。’", "赵祯说：‘我是明王。’"]) {
      const sample = await fixture({ titleById: { 3: "明王" }, nameById: { 3: "赵祯" } });
      await send(sample, text);
      await finalize(sample);
      assert.deepEqual(disclosureRecords(sample, 2, 3), [], `quoted attribution must stay unverified: ${text}`);
    }
  });

  await check("negative adjective does not disclose the opposite Trait", async () => {
    const sample = await fixture({ traitsById: { 1: [{ id: "honest", name: "诚实", category: "Other" }] } });
    await send(sample, "我是不诚实的。" );
    await finalize(sample);
    assert(!disclosureRecords(sample, 2, 1).some(item => item.factType === "TRAIT" && item.factKey === "trait_honest"),
      "不诚实 must not be interpreted as an affirmative claim of 诚实");
  });

  await check("soft negative adjective does not disclose the opposite Trait", async () => {
    for (const text of ["我不太诚实。", "我是不太诚实的。"]) {
      const sample = await fixture({ traitsById: { 1: [{ id: "honest", name: "诚实", category: "Other" }] } });
      await send(sample, text);
      await finalize(sample);
      assert(!disclosureRecords(sample, 2, 1).some(item => item.factType === "TRAIT" && item.factKey === "trait_honest"),
        `soft negative must not be interpreted as an affirmative claim of 诚实: ${text}`);
    }
  });

  await check("ambiguous third-party alias and unresolved pronoun do not bind a target", async () => {
    const ambiguous = await fixture({ titleById: { 2: "明王", 3: "明王" }, nameById: { 2: "同名", 3: "同名" } });
    await ambiguous.conversation.joinWaitingCharacter(3);
    await send(ambiguous, "同名是明王。" );
    await finalize(ambiguous);
    assert.deepEqual(disclosureRecords(ambiguous, 2, 3), []);
    assert.deepEqual(disclosureRecords(ambiguous, 3, 2), []);

    const pronoun = await fixture({ titleById: { 2: "明王" } });
    await pronoun.conversation.joinWaitingCharacter(3);
    await send(pronoun, "他其实是明王。" );
    await finalize(pronoun);
    assert.deepEqual(disclosureRecords(pronoun, 3, 2), []);
  });

  await check("narration and private thought do not disclose to another Owner", async () => {
    const sample = await fixture({ titleById: { 2: "枢密使" } });
    await sample.conversation.joinWaitingCharacter(3);
    sample.response = id => Number(id) === 2 ? "旁白：甲是枢密使。\n甲心想：我也是枢密使。" : "乙沉默不语。";
    await send(sample, "甲，请说说你心中的身份。" );
    await finalize(sample);
    assert.deepEqual(disclosureRecords(sample, 3, 2), []);
    assert.deepEqual(storedDisclosureRecords(sample, 2, 2), []);
  });

  await check("fabricated final-summary claim lacks exact source-text proof and cannot disclose", async () => {
    const sample = await fixture({ titleById: { 1: "明王" } });
    await send(sample, "请说说你眼中的我。" );
    const originalSendSummaryRequest = sample.llm.sendSummaryRequest;
    sample.llm.sendSummaryRequest = async (prompt, signal, options) => {
      const result = await originalSendSummaryRequest(prompt, signal, options);
      if (options.requestType !== "final_summary") return result;
      const extraction = JSON.parse(result.content);
      const context = sample.conversation.buildFinalizationBaseContext();
      const source = context.messages.find(message => message.role === "user");
      assert(source, "fixture has a real user source message");
      const speakerId = findSpeakerId(source, context.participants);
      const present = [...new Set(context.participantPresence.filter(window => Number(window.joinedAtMessageId) <= source.id
        && (window.leftAtMessageId == null || source.id < Number(window.leftAtMessageId))).map(window => Number(window.characterId)))];
      extraction.summarySegments.push({ content: "玩家是明王。", participants: present, visibility: "public", source: "spoken",
        messageIds: [source.id], speakerIds: [speakerId] });
      result.content = JSON.stringify(extraction);
      return result;
    };
    const snapshots = [];
    await finalize(sample, snapshot => snapshots.push(snapshot));
    const ownerSnapshot = snapshots.find(snapshot => snapshot.ownerId === 2);
    const forgedFragment = ownerSnapshot?.fragments.find(fragment => fragment.text === "玩家是明王。");
    assert(forgedFragment, "the structurally valid but fabricated summary fragment reaches owner projection");
    assert.equal(forgedFragment.sourceTextVerified, false, "projection records that the claim is absent from the original message");
    assert.deepEqual(disclosureRecords(sample, 2, 1), [], "summary-only claims cannot create structured knowledge");
  });

  await check("multiple explicit Facts and targets are stored independently", async () => {
    const sample = await fixture({ titleById: { 2: "明王", 3: "枢密使" },
      traitsById: { 2: [{ id: "trait_bastard", name: "私生子", category: "Other" }] } });
    await sample.conversation.joinWaitingCharacter(3);
    await send(sample, "甲是明王，也是私生子；乙是枢密使。" );
    await finalize(sample);
    assert(disclosureRecords(sample, 3, 2).some(item => item.factType === "TITLE" && item.value === "明王"));
    assert(disclosureRecords(sample, 3, 2).some(item => item.factType === "TRAIT" && item.factKey === "trait_bastard"));
    assert(disclosureRecords(sample, 2, 3).some(item => item.factType === "TITLE" && item.value === "枢密使"));
  });

  for (const text of ["玩家不是明王。", "玩家可能是明王。", "玩家是否为明王？", "如果玩家是明王便好了。", "听说玩家乃明王。", "玩家未必是明王。"])
    await check(`epistemic rejection: ${text}`, async () => {
      const sample = await fixture({ titleById: { 1: "明王" } });
      await send(sample, text);
      await finalize(sample);
      assert.deepEqual(disclosureRecords(sample, 2, 1), []);
    });

  await check("finalized profile reaches the next real Prompt; current session remains frozen", async () => {
    const sample = await fixture({ titleById: { 1: "明王" } });
    const openingTitle = frozenDisclosureRows(sample, 2, 1).find(item => item.factType === "TITLE" && item.value === "明王");
    assert(openingTitle && openingTitle.status === null && !openingTitle.effectiveKnown,
      "Conversation initialization captured current candidates without inventing prior knowledge");
    await send(sample, "眼下尚无任何公开身份。" );
    assert(!profileLine(sample, 2, "PLAYER_TITLE").includes("明王"));
    await send(sample, "我乃明王。" );
    await finalize(sample);
    const frozenTitle = frozenDisclosureRows(sample, 2, 1).find(item => item.factType === "TITLE" && item.value === "明王");
    assert(frozenTitle && frozenTitle.status === null && !frozenTitle.effectiveKnown,
      "finalization does not mutate the initialized Conversation snapshot");
    await send(sample, "且再说一件事。" );
    assert(!profileLine(sample, 2, "PLAYER_TITLE").includes("明王"), "a finalized disclosure must not mutate the frozen current Prompt");
    await sample.open("1164.5.21", 2);
    assert(frozenDisclosureRows(sample, 2, 1).some(item => item.factType === "TITLE" && item.value === "明王"
      && item.status === "AUTO_DISCLOSED" && item.effectiveKnown), "new Conversation initialization captures the persisted profile without test injection");
    await send(sample, "请继续说。" );
    assert(profileLine(sample, 2, "PLAYER_TITLE").includes("明王"), "a new Conversation sees the persisted Owner disclosure");
  });

  await check("manual hidden outranks repeat disclosure; manual known is revision-guarded and reaches the next Prompt", async () => {
    const sample = await fixture({ titleById: { 1: "明王" } });
    await send(sample, "我乃明王。" );
    await finalize(sample);
    const scope = { campaignToken: sample.scope.campaignToken, ownerId: 2 };
    let title = currentDisclosureRows(sample, 2, 1).find(item => item.factType === "TITLE" && item.value === "明王");
    assert.equal(title.status, "AUTO_DISCLOSED");
    const fact = { factId: title.factId, factType: title.factType, factKey: title.factKey, value: title.value };
    const hidden = sample.engine.memory4.updateManualDisclosure(scope, 1, fact, "MANUAL_HIDDEN", sample.conversation.gameData,
      { expectedRevision: title.revision });
    assert.equal(hidden.effectiveKnown, false);
    assert.throws(() => sample.engine.memory4.updateManualDisclosure(scope, 1, fact, "MANUAL_KNOWN", sample.conversation.gameData,
      { expectedRevision: title.revision }), /memory4_disclosure_revision_stale/);

    await sample.open("1164.5.21", 2);
    await send(sample, "我乃明王。" );
    await finalize(sample);
    title = currentDisclosureRows(sample, 2, 1).find(item => item.factType === "TITLE" && item.value === "明王");
    assert.equal(title.status, "MANUAL_HIDDEN", "automatic evidence cannot override an explicit hidden choice");
    await sample.open("1164.5.22", 2);
    await send(sample, "请谈谈身份。" );
    assert(!profileLine(sample, 2, "PLAYER_TITLE").includes("明王"));

    title = currentDisclosureRows(sample, 2, 1).find(item => item.factType === "TITLE" && item.value === "明王");
    const known = sample.engine.memory4.updateManualDisclosure(scope, 1, fact, "MANUAL_KNOWN", sample.conversation.gameData,
      { expectedRevision: title.revision });
    assert.equal(known.effectiveKnown, true);
    await sample.open("1164.5.23", 2);
    await send(sample, "请谈谈身份。" );
    assert(profileLine(sample, 2, "PLAYER_TITLE").includes("明王"));
  });

  await check("Owner and Campaign scopes do not leak a valid disclosure across folders", async () => {
    const sample = await fixture({ titleById: { 1: "明王" } });
    await sample.conversation.joinWaitingCharacter(3);
    sample.classifySource = text => text.includes("凑到甲耳边") ? { visibility: "known_group", recipientId: 2 } : ({});
    await send(sample, "我凑到甲耳边，低声说：我乃明王。" );
    await finalize(sample);
    assert(disclosureRecords(sample, 2, 1).some(item => item.status === "AUTO_DISCLOSED"));
    assert(!disclosureRecords(sample, 3, 1).some(item => item.status), "another Owner's folder has no acquired evidence");
    const earlierDate = sample.createGameData("1164.5.19", 2);
    assert.deepEqual(disclosureRecords(sample, 2, 1, earlierDate), [], "acquired evidence cannot travel backward before its game date");
    const otherCampaign = "votc-v8142-qa-other-campaign";
    const otherGameData = sample.createGameData("1164.5.20", 2);
    otherGameData.campaignToken = otherCampaign;
    assert.deepEqual(disclosureRecords(sample, 2, 1, otherGameData, otherCampaign), [], "a different Campaign has no copied disclosure state");
  });

  await check("new finalization for the same Conversation invalidates its older Disclosure proof", async () => {
    const sample = await fixture({ titleById: { 1: "明王" } });
    await send(sample, "我乃明王。" );
    let firstSnapshot = null;
    await finalize(sample, snapshot => { if (snapshot.ownerId === 2) firstSnapshot = snapshot; });
    assert(disclosureRecords(sample, 2, 1).some(item => item.status === "AUTO_DISCLOSED"));

    const sourceMessage = sample.conversation.messages.find(message => message.role === "user");
    assert(sourceMessage, "find the original user source message");
    sourceMessage.content = "我尚未公开身份。";
    let secondSnapshot = null;
    await finalize(sample, snapshot => { if (snapshot.ownerId === 2) secondSnapshot = snapshot; });
    assert(firstSnapshot && secondSnapshot);
    assert.equal(secondSnapshot.conversationId, firstSnapshot.conversationId);
    assert.notEqual(secondSnapshot.finalizationId, firstSnapshot.finalizationId, "the edited finalization must have a distinct identity");

    const scope = { campaignToken: sample.scope.campaignToken, ownerId: 2 };
    const metadataPath = path.join(sample.engine.memory4.store.directory(scope), "metadata.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    assert.equal(metadata.knownEvidenceRevisions[hash([secondSnapshot.conversationId, 2])], secondSnapshot.sourceRevision);
    const title = currentDisclosureRows(sample, 2, 1).find(item => item.factType === "TITLE" && item.value === "明王");
    assert.equal(title.status, null, "the old finalization proof no longer matches the Owner's current source revision");
    assert.equal(title.effectiveKnown, false);
    await sample.open("1164.5.21", 2);
    await send(sample, "请谈谈身份。" );
    assert(!profileLine(sample, 2, "PLAYER_TITLE").includes("明王"), "a new Conversation must not revive the stale disclosure");
  });

  await check("archived Disclosure reads honor currentGameDate and fail closed when it is absent", async () => {
    const sample = await fixture({ date: "1165.1.1", titleById: { 1: "明王" } });
    await send(sample, "我乃明王。" );
    await finalize(sample);
    const scope = { campaignToken: sample.scope.campaignToken, ownerId: 2 };
    const beforeAcquisition = sample.engine.memory4.getCurrentDisclosures(scope, 1, null, { currentGameDate: "1164.5.20" });
    assert.deepEqual(beforeAcquisition, [], "archive before acquisition omits the future fact entirely, not just its effective flag");
    assert.deepEqual(sample.engine.memory4.getCurrentDisclosures(scope, 1, null), [], "missing archive date must not expose raw future records or null-status facts");
    const asOfAcquisition = sample.engine.memory4.getCurrentDisclosures(scope, 1, null, { currentGameDate: "1165.1.1" });
    assert(asOfAcquisition.some(item => item.factType === "TITLE" && item.value === "明王" && item.effectiveKnown));
  });

  await check("first validated inbound Letter can create only its Disclosure sidecar without an Owner summary folder", async () => {
    const sample = await fixture({ titleById: { 1: "明王" }, noSummaryFolders: [2], openConversation: false });
    const gameData = sample.createGameData();
    sample.conversation = { gameData };
    const scope = { campaignToken: sample.scope.campaignToken, ownerId: 2 };
    const ownerFolder = gameData.getCharacterFolderPath(2, names.get(2));
    assert(!fs.existsSync(ownerFolder), "the recipient must have no preexisting summary folder");
    assert.throws(() => sample.engine.memory4.store.directory(scope), /memory4_owner_folder_not_unique/,
      "ordinary reads must not create or widen an Owner scope");
    const result = sample.engine.memory4.recordLetterDisclosures({ campaignToken: sample.scope.campaignToken, date: "1164.5.20",
      ownerId: 2, senderId: 1, recipientId: 2, letterId: "letter-first-owner-folder",
      text: "玩家是明王。", characters: gameData.characters });
    assert.equal(result.status, "RECORDED");
    assert(disclosureRecords(sample, 2, 1).some(item => item.factType === "TITLE" && item.value === "明王"));
    assert(!fs.existsSync(ownerFolder), "letter disclosure must not fabricate a legacy summary folder");
    const sidecar = path.join(sample.summariesDir, ".memory4", "2", hash(sample.scope.campaignToken), "known-entities.json");
    assert(fs.existsSync(sidecar), "validated recipient knowledge gets a canonical Disclosure-only sidecar");
  });

  await check("real LetterPromptBuilder freezes title knowledge at the letter's own game date", async () => {
    const sample = await fixture({ date: "1165.1.1", titleById: { 1: "明王" } });
    const gameData = sample.conversation.gameData;
    sample.engine.memory4.recordLetterDisclosures({ campaignToken: sample.scope.campaignToken, date: "1164.5.20",
      ownerId: 2, senderId: 1, recipientId: 2, letterId: "letter-profile-asof",
      text: "玩家是明王。", characters: gameData.characters });
    sample.settings.getLetterPromptSettings = () => ({ blocks: [{ id: "main", type: "main", enabled: true, role: "system" }],
      mainTemplate: "LETTER_PLAYER_TITLE={{player.primaryTitle}}" });
    const LetterPromptBuilder = createLetterPromptBuilder({ TemplateEngine, PromptScriptLoader,
      settingsRepository: sample.settings, promptConfigManager, memoryEngine: sample.engine,
      PromptBuilder: sample.PromptBuilder, TokenCounter });
    const builder = new LetterPromptBuilder();
    const renderAt = date => builder.buildMessages(gameData, { letterId: "letter-profile-asof", content: "回信。",
      date, totalDays: normalizeGameDate(date).serial }).map(message => message.content).join("\n");
    assert(!renderAt("1164.5.19").includes("明王"), "letter predating the acquisition cannot borrow current knowledge");
    assert(renderAt("1164.5.20").includes("LETTER_PLAYER_TITLE=明王"), "the same letter scope reveals the fact on its acquisition date");
  });

  await check("durable failure recovery replays disclosure exactly once from the committed finalization", async () => {
    const sample = await fixture({ titleById: { 1: "明王" } });
    await send(sample, "我乃明王。" );
    sample.failDurable = true;
    const result = await finalize(sample);
    assert.equal(result.durable?.status, "PARTIAL_FAILURE", "the fixture must create a durable recovery record");
    assert.deepEqual(disclosureRecords(sample, 2, 1), [], "failed owner commit cannot publish disclosure");

    sample.failDurable = false;
    const recovered = await sample.engine.memory4.recoverPending(async () => JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }), {
      activeCampaignToken: sample.scope.campaignToken, isNarrativeCommitted: () => true
    });
    assert(recovered.length > 0 && recovered.every(item => ["NO_DURABLE_CONTENT", "NOT_PRESENT"].includes(item.status)),
      "recovery commits each pending owner without adding durable entries");
    assert(disclosureRecords(sample, 2, 1).some(item => item.status === "AUTO_DISCLOSED"));
    assert.deepEqual(await sample.engine.memory4.recoverPending(async () => JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }), {
      activeCampaignToken: sample.scope.campaignToken, isNarrativeCommitted: () => true
    }), [], "a completed recovery cannot duplicate the source");
  });

  await check("deleting a disclosure hides it in the next real Prompt and leaves a manual tombstone", async () => {
    const sample = await fixture({ titleById: { 1: "明王" } });
    await send(sample, "我乃明王。" );
    await finalize(sample);
    let title = currentDisclosureRows(sample, 2, 1).find(item => item.factType === "TITLE" && item.value === "明王");
    const fact = { factId: title.factId, factType: title.factType, factKey: title.factKey, value: title.value };
    const deleted = sample.engine.memory4.deleteDisclosure({ campaignToken: sample.scope.campaignToken, ownerId: 2 }, 1, fact,
      sample.conversation.gameData, { expectedRevision: title.revision });
    assert.equal(deleted.effectiveKnown, false);
    await sample.open("1164.5.21", 2);
    await send(sample, "请谈谈身份。" );
    assert(!profileLine(sample, 2, "PLAYER_TITLE").includes("明王"));
    title = currentDisclosureRows(sample, 2, 1).find(item => item.factType === "TITLE" && item.value === "明王");
    assert.equal(title.status, "MANUAL_HIDDEN");
    assert.equal(title.tombstone?.status, "MANUAL_HIDDEN");
  });

  await check("title change and Trait removal retain history but do not render stale Current Facts", async () => {
    const sample = await fixture({ titleById: { 1: "明王" }, traitsById: { 1: [{ id: "trait_bastard", name: "私生子", category: "Other" }] } });
    await send(sample, "我乃明王，也是私生子。" );
    await finalize(sample);
    sample.titleById = { 1: "皇帝" };
    sample.traitsById = { 1: [] };
    await sample.open("1165.1.1", 2);
    await send(sample, "请谈谈我的身份。" );
    assert(!profileLine(sample, 2, "PLAYER_TITLE").includes("皇帝"));
    assert(!profileLine(sample, 2, "PLAYER_TITLE").includes("明王"));
    assert(!profileLine(sample, 2, "PLAYER_TRAITS").includes("私生子"));
    assert.deepEqual(disclosureRecords(sample, 2, 1), [], "old Title and removed Trait are not current facts");
    const knownPath = path.join(sample.engine.memory4.store.directory(sample.scope), "known-entities.json");
    const known = JSON.parse(fs.readFileSync(knownPath, "utf8"));
    const history = Object.values(known.entities["1"].disclosedFacts || {});
    assert(history.some(item => item.value === "明王") && history.some(item => item.value === "私生子"),
      "old disclosure records remain as historical evidence");
  });

  await check("nickname stays visible by default and an unknown Mod Trait stays hidden", async () => {
    const sample = await fixture({ nicknameById: { 1: "北地之虎" },
      traitsById: { 1: [{ id: "mod_lineage_x", name: "九天玄月灵猫血统", category: "Body" }] } });
    await send(sample, "请说一句话。" );
    const line = profileLine(sample, 2, "PLAYER_NICK");
    assert(line.includes("北地之虎"));
    assert(!profileLine(sample, 2, "PLAYER_TRAITS").includes("九天玄月灵猫血统"));
    assert.deepEqual(disclosureRecords(sample, 2, 1), []);
  });
}

main().then(() => {
  console.log(`V8.14.2 Disclosure Production QA: ${passed} PASS, ${failed} FAIL (deterministic summaries, temporary data, no live Provider/CK3)`);
  if (failed) process.exitCode = 1;
}).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(() => {
  const resolved = path.resolve(root);
  assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("votc-v8142-disclosure-qa-"));
  fs.rmSync(resolved, { recursive: true, force: true });
});
