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
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");
const { createProjectionLineage } = require("../resources/app/out/main/memory-system/memory4-forget");
const { Memory4OrphanAudit } = require("../resources/app/out/main/memory-system/memory4-orphan-audit");
const { createMemoryRecord } = require("../resources/app/out/main/memory-system/memory-types");
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
  segmentId = `segment-${sequence}`, perspectiveMemoryIds = [], perspectiveOwnerId = ownerId, projectionId = null } = {}) {
  const profiles = [...new Set([ownerId, counterpartId, ...subjectIds])].map(id => ({ id, name: names.get(id) || `人物${id}`,
    shortName: names.get(id) || `人物${id}`, fullName: names.get(id) || `人物${id}`, primaryTitle: id === 3 || id === 4 ? "皇帝" : "" }));
  return { playerId: ownerId, characterId: counterpartId, perspectiveOwnerId, playerName: names.get(ownerId),
    characterName: names.get(counterpartId) || `人物${counterpartId}`, content, date,
    totalDays: normalizeGameDate(date)?.serial ?? null, campaignToken: campaign, campaignBinding: { status: "bound" },
    finalizationId, conversationId, perspectiveSummarySegmentIds: [segmentId], perspectiveMemoryIds,
    ...(projectionId ? { projectionId } : {}), participants: profiles };
}

