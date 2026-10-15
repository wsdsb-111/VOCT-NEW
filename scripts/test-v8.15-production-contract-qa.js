"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
const { PromptScriptLoader } = require("../resources/app/out/main/prompts/prompt-script-loader");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { TokenCounter } = require("../resources/app/out/main/provider-service");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v815-production-contract-qa-"));
const promptsDir = path.resolve(__dirname, "../resources/app/default_userdata/prompts");
const campaignToken = "votc-v815-production-contract-campaign";
const fingerprint = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const names = new Map([[1, "玩家"], [2, "张道素"], [3, "赵光义"], [4, "赵匡胤"], [5, "旧友"]]);
const PromptConfigManager = createPromptConfigManager({ fs, path, promptsDir,
  defaultMainTemplatePath: path.join(promptsDir, "system/default.hbs"),
  defaultLetterTemplatePath: path.join(promptsDir, "system/letter.hbs"), defaultChatInstruction: "请依本轮所知回应。" });
const promptConfigManager = new PromptConfigManager();
const TemplateEngine = createTemplateEngine({ Handlebars, fs, path, promptsHelpersDir: path.join(root, "helpers"),
  defaultPromptsDir: path.resolve(__dirname, "../resources/app/default_userdata"), PromptScriptSandbox });
const promptSettings = { mainTemplate: "{{! VOTC_SEGMENT:stable_global }}仅依据本角色合法所知的事实回应。\n{{! VOTC_SEGMENT:world_context }}当前时间：{{gameData.date}}。",
  blocks: [{ id: "main", type: "main", enabled: true, role: "system" }, { id: "history", type: "history", enabled: true },
    { id: "instruction", type: "instruction", enabled: true, role: "user", template: "请回应本轮对话。" }] };
const settings = {
  getPromptSettings: () => promptSettings,
  getLetterPromptSettings: () => ({ blocks: promptConfigManager.getDefaultLetterBlocks(),
    mainTemplate: fs.readFileSync(path.join(promptsDir, "system/letter.hbs"), "utf8") }),
  getSummaryPromptSettings: () => ({ finalPrompt: "忠实记录来源和边界。", finalSummaryMaxTokens: 4096 }),
  getActiveProviderConfig: () => ({ providerType: "openai-compatible", defaultModel: "fixture", defaultParameters: { max_tokens: 4096 } }),
  getChatPromptV813Layout: () => false,
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89RuntimeProfileSplit: true, chatPromptV810ProviderAdapter: true })
};
const PromptBuilder = createPromptBuilder({ TemplateEngine, PromptScriptLoader, promptConfigManager, settingsRepository: settings,
  path, TokenCounter, createPromptFingerprint: fingerprint, defaultChatInstruction: "请依本轮所知回应。" });
let sequence = 0;

function makeCharacter(id) {
  const name = names.get(id) || `人物${id}`;
  const input = Array(28).fill("");
  input[0] = String(id); input[1] = name; input[2] = name; input[3] = id === 3 || id === 4 ? "皇帝" : "";
  input[4] = "he"; input[5] = "30"; input[6] = "100"; input[7] = "0"; input[18] = name;
  const character = new Character(input);
  if (id === 3 || id === 4) character.primaryTitle = "皇帝";
  character.troops = { totalOwnedTroops: 0 };
  return character;
}

function writeRows(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), "utf8");
}

function summaryRow({ ownerId = 2, counterpartId = 5, subjectIds = [], content, date = "1164.1.1",
  campaign = campaignToken, finalizationId = `final-${++sequence}`, conversationId = `conversation-${sequence}`,
  segmentId = `segment-${sequence}`, perspectiveMemoryIds = [], perspectiveOwnerId = ownerId } = {}) {
  const profiles = [...new Set([ownerId, counterpartId, ...subjectIds])].map(id => ({ id, name: names.get(id) || `人物${id}`,
    shortName: names.get(id) || `人物${id}`, fullName: names.get(id) || `人物${id}`, primaryTitle: id === 3 || id === 4 ? "皇帝" : "" }));
  return { playerId: ownerId, characterId: counterpartId, perspectiveOwnerId, playerName: names.get(ownerId),
    characterName: names.get(counterpartId) || `人物${counterpartId}`, content, date,
    totalDays: normalizeGameDate(date)?.serial ?? null, campaignToken: campaign, campaignBinding: { status: "bound" },
    finalizationId, conversationId, perspectiveSummarySegmentIds: [segmentId], perspectiveMemoryIds, participants: profiles };
}

