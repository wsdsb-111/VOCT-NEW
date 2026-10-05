"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const events = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Handlebars = require("../resources/app/node_modules/handlebars");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { Character } = require("../resources/app/out/main/game-data/character");
const { createPromptBuilder } = require("../resources/app/out/main/prompts/prompt-builder");
const { createPromptConfigManager } = require("../resources/app/out/main/prompts/prompt-config-manager");
const { createTemplateEngine } = require("../resources/app/out/main/prompts/template-engine");
const { PromptScriptLoader } = require("../resources/app/out/main/prompts/prompt-script-loader");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { TokenCounter } = require("../resources/app/out/main/provider-service");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");
const { scanVisibleDisclosures } = require("../resources/app/out/main/memory-system/memory4-disclosure");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-naming-disclosure-qa-"));
const promptsDir = path.resolve(__dirname, "../resources/app/default_userdata/prompts");
const fingerprint = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const names = new Map([[1, "赵太初"], [2, "张道素"], [3, "张道正"], [4, "张道正"]]);
const PromptConfigManager = createPromptConfigManager({ fs, path, promptsDir,
  defaultMainTemplatePath: path.join(promptsDir, "system/default.hbs"),
  defaultLetterTemplatePath: path.join(promptsDir, "system/letter.hbs"), defaultChatInstruction: "请回应本轮对话。" });
const promptConfigManager = new PromptConfigManager();
const TemplateEngine = createTemplateEngine({ Handlebars, fs, path,
  promptsHelpersDir: path.join(temporary, "helpers"),
  defaultPromptsDir: path.resolve(__dirname, "../resources/app/default_userdata"), PromptScriptSandbox });

let sequence = 0;
let passed = 0;
let failed = 0;

async function check(name, run) {
  try {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
  }
}

function makeCharacter(id, { name = names.get(id), age = 30, title = "", traits = [] } = {}) {
  const row = Array(28).fill("");
  row[0] = String(id); row[1] = name; row[2] = name; row[3] = title;
  row[4] = "he"; row[5] = String(age); row[6] = "100"; row[7] = "0"; row[18] = name;
  const character = new Character(row);
  character.troops = { totalOwnedTroops: 0 };
  character.traits = traits.map(value => typeof value === "string" ? { id: value, name: value, category: "Other" } : { ...value });
  return character;
}

function speakerId(message, participants) {
  const id = Number(message.speakerCharacterId ?? message.characterId);
  if (Number.isSafeInteger(id) && id > 0) return id;
  const person = participants.find(item => [item.name, item.fullName, item.shortName].includes(message.name));
  return person ? Number(person.id) : null;
}

function sourceSummary(sample) {
  const context = sample.conversation.buildFinalizationBaseContext();
  const people = context.participants || [];
  const presentAt = messageId => [...new Set(context.participantPresence.filter(window =>
    Number(window.joinedAtMessageId) <= messageId
      && (window.leftAtMessageId == null || messageId < Number(window.leftAtMessageId)))
    .map(window => Number(window.characterId)))];
  const segments = [];
  for (const message of context.messages || []) {
    if (!Number.isSafeInteger(message.id) || !["user", "assistant"].includes(message.role)) continue;
    if (sample.omitAssistantSummary && message.role === "assistant") continue;
    const id = speakerId(message, people);
    if (!id) continue;
    const present = presentAt(message.id);
    const text = String(message.content || "").trim();
    if (!text) continue;
    const isPrivate = /心想|内心|暗想|默念/.test(text);
    const content = sample.rewriteUserSummary && message.role === "user" ? sample.rewriteText : text;
    segments.push({ content, participants: isPrivate ? [id] : present,
      visibility: isPrivate ? "private" : "public", source: "spoken",
      messageIds: [message.id], speakerIds: [id] });
    if (sample.fabricateSummaryClaim && message.role === "user") {
      segments.push({ content: sample.fabricateSummaryClaim, participants: present, visibility: "public",
        source: "spoken", messageIds: [message.id], speakerIds: [id] });
    }
  }
  return { sessionSummary: "对话结束。", summarySegments: segments, memories: [] };
}