function commitCanonicalFacts(engine, { finalizationId, conversationId, date = "1164.1.1", facts, projectionLineages = [] }) {
  const ownerId = 2;
  const fragmentId = `${finalizationId}-fragment`;
  const entityIds = [...new Set(facts.flatMap(fact => fact.entityIds))];
  const visibleIds = [...new Set([1, ownerId, ...entityIds])];
  const snapshot = { campaignToken, ownerId, conversationId, finalizationId, episodeId: `${finalizationId}-episode`, date,
    totalDays: normalizeGameDate(date).serial, sourceRevision: hash([finalizationId, "source"]), presentMessageCount: 1,
    completeness: "complete", summaryIds: [], counterpartIds: visibleIds.filter(id => id !== ownerId),
    fragments: [{ fragmentId, messageId: 10, sourceMessageIds: [10], text: facts.map(fact => fact.text).join("\n"),
      speakerId: ownerId, speakerIds: [ownerId], sourceTextVerified: true, sourceRole: "assistant", presentIds: visibleIds,
      knownBy: visibleIds, visibility: "participants", sourceType: "spoken", recipientIds: visibleIds,
      entityIds, visibilityEvidence: "application_fragment" }], projectionLineages };
  return engine.memory4.store.commitOwner(snapshot, { status: "STORE", entries: facts.map(fact => ({
    memoryType: "DURABLE_KNOWLEDGE", text: fact.text, fragmentIds: [fragmentId], participantIds: visibleIds,
    entityIds: fact.entityIds, topics: fact.topics, eventTime: { status: "unknown" }
  })) });
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

function plannerOptions(harness, legacyMemories, targetId = 3) {
  const profile = harness.gameData.getMentionableCharacterProfiles().get(targetId);
  return { campaignToken, ownerId: 2, query: `${names.get(targetId)}谈过的往事是什么？`, querySpeakerId: 1,
    entityIds: [targetId], explicitTargetEntityIds: [targetId], mentionedOutOfSceneIds: [], activeParticipantIds: [1, 2],
    entityNames: [names.get(targetId)], entityNamesById: { [targetId]: [names.get(targetId)] }, entityProfiles: [profile],
    gameData: harness.gameData, currentGameDate: harness.gameData.date, currentTotalDays: harness.gameData.totalDays,
    conversationId: "knownby-boundary", sceneRevision: "scene", turnEpoch: 1, temporalRecallEnabled: true,
    legacyMemories, memoryEngineRemainingBudget: 3000, providerRemainingSafeBudget: 1200,
    estimateTokens: text => TokenCounter.estimateTokens(String(text || "")) };
}

function makePendingSnapshot() {
  const ownerId = 2, finalizationId = "late-recovery-same-finalization", conversationId = "late-recovery-conversation";
  const projectionA = createProjectionLineage({ campaignToken, ownerId, conversationId, finalizationId,
    counterpartId: 1, segmentIds: ["summary-A"], sourceSegmentIds: ["fragment-A"], sourceMessageIds: [10] });
  const projectionC = createProjectionLineage({ campaignToken, ownerId, conversationId, finalizationId,
    counterpartId: 3, segmentIds: ["summary-C"], sourceSegmentIds: ["fragment-C"], sourceMessageIds: [30] });
  const fragments = [
    { fragmentId: "fragment-A", messageId: 10, sourceMessageIds: [10], text: "LATE_A_FRAGMENT_SECRET", speakerId: ownerId,
      speakerIds: [ownerId], sourceTextVerified: true, sourceRole: "assistant", presentIds: [ownerId, 1],
      knownBy: [ownerId, 1], visibility: "participants", sourceType: "spoken", recipientIds: [1], entityIds: [1],
      visibilityEvidence: "application_fragment" },
    { fragmentId: "fragment-C", messageId: 30, sourceMessageIds: [30], text: "LATE_C_FRAGMENT_SURVIVES", speakerId: ownerId,
      speakerIds: [ownerId], sourceTextVerified: true, sourceRole: "assistant", presentIds: [ownerId, 3],
      knownBy: [ownerId, 3], visibility: "participants", sourceType: "spoken", recipientIds: [3], entityIds: [3],
      visibilityEvidence: "application_fragment" }
  ];
  return { campaignToken, ownerId, conversationId, finalizationId, episodeId: "late-recovery-episode",
    date: "1164.1.1", totalDays: normalizeGameDate("1164.1.1").serial, sourceRevision: hash([finalizationId, "source"]),
    presentMessageCount: 2, completeness: "complete", summaryIds: [], counterpartIds: [1, 3], fragments,
    projectionLineages: [projectionA, projectionC] };
}

async function testPromptRoutingAndScope() {
  const directory = path.join(root, "routing");
  const valid = summaryRow({ subjectIds: [3], content: "赵光义在北境议和时亲口留下 VALID_C_HISTORY_SENTINEL。" });
  const future = summaryRow({ subjectIds: [3], content: "赵光义说了 FUTURE_DATE_FORBIDDEN_SENTINEL。", date: "1181.1.1" });
  const wrongCampaign = summaryRow({ subjectIds: [3], content: "赵光义说了 WRONG_CAMPAIGN_FORBIDDEN_SENTINEL。", campaign: "foreign-campaign" });
  const wrongOwner = summaryRow({ subjectIds: [3], content: "赵光义说了 WRONG_OWNER_FORBIDDEN_SENTINEL。", perspectiveOwnerId: 99 });
  const harness = createHarness({ directory, rows: [valid, future, wrongCampaign, wrongOwner], activeIds: [1, 2, 3] });
  const activeC = await providerInput(harness, "皇帝赵光义当时怎么说");
  assert.deepEqual(activeC.memoryContext.memory4Packet.diagnostics.explicitTargetEntityIds, [3]);
  assert.notEqual(activeC.memoryContext.memory4Packet.diagnostics.blockedReason, "IDENTITY_UNRESOLVED");
  assert(activeC.text.includes("皇帝赵光义当时怎么说"), "the exact mixed title/name query reaches the final provider input");
  const recallQuery = "赵光义在北境议和的旧事是什么？";
  const activeRecall = await providerInput(harness, recallQuery);
  assert(activeRecall.text.includes("VALID_C_HISTORY_SENTINEL"), "the uniquely resolved target history reaches provider input");
  for (const sentinel of ["FUTURE_DATE_FORBIDDEN_SENTINEL", "WRONG_CAMPAIGN_FORBIDDEN_SENTINEL", "WRONG_OWNER_FORBIDDEN_SENTINEL"]) {
    assert.equal(activeRecall.text.includes(sentinel), false, sentinel);
  }

  const duoHarness = createHarness({ directory: path.join(root, "duo-C"), rows: [valid], activeIds: [1, 2] });
  const duoC = await providerInput(duoHarness, recallQuery);
  assert.deepEqual(duoC.memoryContext.memory4Packet.diagnostics.explicitTargetEntityIds, [3]);
  assert(duoC.text.includes("VALID_C_HISTORY_SENTINEL"), "the two-person baseline can recall B's private C-related history");

  const rowD = summaryRow({ subjectIds: [4], content: "赵匡胤在旧友席间留下 ABSENT_D_HISTORY_SENTINEL。" });
  const fourHarness = createHarness({ directory: path.join(root, "four-person"), rows: [valid, rowD], activeIds: [1, 2, 3, 4] });
  const fourC = await providerInput(fourHarness, recallQuery);
  assert.deepEqual(fourC.memoryContext.memory4Packet.diagnostics.explicitTargetEntityIds, [3]);
  assert(fourC.text.includes("VALID_C_HISTORY_SENTINEL"), "the same B-owned C history remains eligible with C and D active");
  assert.equal(fourC.text.includes("ABSENT_D_HISTORY_SENTINEL"), false,
    "an active but unqueried D does not enter C-targeted recall");
  const fourGeneric = await providerInput(fourHarness, "今夜天气如何？");
  assert.equal(fourGeneric.text.includes("VALID_C_HISTORY_SENTINEL"), false,
    "a generic query does not pull B's private C history merely because C is active");
  assert.equal(fourGeneric.text.includes("ABSENT_D_HISTORY_SENTINEL"), false,
    "a generic query does not pull D history merely because D is active");

  const directoryD = path.join(root, "absent-D");
  const absentHarness = createHarness({ directory: directoryD, rows: [rowD], activeIds: [1, 2] });
  const absentD = await providerInput(absentHarness, "赵匡胤谈过的往事是什么？");
  assert.deepEqual(absentD.memoryContext.memory4Packet.diagnostics.explicitTargetEntityIds, [4]);
  assert(absentD.text.includes("ABSENT_D_HISTORY_SENTINEL"), "an explicit out-of-scene target must reach the final provider input");

  const generic = await providerInput(harness, "今夜天气如何？");
  assert.equal(generic.text.includes("VALID_C_HISTORY_SENTINEL"), false, "a generic query must not recall every known person's history");

  const unknown = createMemoryRecord({ memoryId: "wrong-knownby-fixture", type: "folder_summary", subtype: "conversation_summary",
    content: "赵光义说了 WRONG_KNOWNBY_FORBIDDEN_SENTINEL。", eventDate: "1164.1.1", participants: [2, 3, 5], subjects: [3],
    knownBy: [5], visibility: "participants", provenance: { campaignToken, folderOwnerId: 2, counterpartId: 5,
      counterpartIds: [5, 3], campaignBinding: { status: "bound" } } });
  const unknownPacket = harness.engine.memory4Recall.plan(plannerOptions(harness, [unknown]));
  assert.equal(unknownPacket.text.includes("WRONG_KNOWNBY_FORBIDDEN_SENTINEL"), false,
    "the real recall planner must reject a legacy projection not known by its owner");
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
    "incomplete source mapping must preserve the unsplittable legacy narrative in final provider input");

  const oversizedHarness = createHarness({ directory: path.join(root, "oversized") });
  const filler = "往年宫宴礼节与使者往返记载，没有北境通行令的信息。".repeat(220);
  const keyFact = "赵光义在北境通行令案中亲口说：LONG_MIDDLE_EXCERPT_SENTINEL 应由守将开门。";
  const longRow = summaryRow({ subjectIds: [3], content: `${filler}\n${keyFact}\n${filler}` });
  writeRows(path.join(oversizedHarness.ownerFolder, "与旧友的对话.json"), [longRow]);
  const longInput = await providerInput(oversizedHarness, "赵光义在北境通行令案中说过什么？");
  assert(longInput.memoryContext.memory4Packet.tokens <= 1200);
  assert(longInput.text.includes("LONG_MIDDLE_EXCERPT_SENTINEL"), "query-relevant middle evidence must survive packet fitting");
  assert(longInput.memoryContext.memory4Packet.items.some(item => item.memory.content.length < longRow.content.length),
    "oversized legacy source must be excerpted rather than injected whole");
}