function createHarness({ directory, rows = [], activeIds = [1, 2], date = "1180.8.11" }) {
  const summariesDir = path.join(directory, "summaries");
  const ownerFolder = path.join(summariesDir, "2_张道素");
  if (rows.length) writeRows(path.join(ownerFolder, "与旧友的对话.json"), rows);
  else fs.mkdirSync(ownerFolder, { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const GameData = createGameData({ fs, path, memorySystem, memoryEngine: engine, summariesDir, getHistoricalReferenceByYear: () => null });
  const gameData = new GameData(["1", names.get(1), "2", names.get(2), date, "conversationcourt", "临安", names.get(2),
    String(normalizeGameDate(date).serial)]);
  gameData.campaignToken = campaignToken;
  for (const id of [1, 2, 3, 4, 5]) gameData.characters.set(id, makeCharacter(id));
  for (const character of gameData.characters.values()) {
    fs.mkdirSync(gameData.getCharacterFolderPath(character.id, character.shortName), { recursive: true });
  }
  const worldlineService = { getSettings: () => ({ v812MemoryEngine3Enabled: true, v812TemporalSummaryRecallEnabled: true }),
    isSubjectivePromptIntegrationEnabled: () => false, getPromptContext: () => null };
  Conversation.configure({ memoryEngine: engine, settingsRepository: settings,
    llmManager: { getCurrentContextLength: async () => 65536 }, PromptBuilder, TokenCounter,
    usageAnalytics: { record() {} }, createPromptFingerprint: fingerprint, path, worldlineService });
  const createConversation = query => {
    const conversation = Object.create(Conversation.prototype);
    conversation.id = `qa-conversation-${++sequence}`;
    conversation.gameData = gameData;
    conversation.messages = [{ id: 1, role: "user", content: query }];
    conversation.memoryState = engine.createConversationState(conversation.id);
    conversation.memoryState.participantPresence = activeIds.map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null }));
    conversation.turnEpoch = 1;
    conversation.frozenMemoryBudget = null;
    conversation.stableProfileCache = new Map();
    conversation.disclosureProfilesByResponder = new Map();
    conversation.cacheV2FrozenSnapshots = { conversation: null, responders: new Map(), prefixByResponder: new Map() };
    conversation.dynamicRecallHistory = new Map();
    conversation.getHistory = () => conversation.messages;
    conversation.getHistoryForCharacter = () => conversation.messages;
    conversation.getPromptHistoryForCharacter = () => conversation.messages;
    conversation.getPromptSummaryForCharacter = () => "";
    conversation.getActiveConversationCharacters = () => activeIds.map(id => gameData.characters.get(Number(id))).filter(Boolean);
    conversation.buildPresenceContext = () => "";
    conversation.isV813PrefixEnabled = () => false;
    return conversation;
  };
  return { directory, summariesDir, ownerFolder, engine, gameData, createConversation };
}

async function providerInput(harness, query) {
  const conversation = harness.createConversation(query);
  const responder = harness.gameData.characters.get(2);
  const memoryContext = await conversation.getMemoryContextFor(responder, 65536);
  const messages = PromptBuilder.buildMessagesWithTokenCount(conversation.messages, responder, harness.gameData, "", memoryContext).messages;
  return { conversation, memoryContext, messages, text: messages.map(message => message.content || "").join("\n") };
}