async function fixture({ date = "1044.11.8", playerAge = 23, playerTitle = "明王", playerTraits = ["勇敢"],
  directPlayerRelation = true, directMasterRelation = false, duplicateMasterName = false, response = "我听见了。",
  rewriteUserSummary = false, rewriteText = "", fabricateSummaryClaim = "", omitAssistantSummary = false,
  durableText = null, campaignToken = `naming-disclosure-${++sequence}` } = {}) {
  const directory = path.join(temporary, String(sequence));
  const summariesDir = path.join(directory, "summaries");
  for (const [id, name] of names) fs.mkdirSync(path.join(summariesDir, `${id}_${name}`), { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const GameData = createGameData({ fs, path, memorySystem: require("../resources/app/out/main/memory-system"),
    memoryEngine: engine, summariesDir, getHistoricalReferenceByYear: () => null });
  const sample = { directory, summariesDir, engine, scope: { campaignToken, ownerId: 2 }, date,
    playerAge, playerTitle, playerTraits, directPlayerRelation, directMasterRelation, duplicateMasterName,
    response, rewriteUserSummary, rewriteText, fabricateSummaryClaim, omitAssistantSummary, durableText,
    requests: [], summaryRequests: [], durablePayloads: [], snapshots: new Map(), prompts: [] };
  sample.createGameData = currentDate => {
    const data = new GameData(["1", names.get(1), "2", names.get(2), currentDate,
      "conversationcourt", "临安", names.get(1), String(normalizeGameDate(currentDate).serial)]);
    data.campaignToken = sample.scope.campaignToken;
    const player = makeCharacter(1, { age: sample.playerAge, title: sample.playerTitle, traits: sample.playerTraits });
    const owner = makeCharacter(2);
    owner.relationsToPlayer = sample.directPlayerRelation ? ["朋友"] : [];
    owner.relationsToCharacters = sample.directMasterRelation ? [{ id: 3, relations: ["teacher"] }] : [];
    data.characters.set(1, player);
    data.characters.set(2, owner);
    data.characters.set(3, makeCharacter(3));
    data.characters.set(4, makeCharacter(4, { name: sample.duplicateMasterName ? "张道正" : "李道正" }));
    return data;
  };
  const diagnosticTemplate = "{{! VOTC_SEGMENT:character_base }}SELF={{#each traits}}{{name}},{{/each}}\n"
    + "{{! VOTC_SEGMENT:world_context }}{{#each (otherCharacters gameData.characters character.id)}}"
    + "{{#if (eq id 1)}}PLAYER={{fullName}}|{{/if}}{{/each}}";
  const promptSettings = { mainTemplate: diagnosticTemplate,
    blocks: [{ id: "main", type: "main", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "请依据你合法知道的事实回应。" }] };
  sample.settings = {
    getCK3DebugLogPath: () => path.join(directory, "fixture-debug.log"),
    getPromptSettings: () => promptSettings,
    getLetterPromptSettings: () => ({ blocks: promptConfigManager.getDefaultLetterBlocks(),
      mainTemplate: fs.readFileSync(path.join(promptsDir, "system/letter.hbs"), "utf8") }),
    getSummaryPromptSettings: () => ({ finalPrompt: "忠实记录原话、来源与在场边界。", finalSummaryMaxTokens: 4096 }),
    getActiveProviderConfig: () => ({ providerType: "openai-compatible", defaultModel: "deterministic-fixture",
      defaultParameters: { max_tokens: 4096 } }),
    getChatPromptV813Layout: () => true,
    getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89RuntimeProfileSplit: true,
      chatPromptV810ProviderAdapter: true }),
    getGlobalStreamSetting: () => false,
    getActionApprovalSettings: () => ({ pauseOnApproval: false })
  };
  sample.PromptBuilder = createPromptBuilder({ TemplateEngine, PromptScriptLoader, promptConfigManager,
    settingsRepository: sample.settings, path, TokenCounter, createPromptFingerprint: fingerprint,
    defaultChatInstruction: "请回应本轮对话。" });
  sample.llm = {
    getCurrentContextLength: async () => 65536,
    getProviderCapabilities: async () => ({ providerType: "fixture", modelId: "fixture", contextWindow: 65536,
      maxOutputTokens: 4096 }),
    sendChatRequest: async (_messages, _signal, _callback, options) => {
      sample.requests.push(options);
      return { content: sample.response, finish_reason: "stop" };
    },
    sendSummaryRequest: async (prompt, _signal, options) => {
      sample.summaryRequests.push(options.requestType);
      if (options.requestType === "final_summary") return { content: JSON.stringify(sourceSummary(sample)), finish_reason: "stop" };
      if (options.requestType === "memory4_durable") {
        const payload = JSON.parse(prompt[1].content);
        sample.durablePayloads.push(payload);
        if (!sample.durableText || Number(payload.ownerId) !== sample.scope.ownerId) {
          return JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] });
        }
        const fragment = payload.fragments.find(item => item.text.includes("赵太初")) || payload.fragments[0];
        assert(fragment, "the real durable prompt must contain a source fragment");
        return JSON.stringify({ status: "STORE", entries: [{ memoryType: "MAJOR_EXPERIENCE",
          text: sample.durableText, fragmentIds: [fragment.fragmentId],
          entityIds: [...new Set([Number(fragment.speakerId), ...(fragment.entityIds || [])])],
          participantIds: fragment.participantIds || [], topics: ["相识"],
          eventTime: { status: "unknown", precision: "unknown" } }] });
      }
      return JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] });
    }
  };
  sample.worldline = { isSubjectivePromptIntegrationEnabled: () => false,
    isPromptIntegrationEnabled: () => false, getSettings: () => ({ v812MemoryEngine3Enabled: true,
      v812TemporalSummaryRecallEnabled: true }), getPromptContext: async () => null };
  engine.memory4.configureDerived({ isCampaignCurrent: () => true, getProviderSnapshot: async () => null });
  const gameData = sample.createGameData(date);
  fs.writeFileSync(sample.settings.getCK3DebugLogPath(), "deterministic fixture only", "utf8");
  Conversation.configure({ memoryEngine: engine, settingsRepository: sample.settings, parseLog: async () => gameData,
    llmManager: sample.llm, PromptBuilder: sample.PromptBuilder, TokenCounter, createPromptFingerprint: fingerprint,
    runFileManager: { isAvailable: () => true, write: () => { throw new Error("fixture must not write RunFile"); } },
    createMessage: input => ({ type: "message", ...input }), createError: input => ({ type: "error", ...input }),
    ActionEngine: { evaluateForCharacter: async () => ({ autoApproved: [], needsApproval: [] }) },
    usageAnalytics: { record() {} }, events, uuid: { v4: () => `naming-disclosure-${++sequence}` }, path,
    worldlineService: sample.worldline, logVerboseLLM: () => {} });
  sample.conversation = new Conversation();
  await sample.conversation.gameDataReady;
  await sample.conversation.worldlinePrefetchPromise;
  await sample.conversation.memoryRecoveryPromise;
  assert(sample.conversation.isActive, "isolated production Conversation must initialize");
  const buildOwnerSnapshot = engine.memory4.buildOwnerSnapshot.bind(engine.memory4);
  engine.memory4.buildOwnerSnapshot = (context, ownerId) => {
    const snapshot = buildOwnerSnapshot(context, ownerId);
    sample.snapshots.set(Number(ownerId), snapshot);
    return snapshot;
  };
  const buildPrompt = engine.memory4.buildPrompt.bind(engine.memory4);
  engine.memory4.buildPrompt = (...args) => {
    const result = buildPrompt(...args);
    sample.prompts.push({ ownerId: Number(args[0].ownerId), snapshot: args[0], payload: JSON.parse(result[1].content), system: result[0].content });
    return result;
  };
  return sample;
}