async function testExplicitLegacyFinalSelectionReachesProvider() {
  const directory = path.join(root, "explicit-final-selection");
  const harness = createHarness({ directory, activeIds: [1, 2, 3] });
  const sourceId = "explicit-final-selection-source-C";
  const legacyContent = "赵光义在北境旧事中谈及门关。C_SPLIT_LEGACY_FINAL_SELECTION_SENTINEL";
  harness.engine.store.saveMemory({ memoryId: sourceId, type: "information", content: legacyContent,
    participants: [2, 3], subjects: [3], knownBy: [2], visibility: "private",
    provenance: { campaignToken, folderOwnerId: 2, finalizationId: "explicit-final-selection-legacy" } });
  const legacyParent = summaryRow({ counterpartId: 3, subjectIds: [3], perspectiveMemoryIds: [sourceId],
    content: `【张道素能够知道并记住的本场内容】\n- ${legacyContent}`,
    finalizationId: "explicit-final-selection-legacy", conversationId: "explicit-final-selection-legacy-conversation" });
  writeRows(path.join(harness.ownerFolder, "与赵光义的对话.json"), [legacyParent]);
  commitCanonicalFacts(harness.engine, { finalizationId: "explicit-final-selection-canonical",
    conversationId: "explicit-final-selection-canonical-conversation", facts: [
      { entityIds: [4], topics: ["北境"], text: "北境曾出现另一场争议 CANONICAL_UNRELATED_D_SENTINEL。" },
      { entityIds: [5], topics: ["北境"], text: "北境议和中有使者往返 CANONICAL_UNRELATED_E_SENTINEL。" }
    ] });

  const input = await providerInput(harness, "赵光义北境那件事后来怎么样？");
  const packet = input.memoryContext.memory4Packet;
  assert(packet.details.some(item => item.sourceRef.kind === "legacy" && item.memory.content.includes("C_SPLIT_LEGACY_FINAL_SELECTION_SENTINEL")),
    `the explicit C split-Legacy detail must survive final packet selection: ${JSON.stringify({
      selectedIds: packet.items.map(item => item.memory.memoryId), diagnostics: packet.diagnostics })}`);
  assert(input.memoryContext.temporalExtraText.includes("C_SPLIT_LEGACY_FINAL_SELECTION_SENTINEL"),
    "the final Conversation temporalExtraText must contain the selected target history");
  assert(input.messages.some(message => String(message.content || "").includes("C_SPLIT_LEGACY_FINAL_SELECTION_SENTINEL")),
    "the final PromptBuilder provider messages must contain the selected target history");
  assert(packet.details.length <= 2);
  assert(packet.details.filter(item => item.sourceRef.kind === "detail" && !item.explicitTargetEntityIds?.includes(3)).length <= 1,
    "at most one unrelated Canonical detail may remain beside the explicit target");
  assert(packet.tokens <= 1200, "final target selection must retain the packet cap");
}