async function testPromptRoutingAndScope() {
  const valid = summaryRow({ subjectIds: [3], content: "赵光义在北境议和时亲口留下 VALID_C_HISTORY_SENTINEL。" });
  const future = summaryRow({ subjectIds: [3], content: "赵光义说了 FUTURE_DATE_FORBIDDEN_SENTINEL。", date: "1181.1.1" });
  const wrongCampaign = summaryRow({ subjectIds: [3], content: "赵光义说了 WRONG_CAMPAIGN_FORBIDDEN_SENTINEL。", campaign: "foreign-campaign" });
  const wrongOwner = summaryRow({ subjectIds: [3], content: "赵光义说了 WRONG_OWNER_FORBIDDEN_SENTINEL。", perspectiveOwnerId: 99 });
  const harness = createHarness({ directory: path.join(root, "routing"), rows: [valid, future, wrongCampaign, wrongOwner], activeIds: [1, 2, 3] });
  const mixedNameQuery = await providerInput(harness, "皇帝赵光义当时怎么说");
  assert.deepEqual(mixedNameQuery.memoryContext.entityTargetRecall.explicitTargetEntityIds, [3]);
  assert(mixedNameQuery.text.includes("皇帝赵光义当时怎么说"), "the exact mixed title/name query reaches the final provider input");
  const recallQuery = "赵光义在北境议和的旧事是什么？";
  const activeRecall = await providerInput(harness, recallQuery);
  assert(activeRecall.text.includes("VALID_C_HISTORY_SENTINEL"), "the uniquely resolved target history reaches provider input");
  for (const sentinel of ["FUTURE_DATE_FORBIDDEN_SENTINEL", "WRONG_CAMPAIGN_FORBIDDEN_SENTINEL", "WRONG_OWNER_FORBIDDEN_SENTINEL"]) {
    assert.equal(activeRecall.text.includes(sentinel), false, sentinel);
  }

  const duoHarness = createHarness({ directory: path.join(root, "duo-C"), rows: [valid], activeIds: [1, 2] });
  const duoC = await providerInput(duoHarness, recallQuery);
  assert.deepEqual(duoC.memoryContext.entityTargetRecall.explicitTargetEntityIds, [3]);
  assert(duoC.text.includes("VALID_C_HISTORY_SENTINEL"), "the two-person baseline can recall B's private C-related history");

  const rowD = summaryRow({ subjectIds: [4], content: "赵匡胤在旧友席间留下 ABSENT_D_HISTORY_SENTINEL。" });
  const fourHarness = createHarness({ directory: path.join(root, "four-person"), rows: [valid, rowD], activeIds: [1, 2, 3, 4] });
  const fourC = await providerInput(fourHarness, recallQuery);
  assert.deepEqual(fourC.memoryContext.entityTargetRecall.explicitTargetEntityIds, [3]);
  assert(fourC.text.includes("VALID_C_HISTORY_SENTINEL"), "the same B-owned C history remains eligible with C and D active");
  assert.equal(fourC.text.includes("ABSENT_D_HISTORY_SENTINEL"), false, "an active but unqueried D does not enter C-targeted recall");
  const fourGeneric = await providerInput(fourHarness, "今夜天气如何？");
  assert.equal(fourGeneric.text.includes("VALID_C_HISTORY_SENTINEL"), false,
    "a generic query does not pull B's private C history merely because C is active");
  assert.equal(fourGeneric.text.includes("ABSENT_D_HISTORY_SENTINEL"), false,
    "a generic query does not pull D history merely because D is active");

  const absentHarness = createHarness({ directory: path.join(root, "absent-D"), rows: [rowD], activeIds: [1, 2] });
  const absentD = await providerInput(absentHarness, "赵匡胤谈过的往事是什么？");
  assert.deepEqual(absentD.memoryContext.entityTargetRecall.explicitTargetEntityIds, [4]);
  assert(absentD.text.includes("ABSENT_D_HISTORY_SENTINEL"), "an explicit out-of-scene target reaches final provider input");
  const generic = await providerInput(harness, "今夜天气如何？");
  assert.equal(generic.text.includes("VALID_C_HISTORY_SENTINEL"), false, "a generic query must not recall every known person's history");
}

async function testPartialAndOversizedLegacyReachProvider() {
  const partialHarness = createHarness({ directory: path.join(root, "partial") });
  partialHarness.engine.store.saveMemory({ memoryId: "partial-known-source", type: "information", content: "已映射的局部来源。",
    participants: [2, 5], subjects: [5], knownBy: [2], visibility: "private",
    provenance: { campaignToken, folderOwnerId: 2, finalizationId: "partial-finalization" } });
  const partial = summaryRow({ subjectIds: [3], perspectiveMemoryIds: ["partial-known-source", "missing-source"],
    content: "【张道素能够知道并记住的本场内容】\n- 赵光义曾在北境谈及旧约。\n\nPARTIAL_LEGACY_NARRATIVE_REMAINDER_SENTINEL" });
  writeRows(path.join(partialHarness.ownerFolder, "与旧友的对话.json"), [partial]);
  const partialInput = await providerInput(partialHarness, "赵光义的北境旧约是什么？");
  assert(partialInput.text.includes("PARTIAL_LEGACY_NARRATIVE_REMAINDER_SENTINEL"),
    "incomplete source mapping preserves the unsplittable Legacy narrative in final provider input");
  assert(partialInput.text.includes("赵光义曾在北境谈及旧约"),
    "the intact Legacy row retains its supporting passage when one source mapping is incomplete");

  const oversizedHarness = createHarness({ directory: path.join(root, "oversized") });
  const filler = "往年宫宴礼节与使者往返记载，没有北境通行令的信息。".repeat(220);
  const keyFact = "赵光义在北境通行令案中亲口说：LONG_MIDDLE_EXCERPT_SENTINEL 应由守将开门。";
  const longRow = summaryRow({ subjectIds: [3], content: `${keyFact}\n${filler}\n${filler}` });
  writeRows(path.join(oversizedHarness.ownerFolder, "与旧友的对话.json"), [longRow]);
  const longInput = await providerInput(oversizedHarness, "赵光义在北境通行令案中说过什么？");
  const selected = [...longInput.memoryContext.direct, ...longInput.memoryContext.extra,
    ...(longInput.memoryContext.pairMemorySources || [])]
    .find(entry => entry.memory.content.includes("LONG_MIDDLE_EXCERPT_SENTINEL"));
  assert(selected, "query-relevant Legacy evidence reaches a real direct, Extra, or exact Pair Source route");
  assert(selected.memory.content.length < longRow.content.length, "oversized Legacy source is excerpted rather than injected whole");
  assert(longInput.text.includes("LONG_MIDDLE_EXCERPT_SENTINEL"), "the relevant middle evidence reaches final provider messages");
  assert(longInput.memoryContext.selectedTokens <= longInput.memoryContext.tokenBudget, "Legacy recall stays within its frozen budget");
}

