"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Handlebars = require("../resources/app/node_modules/handlebars");
const memorySystem = require("../resources/app/out/main/memory-system");
const { MemoryEngine } = memorySystem;
const { Memory4OrphanAudit } = require("../resources/app/out/main/memory-system/memory4-orphan-audit");
const { Memory4RecallPlanner, fitRecallPacket } = require("../resources/app/out/main/memory-system/memory4-recall-planner");
const { createProjectionLineage } = require("../resources/app/out/main/memory-system/memory4-forget");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v815-fix1-independent-qa-"));
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

function snapshotTree(directory) {
  const result = {};
  const visit = current => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("unexpected_test_symlink");
      if (entry.isDirectory()) visit(file);
      else result[path.relative(directory, file)] = {
        bytes: fs.readFileSync(file).toString("base64"),
        mtimeMs: fs.statSync(file).mtimeMs
      };
    }
  };
  visit(directory);
  return result;
}

function snapshotContents(directory) {
  return Object.fromEntries(Object.entries(snapshotTree(directory)).map(([file, record]) => [file, record.bytes]));
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
  segmentId = "qa-summary-segment", projectionId = null, perspectiveMemoryIds = [], campaign = campaignToken,
  includeLineage = true } = {}) {
  const row = { playerId: owner, characterId: counterpart, perspectiveOwnerId: owner,
    playerName: names.get(owner), characterName: names.get(counterpart) || `人物${counterpart}`,
    content, date, totalDays: 425000, campaignToken: campaign, campaignBinding: { status: "bound" },
    participants: [...new Set([owner, counterpart, ...subjectIds])].map(id => ({ id, name: names.get(id) || `人物${id}`,
      shortName: names.get(id) || `人物${id}`, fullName: names.get(id) || `人物${id}` })) };
  if (includeLineage) Object.assign(row, { conversationId, finalizationId,
    perspectiveSummarySegmentIds: [segmentId], perspectiveMemoryIds,
    ...(projectionId ? { projectionId } : {}) });
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

function createPlannerSelectionHarness(directory) {
  const summariesDir = path.join(directory, "summaries");
  fs.mkdirSync(path.join(summariesDir, "2_fixture"), { recursive: true });
  const entries = new Map();
  let index = { revision: 1, entries: {}, byTopic: {}, finalizations: {} };
  const baseStore = { summaryFoldersDir: summariesDir, index: { memories: {} }, getMemory: () => null,
    loadFolderSummariesForCharacter: () => [] };
  const store = { loadIndex: () => index, directory: () => path.join(directory, "memory4"), read: (_file, fallback = null) => fallback,
    readEntry: (_scope, id) => entries.get(id), isProjectionLineageForgotten: () => false };
  const targetProfile = { id: 3, firstName: names.get(3), shortName: names.get(3), fullName: names.get(3) };
  const coordinator = { baseStore, store, derived: { selectSlice: () => null },
    getKnownEntityProfile: () => ({ recognition: { level: "KNOWN" }, relationship: { status: "UNKNOWN", types: [] } }) };
  const planner = new Memory4RecallPlanner(coordinator);
  const setRows = rows => {
    entries.clear();
    const indexedEntries = {}, byTopic = {}, finalizations = {};
    for (const row of rows) {
      const finalizationId = `qa-${row.entryId}`;
      const sourceRevision = `revision-${row.entryId}`;
      const entry = { entryId: row.entryId, campaignToken, ownerId, conversationDate: summaryDate, acquiredDate: summaryDate,
        text: row.text, topics: row.topics, entityIds: row.entityIds, counterpartIds: [1], importance: 0.5,
        eventTime: { status: "unknown" }, evidence: { knownBy: [ownerId], visibility: "participants",
          sourceType: "spoken", epistemicStatus: "reported" }, state: { status: "active" },
        source: { finalizationId, conversationId: finalizationId, sourceRevision, legacyRefs: [] } };
      entries.set(row.entryId, entry);
      indexedEntries[row.entryId] = { entityIds: row.entityIds, topics: row.topics, counterpartIds: [1], knownBy: [ownerId],
        visibility: "participants", deleted: false, memoryType: "DURABLE_KNOWLEDGE", status: "active", finalizationId,
        conversationId: finalizationId, conversationDate: summaryDate, acquiredDate: summaryDate, stateChangedGameDate: null,
        legacyRefs: [], bodyHash: `body-${row.entryId}`, importance: 0.5 };
      finalizations[hash(finalizationId)] = { sourceRevision };
      for (const topic of row.topics) (byTopic[topic] ||= []).push(row.entryId);
    }
    index = { revision: 1, entries: indexedEntries, byTopic, finalizations };
  };
  const makeLegacy = (memoryId, content, subjects = [3]) => ({ memoryId, type: "folder_summary", subtype: "conversation_summary",
    content, eventDate: summaryDate, knownBy: [ownerId], subjects, tags: ["北境"], deleted: false,
    provenance: { campaignToken, folderOwnerId: ownerId, counterpartId: 5, counterpartIds: [5],
      campaignBinding: { status: "bound" }, extractionMode: "user_edited_summary" } });
  const makeDerived = (memoryId, content, sourceEntryIds = []) => ({ memory: { memoryId, content, tags: ["北境"] },
    reason: { axis: "life", from: summaryDate, to: summaryDate, precision: "year" }, annotation: "derived fixture",
    sourceRef: { kind: "life", id: memoryId, sourceEntryIds } });
  const plan = ({ query, explicitTargetEntityIds = [3], legacyMemories = [], rows = [], overview = null }) => {
    setRows(rows);
    coordinator.derived.selectSlice = () => overview;
    const entityIds = [...explicitTargetEntityIds];
    const queryModel = { axis: "EVENT", granularity: "EVENT", entityIds, querySpeakerId: 1, window: null,
      blockedReason: null, firstMeeting: false, temporalRequested: false, expression: null, topics: ["北境"], text: query };
    return planner.plan({ campaignToken, ownerId, currentGameDate: currentDate, currentTotalDays: 0, conversationId: "qa-selection",
      sceneRevision: "qa-selection", turnEpoch: 1, query, queryModel, entityIds, explicitTargetEntityIds,
      topics: ["北境"], entityProfiles: [targetProfile], gameData: { characters: new Map([[3, targetProfile]]) },
      legacyMemories, memoryEngineRemainingBudget: 1200, providerRemainingSafeBudget: 1200,
      estimateTokens: text => Math.ceil(String(text || "").length / 2) });
  };
  return { makeDerived, makeLegacy, plan, planner, setRows };
}

function fragment(fragmentId, counterpartIds) {
  return { fragmentId, messageId: fragmentId, sourceMessageIds: [fragmentId], text: `source ${fragmentId}`,
    speakerId: ownerId, speakerIds: [ownerId], sourceTextVerified: true, sourceRole: "assistant",
    presentIds: [ownerId, ...counterpartIds], knownBy: [ownerId, ...counterpartIds], visibility: "participants",
    sourceType: "spoken", recipientIds: counterpartIds, entityIds: counterpartIds, visibilityEvidence: "application_fragment" };
}

function commitCanonical(engine, { finalizationId, fragments, counterpartIds, entries, projectionLineages = [] }) {
  const snapshot = { campaignToken, ownerId, conversationId: `conversation-${finalizationId}`, finalizationId,
    episodeId: `episode-${finalizationId}`, date: summaryDate, totalDays: 425000,
    sourceRevision: hash([finalizationId, "source"]), presentMessageCount: fragments.length,
    completeness: "complete", summaryIds: [], counterpartIds, fragments, projectionLineages };
  return engine.memory4.store.commitOwner(snapshot, { status: "STORE", entries });
}

function canonicalEntry(text, fragmentId, counterpartIds, topics, entityIds) {
  return { memoryType: "DURABLE_KNOWLEDGE", text, fragmentIds: [fragmentId],
    participantIds: [ownerId, ...counterpartIds], entityIds, topics, eventTime: { status: "unknown" } };
}

function createAuditFixture(directory, { includeRecovery = false, includeVisibleC = true,
  visibleA = false, inferredUnknown = false, unprovenSharedCoverage = false, singleProjectionA = false } = {}) {
  const summariesDir = path.join(directory, "summaries");
  const ownerFolder = path.join(summariesDir, "2_张道素");
  fs.mkdirSync(ownerFolder, { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const scope = { campaignToken, ownerId };
  const conversationId = `orphan-conversation-${path.basename(directory)}`;
  const finalizationId = `orphan-finalization-${path.basename(directory)}`;
  const sourceA = "orphan-source-a", sourceC = "orphan-source-c";
  const projectionA = createProjectionLineage({ ...scope, conversationId, finalizationId, counterpartId: 1,
    segmentIds: ["summary-A"], sourceSegmentIds: [sourceA], sourceMessageIds: [10] });
  const projectionC = createProjectionLineage({ ...scope, conversationId, finalizationId, counterpartId: 3,
    segmentIds: ["summary-C"], sourceSegmentIds: [unprovenSharedCoverage ? sourceC : sourceA],
    sourceMessageIds: [unprovenSharedCoverage ? 11 : 10] });
  const sharedFragment = fragment(sourceA, unprovenSharedCoverage ? [1] : [1, 3]);
  const snapshot = { campaignToken, ownerId, conversationId, finalizationId, episodeId: `episode-${finalizationId}`,
    date: summaryDate, totalDays: 425000, sourceRevision: hash([finalizationId, "shared"]), presentMessageCount: 1,
    completeness: "complete", summaryIds: [], counterpartIds: [1, 3], fragments: [sharedFragment],
    projectionLineages: inferredUnknown ? [] : singleProjectionA ? [projectionA] : [projectionA, projectionC] };
  const entry = inferredUnknown
    ? canonicalEntry("AMBIGUOUS_SOURCE_ENTRY", sourceA, [1, 3], ["shared"], [1, 3])
    : canonicalEntry("SHARED_CANONICAL_SENTINEL", sourceA, [1, 3], ["shared"], [1, 3]);
  if (inferredUnknown) {
    snapshot.fragments = [sharedFragment, { ...fragment(sourceC, [3]), messageId: 11 }];
    snapshot.presentMessageCount = 2;
    entry.fragmentIds = [sourceA, sourceC];
  }
  if (unprovenSharedCoverage) {
    snapshot.fragments = [sharedFragment, { ...fragment(sourceC, [3]), messageId: 11 }];
    snapshot.presentMessageCount = 2;
    entry.fragmentIds = [sourceA, sourceC];
  }
  const committed = engine.memory4.store.commitOwner(snapshot, { status: "STORE", entries: [entry] });
  const entryId = committed.entryIds[0];
  if (includeVisibleC) {
    writeJson(path.join(ownerFolder, "与赵光义的对话.json"), [summaryRow({ counterpart: 3,
      subjectIds: [3], content: "VISIBLE_C_SHARED_SOURCE", conversationId, finalizationId,
      segmentId: "summary-C", projectionId: inferredUnknown ? null : projectionC.projectionId })]);
  }
  if (visibleA) {
    writeJson(path.join(ownerFolder, "与玩家的对话.json"), [summaryRow({ counterpart: 1,
      subjectIds: [1], content: "AMBIGUOUS_VISIBLE_A", conversationId: null, finalizationId: null,
      includeLineage: false })]);
  }
  if (includeRecovery) engine.memory4.saveRecovery(snapshot, { status: "PENDING", retryCount: 0, lastError: null });
  return { directory, summariesDir, ownerFolder, engine, scope, snapshot, entryId, projectionA, projectionC,
    auditor: new Memory4OrphanAudit(engine) };
}

function expectStale(fixture, expectedAuditToken, projectionId = fixture.projectionA.projectionId) {
  assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId, expectedAuditToken, confirmed: true }),
    /memory4_orphan_audit_stale/);
}