async function testOrphanForgetReachesProvider() {
  const directory = path.join(root, "orphan-provider");
  const harness = createHarness({ directory, activeIds: [1, 2] });
  const scope = { campaignToken, ownerId: 2 };
  const finalizationId = "orphan-provider-finalization", conversationId = "orphan-provider-conversation";
  const lineage = createProjectionLineage({ ...scope, conversationId, finalizationId, counterpartId: 3,
    segmentIds: ["orphan-provider-summary"], sourceSegmentIds: ["orphan-provider-fragment"], sourceMessageIds: [10] });
  const committed = commitCanonicalFacts(harness.engine, { finalizationId, conversationId, projectionLineages: [lineage],
    facts: [{ entityIds: [3], topics: ["北境守门之约"],
      text: "赵光义在北境守门之约中留下 ORPHAN_FORGET_PROVIDER_SENTINEL。" }] });
  const query = "赵光义谈过的北境守门之约是什么？";
  const before = await providerInput(harness, query);
  assert(before.memoryContext.memory4Packet.items.some(item => item.memory.content.includes("ORPHAN_FORGET_PROVIDER_SENTINEL")),
    "the pre-forget orphan canonical fact must be visible to the real recall path");
  assert(before.memoryContext.temporalExtraText.includes("ORPHAN_FORGET_PROVIDER_SENTINEL"));
  assert(before.messages.some(message => String(message.content || "").includes("ORPHAN_FORGET_PROVIDER_SENTINEL")));

  const orphanAudit = new Memory4OrphanAudit(harness.engine);
  const audit = orphanAudit.audit(scope);
  const orphan = audit.items.find(item => item.projectionId === lineage.projectionId);
  assert.equal(orphan?.status, "ORPHANED_PRE_V815_PROJECTION", JSON.stringify(orphan));
  assert(orphan.canonicalEntryIds.includes(committed.entryIds[0]));
  orphanAudit.forget(scope, { projectionId: lineage.projectionId, expectedAuditToken: audit.auditToken, confirmed: true });

  const restarted = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: path.join(directory, "summaries"),
    trace: { record() {} } });
  const resumedHarness = createHarness({ directory: path.join(directory, "prompt"), activeIds: [1, 2] });
  resumedHarness.engine = restarted;
  Conversation.configure({ memoryEngine: restarted, settingsRepository: settings,
    llmManager: { getCurrentContextLength: async () => 65536 }, PromptBuilder, TokenCounter,
    usageAnalytics: { record() {} }, createPromptFingerprint: fingerprint, path,
    worldlineService: { getSettings: () => ({ v812MemoryEngine3Enabled: true, v812TemporalSummaryRecallEnabled: true }),
      isSubjectivePromptIntegrationEnabled: () => false, getPromptContext: () => null } });
  const after = await providerInput(resumedHarness, query);
  assert.equal(after.memoryContext.memory4Packet.items.some(item => item.memory.content.includes("ORPHAN_FORGET_PROVIDER_SENTINEL")), false,
    "the forgotten orphan must stay absent from the restarted Memory4 packet");
  assert.equal(after.memoryContext.temporalExtraText?.includes("ORPHAN_FORGET_PROVIDER_SENTINEL"), false,
    "the forgotten orphan must stay absent from Conversation temporalExtraText");
  assert.equal(after.messages.some(message => String(message.content || "").includes("ORPHAN_FORGET_PROVIDER_SENTINEL")), false,
    "the forgotten orphan must stay absent from final provider messages");
}