async function testLegacyForgetRemainsAbsentFromProvider() {
  const directory = path.join(root, "forget-provider");
  const harness = createHarness({ directory, activeIds: [1, 2] });
  const sourceId = "forget-provider-source";
  const content = "赵光义与张道素曾约定守住北境渡口。FORGET_PROVIDER_SENTINEL";
  const row = summaryRow({ counterpartId: 3, subjectIds: [3], finalizationId: "forget-provider-finalization",
    conversationId: "forget-provider-conversation", segmentId: "forget-provider-segment", perspectiveMemoryIds: [sourceId], content });
  const file = path.join(harness.ownerFolder, "与赵光义的对话.json");
  writeRows(file, [row]);
  const source = harness.engine.store.saveMemory({ memoryId: sourceId, type: "information", subtype: "user_edited_summary",
    content, participants: [2, 3], subjects: [3], knownBy: [2], visibility: "known_group",
    provenance: { campaignToken, folderOwnerId: 2, counterpartId: 3, finalizationId: row.finalizationId,
      extractionMode: "user_edited_summary" } });
  harness.engine.store.markKnownBy(2, source.memoryId, { awareness: "imported" });
  const before = await providerInput(harness, "赵光义当时为何守住北境渡口？");
  assert(before.text.includes("FORGET_PROVIDER_SENTINEL"), "the authorized Legacy source reaches the provider before Forget");

  const manager = createSummariesManager({ fs, path, summariesDir: harness.summariesDir, memoryEngine: harness.engine,
    memorySystem, getCurrentConversation: () => null });
  const deleted = await manager.deleteSummary(2, 3, 0);
  assert.equal(deleted.success, true, JSON.stringify(deleted));
  assert.equal(fs.existsSync(file), false, "Forget removes the selected visible Legacy projection");
  assert.equal(harness.engine.store.getMemory(sourceId), null, "Forget removes the exclusively owned mapped source");
  assert.equal(harness.engine.store.isSummaryProjectionForgotten(row, { ownerId: 2, counterpartId: 3 }), true,
    "Forget retains the scoped Legacy ledger after deleting the visible row");

  const restartedHarness = createHarness({ directory, rows: [], activeIds: [1, 2] });
  const after = await providerInput(restartedHarness, "赵光义当时为何守住北境渡口？");
  assert.equal(after.text.includes("FORGET_PROVIDER_SENTINEL"), false, "a restarted provider prompt cannot revive a forgotten Legacy source");
}

async function main() {
  const cases = [
    [testPromptRoutingAndScope, "Legacy ProviderPrompt: out-of-scene target, explicit identity, scope and generic-query privacy"],
    [testPartialAndOversizedLegacyReachProvider, "Legacy ProviderPrompt: incomplete source mapping, relevant excerpt and budget cap"],
    [testLegacyForgetRemainsAbsentFromProvider, "SummariesManager Forget: scoped Legacy deletion survives restart and ProviderPrompt"]
  ];
  const failures = [];
  try {
    for (const [run, label] of cases) {
      try { await run(); console.log(`PASS ${label}`); }
      catch (error) { failures.push({ label, error }); console.error(`FAIL ${label}`, error); }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (failures.length) throw new Error(`${failures.length} of ${cases.length} QA cases failed`);
  console.log("PASS V8.15 Legacy production contract QA");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