async function send(sample, text) {
  await sample.conversation.sendMessage(text);
  const deadline = Date.now() + 10000;
  while (sample.conversation.activeResponse || sample.conversation.npcQueue.length) {
    assert(Date.now() < deadline, "fixture Conversation response queue stalled");
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(sample.conversation.messages.filter(message => message.type === "error").length, 0);
}

async function finalize(sample) {
  const result = await sample.conversation.createFinalSummary();
  assert(result.success, `real finalization failed: ${result.error || result.status}`);
  assert(sample.summaryRequests.includes("final_summary"), "must cross the production final summary boundary");
  assert(sample.summaryRequests.includes("memory4_durable"), "must cross the production durable prompt and store boundary");
  return result;
}

function ownerPrompt(sample, ownerId = 2) {
  return [...sample.prompts].reverse().find(item => item.ownerId === ownerId) || null;
}

function profileFacts(sample, ownerId = 2, targetId = 1, gameData = sample.conversation.gameData) {
  return sample.engine.memory4.getKnownEntityProfile({ campaignToken: sample.scope.campaignToken, ownerId }, targetId,
    { gameData }).disclosedFacts;
}

function annotateSpeech(context) {
  return { ...context, finalizationVisibilityV1: true, messages: context.messages.map(message => {
    if (!["user", "assistant"].includes(message.role) || !String(message.content || "").length) return message;
    return { ...message, memory4Fragments: [{ start: 0, end: message.content.length, visibility: "participants",
      sourceType: "spoken", recipientIds: [], entityIds: [] }] };
  }) };
}

async function main() {
  let positive = null;

  await check("full Conversation finalization binds player, Owner, and named master; source facts reach Profile", async () => {
    positive = await fixture({ rewriteUserSummary: true,
      rewriteText: "赵太初自述二十三岁、自称明王且很勇敢，师父张道正曾教他守正。",
      durableText: "赵太初告诉张道素，师父张道正曾教他守正。" });
    await send(positive, "我叫赵太初。\n我今年二十三岁。\n我乃明王。\n我很勇敢。\n师父张道正曾教我守正。");
    const baseContext = positive.conversation.buildFinalizationBaseContext();
    const userSource = baseContext.messages.find(message => message.role === "user");
    assert.equal(userSource.id, 0, "the first production user source intentionally has messageId 0");
    const result = await finalize(positive);
    const snapshot = positive.snapshots.get(2);
    assert(snapshot.fragments.some(fragment => fragment.sourceTextVerified === true
      && fragment.text === "我叫赵太初。"),
    "the original player paragraph must remain source-verified even when the summary rewrites it");
    assert(snapshot.entityNameEvidence.some(row => row.entityId === 1 && row.name === "赵太初"
      && row.evidence.some(item => item.source === "SOURCE_EXPLICIT_NAME" && item.sourceMessageIds.includes(0))));
    assert(snapshot.entityNameEvidence.some(row => row.entityId === 2 && row.name === "张道素"
      && row.evidence.some(item => item.source === "OWNER_SELF")));
    assert(snapshot.entityNameEvidence.some(row => row.entityId === 3 && row.name === "张道正"
      && row.evidence.some(item => item.source === "SOURCE_EXPLICIT_NAME")));
    const prompt = ownerPrompt(positive);
    assert(prompt, "the NPC Owner must receive a real durable prompt");
    const namedFragments = prompt.payload.fragments.filter(fragment => fragment.text.includes("张道正"));
    assert(namedFragments.some(fragment => fragment.entityNames.some(row => row.entityId === 3 && row.name === "张道正")));
    assert(prompt.system.includes("Owner means the memory holder"));
    assert(prompt.system.includes("never a master or 主人"));
    assert.equal(result.durable?.status, "COMPLETE");
    assert.equal(result.durable?.owners?.find(owner => owner.ownerId === 2)?.status, "STORE");
    const stored = positive.engine.memory4.store.query(positive.scope);
    assert(stored.some(entry => entry.text === "赵太初告诉张道素，师父张道正曾教他守正。"
      && entry.entityIds.includes(1) && entry.entityIds.includes(3)));
    const facts = profileFacts(positive);
    assert(facts.some(fact => fact.factType === "TITLE" && fact.value === "明王" && fact.effectiveKnown));
    assert(facts.some(fact => fact.factType === "TRAIT" && fact.value === "勇敢" && fact.effectiveKnown));
    const age = facts.find(fact => fact.factType === "AGE" && fact.value === "23");
    assert(age && age.effectiveKnown && age.current === false && age.firstAcquiredDate === "1044.11.8");
    const ageChanged = { ...positive.conversation.gameData, date: "1044.11.9", characters: new Map(positive.conversation.gameData.characters) };
    ageChanged.characters.set(1, { ...ageChanged.characters.get(1), age: 24 });
    const historicalAge = profileFacts(positive, 2, 1, ageChanged).find(fact => fact.factType === "AGE");
    assert.equal(historicalAge.value, "23", "a later runtime age must not recalculate the disclosure");
    assert.equal(historicalAge.firstAcquiredDate, "1044.11.8");
    assert(result.success);
  });

  await check("Owner is rendered by the Owner's actual name, never as a person named 主人", async () => {
    const sample = await fixture({ directPlayerRelation: false });
    await send(sample, "我和你说一件事。");
    await finalize(sample);
    const prompt = ownerPrompt(sample);
    assert(prompt);
    const rows = prompt.payload.fragments.flatMap(fragment => fragment.entityNames);
    assert(rows.some(row => row.entityId === 2 && row.name === "张道素"));
    assert(!rows.some(row => row.name === "主人"));
    assert(!rows.some(row => row.entityId === 1), "same-scene player identity alone does not expose a backend name");
  });

  await check("a legacy context without finalizationVisibilityV1 does not bridge unannotated speech to another Owner", async () => {
    const sample = await fixture({ directPlayerRelation: false });
    await send(sample, "我乃明王。");
    const legacy = sample.conversation.buildFinalizationBaseContext();
    delete legacy.finalizationVisibilityV1;
    legacy.messages = legacy.messages.map(message => ({ ...message, memory4Fragments: undefined }));
    const snapshot = sample.engine.memory4.buildOwnerSnapshot(legacy, 2);
    assert(!snapshot.fragments.some(fragment => fragment.text.includes("我乃明王。")));
    assert(!snapshot.entityNameEvidence.some(row => row.entityId === 1));
    sample.engine.memory4.store.recordKnownEvidence(snapshot);
    const known = sample.engine.memory4.store.getKnownEntityEvidence(sample.scope, 1, { currentGameDate: sample.date });
    assert.equal(known.status, "SHARED_SCENE");
    assert.equal(known.directConversationCount, 0);
    assert.equal(known.sharedSceneCount, 1);
  });

  await check("removing one speech annotation from a reciprocal exchange downgrades Direct Interaction to Shared Scene", async () => {
    const sample = await fixture({ directPlayerRelation: false });
    await send(sample, "我乃明王。");
    const context = annotateSpeech(sample.conversation.buildFinalizationBaseContext());
    const initial = sample.engine.memory4.buildOwnerSnapshot(context, 2);
    assert(initial.counterpartIds.includes(1), "both annotated speakers establish a direct pair");
    sample.engine.memory4.store.recordKnownEvidence(initial);
    assert.equal(sample.engine.memory4.store.getKnownEntityEvidence(sample.scope, 1,
      { currentGameDate: sample.date }).status, "DIRECT_INTERACTION");

    const legacy = { ...context };
    delete legacy.finalizationVisibilityV1;
    legacy.messages = legacy.messages.map(message => message.role === "user"
      ? { ...message, memory4Fragments: undefined } : message);
    const downgraded = sample.engine.memory4.buildOwnerSnapshot(legacy, 2);
    assert(!downgraded.fragments.some(fragment => fragment.text === "我乃明王。"),
      "without the native flag, raw speech cannot fill the removed annotation");
    assert(!downgraded.counterpartIds.includes(1));
    sample.engine.memory4.store.recordKnownEvidence(downgraded);
    const known = sample.engine.memory4.store.getKnownEntityEvidence(sample.scope, 1, { currentGameDate: sample.date });
    assert.equal(known.status, "SHARED_SCENE");
    assert.equal(known.directConversationCount, 0);
    assert.equal(known.sharedSceneCount, 1);
  });

  await check("a unique explicit third-party name binds to the right entity without relationship inference", async () => {
    const sample = await fixture({ directPlayerRelation: false, directMasterRelation: false });
    await send(sample, "师父张道正曾教我守正。");
    await finalize(sample);
    const snapshot = sample.snapshots.get(2);
    assert(snapshot.entityNameEvidence.some(row => row.entityId === 3 && row.name === "张道正"
      && row.evidence.some(item => item.source === "SOURCE_EXPLICIT_NAME")));
    assert(ownerPrompt(sample).payload.fragments.some(fragment => fragment.entityNames.some(row => row.entityId === 3
      && row.name === "张道正")));
  });

  await check("generic 天师/师父 labels do not infer an unnamed third person's identity", async () => {
    const sample = await fixture({ directPlayerRelation: false, directMasterRelation: true });
    await send(sample, "天师（师父）曾吩咐我站桩满七天。");
    await finalize(sample);
    const snapshot = sample.snapshots.get(2);
    assert(!snapshot.entityNameEvidence.some(row => row.entityId === 3));
    assert(!ownerPrompt(sample).payload.fragments.some(fragment => fragment.entityNames.some(row => row.entityId === 3)));
    assert(!snapshot.relationshipEvidence.some(row => row.entityId === 3),
      "a generic role phrase does not add an otherwise unmentioned entity to the source");
  });

  await check("ambiguous duplicate proper names do not bind either character", async () => {
    const sample = await fixture({ duplicateMasterName: true, directPlayerRelation: false });
    await send(sample, "师父张道正曾教我守正。");
    await finalize(sample);
    const snapshot = sample.snapshots.get(2);
    assert(!snapshot.entityNameEvidence.some(row => [3, 4].includes(row.entityId)));
    assert(!ownerPrompt(sample).payload.fragments.some(fragment => fragment.entityNames.some(row => [3, 4].includes(row.entityId))));
  });

  await check("conversation presence without source disclosure or direct relationship does not reveal the player's backstage name", async () => {
    const sample = await fixture({ directPlayerRelation: false });
    await send(sample, "我站在你面前，想谈谈粮食。");
    await finalize(sample);
    const snapshot = sample.snapshots.get(2);
    assert(!snapshot.entityNameEvidence.some(row => row.entityId === 1 && row.name === "赵太初"));
    assert(!ownerPrompt(sample).payload.fragments.some(fragment => fragment.entityNames.some(row => row.entityId === 1)));
  });

  await check("a private self-thought does not enter another Owner's names, AGE, or Profile", async () => {
    const sample = await fixture();
    await send(sample, "我心想：师父张道正教过我，我今年二十三岁。");
    await finalize(sample);
    const snapshot = sample.snapshots.get(2);
    assert(!snapshot.fragments.some(fragment => fragment.text.includes("张道正") || fragment.text.includes("二十三岁")));
    assert(!snapshot.entityNameEvidence.some(row => row.entityId === 3));
    assert(!profileFacts(sample).some(fact => fact.factType === "AGE"));
  });

  await check("unmarked assistant third-person narration cannot authorize a name for durable memory", async () => {
    const sample = await fixture({ response: "旁白：师父张道正走入大殿。", omitAssistantSummary: true });
    await send(sample, "请告诉我发生了什么。");
    const assistant = sample.conversation.messages.find(message => message.role === "assistant");
    assert(assistant && !assistant.memory4Fragments?.length, "fixture is an unmarked assistant narration");
    await finalize(sample);
    const authorSnapshot = sample.snapshots.get(2);
    const authorPrompt = ownerPrompt(sample, 2);
    assert(authorPrompt);
    assert(!authorSnapshot.entityNameEvidence.some(row => row.entityId === 3));
    assert(authorSnapshot.fragments.some(fragment => fragment.text.includes("旁白：师父张道正")
      && fragment.visibilityEvidence === "legacy_author_perspective"
      && !fragment.entityIds.includes(3)), "the author may retain the unmarked narration only as self-only Legacy");
    assert(!authorPrompt.payload.fragments.some(fragment => fragment.entityIds.includes(3)
      || fragment.allowedEntityIds.includes(3) || fragment.entityNames.some(row => row.entityId === 3)),
    "unmarked assistant narration cannot authorize a third-party entity binding");
    const otherOwnerSnapshot = sample.snapshots.get(1);
    assert(otherOwnerSnapshot);
    assert(!otherOwnerSnapshot.fragments.some(fragment => fragment.text.includes("旁白：师父张道正")),
      "unmarked assistant narration is not visible to a different Owner");
  });

  await check("a summary-only fabricated title is rejected while the exact original message remains the source", async () => {
    const sample = await fixture({ playerTitle: "明王", playerTraits: ["勇敢"],
      fabricateSummaryClaim: "我乃明王，也是勇敢。" });
    await send(sample, "请聊聊今后的收成。");
    await finalize(sample);
    assert(!profileFacts(sample).some(fact => fact.effectiveKnown), "summary-only facts must not create disclosures");
    const snapshot = sample.snapshots.get(2);
    assert(snapshot.fragments.some(fragment => fragment.sourceTextVerified === true
      && fragment.text === "请聊聊今后的收成。"));
    assert(!snapshot.fragments.some(fragment => fragment.sourceTextVerified === true && fragment.text.includes("明王")));
  });

  await check("an age self-claim that disagrees with current CK3 age is not a verified AGE disclosure", async () => {
    const sample = await fixture({ playerAge: 26, playerTraits: [], playerTitle: "" });
    await send(sample, "我今年二十岁。");
    await finalize(sample);
    assert(!profileFacts(sample).some(fact => fact.factType === "AGE"),
      "the source claim 20 must not be changed into a disclosure of CK3 age 26");
  });

  await check("historical, hypothetical, negated, and uncertain ages do not become current AGE facts", async () => {
    for (const text of ["我当年二十三岁。", "我可能二十三岁。", "我不是二十三岁。", "将来我二十三岁。", "听说我二十三岁。"]) {
      const sample = await fixture({ playerAge: 23, playerTraits: [], playerTitle: "" });
      await send(sample, text);
      await finalize(sample);
      assert(!profileFacts(sample).some(fact => fact.factType === "AGE"), `non-current claim must not disclose AGE: ${text}`);
    }
  });

  await check("AGE proof is campaign- and Owner-scoped, date-gated, and invalid dates fail closed", async () => {
    assert(positive, "the first integration fixture must have persisted one historical AGE fact");
    const gameData = positive.conversation.gameData;
    assert(!positive.engine.memory4.getCurrentDisclosures({ campaignToken: "other-campaign", ownerId: 2 }, 1,
      { ...gameData, campaignToken: "other-campaign" }).some(fact => fact.factType === "AGE"),
    "another Campaign cannot borrow the AGE proof");
    assert(!positive.engine.memory4.getCurrentDisclosures({ campaignToken: positive.scope.campaignToken, ownerId: 4 }, 1,
      gameData).some(fact => fact.factType === "AGE"), "another Owner cannot borrow the AGE proof");
    const snapshot = positive.snapshots.get(2);
    const invalid = scanVisibleDisclosures({ ...snapshot, date: "1044.2.30" }, gameData);
    assert(!invalid.disclosures.some(fact => fact.factType === "AGE"), "an invalid source date cannot create an AGE disclosure");
    const before = positive.engine.memory4.getCurrentDisclosures(positive.scope, 1,
      { ...gameData, date: "1044.11.7" });
    assert(!before.some(fact => fact.factType === "AGE"), "the proof remains invisible before its acquisition date");
  });

  console.log(`V8.14.2 naming/disclosure independent QA: ${passed} PASS, ${failed} FAIL (production Conversation/Memory4 path, temporary deterministic fixtures)`);
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(() => {
  const target = path.resolve(temporary);
  assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(target, { recursive: true, force: true });
});