function summaryManagerFixture(directory, { durableFootprint = false } = {}) {
  const summariesDir = path.join(directory, "summaries");
  const ownerFolder = path.join(summariesDir, "2_张道素");
  fs.mkdirSync(ownerFolder, { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const record = summaryRow({ counterpart: 1, content: "LEGACY_SUMMARY_WITH_UNCERTAIN_DURABLE_LINEAGE",
    includeLineage: false });
  const summaryFile = path.join(ownerFolder, "与玩家的对话.json");
  writeJson(summaryFile, [record]);
  if (durableFootprint) {
    const projection = createProjectionLineage({ campaignToken, ownerId, conversationId: "possible-footprint-conversation",
      finalizationId: "possible-footprint-finalization", counterpartId: 1,
      segmentIds: ["possible-summary-segment"], sourceSegmentIds: ["possible-fragment"], sourceMessageIds: [10] });
    const source = fragment("possible-fragment", [1]);
    commitCanonical(engine, { finalizationId: "possible-footprint-finalization", fragments: [source],
      counterpartIds: [1], projectionLineages: [projection], entries: [canonicalEntry(
        "POSSIBLE_DURABLE_FOOTPRINT", source.fragmentId, [1], ["history"], [1])] });
  }
  const manager = createSummariesManager({ fs, path, summariesDir, memoryEngine: engine, memorySystem,
    getCurrentConversation: () => null });
  return { directory, summariesDir, ownerFolder, engine, manager, summaryFile };
}

async function run() {
  try {
    await check("unsplit Explicit Target Legacy replaces non-target Derived overview and survives the packet cap", () => {
      const selection = createPlannerSelectionHarness(path.join(root, "unsplit-overview-selection"));
      const filler = "南方宫宴礼乐席次与账册往来。".repeat(600);
      const sentinel = "赵光义在北境守门约定中留下 UNSPLIT_OVERVIEW_SENTINEL，守将依约开启城门。";
      const legacy = selection.makeLegacy("unsplit-explicit-target", `【张道素能够知道并记住的本场经过】\n${filler}\n${sentinel}\n${filler}`);
      assert.equal(legacy.provenance.legacyParentId, undefined, "fixture must remain a whole unsplit narrative");
      const packet = selection.plan({ query: "赵光义北境守门约定玉印后来如何？",
        rows: [{ entryId: "unrelated-derived-source", entityIds: [4], topics: ["北境"], text: "北境行程年度记载。" }],
        legacyMemories: [legacy], overview: selection.makeDerived("unrelated-derived", "北境行程年度概览，不含赵光义。",
          ["unrelated-derived-source"]) });
      assert.equal(packet.overview?.memory.memoryId, legacy.memoryId,
        `Explicit Target unsplit Legacy must replace non-target Derived overview: ${JSON.stringify(packet.items.map(item => item.memory.memoryId))}`);
      assert(packet.overview.memory.content.includes("UNSPLIT_OVERVIEW_SENTINEL"), "oversize excerpt must retain the target sentence");
      assert(packet.tokens <= 1200, `packet exceeded 1200 tokens: ${packet.tokens}`);
    });

    await check("explicit Derived and higher-ranked Explicit Legacy overviews remain protected", () => {
      const selection = createPlannerSelectionHarness(path.join(root, "explicit-overview-protection"));
      const query = "赵光义北境守门约定玉印后来如何？";
      const derivedId = "explicit-derived-overview";
      const derived = selection.makeDerived(derivedId, "赵光义在北境守门约定中的经历概览。", ["explicit-derived-source"]);
      const derivedPacket = selection.plan({ query, rows: [{ entryId: "explicit-derived-source", entityIds: [3], topics: ["北境"],
        text: "赵光义在北境守门约定中的经历。" }], legacyMemories: [selection.makeLegacy("competing-explicit-legacy",
        "赵光义在北境守门约定中交出玉印；COMPETING_EXPLICIT_LEGACY_SENTINEL")], overview: derived });
      assert.equal(derivedPacket.overview?.memory.memoryId, derivedId,
        "an Explicit Target Derived overview must not be replaced by Explicit Target Legacy");
      assert.equal(derivedPacket.overview.routeKind, "entity_target");
      assert.equal(derivedPacket.items.some(item => item.memory.memoryId === "competing-explicit-legacy"), false);

      const high = selection.makeLegacy("ranked-explicit-legacy-high",
        "赵光义在北境守门约定中交出玉印，守将依约开启城门。HIGH_EXPLICIT_OVERVIEW_SENTINEL");
      const low = selection.makeLegacy("ranked-explicit-legacy-low", "赵光义早年在北境宫宴中听曲赏舞。LOW_EXPLICIT_OVERVIEW_SENTINEL");
      const nonTarget = selection.makeLegacy("non-target-legacy", "北境另一场宫宴只记有乐舞席次。", [45]);
      const ranked = selection.planner.ranker.rank([low, nonTarget, high], { query, entityIds: [3] });
      assert.equal(ranked[0].memory.memoryId, high.memoryId, "fixture must put the better matching target Legacy first");
      const legacyPacket = selection.plan({ query, legacyMemories: [low, nonTarget, high] });
      assert.equal(legacyPacket.overview?.memory.memoryId, high.memoryId,
        "later Explicit or non-target Legacy candidates must not replace the better-ranked Explicit Legacy overview");
    });

    await check("an empty Explicit Target set preserves the existing Derived overview", () => {
      const selection = createPlannerSelectionHarness(path.join(root, "generic-overview-selection"));
      const derived = selection.makeDerived("generic-derived-overview", "北境旧事的年度概览。", ["generic-derived-source"]);
      const packet = selection.plan({ query: "你还记得北境旧事吗？", explicitTargetEntityIds: [],
        rows: [{ entryId: "generic-derived-source", entityIds: [4], topics: ["北境"], text: "北境旧事中的行程记录。" }],
        legacyMemories: [selection.makeLegacy("generic-legacy", "北境旧事另有一段旧叙事。", [45])], overview: derived });
      assert.equal(packet.overview?.memory.memoryId, derived.memory.memoryId);
      assert.equal(packet.items.some(item => item.memory.memoryId === "generic-legacy"), false,
        "ordinary Legacy must not force its way into the overview without an Explicit Target");
    });

    await check("oversize explicit Legacy target is re-excerpted after dropping competing items", () => {
      const content = "赵光义所涉事件 ".repeat(200);
      const target = { routeKind: "entity_target", explicitTargetEntityIds: [3], sourceRef: { kind: "legacy" },
        memory: { memoryId: "explicit-target", content }, reason: { axis: "conversation", precision: "day" }, annotation: "explicit" };
      const unrelated = { sourceRef: { kind: "detail" }, memory: { memoryId: "unrelated", content: "other ".repeat(100) },
        reason: { axis: "event", precision: "day" }, annotation: "other" };
      const packet = fitRecallPacket({ query: { text: "赵光义为何如此" }, overview: target, details: [unrelated],
        profileText: "profile ".repeat(150), notice: "notice ".repeat(40) }, 200,
      value => Math.ceil(String(value || "").length / 4));
      assert(packet.tokens <= 200);
      assert.deepEqual(packet.items.map(item => item.memory.memoryId), ["explicit-target"]);
      assert(packet.items[0].memory.content.length < content.length);
      assert.match(packet.text, /赵光义/);
    });

    await check("final provider input keeps explicit-target split Legacy over two unrelated Canonical details", async () => {
      const harness = createPromptHarness(path.join(root, "final-selection"));
      const fragmentM1 = fragment("unrelated-m1-source", [4]);
      const fragmentM2 = fragment("unrelated-m2-source", [5]);
      commitCanonical(harness.engine, { finalizationId: "unrelated-canonical-finalization",
        fragments: [fragmentM1, fragmentM2], counterpartIds: [4, 5], entries: [
          canonicalEntry("北境另一场争议 M1_UNRELATED_CANONICAL_SENTINEL", fragmentM1.fragmentId, [4], ["北境"], [4]),
          canonicalEntry("北境议和中有使者往返 M2_UNRELATED_CANONICAL_SENTINEL", fragmentM2.fragmentId, [5], ["北境"], [5])
        ] });
      const targetSource = harness.engine.store.saveMemory({ memoryId: "legacy-target-source", type: "information",
        subtype: "conversation_summary", content: "赵光义在北境旧事中留下 EXPLICIT_C_LEGACY_SENTINEL。",
        eventDate: summaryDate, participants: [ownerId, 3], subjects: [3], knownBy: [ownerId],
        visibility: "known_group", provenance: { campaignToken, folderOwnerId: ownerId,
          counterpartId: 5, counterpartIds: [5, 3], finalizationId: "legacy-parent-finalization",
          extractionMode: "user_edited_summary" } });
      const parentText = `【张道素能够知道并记住的本场经过】\n- ${targetSource.content}`;
      writeJson(path.join(harness.ownerFolder, "与旧友的对话.json"), [summaryRow({ counterpart: 5,
        subjectIds: [3], content: parentText, perspectiveMemoryIds: [targetSource.memoryId],
        conversationId: "legacy-parent-conversation", finalizationId: "legacy-parent-finalization",
        segmentId: "legacy-parent-segment" })]);
      const query = "赵光义北境那件事后来怎么样？";
      const result = await providerInput(harness, query);
      assert.deepEqual(result.memoryContext.memory4Packet.diagnostics.explicitTargetEntityIds, [3]);
      const selection = result.memoryContext.memory4Packet;
      assert(result.memoryContext.memory4Packet.items.some(item => item.sourceRef.kind === "legacy"
        && item.memory.content.includes("EXPLICIT_C_LEGACY_SENTINEL")),
      `the final packet must select C's split Legacy item: ${JSON.stringify({ diagnostics: selection.diagnostics,
        items: selection.items.map(item => ({ kind: item.sourceRef?.kind, id: item.memory?.memoryId, route: item.routeKind })) })}`);
      assert(result.text.includes("EXPLICIT_C_LEGACY_SENTINEL"), "the complete Provider messages must contain C's Legacy sentinel");
      assert(result.memoryContext.memory4Packet.items.filter(item => item.sourceRef.kind === "detail").length <= 1,
        "the selected explicit Legacy item may replace at most one unrelated Canonical detail");
    });

    await check("uncertain Durable Forget aborts visible summary deletion and leaves all files unchanged", async () => {
      const fixture = summaryManagerFixture(path.join(root, "uncertain-delete"), { durableFootprint: true });
      const before = snapshotContents(fixture.directory);
      const visibleBefore = fs.readFileSync(fixture.summaryFile, "utf8");
      const result = await fixture.manager.deleteSummary(ownerId, 1, 0);
      assert.equal(result.success, false, JSON.stringify(result));
      assert.deepEqual(snapshotContents(fixture.directory), before, "failed durable forget must roll back visible and Memory4 files");
      assert.equal(fs.readFileSync(fixture.summaryFile, "utf8"), visibleBefore, "the selected summary remains byte-for-byte present");
    });

    await check("Legacy-only summary with proved zero Memory4 footprint may be deleted safely", async () => {
      const fixture = summaryManagerFixture(path.join(root, "no-footprint-delete"));
      const result = await fixture.manager.deleteSummary(ownerId, 1, 0);
      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(result.diagnostics.status, "SKIPPED_SAFE_NO_FOOTPRINT", JSON.stringify(result.diagnostics));
      assert.equal(fs.existsSync(fixture.summaryFile), false);
      assert.equal(fixture.engine.memory4.store.loadIndex({ campaignToken, ownerId }).revision, 0,
        "safe skip must not create a tombstone or a new sidecar index");
    });

    await check("regular file at .memory4 owner path blocks the no-footprint deletion proof", async () => {
      const fixture = summaryManagerFixture(path.join(root, "malformed-sidecar-owner-path"));
      const sidecarRoot = path.join(fixture.summariesDir, ".memory4");
      fs.mkdirSync(sidecarRoot);
      const malformedOwnerPath = path.join(sidecarRoot, String(ownerId));
      fs.writeFileSync(malformedOwnerPath, "not-a-directory", "utf8");
      const before = snapshotContents(fixture.directory);
      const result = await fixture.manager.deleteSummary(ownerId, 1, 0);
      assert.equal(result.success, false, JSON.stringify(result));
      assert.deepEqual(snapshotContents(fixture.directory), before,
        "malformed owner path must not be treated as positive proof of absent Memory4 state");
      assert.equal(fs.readFileSync(malformedOwnerPath, "utf8"), "not-a-directory");
    });

    await check("orphan audit is byte-for-byte read-only and distinguishes shared A orphan from active C", async () => {
      const fixture = createAuditFixture(path.join(root, "shared-read-only"), { includeRecovery: true });
      const before = snapshotTree(fixture.directory);
      const audited = fixture.auditor.audit(fixture.scope);
      assert.deepEqual(snapshotTree(fixture.directory), before, "audit must not persist repair, tombstone, or cache files");
      const a = audited.items.find(item => item.projectionId === fixture.projectionA.projectionId);
      const c = audited.items.find(item => item.projectionId === fixture.projectionC.projectionId);
      assert.equal(a?.status, "ORPHANED_PRE_V815_PROJECTION", JSON.stringify(a));
      assert.equal(c?.status, "ACTIVE", JSON.stringify(c));
      assert.deepEqual(a.canonicalEntryIds, [fixture.entryId]);
      assert.equal(a.recoveryFiles.length, 1, "the audit should identify the recovery source without changing it");
    });

    await check("visible summary with incomplete mapping is UNKNOWN and cannot be forgotten", () => {
      const fixture = createAuditFixture(path.join(root, "visible-unknown"), { includeRecovery: false,
        includeVisibleC: false, visibleA: true });
      const before = snapshotTree(fixture.directory);
      const audited = fixture.auditor.audit(fixture.scope);
      const a = audited.items.find(item => item.projectionId === fixture.projectionA.projectionId);
      assert.equal(a?.status, "UNKNOWN", JSON.stringify(a));
      assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId: fixture.projectionA.projectionId,
        expectedAuditToken: audited.auditToken, confirmed: true }), /memory4_orphan_not_confirmed/);
      assert.deepEqual(snapshotTree(fixture.directory), before, "UNKNOWN must remain unmodified after rejected forget");
    });

    await check("visible summary with missing counterpart and matching source IDs is UNKNOWN", () => {
      const fixture = createAuditFixture(path.join(root, "visible-missing-counterpart"), { includeVisibleC: false });
      const visible = summaryRow({ counterpart: 1, content: "VISIBLE_WITH_MISSING_COUNTERPART", includeLineage: false });
      delete visible.characterId;
      visible.conversationId = fixture.projectionA.conversationId;
      visible.finalizationId = fixture.projectionA.finalizationId;
      writeJson(path.join(fixture.ownerFolder, "uncertain-pair.json"), [visible]);
      const before = snapshotTree(fixture.directory);
      const audited = fixture.auditor.audit(fixture.scope);
      const a = audited.items.find(item => item.projectionId === fixture.projectionA.projectionId);
      assert.equal(a?.status, "UNKNOWN", JSON.stringify(a));
      assert(a.reasons.includes("VISIBLE_SOURCE_MAPPING_UNCERTAIN"));
      assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId: fixture.projectionA.projectionId,
        expectedAuditToken: audited.auditToken, confirmed: true }), /memory4_orphan_not_confirmed/);
      assert.deepEqual(snapshotTree(fixture.directory), before, "unknown visible counterpart must block deletion without mutation");
    });

    await check("visible C sharing a Legacy source ID blocks A orphan deletion", () => {
      const fixture = createAuditFixture(path.join(root, "visible-shared-legacy-source"), { includeVisibleC: false,
        singleProjectionA: true });
      const legacyMemoryId = "legacy-source-shared-with-c";
      fixture.engine.store.saveMemory({ memoryId: legacyMemoryId, type: "information", content: "C source retained in Legacy store",
        participants: [ownerId, 3], subjects: [3], knownBy: [ownerId], visibility: "known_group",
        provenance: { campaignToken, folderOwnerId: ownerId, counterpartId: 3, counterpartIds: [ownerId, 3] } });
      const store = fixture.engine.memory4.store, directory = store.directory(fixture.scope);
      const index = store.loadIndex(fixture.scope), entry = store.read(store.entryPath(directory, fixture.entryId), null);
      entry.source.summaryIds = [legacyMemoryId];
      entry.source.projectionLineages = [fixture.projectionA];
      fixture.engine.store.writeJson(store.entryPath(directory, fixture.entryId), entry);
      index.entries[fixture.entryId] = store.indexRow(entry);
      const metadata = store.read(path.join(directory, "metadata.json"), null);
      metadata.indexHash = hash(index);
      fixture.engine.store.writeJson(path.join(directory, "index.json"), index);
      fixture.engine.store.writeJson(path.join(directory, "metadata.json"), metadata);
      writeJson(path.join(fixture.ownerFolder, "visible-c-legacy-ref.json"), [summaryRow({ counterpart: 3,
        subjectIds: [3], content: "VISIBLE_C_STILL_USES_SHARED_LEGACY_SOURCE", projectionId: fixture.projectionC.projectionId,
        conversationId: fixture.projectionC.conversationId, finalizationId: fixture.projectionC.finalizationId,
        segmentId: fixture.projectionC.segmentIds[0], perspectiveMemoryIds: [legacyMemoryId] })]);
      const audited = fixture.auditor.audit(fixture.scope);
      const a = audited.items.find(item => item.projectionId === fixture.projectionA.projectionId);
      assert.equal(a?.status, "UNKNOWN", JSON.stringify(a));
      assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId: fixture.projectionA.projectionId,
        expectedAuditToken: audited.auditToken, confirmed: true }), /memory4_orphan_not_confirmed/);
      assert(fixture.engine.store.getMemory(legacyMemoryId), "visible C's shared Legacy source must remain stored");
    });

    await check("ambiguous source without a unique counterpart remains UNKNOWN", () => {
      const fixture = createAuditFixture(path.join(root, "source-unknown"), { includeVisibleC: false,
        inferredUnknown: true });
      const before = snapshotTree(fixture.directory);
      const audited = fixture.auditor.audit(fixture.scope);
      const unknown = audited.items.find(item => item.canonicalEntryIds.includes(fixture.entryId));
      assert.equal(unknown?.status, "UNKNOWN", JSON.stringify(unknown));
      assert.equal(unknown?.projectionId, null);
      assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId: unknown.projectionId,
        expectedAuditToken: audited.auditToken, confirmed: true }), /memory4_orphan_not_confirmed/);
      assert.deepEqual(snapshotTree(fixture.directory), before, "ambiguous lineage must remain unmodified after rejected forget");
    });

    await check("shared canonical with incomplete per-projection coverage stays UNKNOWN", () => {
      const fixture = createAuditFixture(path.join(root, "shared-coverage-unknown"), {
        includeVisibleC: true, unprovenSharedCoverage: true
      });
      const before = snapshotTree(fixture.directory);
      const audited = fixture.auditor.audit(fixture.scope);
      const a = audited.items.find(item => item.projectionId === fixture.projectionA.projectionId);
      assert.equal(a?.status, "UNKNOWN", JSON.stringify(a));
      assert(a.reasons.includes("SHARED_SOURCE_COVERAGE_UNPROVEN"));
      assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId: fixture.projectionA.projectionId,
        expectedAuditToken: audited.auditToken, confirmed: true }), /memory4_orphan_not_confirmed/);
      assert.deepEqual(snapshotTree(fixture.directory), before,
        "incomplete source partition must not permit a tombstone or canonical deletion");
    });

    await check("stale orphan confirmation rejects visible-catalog changes", () => {
      const fixture = createAuditFixture(path.join(root, "stale-visible"));
      const audited = fixture.auditor.audit(fixture.scope);
      const file = path.join(fixture.ownerFolder, "与赵光义的对话.json");
      const rows = JSON.parse(fs.readFileSync(file, "utf8"));
      rows[0].content += " changed after audit";
      writeJson(file, rows);
      const afterMutation = snapshotTree(fixture.directory);
      expectStale(fixture, audited.auditToken);
      assert.deepEqual(snapshotTree(fixture.directory), afterMutation, "rejected stale confirmation must not mutate files");
    });

    await check("stale orphan confirmation rejects canonical sidecar changes", () => {
      const fixture = createAuditFixture(path.join(root, "stale-sidecar"));
      const audited = fixture.auditor.audit(fixture.scope);
      fixture.engine.memory4.store.updateEntry(fixture.scope, fixture.entryId, "UPDATED_CANONICAL_AFTER_AUDIT",
        { expectedRevision: 1 });
      const afterMutation = snapshotTree(fixture.directory);
      expectStale(fixture, audited.auditToken);
      assert.deepEqual(snapshotTree(fixture.directory), afterMutation, "rejected stale confirmation must not add a tombstone");
    });

    await check("stale orphan confirmation rejects recovery snapshot changes", () => {
      const fixture = createAuditFixture(path.join(root, "stale-recovery"), { includeRecovery: true });
      const audited = fixture.auditor.audit(fixture.scope);
      fixture.engine.memory4.saveRecovery(fixture.snapshot, { status: "PENDING", retryCount: 1,
        lastError: "fixture changed after audit" });
      const afterMutation = snapshotTree(fixture.directory);
      expectStale(fixture, audited.auditToken);
      assert.deepEqual(snapshotTree(fixture.directory), afterMutation, "rejected stale confirmation must not alter recovery data");
    });

    await check("explicitly confirmed orphan forget removes only A and preserves shared C after restart", () => {
      const fixture = createAuditFixture(path.join(root, "shared-forget"), { includeRecovery: true });
      const filesBefore = snapshotTree(fixture.directory);
      const before = fixture.auditor.audit(fixture.scope);
      assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId: fixture.projectionA.projectionId,
        expectedAuditToken: before.auditToken, confirmed: false }), /memory4_orphan_confirmation_required/);
      assert.deepEqual(snapshotTree(fixture.directory), filesBefore, "missing confirmation must be read-only");
      const forgotten = fixture.auditor.forget(fixture.scope, { projectionId: fixture.projectionA.projectionId,
        expectedAuditToken: before.auditToken, confirmed: true });
      assert.equal(forgotten.status, "FORGOTTEN", JSON.stringify(forgotten));
      const restarted = new MemoryEngine({ baseDir: path.join(fixture.directory, "memory"),
        summaryFoldersDir: fixture.summariesDir, trace: { record() {} } });
      const entry = restarted.memory4.store.readEntry(fixture.scope, fixture.entryId);
      assert.equal(entry.deleted, false);
      assert.deepEqual(entry.source.projectionLineages.map(lineage => lineage.projectionId), [fixture.projectionC.projectionId]);
      const recovery = restarted.memory4.readRecovery(restarted.memory4.recoveryPath(fixture.snapshot));
      assert.deepEqual(recovery.snapshot.projectionLineages.map(lineage => lineage.projectionId), [fixture.projectionC.projectionId]);
      const afterRestart = new Memory4OrphanAudit(restarted).audit(fixture.scope);
      assert.equal(afterRestart.items.find(item => item.projectionId === fixture.projectionA.projectionId)?.status, "FORGOTTEN");
      assert.equal(afterRestart.items.find(item => item.projectionId === fixture.projectionC.projectionId)?.status, "ACTIVE");
    });

    console.log(`PASS ${checks} independent V8.15 fix1 QA cases`);
    if (failures.length) throw new Error(`${failures.length} independent QA case(s) failed: ${failures.map(item => item.name).join("; ")}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
