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

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v815-fix1-legacy-qa-"));
const campaignToken = "votc-v815-independent-qa-campaign";
const ownerId = 2;
const currentDate = "1180.8.11";
const summaryDate = "1164.1.1";
const names = new Map([[1, "玩家"], [2, "张道素"], [3, "赵光义"], [4, "赵匡胤"], [5, "旧友"]]);
const fingerprint = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const promptsDir = path.resolve(__dirname, "../resources/app/default_userdata/prompts");
let conversationSequence = 0;
let checks = 0;
const failures = [];

function check(name, operation) {
  return Promise.resolve().then(operation).then(() => {
    checks++;
    console.log(`PASS ${name}`);
  }).catch(error => {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.message}`);
  });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function snapshotContents(directory) {
  const result = {};
  const visit = current => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("unexpected_test_symlink");
      if (entry.isDirectory()) visit(file);
      else result[path.relative(directory, file)] = fs.readFileSync(file).toString("base64");
    }
  };
  visit(directory);
  return result;
}

function makeCharacter(id) {
  const name = names.get(id) || `人物${id}`;
  const input = Array(28).fill("");
  input[0] = String(id); input[1] = name; input[2] = name;
  input[3] = id === 3 || id === 4 ? "皇帝" : "";
  input[4] = "he"; input[5] = "30"; input[6] = "100"; input[7] = "0"; input[18] = name;
  const character = new Character(input);
  if (id === 3 || id === 4) character.primaryTitle = "皇帝";
  character.troops = { totalOwnedTroops: 0 };
  return character;
}

function summaryRow({ owner = ownerId, counterpart = 5, subjectIds = [], content, date = summaryDate,
  conversationId = "qa-summary-conversation", finalizationId = "qa-summary-finalization",
  segmentId = "qa-summary-segment", perspectiveMemoryIds = [], campaign = campaignToken,
  includeLineage = true } = {}) {
  const row = { playerId: owner, characterId: counterpart, perspectiveOwnerId: owner,
    playerName: names.get(owner), characterName: names.get(counterpart) || `人物${counterpart}`,
    content, date, totalDays: 425000, campaignToken: campaign, campaignBinding: { status: "bound" },
    participants: [...new Set([owner, counterpart, ...subjectIds])].map(id => ({ id, name: names.get(id) || `人物${id}`,
      shortName: names.get(id) || `人物${id}`, fullName: names.get(id) || `人物${id}` })) };
  if (includeLineage) Object.assign(row, { conversationId, finalizationId,
    perspectiveSummarySegmentIds: [segmentId], perspectiveMemoryIds });
  return row;
}

function makePromptRuntime() {
  const promptConfigManager = new (createPromptConfigManager({ fs, path, promptsDir,
    defaultMainTemplatePath: path.join(promptsDir, "system/default.hbs"),
    defaultLetterTemplatePath: path.join(promptsDir, "system/letter.hbs"),
    defaultChatInstruction: "请依本轮所知回应。" }))();
  const settings = {
    getPromptSettings: () => ({ mainTemplate: "{{! VOTC_SEGMENT:stable_global }}仅依据本角色合法所知的事实回应。\n{{! VOTC_SEGMENT:world_context }}当前时间：{{gameData.date}}。",
      blocks: [{ id: "main", type: "main", enabled: true, role: "system" },
        { id: "history", type: "history", enabled: true },
        { id: "instruction", type: "instruction", enabled: true, role: "user", template: "请回应本轮对话。" }] }),
    getLetterPromptSettings: () => ({ blocks: promptConfigManager.getDefaultLetterBlocks(),
      mainTemplate: fs.readFileSync(path.join(promptsDir, "system/letter.hbs"), "utf8") }),
    getSummaryPromptSettings: () => ({ finalPrompt: "忠实记录来源和边界。", finalSummaryMaxTokens: 4096 }),
    getActiveProviderConfig: () => ({ providerType: "openai-compatible", defaultModel: "fixture",
      defaultParameters: { max_tokens: 4096 } }),
    getChatPromptV813Layout: () => false,
    getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89RuntimeProfileSplit: true,
      chatPromptV810ProviderAdapter: true })
  };
  const TemplateEngine = createTemplateEngine({ Handlebars, fs, path,
    promptsHelpersDir: path.join(root, "helpers"),
    defaultPromptsDir: path.resolve(__dirname, "../resources/app/default_userdata"), PromptScriptSandbox });
  const PromptBuilder = createPromptBuilder({ TemplateEngine, PromptScriptLoader, promptConfigManager,
    settingsRepository: settings, path, TokenCounter, createPromptFingerprint: fingerprint,
    defaultChatInstruction: "请依本轮所知回应。" });
  return { settings, PromptBuilder };
}

function createPromptHarness(directory, { activeIds = [1, 2] } = {}) {
  const summariesDir = path.join(directory, "summaries");
  const ownerFolder = path.join(summariesDir, "2_张道素");
  fs.mkdirSync(ownerFolder, { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const { settings, PromptBuilder } = makePromptRuntime();
  const GameData = createGameData({ fs, path, memorySystem, memoryEngine: engine, summariesDir,
    getHistoricalReferenceByYear: () => null });
  const gameData = new GameData(["1", names.get(1), "2", names.get(2), currentDate,
    "conversationcourt", "临安", names.get(2), String(normalizeGameDate(currentDate).serial)]);
  gameData.campaignToken = campaignToken;
  for (const id of [1, 2, 3, 4, 5]) gameData.characters.set(id, makeCharacter(id));
  for (const character of gameData.characters.values()) {
    fs.mkdirSync(gameData.getCharacterFolderPath(character.id, character.shortName), { recursive: true });
  }
  const worldlineService = { getSettings: () => ({ v812MemoryEngine3Enabled: true,
    v812TemporalSummaryRecallEnabled: true }), isSubjectivePromptIntegrationEnabled: () => false,
    getPromptContext: () => null };
  Conversation.configure({ memoryEngine: engine, settingsRepository: settings,
    llmManager: { getCurrentContextLength: async () => 65536 }, PromptBuilder, TokenCounter,
    usageAnalytics: { record() {} }, createPromptFingerprint: fingerprint, path, worldlineService });
  const createConversation = query => {
    const conversation = Object.create(Conversation.prototype);
    conversation.id = `qa-conversation-${++conversationSequence}`;
    conversation.gameData = gameData;
    conversation.messages = [{ id: 1, role: "user", content: query }];
    conversation.memoryState = engine.createConversationState(conversation.id);
    conversation.memoryState.participantPresence = activeIds.map(characterId => ({ characterId,
      joinedAtMessageId: 0, leftAtMessageId: null }));
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
  return { directory, summariesDir, ownerFolder, engine, gameData, PromptBuilder, createConversation };
}

async function providerInput(harness, query) {
  const conversation = harness.createConversation(query);
  const responder = harness.gameData.characters.get(2);
  const memoryContext = await conversation.getMemoryContextFor(responder, 65536);
  const messages = harness.PromptBuilder.buildMessagesWithTokenCount(conversation.messages,
    responder, harness.gameData, "", memoryContext).messages;
  return { memoryContext, messages, text: messages.map(message => message.content || "").join("\n") };
}

function summaryManagerFixture(directory, { mismatchedSource = false } = {}) {
  const summariesDir = path.join(directory, "summaries");
  const ownerFolder = path.join(summariesDir, "2_张道素");
  fs.mkdirSync(ownerFolder, { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const sourceId = "legacy-summary-source";
  const record = summaryRow({ counterpart: 1, content: "LEGACY_SUMMARY_WITH_SCOPED_SOURCE_MAPPING",
    conversationId: "legacy-summary-conversation", finalizationId: "legacy-summary-finalization",
    segmentId: "legacy-summary-segment", perspectiveMemoryIds: [sourceId] });
  const summaryFile = path.join(ownerFolder, "与玩家的对话.json");
  writeJson(summaryFile, [record]);
  engine.store.saveMemory({ memoryId: sourceId, type: "information", subtype: "user_edited_summary",
    content: record.content, eventDate: record.date, totalDays: record.totalDays,
    participants: [ownerId, mismatchedSource ? 3 : 1], subjects: [mismatchedSource ? 3 : 1], knownBy: [ownerId],
    visibility: "known_group", provenance: { campaignToken, folderOwnerId: ownerId,
      counterpartId: mismatchedSource ? 3 : 1, finalizationId: record.finalizationId,
      extractionMode: "user_edited_summary" } });
  engine.store.markKnownBy(ownerId, sourceId, { awareness: "imported", acquiredAt: record.totalDays });
  const otherPair = engine.store.saveMemory({ memoryId: "unrelated-counterpart-source", type: "information",
    content: "另一位人物的摘要来源。", eventDate: record.date, totalDays: record.totalDays,
    participants: [ownerId, 3], subjects: [3], knownBy: [ownerId], visibility: "known_group",
    provenance: { campaignToken, folderOwnerId: ownerId, counterpartId: 3,
      finalizationId: "other-finalization", extractionMode: "user_edited_summary" } });
  engine.store.markKnownBy(ownerId, otherPair.memoryId, { awareness: "imported", acquiredAt: otherPair.totalDays });
  const manager = createSummariesManager({ fs, path, summariesDir, memoryEngine: engine, memorySystem,
    getCurrentConversation: () => null });
  return { directory, summariesDir, ownerFolder, engine, manager, summaryFile, record, sourceId,
    otherPairId: otherPair.memoryId };
}

async function run() {
  try {
    await check("final Provider input recalls the explicit-target Legacy projection", async () => {
      const harness = createPromptHarness(path.join(root, "final-selection"));
      const sourceId = "legacy-target-source";
      const targetSource = harness.engine.store.saveMemory({ memoryId: sourceId, type: "information",
        subtype: "conversation_summary", content: "赵光义在北境旧事中留下 EXPLICIT_C_LEGACY_SENTINEL。",
        eventDate: summaryDate, participants: [ownerId, 3], subjects: [3], knownBy: [ownerId],
        visibility: "known_group", provenance: { campaignToken, folderOwnerId: ownerId,
          counterpartId: 5, counterpartIds: [5, 3], finalizationId: "legacy-parent-finalization",
          extractionMode: "user_edited_summary" } });
      harness.engine.store.markKnownBy(ownerId, targetSource.memoryId, { awareness: "imported" });
      const parentText = `【张道素能够知道并记住的本场经过】\n- ${targetSource.content}`;
      writeJson(path.join(harness.ownerFolder, "与旧友的对话.json"), [summaryRow({ counterpart: 5,
        subjectIds: [3], content: parentText, perspectiveMemoryIds: [targetSource.memoryId],
        conversationId: "legacy-parent-conversation", finalizationId: "legacy-parent-finalization",
        segmentId: "legacy-parent-segment" })]);
      const result = await providerInput(harness, "赵光义北境那件事后来怎么样？");
      assert.deepEqual(result.memoryContext.entityTargetRecall.explicitTargetEntityIds, [3]);
      assert(result.memoryContext.entityTargetText.includes("EXPLICIT_C_LEGACY_SENTINEL"),
        "the responder memory context must include the authorized Legacy projection");
      assert(result.text.includes("EXPLICIT_C_LEGACY_SENTINEL"), "the complete Provider messages must contain Legacy evidence");
    });

    await check("invalid Legacy source mapping rolls back visible deletion and Forget ledger", async () => {
      const fixture = summaryManagerFixture(path.join(root, "invalid-mapping"), { mismatchedSource: true });
      const before = snapshotContents(fixture.directory);
      const visibleBefore = fs.readFileSync(fixture.summaryFile, "utf8");
      const result = await fixture.manager.deleteSummary(ownerId, 1, 0);
      assert.equal(result.success, false, JSON.stringify(result));
      assert.deepEqual(snapshotContents(fixture.directory), before, "failed mapping must roll back visible and MemoryStore files");
      assert.equal(fs.readFileSync(fixture.summaryFile, "utf8"), visibleBefore, "the selected summary stays byte-for-byte present");
      assert.equal(fixture.engine.store.listForgottenSummaryProjections().length, 0);
    });

    await check("Legacy Forget records exact Campaign/Owner/counterpart scope and keeps other pairs", async () => {
      const fixture = summaryManagerFixture(path.join(root, "scoped-forget"));
      const result = await fixture.manager.deleteSummary(ownerId, 1, 0);
      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(result.diagnostics.status, "FORGOTTEN", JSON.stringify(result.diagnostics));
      assert.equal(fs.existsSync(fixture.summaryFile), false);
      assert.equal(fixture.engine.store.getMemory(fixture.sourceId), null, "only the mapped source for this projection is removed");
      assert(fixture.engine.store.getMemory(fixture.otherPairId), "a different counterpart's source remains stored");
      const [lineage] = fixture.engine.store.listForgottenSummaryProjections();
      assert.equal(lineage.campaignToken, campaignToken);
      assert.equal(lineage.ownerId, ownerId);
      assert.equal(lineage.counterpartId, 1);
      assert(lineage.legacyMemoryIds.includes(fixture.sourceId));
    });

    console.log(`PASS ${checks} independent V8.15 Legacy QA cases`);
    if (failures.length) throw new Error(`${failures.length} QA case(s) failed: ${failures.map(item => item.name).join("; ")}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