async function testManagerDeletionAndLateRecovery() {
  const directory = path.join(root, "recovery");
  const summariesDir = path.join(directory, "summaries");
  const ownerFolder = path.join(summariesDir, "2_张道素");
  fs.mkdirSync(ownerFolder, { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const snapshot = makePendingSnapshot();
  engine.memory4.saveRecovery(snapshot, { status: "PENDING", retryCount: 0, lastError: null });
  const lineageA = snapshot.projectionLineages[0];
  const rowA = summaryRow({ counterpartId: 1, content: "USER_DELETABLE_A_PROJECTION", date: snapshot.date,
    finalizationId: snapshot.finalizationId, conversationId: snapshot.conversationId,
    segmentId: "summary-A", projectionId: lineageA.projectionId });
  const rowC = summaryRow({ counterpartId: 3, subjectIds: [3], content: "RETAINED_B_C_PROJECTION", date: snapshot.date,
    finalizationId: snapshot.finalizationId, conversationId: snapshot.conversationId,
    segmentId: "summary-C", projectionId: snapshot.projectionLineages[1].projectionId });
  const fileA = path.join(ownerFolder, "与玩家的对话.json");
  writeRows(fileA, [rowA]);
  writeRows(path.join(ownerFolder, "与赵光义的对话.json"), [rowC]);
  const SummariesManager = createSummariesManager({ fs, path, summariesDir, memoryEngine: engine, memorySystem,
    getCurrentConversation: () => null });
  const deleted = await SummariesManager.deleteSummary(2, 1, 0);
  assert.equal(deleted.success, true, JSON.stringify(deleted));
  assert.equal(fs.existsSync(fileA), false, "the production manager API must remove the selected visible projection");

  const restarted = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  let extractionInput = "";
  const recovered = await restarted.memory4.recoverPending(async prompt => {
    extractionInput = prompt[1].content;
    return JSON.stringify({ status: "STORE", entries: [
      { memoryType: "DURABLE_KNOWLEDGE", text: "A must not return", fragmentIds: ["fragment-A"],
        participantIds: [2, 1], entityIds: [1], topics: ["A"], eventTime: { status: "unknown" } },
      { memoryType: "DURABLE_KNOWLEDGE", text: "RECOVERED_C_CANONICAL_SENTINEL about 赵光义", fragmentIds: ["fragment-C"],
        participantIds: [2, 3], entityIds: [3], topics: ["C"], eventTime: { status: "unknown" } }
    ] });
  }, { activeCampaignToken: campaignToken, isNarrativeCommitted: () => true });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, "STORE", JSON.stringify(recovered[0]));
  assert.equal(extractionInput.includes("LATE_A_FRAGMENT_SECRET"), false, "deleted projection source must be pruned before recovery input");
  assert(extractionInput.includes("LATE_C_FRAGMENT_SURVIVES"), "same-finalization C evidence must remain available after deleting A");
  const committed = restarted.memory4.store.query({ campaignToken, ownerId: 2 });
  assert.deepEqual(committed.map(entry => entry.text), ["RECOVERED_C_CANONICAL_SENTINEL about 赵光义"]);

  const resumedHarness = createHarness({ directory: path.join(directory, "prompt"), activeIds: [1, 2] });
  resumedHarness.engine = restarted;
  Conversation.configure({ memoryEngine: restarted, settingsRepository: settings,
    llmManager: { getCurrentContextLength: async () => 65536 }, PromptBuilder, TokenCounter,
    usageAnalytics: { record() {} }, createPromptFingerprint: fingerprint, path,
    worldlineService: { getSettings: () => ({ v812MemoryEngine3Enabled: true, v812TemporalSummaryRecallEnabled: true }),
      isSubjectivePromptIntegrationEnabled: () => false, getPromptContext: () => null } });
  const afterRestart = await providerInput(resumedHarness, "赵光义谈过什么？");
  assert(afterRestart.text.includes("RECOVERED_C_CANONICAL_SENTINEL"), "the surviving C projection must be queryable through the post-restart provider prompt");
  assert.equal(afterRestart.text.includes("A must not return"), false, "deleted A must not resurrect in the post-restart prompt");
  assert(afterRestart.text.includes("RETAINED_B_C_PROJECTION"), "deleting B-A must not delete the same-finalization B-C projection");
}

async function testUnknownSourceResponseRejected() {
  const directory = path.join(root, "unknown-source-response");
  const summariesDir = path.join(directory, "summaries");
  fs.mkdirSync(path.join(summariesDir, "2_张道素"), { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const snapshot = makePendingSnapshot();
  const response = JSON.stringify({ status: "STORE", entries: [
    { memoryType: "DURABLE_KNOWLEDGE", text: "VALID_C_BUT_BATCH_MUST_FAIL_CLOSED", fragmentIds: ["fragment-C"],
      participantIds: [2, 3], entityIds: [3], topics: ["C"], eventTime: { status: "unknown" } },
    { memoryType: "DURABLE_KNOWLEDGE", text: "UNKNOWN_FRAGMENT_MUST_NOT_COMMIT", fragmentIds: ["not-in-snapshot"],
      participantIds: [2, 3], entityIds: [3], topics: ["unknown"], eventTime: { status: "unknown" } }
  ] });
  const result = await engine.memory4.finishOwner(snapshot, async () => response, null, () => true);
  assert.equal(result.status, "EXTRACTION_FAILED");
  assert.equal(result.error, "memory4_response_source_mismatch");
  assert.deepEqual(engine.memory4.store.query({ campaignToken, ownerId: 2 }), [],
    "a response containing any unknown fragment reference must not partially commit its otherwise-valid entries");
}

async function testSharedSourceProjectionAndReadDtos() {
  const directory = path.join(root, "shared-source");
  const summariesDir = path.join(directory, "summaries");
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const ownerFolder = path.join(summariesDir, "2_张道素");
  fs.mkdirSync(ownerFolder, { recursive: true });
  const scope = { campaignToken, ownerId: 2 };
  const conversationId = "shared-source-conversation", finalizationId = "shared-source-finalization";
  const date = "1164.1.1", totalDays = normalizeGameDate(date).serial;
  const fragmentId = "fragment-shared-A-C", messageId = 10;
  const projectionA = createProjectionLineage({ campaignToken, ownerId: 2, conversationId, finalizationId,
    counterpartId: 1, segmentIds: ["summary-shared-A"], sourceSegmentIds: [fragmentId], sourceMessageIds: [messageId] });
  const projectionC = createProjectionLineage({ campaignToken, ownerId: 2, conversationId, finalizationId,
    counterpartId: 3, segmentIds: ["summary-shared-C"], sourceSegmentIds: [fragmentId], sourceMessageIds: [messageId] });
  const snapshot = { campaignToken, ownerId: 2, conversationId, finalizationId, episodeId: "shared-source-episode",
    date, totalDays, sourceRevision: hash([finalizationId, "shared-source"]), presentMessageCount: 1, completeness: "complete",
    summaryIds: [], counterpartIds: [1, 3], fragments: [{ fragmentId, messageId, sourceMessageIds: [messageId],
      text: "1164年1月1日，同一句可见话语由甲、丙共同听见并形成独立投影。", speakerId: 2, speakerIds: [2], sourceTextVerified: true,
      sourceRole: "assistant", presentIds: [1, 2, 3], knownBy: [1, 2, 3], visibility: "participants", sourceType: "spoken",
      recipientIds: [1, 3], entityIds: [1, 3], visibilityEvidence: "application_fragment" }],
    projectionLineages: [projectionA, projectionC] };
  const candidate = { memoryType: "MAJOR_EXPERIENCE", text: "甲与丙共同听见同一句话，北境守门之约由守将执行。",
    fragmentIds: [fragmentId], participantIds: [1, 2, 3], entityIds: [1, 3], topics: ["北境守门之约"],
    eventTime: { status: "reported", precision: "day", from: date, to: date } };
  const committed = engine.memory4.store.commitOwner(snapshot, { status: "STORE", entries: [candidate] });
  const entryId = committed.entryIds[0];
  const initialEntry = engine.memory4.store.readEntry(scope, entryId);
  assert.deepEqual(initialEntry.source.projectionLineages.map(lineage => lineage.counterpartId).sort(), [1, 3],
    "the canonical source must retain both independently-addressable projections before deletion");
  const built = await engine.memory4.derived.rebuild(scope, { kind: "all", overwriteManual: false });
  assert.equal(built.status, "COMPLETE", JSON.stringify(built));

  const rowA = summaryRow({ counterpartId: 1, subjectIds: [1], content: "VISIBLE_A_SUMMARY_TO_DELETE", date,
    finalizationId, conversationId, segmentId: "summary-shared-A", projectionId: projectionA.projectionId });
  const rowC = summaryRow({ counterpartId: 3, subjectIds: [3], content: "VISIBLE_C_SUMMARY_TO_KEEP", date,
    finalizationId, conversationId, segmentId: "summary-shared-C", projectionId: projectionC.projectionId });
  const fileA = path.join(ownerFolder, "与玩家的对话.json");
  writeRows(fileA, [rowA]);
  writeRows(path.join(ownerFolder, "与赵光义的对话.json"), [rowC]);
  const currentConversation = createHarness({ directory: path.join(directory, "prompt") }).createConversation("测试删除后读取");
  const manager = createSummariesManager({ fs, path, summariesDir, memoryEngine: engine, memorySystem,
    getCurrentConversation: () => currentConversation });
  const deleted = await manager.deleteSummary(2, 1, 0);
  assert.equal(deleted.success, true, JSON.stringify(deleted));
  assert.equal(fs.existsSync(fileA), false);
  assert.equal(deleted.diagnostics.canonicalEntriesForgotten, 0,
    "one deleted projection cannot tombstone a canonical entry still covered by the shared C source");

  const retainedEntry = engine.memory4.store.readEntry(scope, entryId);
  assert.equal(retainedEntry.deleted, false);
  assert.deepEqual(retainedEntry.source.projectionLineages.map(lineage => lineage.counterpartId), [3]);
  assert.deepEqual(retainedEntry.counterpartIds, [3]);

  const ownerDto = await manager.getMemory4OwnerData({ ownerId: 2, expectedCampaignToken: campaignToken });
  const detailDtoRow = ownerDto.detail.items.find(item => item.entryId === entryId);
  assert(detailDtoRow, "the surviving canonical fact must remain in the production owner DTO");
  assert.deepEqual(detailDtoRow.projectionLineages.map(lineage => lineage.counterpartId), [3]);
  const detailSources = await manager.getMemory4Sources({ ownerId: 2, expectedCampaignToken: campaignToken,
    kind: "detail", entryId });
  assert.equal(detailSources.sources.entries.length, 1);
  assert.equal(detailSources.sources.entries[0].sourceValid, true);
  assert.deepEqual(detailSources.sources.entries[0].source.projectionLineages.map(lineage => lineage.counterpartId), [3]);
  const year = ownerDto.derived.years.find(view => view.items.some(item => item.sourceEntryIds.includes(entryId)));
  assert(year, "the derived year DTO must still point to the surviving canonical source");
  const yearSources = await manager.getMemory4Sources({ ownerId: 2, expectedCampaignToken: campaignToken,
    kind: "year", eventYear: year.eventYear });
  assert.equal(yearSources.sources.entries.length, 1);
  assert.equal(yearSources.sources.entries[0].sourceValid, true);
  assert.deepEqual(yearSources.sources.entries[0].source.projectionLineages.map(lineage => lineage.counterpartId), [3]);

  const restartedEngine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const restartedManager = createSummariesManager({ fs, path, summariesDir, memoryEngine: restartedEngine, memorySystem,
    getCurrentConversation: () => currentConversation });
  const restartedEntry = restartedEngine.memory4.store.readEntry(scope, entryId);
  assert.equal(restartedEntry.deleted, false, "restart must not resurrect a deleted lineage as a deleted canonical fact");
  assert.deepEqual(restartedEntry.source.projectionLineages.map(lineage => lineage.counterpartId), [3]);
  const restartedDetail = await restartedManager.getMemory4Sources({ ownerId: 2, expectedCampaignToken: campaignToken,
    kind: "detail", entryId });
  assert.equal(restartedDetail.sources.entries.length, 1);
  assert.equal(restartedDetail.sources.entries[0].sourceValid, true);
  assert.deepEqual(restartedDetail.sources.entries[0].source.projectionLineages.map(lineage => lineage.counterpartId), [3]);
  const restartedYearDto = await restartedManager.getMemory4OwnerData({ ownerId: 2, expectedCampaignToken: campaignToken });
  const restartedYear = restartedYearDto.derived.years.find(view => view.items.some(item => item.sourceEntryIds.includes(entryId)));
  assert(restartedYear && restartedYear.dirty, "revision change must leave derived content visible but mark it stale after restart");
  const restartedYearSources = await restartedManager.getMemory4Sources({ ownerId: 2, expectedCampaignToken: campaignToken,
    kind: "year", eventYear: year.eventYear });
  assert.equal(restartedYearSources.sources.entries.length, 1);
  assert.equal(restartedYearSources.sources.entries[0].sourceValid, true);
  assert.deepEqual(restartedYearSources.sources.entries[0].source.projectionLineages.map(lineage => lineage.counterpartId), [3]);
}

async function main() {
  const cases = [
    [testPromptRoutingAndScope, "PromptBuilder: explicit C history across duo/trio/four-person presence, absent D, generic negative, identity and scope gates"],
    [testPartialAndOversizedLegacyReachProvider, "Conversation -> PromptBuilder: partial legacy retention and query-focused middle excerpt"],
    [testExplicitLegacyFinalSelectionReachesProvider, "Conversation -> final selection -> temporalExtraText -> PromptBuilder: explicit C Legacy survives two unrelated Canonical details"],
    [testOrphanForgetReachesProvider, "orphan audit/forget -> restart -> Memory4 packet, temporalExtraText and Provider messages stay clear"],
    [testSharedSourceProjectionAndReadDtos, "shared A/C source -> delete A -> owner/detail/year DTOs and readSources -> restart keeps C only"],
    [testManagerDeletionAndLateRecovery, "SummariesManager deletion -> restart -> late A+C recovery, C-only durable/provider recall"],
    [testUnknownSourceResponseRejected, "durable finalization rejects a mixed valid/unknown-fragment provider response without partial commit"]
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
  console.log("PASS v8.15 production contract QA");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
