"use strict";

// Independent fixture scaffold for the V9.3.6 FR/TP/MP/TK contracts.
// Intentionally not in test-manifest.js until the implementation is ready for execution.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = {
  id: versionPath,
  filename: versionPath,
  loaded: true,
  exports: require("../resources/app/out/main/version")
};

const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { resolveTrustedPlayerTurn } = require("../src/app/main/memory-system/pair-memory-routing");
const { createProjectionLineage } = require("../src/app/main/memory-system/legacy-source-lineage");
const { createMemoryId } = require("../src/app/main/memory-system/memory-types");
const { retrievePairMemorySources } = require("../src/app/main/memory-system/pair-memory-source-retrieval");
const { buildPerspectiveSummaryMap, validatePerspectiveSummaryMap } = require("../src/app/main/memory-system/perspective-projector");
const { validateVisibilityBoundaries } = require("../src/app/main/memory-system/finalization-visibility");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const { TokenCounter } = require("../resources/app/out/main/provider-service");

const repoRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(repoRoot, ".build");
const campaignToken = "qa-v936-independent-campaign";
const currentGameDate = "1200.1.1";
const currentTotalDays = normalizeGameDate(currentGameDate).serial;
const names = new Map([[1, "甲"], [2, "乙"], [3, "玛蒂尔达"], [4, "丁"], [5, "玛蒂尔达"]]);

const caseDescriptions = [
  ["FR", ["双人三固定块", "Official缺失", "B→A缺失不取B→C", "15轮Frozen稳定", "30条全量", "100条全量",
    "500条预算裁剪", "同日期稳定source key", "排除未来", "承诺语义", "新会话重建", "Forget清前缀",
    "编辑删除失效", "Campaign切换", "玩家与Owner变化", "并发单一Frozen", "Provider失败重试", "普通GLM和V8.13布局"]],
  ["TP", ["仅提名L0", "当前事实L0", "引述记得L0", "否定优先L0", "记得C为L1", "关系概况L1",
    "具体争执L2", "3条匹配不补齐", "80条跨年公平选择", "C/D每目标上限并共享预算", "同名ID歧义",
    "代词只沿用已绑定目标", "NPC发言不授权", "C在场不自动读取", "L1无源不全文fallback",
    "L2索引miss有界fallback", "过期revision拒绝", "Mentioned旁路门禁", "EntityTarget旁路门禁",
    "Temporal/TopicPatch旁路门禁", "B→D转述来源和权限", "禁止读取C→B", "Forget事项和原文双层撤回",
    "坏索引fail-closed", "事件时间与谈话时间双轴", "只提名字后追问仅本轮升级"]],
  ["MP", ["B固定B→A", "C固定C→A", "C最近发言不改B锚点", "参与者重排稳定", "A+B+C+D锚点隔离",
    "共同见证不伪装私聊", "秘密和在场边界", "后来查B→C仍可用"]],
  ["TK", ["8K双人", "16K三人", "32K四人硬顶", "128K硬顶及动态限", "高输出reserve", "长历史与世界线",
    "格式化后计数", "16项加两源共享预算", "长会话性能", "真实Provider usage对照"]]
].flatMap(([prefix, descriptions]) => descriptions.map((description, index) => ({
  id: prefix + "-" + String(index + 1).padStart(2, "0"), description
})));

function createMatters(prefix, count, options = {}) {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(3, "0");
    const year = options.spreadYears ? 1080 + ((index * 7) % 115) : null;
    const temporal = year ? "事件约在" + year + "年；" : "";
    const status = options.promiseEvery === index + 1 ? "仍承诺稍后核验，尚未声称已完成；" : "";
    return prefix + "_MATTER_" + number + "：" + temporal + status + "双方讨论长命锁与税收安排。";
  });
}

function makeLegacySummary(ownerId, counterpartId, finalizationId, date, matters, extra = {}) {
  const ownerName = names.get(ownerId) || "人物" + ownerId;
  const counterpartName = names.get(counterpartId) || "人物" + counterpartId;
  return {
    date,
    totalDays: normalizeGameDate(date).serial,
    content: "QA_SOURCE_" + finalizationId + "：合成 Legacy 叙事。\n\n【需要长期记住的事项】\n" +
      (matters.length ? matters.map(item => "- " + item).join("\n") : "无") +
      "\n【其他事项】\n仅用于 V9.3.6 离线独立 QA。",
    playerId: ownerId,
    playerName: ownerName,
    characterId: counterpartId,
    characterName: counterpartName,
    perspectiveOwnerId: ownerId,
    campaignToken,
    campaignBinding: { status: "bound", source: "qa_fixture", version: 1 },
    finalizationId,
    conversationId: "conversation-" + finalizationId,
    conversationType: "pair",
    participants: [{ id: ownerId, name: ownerName }, { id: counterpartId, name: counterpartName }],
    ...extra
  };
}

function createAdversarialFixtureData() {
  const pairSummaries = [
    { ownerId: 2, counterpartId: 1, summaries: [
      makeLegacySummary(2, 1, "ba-30", "1190.1.1", createMatters("BA30", 30)),
      makeLegacySummary(2, 1, "ba-100", "1195.1.1", createMatters("BA100", 100)),
      makeLegacySummary(2, 1, "ba-500", "1199.1.1", createMatters("BA500", 500, { promiseEvery: 247 }))
    ] },
    { ownerId: 2, counterpartId: 3, summaries: Array.from({ length: 8 }, (_, index) => {
      const year = 1080 + index * 15;
      return makeLegacySummary(2, 3, "bc-year-" + year, year + ".1.1",
        createMatters("BC" + year, 10, { spreadYears: true }));
    }) },
    { ownerId: 2, counterpartId: 4, summaries: [
      makeLegacySummary(2, 4, "bd-hears-c", "1197.1.1", ["BD_HEARS_C：丁转告乙，玛蒂尔达曾提出边境税收异议。"])
    ] },
    { ownerId: 3, counterpartId: 2, summaries: [
      makeLegacySummary(3, 2, "cb-private", "1198.1.1", ["CB_PRIVATE_SENTINEL：丙的私人视角，不得由乙读取。"])
    ] },
    { ownerId: 2, counterpartId: 5, summaries: [
      makeLegacySummary(2, 5, "ba-same-name-other-id", "1196.1.1", ["SAME_NAME_OTHER_ID：同名但不同身份。"])
    ] },
    { ownerId: 2, counterpartId: 3, summaries: [
      makeLegacySummary(2, 3, "bc-future", "1201.1.1", ["FUTURE_SENTINEL：不得提前可见。"]),
      makeLegacySummary(2, 3, "bc-same-date-a", "1194.6.1", ["SAME_DATE_A：稳定源身份测试。"]),
      makeLegacySummary(2, 3, "bc-same-date-b", "1194.6.1", ["SAME_DATE_B：稳定源身份测试。"])
    ] }
  ];

  const turns = {
    nameOnly: "玛蒂尔达刚刚走了。",
    currentFact: "玛蒂尔达现在在哪儿？",
    quoted: "丁说“我记得玛蒂尔达”，你怎么看？",
    denied: "别回忆玛蒂尔达以前的事，只说今天的安排。",
    relationship: "你还记得玛蒂尔达吗？",
    relationshipBroad: "你以前和玛蒂尔达关系怎么样？",
    detail: "1090年你和玛蒂尔达为了税收具体争执过什么？",
    ambiguous: "那个人当年呢？",
    followup: "那后来呢？",
    twoTargets: "你以前和玛蒂尔达、丁分别发生过什么？"
  };

  return {
    identities: { playerId: 1, responderB: 2, targetC: 3, otherD: 4, sameNameTarget: 5 },
    campaignToken,
    currentGameDate,
    currentTotalDays,
    pairSummaries,
    turns,
    history: [
      { id: 1, role: "user", speakerCharacterId: 1, addresseeId: 2, content: "玩家甲向乙询问宫廷。" },
      { id: 2, role: "assistant", speakerCharacterId: 3, content: "丙最近对乙说话，但没有向玩家甲提问。" }
    ],
    participantOrders: [[1, 2, 3, 4], [4, 3, 2, 1], [2, 1, 4, 3]],
    budgets: [
      { contextWindow: 8192, participantIds: [1, 2], outputReserve: 2048, safetyMargin: 512 },
      { contextWindow: 16384, participantIds: [1, 2, 3], outputReserve: 4096, safetyMargin: 768 },
      { contextWindow: 32768, participantIds: [1, 2, 3, 4], outputReserve: 8192, safetyMargin: 1024 },
      { contextWindow: 131072, participantIds: [1, 2, 3, 4], outputReserve: 32768, safetyMargin: 2048 }
    ],
    multiPartyEvidence: {
      participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }, { id: 3, name: "玛蒂尔达" }],
      participantPresence: [
        { characterId: 1, joinedAtMessageId: 1, leftAtMessageId: null },
        { characterId: 2, joinedAtMessageId: 1, leftAtMessageId: null },
        { characterId: 3, joinedAtMessageId: 3, leftAtMessageId: 5 }
      ],
      messages: [
        { id: 1, role: "user", speakerCharacterId: 1, content: "甲公开要求乙交付账册。" },
        { id: 2, role: "assistant", speakerCharacterId: 2, content: "乙公开回应并作出承诺。" },
        { id: 3, role: "system", kind: "presence_join", characterId: 3 },
        { id: 4, role: "user", speakerCharacterId: 1, content: "甲只对乙低声说 MP_WHISPER_SENTINEL。" },
        { id: 5, role: "system", kind: "presence_leave", characterId: 3 }
      ]
    }
  };
}

function seedAdversarialFixture(engine, fixture = createAdversarialFixtureData()) {
  for (const pair of fixture.pairSummaries) {
    const ownerName = names.get(pair.ownerId) || "人物" + pair.ownerId;
    const counterpartName = names.get(pair.counterpartId) || "人物" + pair.counterpartId;
    const folder = path.join(engine.store.summaryFoldersDir, pair.ownerId + "_" + ownerName);
    const file = path.join(folder, "与" + counterpartName + "的对话.json");
    fs.mkdirSync(folder, { recursive: true });
    const existing = fs.existsSync(file) ? engine.store.readJson(file, []) : [];
    engine.store.writeJson(file, [...existing, ...pair.summaries]);
    engine.store.invalidateFolderSummaryCache([pair.ownerId]);
  }
  return fixture;
}

function createFixtureEngine(label = "fixture") {
  fs.mkdirSync(buildRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(buildRoot, "v936-independent-" + label + "-"));
  const engine = new MemoryEngine({
    baseDir: path.join(root, "memory"),
    summaryFoldersDir: path.join(root, "summaries"),
    trace: { record() {} }
  });
  return { engine, root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function pairSummaryPath(engine, ownerId, counterpartId) {
  const ownerName = names.get(ownerId) || "人物" + ownerId;
  const counterpartName = names.get(counterpartId) || "人物" + counterpartId;
  return path.join(engine.store.summaryFoldersDir, ownerId + "_" + ownerName, "与" + counterpartName + "的对话.json");
}

function validationGameData(fixture, overrides = {}) {
  return {
    campaignToken: overrides.campaignToken ?? fixture.campaignToken,
    playerID: overrides.playerID ?? fixture.identities.playerId,
    date: overrides.date ?? fixture.currentGameDate,
    getOfficialRecollectionSummary: overrides.getOfficialRecollectionSummary || (() => null)
  };
}

function addProjectionLineage(summary, ownerId, counterpartId, segmentId) {
  const sourceMessageIds = [ownerId * 100 + counterpartId];
  const sourceSegmentIds = ["qa-source-" + segmentId];
  const lineage = createProjectionLineage({ campaignToken: summary.campaignToken, ownerId, counterpartId,
    conversationId: summary.conversationId, finalizationId: summary.finalizationId,
    segmentIds: [segmentId], sourceSegmentIds, sourceMessageIds });
  return { ...summary, perspectiveMemoryIds: [], perspectiveSummarySegmentIds: [segmentId],
    sourceSegmentIds, sourceMessageIds, projectionId: lineage.projectionId };
}

function promptPrefixContains(cache, marker) {
  return JSON.stringify([...cache.values()]).includes(marker);
}

function makePlayerTurn(id, content, speakerCharacterId = 1) {
  return { id, role: "user", speakerCharacterId, content };
}

function makeCandidateRequest(fixture, turnName, overrides = {}) {
  const conversationId = overrides.conversationId || "qa-v936-independent";
  const sceneRevision = overrides.sceneRevision || "fixture-scene-1";
  const turnEpoch = Number.isSafeInteger(overrides.turnEpoch) ? overrides.turnEpoch : 1;
  const messageId = overrides.currentPlayerMessageId ?? 9000 + turnEpoch;
  const playerAnchorId = Number(overrides.trustedPlayerAnchorId ?? fixture.identities.playerId);
  const responderId = Number(overrides.characterId ?? fixture.identities.responderB);
  const playerMessage = makePlayerTurn(messageId, overrides.playerContent ?? fixture.turns[turnName] ?? "", playerAnchorId);
  const history = Array.isArray(overrides.history) ? overrides.history : [...fixture.history, playerMessage];
  const trustedPlayerTurn = resolveTrustedPlayerTurn({
    history,
    playerAnchorId,
    currentPlayerMessageId: playerMessage.id,
    turnEpoch,
    conversationId,
    sceneRevision
  });
  assert(trustedPlayerTurn, "fixture player turn must pass the runtime trust resolver");
  const queryNamesTarget = trustedPlayerTurn.content.includes("玛蒂尔达");
  return {
    characterId: responderId,
    query: trustedPlayerTurn.content,
    history,
    currentPlayerMessageId: playerMessage.id,
    turnEpoch,
    conversationId,
    sceneRevision,
    directCounterpartIds: [playerAnchorId],
    activeParticipantIds: [playerAnchorId, responderId],
    mentionedEntityIds: queryNamesTarget ? [fixture.identities.targetC] : [],
    mentionedEntityNames: queryNamesTarget ? { 3: ["玛蒂尔达"] } : {},
    explicitTargetEntityIds: queryNamesTarget ? [fixture.identities.targetC] : [],
    campaignToken: fixture.campaignToken,
    currentGameDate: fixture.currentGameDate,
    currentTotalDays: fixture.currentTotalDays,
    memoryEngine3Enabled: true,
    tokenBudget: 50000,
    estimateTokens: value => Math.ceil(String(value || "").length / 2),
    sessionRecallCache: new Map(),
    mentionedRecallCache: new Map(),
    playerCenteredRecallEnabled: true,
    trustedPlayerAnchorId: playerAnchorId,
    trustedPlayerTurn,
    ...overrides
  };
}

function createFrBaselineFixtureData(caseId) {
  const fixture = createAdversarialFixtureData();
  const matterCount = caseId === "FR-05" ? 30 : caseId === "FR-06" ? 100 : caseId === "FR-07" ? 500 : 30;
  const baMatters = createMatters("FR_BA", matterCount, caseId === "FR-10" ? { promiseEvery: 1 } : {});
  const ba = makeLegacySummary(2, 1, "fr-player-recent", "1199.1.1", baMatters);
  ba.content = ba.content.replace("QA_SOURCE_fr-player-recent：合成 Legacy 叙事。", "FR_BA_RECENT：乙对甲的最近摘要。");
  const baRows = [ba];
  if (caseId === "FR-07") {
    const history = { ...ba, date: "1198.1.1", totalDays: normalizeGameDate("1198.1.1").serial };
    const recent = makeLegacySummary(2, 1, "fr-player-recent-small", "1199.1.1", []);
    recent.content = recent.content.replace("QA_SOURCE_fr-player-recent-small：合成 Legacy 叙事。", "FR_BA_RECENT：乙对甲的短最近摘要。");
    baRows.splice(0, baRows.length, history, recent);
  }
  if (caseId === "FR-08") {
    const sameDateA = makeLegacySummary(2, 1, "fr-same-date-a", "1198.6.1", ["FR_SAME_DATE_A_ITEM。"]);
    const sameDateB = makeLegacySummary(2, 1, "fr-same-date-b", "1198.6.1", ["FR_SAME_DATE_B_ITEM。"]);
    sameDateA.content = sameDateA.content.replace("QA_SOURCE_fr-same-date-a：合成 Legacy 叙事。", "FR_SAME_DATE_A_RECENT。");
    sameDateB.content = sameDateB.content.replace("QA_SOURCE_fr-same-date-b：合成 Legacy 叙事。", "FR_SAME_DATE_B_RECENT。");
    baRows.splice(0, baRows.length, sameDateA, sameDateB);
  }
  if (caseId === "FR-09") {
    const future = makeLegacySummary(2, 1, "fr-future", "1201.1.1", ["FR_FUTURE_SENTINEL：未来摘要。"]);
    future.content = future.content.replace("QA_SOURCE_fr-future：合成 Legacy 叙事。", "FR_FUTURE_RECENT：未来摘要。");
    baRows.push(future);
  }
  const bc = makeLegacySummary(2, 3, "fr-npc-recent", "1199.2.1", createMatters("FR_BC", 3));
  bc.content = bc.content.replace("QA_SOURCE_fr-npc-recent：合成 Legacy 叙事。", "FR_BC_FORBIDDEN：乙对丙的摘要。");
  fixture.pairSummaries = [
    ...(caseId === "FR-03" ? [] : [{ ownerId: 2, counterpartId: 1, summaries: baRows }]),
    { ownerId: 2, counterpartId: 3, summaries: [bc] }
  ];
  fixture.frCaseId = caseId;
  return fixture;
}

function baselineSlots(result) {
  return {
    recent: String(result?.directStableText || ""),
    official: String(result?.officialRecollectionText || ""),
    ledger: String(result?.playerLedgerFrozenText || ""),
    snapshotId: String(result?.baselineSnapshotId || ""),
    sourceGuard: result?.sourceGuard || result?.sourceguard || null,
    metrics: result?.pairMemoryMetrics || result?.metrics || null
  };
}

function assertBaselineSlots(result, { expectedRecent, expectedOfficial, expectedLedger, forbidden = [] } = {}) {
  const slots = baselineSlots(result);
  if (expectedRecent) assert(slots.recent.includes(expectedRecent), "player Recent1 must occupy directStableText");
  if (expectedOfficial) {
    assert(slots.official.includes(expectedOfficial), "valid Official must occupy its independent frozen slot");
    assert(!slots.recent.includes(expectedOfficial), "Official cannot be duplicated in directStableText");
  } else {
    assert.equal(slots.official, "", "missing Official must not be synthesized");
  }
  if (expectedLedger) assert(slots.ledger.includes(expectedLedger), "player ledger must occupy its independent frozen slot; metrics=" + JSON.stringify(slots.metrics));
  for (const marker of forbidden) {
    assert(![slots.recent, slots.official, slots.ledger].join("\n").includes(marker),
      "fixed player baseline leaked forbidden marker: " + marker);
  }
  assert(slots.snapshotId, "baseline snapshot must expose a stable ID");
  return slots;
}

function assertLedgerItemRendering(result) {
  const slots = baselineSlots(result);
  const recentText = String(result?.directStableText || "");
  const recentSources = (result?.direct || []).flatMap(entry => entry.memory?.provenance?.pairLedgerSources || []);
  const items = result?.pairMemoryItems || [];
  let referencedCount = 0;
  for (const item of items) {
    const exactSource = recentSources.some(source => source.sourceSummaryKey === item.source?.sourceSummaryKey
      && source.sourceRevision === item.source?.sourceRevision);
    const shouldReference = exactSource && recentText.includes(item.text);
    assert.equal(item.recentSummaryReference === true, shouldReference,
      "Recent dedupe must require exact source key, revision, and complete text containment for " + item.itemId);
    if (shouldReference) {
      referencedCount++;
      assert(slots.ledger.includes("详见近期摘要"), "an exact duplicate matter should retain a dated/evidence ledger reference");
      assert(!slots.ledger.includes(item.text), "an exact duplicate matter body should not be rendered twice");
    } else if (slots.ledger) {
      assert(slots.ledger.includes(item.text), "a distinct or incomplete matter must remain fully visible in the ledger");
    }
  }
  assert.equal(result?.pairMemoryMetrics?.recentSummaryReferencedItems || 0, referencedCount,
    "dedupe reference metrics must reconcile with retained item objects");
  return referencedCount;
}

function makePromptRuntime() {
  const state = { v813: false };
  const characters = new Map([
    [1, { id: 1, shortName: "甲", fullName: "甲", age: 40, traits: [], parents: [], children: [] }],
    [2, { id: 2, shortName: "乙", fullName: "乙", age: 35, traits: [], parents: [], children: [] }]
  ]);
  const gameData = {
    date: currentGameDate,
    year: 1200,
    scene: "宫廷",
    location: "临安",
    playerID: 1,
    characters,
    mentionedCharactersInContext: new Set(),
    getActiveParticipantRelationshipInfo: () => "当前关系",
    getMentionExclusionIds: () => new Set(),
    getMentionableCharacterProfiles: () => characters,
    findMentionedCharacterIdsInHistory: () => [],
    getMentionedCharactersInfo: () => ""
  };
  const settingsRepository = {
    getPromptSettings: () => ({ mainTemplate: "FR_QA_GLOBAL", blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "FR_QA_INSTRUCTION" }
    ], suffix: { enabled: false, template: "" } }),
    getChatPromptV89Settings: () => ({ chatPromptV89Layout: true,
      chatPromptV89RuntimeProfileSplit: false, chatPromptV810ProviderAdapter: true }),
    getChatPromptV813Layout: () => state.v813
  };
  const builder = createPromptBuilder({
    TemplateEngine: class { renderTemplateString(template) { return String(template); } },
    PromptScriptLoader: class {},
    promptConfigManager: { getDefaultMainTemplateContent: () => "FR_QA_GLOBAL", resolvePath: value => value },
    settingsRepository,
    path,
    TokenCounter,
    createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
    defaultChatInstruction: "FR_QA_INSTRUCTION"
  });
  const history = [{ role: "user", content: "甲询问当前宫廷安排。" }];
  const build = (layout, memoryContext) => {
    state.v813 = layout === "v813";
    const provider = layout === "glm"
      ? { providerType: "zhipu", defaultModel: "glm-5.3-flash" }
      : { providerType: "openai-compatible", defaultModel: "qa-model" };
    return builder.buildMessagesWithTokenCount(history, characters.get(2), gameData, "", {
      ...memoryContext,
      activeParticipantIds: [1, 2],
      cacheV2FrozenSnapshots: memoryContext.cacheV2FrozenSnapshots || {
        conversation: null, responders: new Map(), prefixByResponder: new Map()
      },
      stableProfileCache: new Map(),
      stableDescriptionCache: new Map(),
      freezePromptPrefix: true
    }, provider);
  };
  return { build, builder, gameData };
}

function countPromptMarker(result, marker) {
  return (result?.messages || []).reduce((count, message) => count +
    (String(message.content || "").split(marker).length - 1), 0);
}

async function runBudgetBoundaryBehaviorChecks() {
  const fixture = createAdversarialFixtureData();
  const recentMarker = "QA_BUDGET_RECENT_SENTINEL";
  const officialMarker = "QA_BUDGET_OFFICIAL_SENTINEL";
  const recent = makeLegacySummary(2, 1, "qa-budget-recent", "1199.1.1", []);
  recent.content = recentMarker + "：最近谈话记录。" + "玩家与乙讨论宫廷安排和边境使者。".repeat(5000);
  fixture.pairSummaries = [{ ownerId: 2, counterpartId: 1, summaries: [recent] }];
  const test = createFixtureEngine("budget-boundaries");
  const checks = [];
  const conversationId = "qa-v936-budget-edge";
  const officialSummary = { status: "READY", sourceType: "CK3_OFFICIAL_RECOLLECTION",
    officialCaptureSessionId: conversationId, playerId: 2, campaignToken,
    campaignBinding: { status: "bound", source: "qa_fixture", version: 1 }, memoryCount: 1,
    content: officialMarker + "：合法官方追忆。" + "当时记载的宫廷历程和人物交往。".repeat(1800) };
  try {
    seedAdversarialFixture(test.engine, fixture);
    const promptRuntime = makePromptRuntime();
    for (const tokenBudget of [64, 256, 1310, 4800]) {
      const result = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
        conversationId, tokenBudget, officialSummary, sessionRecallCache: new Map(), mentionedRecallCache: new Map(),
        estimateTokens: text => TokenCounter.estimateTokens(String(text || "")),
        estimateMessageTokens: message => TokenCounter.estimateMessageTokens(message)
      }));
      assert.equal(result.tokenBudget, tokenBudget, "the fixture request must preserve its exact memory budget");
      assert(result.directStableText?.includes(recentMarker), `${tokenBudget} tokens must keep a visible Recent1 prefix`);
      assert.equal(result.pairMemoryMetrics.recentSummaryTruncated, true,
        `${tokenBudget} tokens must report that the oversized Recent1 was safely truncated`);
      assert(result.pairMemoryMetrics.baselineBudgetUsed <= tokenBudget,
        `${tokenBudget} tokens must bound the engine-formatted fixed baseline`);
      assert(result.pairMemoryMetrics.finalInjectedTokens <= tokenBudget,
        `${tokenBudget} tokens must bound all engine-injected memory blocks`);

      const officialPresent = String(result.officialRecollectionText || "").includes(officialMarker);
      if (tokenBudget >= 256) {
        assert(officialPresent, `${tokenBudget} tokens must retain a bounded prefix of the legal Official source`);
        assert.equal(result.pairMemoryMetrics.officialSummaryTruncated, true,
          `${tokenBudget} tokens must expose truncation of the oversized Official source`);
      }
      if (officialPresent) assert.equal(result.pairMemoryMetrics.officialSummaryTruncated, true,
        "an oversized Official source cannot be silently shortened without a truncation metric");

      for (const layout of ["normal", "glm", "v813"]) {
        const prompt = promptRuntime.build(layout, { ...result,
          cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() } });
        const renderedMemoryTokens = promptRuntime.builder.getMemoryBlockTokenCount(prompt);
        assert(renderedMemoryTokens <= tokenBudget,
          `${layout}/${tokenBudget}: PromptBuilder measured ${renderedMemoryTokens}, over memory budget ${tokenBudget}`);
        assert(prompt.messages.some(message => String(message.content || "").includes(recentMarker)),
          `${layout}/${tokenBudget}: final Prompt must not silently clear the truncated Recent1`);
        if (tokenBudget >= 256) assert(prompt.messages.some(message => String(message.content || "").includes(officialMarker)),
          `${layout}/${tokenBudget}: final Prompt must include the bounded Official prefix`);
        checks.push({ id: `QA-BUDGET-${tokenBudget}-${layout}`, status: "PASS", tokenBudget, layout,
          renderedMemoryTokens, baselineBudgetUsed: result.pairMemoryMetrics.baselineBudgetUsed,
          recentTruncated: result.pairMemoryMetrics.recentSummaryTruncated,
          officialPresent, officialTruncated: result.pairMemoryMetrics.officialSummaryTruncated,
          ...(tokenBudget === 4800 && layout === "normal" ? { crossCoverage: [{ catalogId: "TK-01",
            status: "PARTIAL_NOT_CREDITED",
            reason: "actual memory clipping and PromptBuilder boundary are exercised; the full 8K dual-participant context case is not" }] } : {}) });
      }
    }
  } finally {
    test.cleanup();
  }

  const l2Fixture = createAdversarialFixtureData();
  const l2Recent = makeLegacySummary(2, 1, "qa-budget-l2-recent", "1199.1.1", []);
  l2Recent.content = "QA_BUDGET_L2_RECENT_SENTINEL：近期玩家对话。";
  const l2SourceMarker = "QA_BUDGET_L2_OVERSIZE_SOURCE_SENTINEL";
  const l2Source = makeLegacySummary(2, 3, "qa-budget-l2-source", "1090.1.1", [
    "1090年，乙与玛蒂尔达因边境税收发生争执，双方约定由账册核验后再议。QA_BUDGET_L2_INDEX_SENTINEL。"
  ]);
  l2Source.content += "\n" + l2SourceMarker + "：超长原文。" + "完整旧谈话原文保留但不能部分注入。".repeat(6000);
  l2Fixture.pairSummaries = [
    { ownerId: 2, counterpartId: 1, summaries: [l2Recent] },
    { ownerId: 2, counterpartId: 3, summaries: [l2Source] }
  ];
  const l2Test = createFixtureEngine("budget-l2-omission");
  try {
    seedAdversarialFixture(l2Test.engine, l2Fixture);
    const tokenBudget = 1310;
    const result = l2Test.engine.retrieveForResponder(makeCandidateRequest(l2Fixture, "detail", {
      tokenBudget,
      estimateTokens: text => TokenCounter.estimateTokens(String(text || "")),
      estimateMessageTokens: message => TokenCounter.estimateMessageTokens(message)
    }));
    assert.equal(result.thirdPersonDecision.level, "L2", "the oversize-source case must be an authorized L2 query");
    assert(result.pairMemoryMetrics.thirdPersonIndexHitCount > 0, "the indexed L2 matter must remain a real hit");
    assert.equal(result.pairMemoryMetrics.thirdPersonLegacyFallbackStatus, "BUDGET_OMITTED",
      "a whole Legacy source that cannot fit must be reported as budget omission, not INDEX_MISS");
    assert.equal(result.pairMemoryMetrics.legacyBudgetOmittedCount, 0,
      "the indexed-source omission is separate from no-index Legacy fallback omission");
    assert(!String(result.temporalExtraText || "").includes(l2SourceMarker),
      "an over-budget Legacy source must be omitted whole, not partially injected");
    const promptRuntime = makePromptRuntime();
    const prompt = promptRuntime.build("normal", { ...result,
      cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() } });
    const renderedMemoryTokens = promptRuntime.builder.getMemoryBlockTokenCount(prompt);
    assert(renderedMemoryTokens <= tokenBudget, "L2 omission must keep final Prompt memory within the same budget");
    assert(prompt.messages.some(message => String(message.content || "").includes("QA_BUDGET_L2_RECENT_SENTINEL")),
      "omitting an oversized L2 source must preserve Recent1");
    checks.push({ id: "QA-BUDGET-L2-WHOLE-SOURCE-OMISSION", status: "PASS", tokenBudget,
      level: result.thirdPersonDecision.level, indexHits: result.pairMemoryMetrics.thirdPersonIndexHitCount,
      fallback: result.pairMemoryMetrics.thirdPersonLegacyFallbackStatus, renderedMemoryTokens,
      recentPresent: true, sourcePartiallyInjected: false });
  } finally {
    l2Test.cleanup();
  }
  return checks;
}

async function runFrBaselineBehaviorChecks() {
  const checks = [];
  const officialMarker = "FR01_OFFICIAL_B";
  const officialSummary = {
    status: "READY",
    sourceType: "CK3_OFFICIAL_RECOLLECTION",
    officialCaptureSessionId: "qa-v936-independent",
    playerId: 2,
    campaignToken,
    campaignBinding: { status: "bound", source: "qa_fixture", version: 1 },
    memoryCount: 1,
    content: officialMarker + "：乙的合成官方追忆。"
  };

  for (const caseId of ["FR-01", "FR-02", "FR-03", "FR-05", "FR-06"]) {
    const fixture = createFrBaselineFixtureData(caseId);
    const test = createFixtureEngine(caseId);
    try {
      seedAdversarialFixture(test.engine, fixture);
      const request = makeCandidateRequest(fixture, "nameOnly", {
        tokenBudget: 100000,
        officialSummary: caseId === "FR-01" ? officialSummary : null
      });
      const result = test.engine.retrieveForResponder(request);
      const expectedRecent = caseId === "FR-03" ? null : "FR_BA_RECENT";
      const expectedOfficial = caseId === "FR-01" ? officialMarker : null;
      const slots = assertBaselineSlots(result, {
        expectedRecent,
        expectedOfficial,
        expectedLedger: caseId === "FR-03" ? null : "详见近期摘要",
        forbidden: ["FR_BC_FORBIDDEN"]
      });
      const referenced = assertLedgerItemRendering(result);
      if (caseId === "FR-05" || caseId === "FR-06") {
        const count = caseId === "FR-05" ? 30 : 100;
        assert.equal(result.pairMemoryItems.length, count, caseId + " must retain every complete indexed item object");
        assert.equal(referenced, count, caseId + " should reference each complete same-source matter already present in Recent1");
      }
      checks.push({ id: caseId, status: "PASS", snapshotId: slots.snapshotId });
    } finally {
      test.cleanup();
    }
  }

  const fixture = createFrBaselineFixtureData("FR-04");
  const test = createFixtureEngine("FR-04");
  try {
    seedAdversarialFixture(test.engine, fixture);
    const sessionRecallCache = new Map();
    const mentionedRecallCache = new Map();
    const snapshotIds = [];
    const frozenText = [];
    let history = [...fixture.history];
    for (let turnEpoch = 1; turnEpoch <= 15; turnEpoch++) {
      if (turnEpoch > 1) history.push({ id: 8000 + turnEpoch, role: "assistant", speakerCharacterId: 3,
        content: "丙在玩家轮次之间发言，不能改写乙对甲的冻结基线。" });
      const messageId = 9000 + turnEpoch;
      const message = makePlayerTurn(messageId, "第" + turnEpoch + "轮：今天宫廷如何？");
      history.push(message);
      const request = makeCandidateRequest(fixture, "nameOnly", {
        currentPlayerMessageId: messageId,
        turnEpoch,
        playerContent: message.content,
        history,
        sessionRecallCache,
        mentionedRecallCache,
        tokenBudget: 100000
      });
      const result = test.engine.retrieveForResponder(request);
      const slots = assertBaselineSlots(result, {
        expectedRecent: "FR_BA_RECENT",
        expectedLedger: "详见近期摘要",
        forbidden: ["FR_BC_FORBIDDEN"]
      });
      assertLedgerItemRendering(result);
      snapshotIds.push(slots.snapshotId);
      frozenText.push([slots.recent, slots.official, slots.ledger].join("\n"));
    }
    assert(snapshotIds.every(id => id === snapshotIds[0]), "one responder's baseline snapshot ID must stay frozen for 15 turns");
    assert(frozenText.every(text => text === frozenText[0]), "all three frozen blocks must remain byte-identical for 15 turns");
    checks.push({ id: "FR-04", status: "PASS", turns: 15, snapshotId: snapshotIds[0] });
  } finally {
    test.cleanup();
  }

  {
    const fixture = createFrBaselineFixtureData("FR-07");
    const test = createFixtureEngine("FR-07");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const request = makeCandidateRequest(fixture, "nameOnly", { tokenBudget: 5000 });
      const result = test.engine.retrieveForResponder(request);
      const slots = assertBaselineSlots(result, { expectedRecent: "FR_BA_RECENT" });
      const metrics = slots.metrics;
      assert.equal(metrics.playerLedgerAvailableCount, 500, "all 500 indexed items remain visible before budgeting");
      assert(metrics.playerLedgerInjectedCount > 0 && metrics.playerLedgerInjectedCount < 500,
        "an insufficient budget should inject a partial set of whole items");
      assert.equal(metrics.playerLedgerOmittedCount, 500 - metrics.playerLedgerInjectedCount,
        "omitted-item count should be observable and reconciled");
      assertLedgerItemRendering(result);
      const diskRows = test.engine.store.readJson(pairSummaryPath(test.engine, 2, 1), []);
      assert.equal((diskRows[0].content.match(/FR_BA_MATTER_/g) || []).length, 500, "budgeting must not trim persisted Legacy source");
      checks.push({ id: "FR-07", status: "PASS", injected: metrics.playerLedgerInjectedCount, omitted: metrics.playerLedgerOmittedCount });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    const crowded = makeLegacySummary(2, 1, "fr07-crowded-recent", "1199.1.1", createMatters("FR07_CROWDED", 500));
    crowded.content = "FR07_CROWDED_RECENT_SENTINEL：" + "近期对话叙述仍在继续。".repeat(12000)
      + "\n\n【需要长期记住的事项】\n" + createMatters("FR07_CROWDED", 500).map(item => "- " + item).join("\n")
      + "\n【其他事项】\n预算测试合成内容。";
    fixture.pairSummaries = [{ ownerId: 2, counterpartId: 1, summaries: [crowded] }];
    const test = createFixtureEngine("FR-07-crowded-recent");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const result = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", { tokenBudget: 5000 }));
      const metrics = result.pairMemoryMetrics;
      assert(result.directStableText?.includes("FR07_CROWDED_RECENT_SENTINEL"), "a long Recent1 must remain present");
      assert(!result.directStableText?.includes("FR07_CROWDED_MATTER_001"), "the deliberately truncated Recent1 must omit its trailing matters");
      assert.equal(metrics.recentSummaryTruncated, true, "long Recent1 should be visibly truncated under the constrained budget");
      assert(metrics.playerLedgerInjectedCount > 0, "a long Recent1 must not crowd out every whole ledger item");
      assert.equal(assertLedgerItemRendering(result), 0,
        "ledger matters beyond Recent1's truncation boundary must retain their complete text");
      assert(metrics.baselineBudgetUsed <= 5000, "formatted fixed baseline including block overhead must fit the budget");
      assert(metrics.finalInjectedTokens <= 5000, "all final memory blocks including dynamic reserve must fit the budget");
      const record = { id: "FR-07-crowded-recent", status: "PASS",
        injected: metrics.playerLedgerInjectedCount, omitted: metrics.playerLedgerOmittedCount,
        baselineBudgetUsed: metrics.baselineBudgetUsed, recentTruncated: metrics.recentSummaryTruncated,
        finalInjectedTokens: metrics.finalInjectedTokens };
      checks.push(record);
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createFrBaselineFixtureData("FR-01");
    const test = createFixtureEngine("FR-source-reference-strict");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const request = makeCandidateRequest(fixture, "nameOnly", { tokenBudget: 100000 });
      const baseline = test.engine.retrieveForResponder(request);
      const selected = baseline.pairMemoryItems.find(item => item.text.includes("FR_BA_MATTER_001"));
      assert(selected?.recentSummaryReference, "a complete exact same-source matter should retain its item and render as a Recent reference");
      assert(baseline.playerLedgerFrozenText.includes("详见近期摘要"));
      assert(!baseline.playerLedgerFrozenText.includes(selected.text));
      assertLedgerItemRendering(baseline);

      const common = { mode: "PLAYER_BASELINE_LEDGER", store: test.engine.store, ownerId: 2,
        counterpartIds: [1], campaignToken: fixture.campaignToken, currentGameDate: fixture.currentGameDate,
        currentTotalDays: fixture.currentTotalDays, memories: test.engine.store.loadFolderSummariesForCharacter(2),
        tokenBudget: 100000, estimateTokens: value => Math.ceil(String(value || "").length / 2) };
      const mismatchedRevision = retrievePairMemorySources({ ...common,
        recentSummary: { text: selected.text, sources: [{ sourceSummaryKey: selected.source.sourceSummaryKey,
          sourceRevision: "0".repeat(64) }] } });
      const staleItem = mismatchedRevision.items.find(item => item.itemId === selected.itemId);
      assert(staleItem && staleItem.recentSummaryReference !== true,
        "matching source key with a different revision cannot collapse an indexed item");
      assert(mismatchedRevision.text.includes(staleItem.text), "revision mismatch must preserve the complete item body");

      const similarOnly = retrievePairMemorySources({ ...common,
        recentSummary: { text: selected.text.slice(0, -1) + "改", sources: [{
          sourceSummaryKey: selected.source.sourceSummaryKey, sourceRevision: selected.source.sourceRevision
        }] } });
      const similarItem = similarOnly.items.find(item => item.itemId === selected.itemId);
      assert(similarItem && similarItem.recentSummaryReference !== true,
        "near-similar Recent text is not an exact matter duplicate");
      assert(similarOnly.text.includes(similarItem.text), "near-similar text must not delete the complete ledger matter");
      checks.push({ id: "FR-DEDUP-STRICT", status: "PASS", exactReference: true,
        revisionMismatchPreserved: true, similarTextPreserved: true });
    } finally {
      test.cleanup();
    }
  }

  {
    const selected = [];
    for (const reverse of [false, true]) {
      const fixture = createFrBaselineFixtureData("FR-08");
      if (reverse) fixture.pairSummaries[0].summaries.reverse();
      const test = createFixtureEngine("FR-08-" + (reverse ? "reverse" : "forward"));
      try {
        seedAdversarialFixture(test.engine, fixture);
        const slots = assertBaselineSlots(test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
          tokenBudget: 100000
        })));
        selected.push(slots.recent);
      } finally {
        test.cleanup();
      }
    }
    assert(selected[0], "same-date candidates should resolve one stable source");
    assert.equal(selected[1], selected[0], "same-date source selection cannot depend on physical row order");

    const chronological = [];
    for (const reverse of [false, true]) {
      const fixture = createAdversarialFixtureData();
      const older = makeLegacySummary(2, 1, "fr-chronology-older", "1197.1.1", []);
      older.content = "FR_CHRONO_OLDER_RECENT：较早谈话。";
      const newer = makeLegacySummary(2, 1, "fr-chronology-newer", "1199.1.1", []);
      newer.content = "FR_CHRONO_NEWER_RECENT：较晚谈话。";
      fixture.pairSummaries = [{ ownerId: 2, counterpartId: 1, summaries: reverse ? [newer, older] : [older, newer] }];
      const test = createFixtureEngine("FR-08-chronology-" + (reverse ? "reverse" : "forward"));
      try {
        seedAdversarialFixture(test.engine, fixture);
        const slots = assertBaselineSlots(test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
          tokenBudget: 100000
        })));
        assert(slots.recent.includes("FR_CHRONO_NEWER_RECENT"), "Recent1 must select the later original conversation date");
        assert(!slots.recent.includes("FR_CHRONO_OLDER_RECENT"), "an older conversation cannot replace the later Recent1");
        chronological.push(slots.recent);
      } finally {
        test.cleanup();
      }
    }
    assert.equal(chronological[1], chronological[0], "chronological Recent1 selection cannot depend on physical row order");
    checks.push({ id: "FR-08", status: "PASS", stableSelection: selected[0].includes("FR_SAME_DATE_A_RECENT") ? "A" : "B",
      chronologicalWinner: "later original conversation date" });
  }

  {
    const fixture = createFrBaselineFixtureData("FR-09");
    const test = createFixtureEngine("FR-09");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const result = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
        tokenBudget: 100000
      }));
      const slots = assertBaselineSlots(result, { expectedRecent: "FR_BA_RECENT", expectedLedger: "详见近期摘要",
        forbidden: ["FR_FUTURE_SENTINEL", "FR_FUTURE_RECENT"] });
      assertLedgerItemRendering(result);
      checks.push({ id: "FR-09", status: "PASS", snapshotId: slots.snapshotId });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createFrBaselineFixtureData("FR-10");
    const test = createFixtureEngine("FR-10");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const result = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
        tokenBudget: 100000
      }));
      const slots = assertBaselineSlots(result);
      assertLedgerItemRendering(result);
      assert(slots.recent.includes("仍承诺稍后核验，尚未声称已完成"), "the source promise wording must survive intact in the full fixed prompt");
      assert(slots.ledger.includes("承诺或打算不表示已履行"), "the ledger must preserve the contract's promise disclaimer");
      assert(!slots.ledger.includes("承诺稍后已完成"), "the ledger must not convert a promise into completion");
      checks.push({ id: "FR-10", status: "PASS" });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createFrBaselineFixtureData("FR-11");
    const test = createFixtureEngine("FR-11");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const oldResult = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", { tokenBudget: 100000 }));
      const oldId = oldResult.baselineSnapshotId;
      const file = pairSummaryPath(test.engine, 2, 1);
      const rows = test.engine.store.readJson(file, []);
      rows.push(makeLegacySummary(2, 1, "fr-session-reopened", "1199.8.1", ["FR11_NEW_SESSION_ITEM：新会话可见。"]));
      test.engine.store.writeJson(file, rows);
      const reopened = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
        conversationId: "qa-v936-reopened-session", tokenBudget: 100000, sessionRecallCache: new Map()
      }));
      const slots = assertBaselineSlots(reopened);
      assertLedgerItemRendering(reopened);
      assert.notEqual(slots.snapshotId, oldId, "a new session must receive a new frozen snapshot identity");
      assert(reopened.pairMemoryItems.some(item => item.text.includes("FR11_NEW_SESSION_ITEM")),
        "the reopened session must retain the newly written source item");
      checks.push({ id: "FR-11", status: "PASS", oldSnapshotId: oldId, newSnapshotId: slots.snapshotId });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createFrBaselineFixtureData("FR-12");
    const test = createFixtureEngine("FR-12");
    try {
      const source = makeLegacySummary(2, 1, "fr-forget-projection", "1199.1.1",
        ["FR12_FORGET_SENTINEL：双方讨论宫廷事项并约定稍后核验。"]);
      const segmentId = "qa-fr12-segment";
      const sourceSegmentIds = ["qa-source-fr12-segment"];
      const sourceMessageIds = [201];
      const memoryId = createMemoryId("v936-fr12-projection");
      const lineage = createProjectionLineage({ campaignToken, ownerId: 2, counterpartId: 1,
        conversationId: source.conversationId, finalizationId: source.finalizationId,
        segmentIds: [segmentId], sourceSegmentIds, sourceMessageIds });
      source.perspectiveMemoryIds = [memoryId];
      source.perspectiveSummarySegmentIds = [segmentId];
      source.sourceSegmentIds = sourceSegmentIds;
      source.sourceMessageIds = sourceMessageIds;
      source.projectionId = lineage.projectionId;
      test.engine.store.saveMemory({ memoryId, type: "information", subtype: "legacy_projection_source",
        eventDate: source.date, totalDays: source.totalDays, participants: [2, 1], subjects: [1],
        content: source.content, importance: 0.99, confidence: 1, source: "imported", visibility: "known_group",
        knownBy: [2], provenance: { campaignToken, campaignBinding: { status: "bound", source: "qa_fixture" },
          conversationId: source.conversationId, finalizationId: source.finalizationId, projectionId: lineage.projectionId,
          projectionLineages: [lineage], sourceSegmentIds, sourceMessageIds, segmentIds: [segmentId],
          perspectiveSummarySegmentIds: [segmentId], counterpartId: 1, perspectiveMemoryIds: [memoryId] } });
      test.engine.store.markKnownBy(2, memoryId, { awareness: "imported", acquiredAt: source.totalDays });
      fixture.pairSummaries = [{ ownerId: 2, counterpartId: 1, summaries: [source] }];
      seedAdversarialFixture(test.engine, fixture);
      const sessionCache = new Map();
      const request = makeCandidateRequest(fixture, "nameOnly", { tokenBudget: 100000, sessionRecallCache: sessionCache });
      const oldContext = test.engine.retrieveForResponder(request);
      assert(oldContext.pairMemoryItems?.some(item => item.text.includes("FR12_FORGET_SENTINEL")), "projection source did not reach the retained ledger items: " +
        JSON.stringify({ recent: oldContext.directStableText, ledger: oldContext.playerLedgerFrozenText,
          metrics: oldContext.pairMemoryMetrics, pairItems: oldContext.pairMemoryItems?.length }));
      assertLedgerItemRendering(oldContext);
      const promptCache = { conversation: null, responders: new Map(), prefixByResponder: new Map() };
      const promptRuntime = makePromptRuntime();
      promptRuntime.build("v813", { ...oldContext, cacheV2FrozenSnapshots: promptCache, freezePromptPrefix: true });
      assert(promptPrefixContains(promptCache.prefixByResponder, "FR12_FORGET_SENTINEL"),
        "V8.13 PromptBuilder must have warmed the old responder prefix");

      const forgotten = test.engine.forgetSummaryProjection(source, { ownerId: 2, counterpartId: 1 });
      assert.equal(forgotten.status, "FORGOTTEN");
      assert.equal(test.engine.validatePlayerMemoryContext(oldContext, validationGameData(fixture), request.conversationId).valid, false,
        "a cached context is invalid after Forget even when no active conversation was supplied");
      const fresh = test.engine.retrieveForResponder(request);
      assert.notEqual(fresh.baselineSnapshotId, oldContext.baselineSnapshotId);
      assert(![fresh.directStableText, fresh.officialRecollectionText, fresh.playerLedgerFrozenText, fresh.stableText]
        .filter(Boolean).join("\n").includes("FR12_FORGET_SENTINEL"), "Forgotten source must be absent from rebuilt baseline: " +
        JSON.stringify({ recent: fresh.directStableText, ledger: fresh.playerLedgerFrozenText,
          forgotten: test.engine.store.isSummaryProjectionForgotten(source, { ownerId: 2, counterpartId: 1 }),
          metrics: fresh.pairMemoryMetrics }));
      const prompt = promptRuntime.build("v813", { ...fresh, cacheV2FrozenSnapshots: promptCache, freezePromptPrefix: true });
      assert(!promptPrefixContains(promptCache.prefixByResponder, "FR12_FORGET_SENTINEL"),
        "rebuilding the same responder must replace, not revive, its cached prefix");
      assert.equal(countPromptMarker(prompt, "FR12_FORGET_SENTINEL"), 0);
      checks.push({ id: "FR-12", status: "PASS", forgotten: true, promptPrefixClearedOnRebuild: true });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createFrBaselineFixtureData("FR-13");
    const test = createFixtureEngine("FR-13");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const file = pairSummaryPath(test.engine, 2, 1);
      const sessionRecallCache = new Map();
      const request = makeCandidateRequest(fixture, "nameOnly", { tokenBudget: 100000, sessionRecallCache });
      const oldContext = test.engine.retrieveForResponder(request);
      assert(oldContext.pairMemoryItems.some(item => item.text.includes("FR_BA_MATTER_001")));
      assertLedgerItemRendering(oldContext);
      const relativePath = "2_乙/与甲的对话.json";
      const getSignature = test.engine.store.getSummarySourceFileSignature.bind(test.engine.store);
      const stableSignature = getSignature(relativePath);
      test.engine.store.getSummarySourceFileSignature = relative => relative === relativePath ? stableSignature : getSignature(relative);
      const getDirectories = test.engine.store.getFolderSummarySourceDirectories.bind(test.engine.store);
      const cachedSourceState = test.engine.store.folderSummaryCacheSources.get(2);
      assert(cachedSourceState, "fixture must have a captured folder source signature");
      test.engine.store.getFolderSummarySourceDirectories = (ownerId, folderNames) => ownerId === 2
        ? cachedSourceState.directories : getDirectories(ownerId, folderNames);
      const beforeBytes = fs.readFileSync(file);
      const beforeText = beforeBytes.toString("utf8");
      const editedText = beforeText.replace("FR_BA_MATTER_001", "FR_BX_MATTER_001");
      assert.notEqual(editedText, beforeText);
      assert.equal(Buffer.byteLength(editedText), beforeBytes.length, "the adversarial source edit must retain exact byte length");
      fs.writeFileSync(file, editedText, "utf8");
      assert.deepEqual(test.engine.store.getSummarySourceFileSignature(relativePath), stableSignature,
        "the adversarial source edit must retain the complete source signature");
      const guardAfterEdit = test.engine.validatePlayerMemoryContext(oldContext, validationGameData(fixture), request.conversationId);
      assert.equal(guardAfterEdit.valid, false, "source-content digest must reject an equal-stat rewrite");
      assert.equal(guardAfterEdit.reason, "SOURCE_CONTENT_CHANGED", "unchanged full stat signature must reach content validation");
      test.engine.store.getSummarySourceFileSignature = getSignature;
      test.engine.store.getFolderSummarySourceDirectories = getDirectories;
      const edited = test.engine.retrieveForResponder(request);
      assert.notEqual(edited.baselineSnapshotId, oldContext.baselineSnapshotId);
      assert(!edited.pairMemoryItems.some(item => item.text.includes("FR_BA_MATTER_001")));
      assert(edited.pairMemoryItems.some(item => item.text.includes("FR_BX_MATTER_001")));
      assertLedgerItemRendering(edited);

      test.engine.store.writeJson(file, []);
      const guardAfterDelete = test.engine.validatePlayerMemoryContext(edited, validationGameData(fixture), request.conversationId);
      assert.equal(guardAfterDelete.valid, false, "source deletion must invalidate the prior frozen source context");
      const deleted = test.engine.retrieveForResponder(request);
      assert(![deleted.directStableText, deleted.playerLedgerFrozenText, deleted.stableText].filter(Boolean).join("\n")
        .includes("FR_BX_MATTER_001"), "deleted item cannot reappear from session cache");
      checks.push({ id: "FR-13", status: "PASS", equalStatEditDetected: true, deletionDetected: true });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createFrBaselineFixtureData("FR-14");
    const test = createFixtureEngine("FR-14");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const cache = new Map();
      const originalRequest = makeCandidateRequest(fixture, "nameOnly", { tokenBudget: 100000, sessionRecallCache: cache });
      const original = test.engine.retrieveForResponder(originalRequest);
      const switchedRequest = makeCandidateRequest(fixture, "nameOnly", { tokenBudget: 100000, sessionRecallCache: cache,
        campaignToken: "qa-v936-other-campaign" });
      const switched = test.engine.retrieveForResponder(switchedRequest);
      assert.notEqual(switched.baselineSnapshotId, original.baselineSnapshotId);
      assert(![switched.directStableText, switched.officialRecollectionText, switched.playerLedgerFrozenText, switched.stableText]
        .filter(Boolean).join("\n").includes("FR_BA_"), "campaign switch cannot reuse the old campaign baseline");
      assert.equal(test.engine.validatePlayerMemoryContext(original,
        validationGameData(fixture, { campaignToken: switchedRequest.campaignToken }), originalRequest.conversationId).valid, false);

      const futureFixture = createFrBaselineFixtureData("FR-09");
      const dateTest = createFixtureEngine("FR-14-date");
      try {
        seedAdversarialFixture(dateTest.engine, futureFixture);
        const dateCache = new Map();
        const forward = dateTest.engine.retrieveForResponder(makeCandidateRequest(futureFixture, "nameOnly", {
          tokenBudget: 100000, sessionRecallCache: dateCache, currentGameDate: "1202.1.1",
          currentTotalDays: normalizeGameDate("1202.1.1").serial
        }));
        assert(forward.directStableText?.includes("FR_FUTURE_RECENT") || forward.playerLedgerFrozenText?.includes("FR_FUTURE_SENTINEL"),
          "an item becomes eligible when game time advances beyond its source date");
        const rolledBack = dateTest.engine.retrieveForResponder(makeCandidateRequest(futureFixture, "nameOnly", {
          tokenBudget: 100000, sessionRecallCache: dateCache, currentGameDate: "1190.1.1",
          currentTotalDays: normalizeGameDate("1190.1.1").serial
        }));
        assert.notEqual(rolledBack.baselineSnapshotId, forward.baselineSnapshotId);
        assert(![rolledBack.directStableText, rolledBack.playerLedgerFrozenText, rolledBack.stableText].filter(Boolean).join("\n")
          .includes("FR_FUTURE_"), "date rollback must remove newly future sources");
        assert.equal(dateTest.engine.validatePlayerMemoryContext(forward, validationGameData(futureFixture, { date: "1190.1.1" }),
          forward.conversationId).valid, false, "the old transport context must fail its game-date guard");
      } finally {
        dateTest.cleanup();
      }
      checks.push({ id: "FR-14", status: "PASS", campaignSwitch: true, dateRollback: true });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    fixture.pairSummaries.push({ ownerId: 3, counterpartId: 1, summaries: [
      makeLegacySummary(3, 1, "fr-owner-ca", "1197.1.1", ["FR15_C_OWNER_TO_A：丙对甲的私聊事项。"])
    ] });
    const test = createFixtureEngine("FR-15");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const cache = new Map();
      const bToA = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
        sessionRecallCache: cache, tokenBudget: 100000
      }));
      const bToD = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
        sessionRecallCache: cache, trustedPlayerAnchorId: 4, tokenBudget: 100000
      }));
      const cToA = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
        sessionRecallCache: cache, characterId: 3, tokenBudget: 100000
      }));
      assert(bToA.pairMemoryItems.some(item => item.text.includes("BA30_MATTER_")));
      assert(bToD.pairMemoryItems.some(item => item.text.includes("BD_HEARS_C")), "changing the trusted anchor to D must select B→D");
      assert(!bToD.pairMemoryItems.some(item => item.text.includes("BA30_MATTER_")), "stale direct counterpart A cannot override trusted anchor D");
      assert(cToA.pairMemoryItems.some(item => item.text.includes("FR15_C_OWNER_TO_A")), "changing responder Owner must read C→A");
      assertLedgerItemRendering(bToA);
      assertLedgerItemRendering(bToD);
      assertLedgerItemRendering(cToA);
      assert(!cToA.playerLedgerFrozenText.includes("CB_PRIVATE_SENTINEL"), "C→B private memory cannot be used for C→A");
      checks.push({ id: "FR-15", status: "PASS", pairScopes: ["B→A", "B→D", "C→A"] });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createFrBaselineFixtureData("FR-16");
    const test = createFixtureEngine("FR-16");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const sessionRecallCache = new Map();
      const request = makeCandidateRequest(fixture, "nameOnly", { sessionRecallCache, tokenBudget: 100000 });
      const results = await Promise.all(Array.from({ length: 12 }, () => Promise.resolve().then(() =>
        test.engine.retrieveForResponder({ ...request, sessionRecallCache }))));
      const snapshots = results.map(result => [result.baselineSnapshotId, result.directStableText,
        result.officialRecollectionText, result.playerLedgerFrozenText].join("\n"));
      assert(snapshots[0]);
      assert(snapshots.every(value => value === snapshots[0]), "one responder's parallel calls must share identical frozen bytes");
      assert(results.every(result => result.pairMemoryMetrics.frozenSnapshotReuse || result === results[0]),
        "subsequent calls should reuse the single frozen baseline");
      checks.push({ id: "FR-16", status: "PASS", calls: results.length, execution: "same-process async interleaving" });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createFrBaselineFixtureData("FR-17");
    const test = createFixtureEngine("FR-17");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const sessionRecallCache = new Map();
      const first = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
        sessionRecallCache, tokenBudget: 100000, turnEpoch: 1
      }));
      const state = sessionRecallCache.get(2);
      const seenBefore = [...state.seenDynamicSummaries];
      await assert.rejects(Promise.reject(new Error("qa_provider_failed_before_send")), /qa_provider_failed_before_send/);
      const retry = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
        sessionRecallCache, tokenBudget: 100000, turnEpoch: 2
      }));
      assert.deepEqual([...state.seenDynamicSummaries], seenBefore, "synthetic pre-send failure cannot commit a seen marker");
      assert.equal(retry.baselineSnapshotId, first.baselineSnapshotId);
      assert.equal(retry.playerLedgerFrozenText, first.playerLedgerFrozenText, "retry keeps the frozen fixed prefix unchanged");
      checks.push({ id: "FR-17", status: "PASS", provider: "synthetic pre-send failure only" });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createFrBaselineFixtureData("FR-18");
    const ledgerSource = makeLegacySummary(2, 1, "fr-prompt-ledger", "1198.1.1", ["FR18_LEDGER_MARKER：固定事项。"]);
    const recent = makeLegacySummary(2, 1, "fr-prompt-recent", "1199.1.1", []);
    recent.content = recent.content.replace("QA_SOURCE_fr-prompt-recent：合成 Legacy 叙事。", "FR18_RECENT_MARKER：最近摘要。");
    fixture.pairSummaries = [{ ownerId: 2, counterpartId: 1, summaries: [ledgerSource, recent] }];
    const test = createFixtureEngine("FR-18");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const official = { status: "READY", sourceType: "CK3_OFFICIAL_RECOLLECTION", officialCaptureSessionId: "qa-v936-independent",
        playerId: 2, campaignToken, campaignBinding: { status: "bound", source: "qa_fixture", version: 1 }, memoryCount: 1,
        content: "FR18_OFFICIAL_MARKER：官方追忆。" };
      const result = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
        tokenBudget: 100000, officialSummary: official
      }));
      assert(result.directStableText?.includes("FR18_RECENT_MARKER"));
      assert(result.officialRecollectionText?.includes("FR18_OFFICIAL_MARKER"));
      assert(result.playerLedgerFrozenText?.includes("FR18_LEDGER_MARKER"));
      const dynamicMarker = "FR18_DYNAMIC_ONLY";
      const promptRuntime = makePromptRuntime();
      for (const layout of ["normal", "glm", "v813"]) {
        const prefix = { conversation: null, responders: new Map(), prefixByResponder: new Map() };
        const prompt = promptRuntime.build(layout, { ...result, temporalExtraText: dynamicMarker,
          cacheV2FrozenSnapshots: prefix, freezePromptPrefix: true });
        for (const marker of ["FR18_OFFICIAL_MARKER", "FR18_RECENT_MARKER", "FR18_LEDGER_MARKER", dynamicMarker]) {
          assert.equal(countPromptMarker(prompt, marker), 1, layout + " must include " + marker + " exactly once");
        }
        const messages = prompt.messages || [];
        const firstIndex = marker => messages.findIndex(message => String(message.content || "").includes(marker));
        assert(firstIndex("FR18_OFFICIAL_MARKER") < firstIndex("FR18_RECENT_MARKER"), layout + " order: Official before Recent");
        assert(firstIndex("FR18_RECENT_MARKER") < firstIndex("FR18_LEDGER_MARKER"), layout + " order: Recent before Ledger");
        assert(firstIndex("FR18_LEDGER_MARKER") < firstIndex("FR18_DYNAMIC_ONLY"), layout + " keeps dynamic after the fixed ledger");
        assert(!promptPrefixContains(prefix.prefixByResponder, dynamicMarker), layout + " cannot put Dynamic Extra inside the fixed prefix");
      }
      checks.push({ id: "FR-18", status: "PASS", layouts: ["normal", "glm", "v813"] });
    } finally {
      test.cleanup();
    }
  }

  return checks;
}

function makeEntityProfiles(includeSameNameId = false) {
  const profiles = [
    { id: 1, name: "甲", aliases: ["甲"] },
    { id: 2, name: "乙", aliases: ["乙"] },
    { id: 3, name: "玛蒂尔达", aliases: ["玛蒂尔达"] },
    { id: 4, name: "丁大人", shortName: "丁大人", mentionAliases: ["丁大人"] }
  ];
  if (includeSameNameId) profiles.push({ id: 5, name: "玛蒂尔达", aliases: ["玛蒂尔达"] });
  return profiles;
}

function retrievePlayerQuery(engine, fixture, content, overrides = {}) {
  const request = makeCandidateRequest(fixture, "nameOnly", {
    playerContent: content,
    entityProfiles: makeEntityProfiles(),
    ...overrides
  });
  return { request, result: engine.retrieveForResponder(request) };
}

function thirdPersonItems(result) {
  return (result.pairMemoryItems || []).filter(item =>
    item.routeKind === "third_direct_pair" || item.routeKind === "third_cross_pair");
}

async function runThirdPersonAndMultiPartyBehaviorChecks() {
  const checks = [];
  const l0Queries = [
    ["TP-01", "玛蒂尔达刚刚走了。"],
    ["TP-02", "玛蒂尔达现在在哪儿？"],
    ["TP-03", "丁说“我记得玛蒂尔达”，你怎么看？"],
    ["TP-04", "别回忆玛蒂尔达以前的事，只说今天的安排。"]
  ];
  for (const [id, query] of l0Queries) {
    const fixture = createAdversarialFixtureData();
    const test = createFixtureEngine(id);
    try {
      seedAdversarialFixture(test.engine, fixture);
      const { result } = retrievePlayerQuery(test.engine, fixture, query, {
        // These legacy/caller-provided channels must not authorize a third-person read.
        mentionedEntityIds: [3], mentionedEntityNames: { 3: ["玛蒂尔达"] },
        explicitTargetEntityIds: [3], queryEntityIds: [3], temporalSummaryRecallEnabled: true
      });
      assert.equal(result.thirdPersonDecision.level, "L0", id + " should remain L0");
      assert.equal(result.pairMemoryMetrics.thirdPersonIndexHitCount, 0, id + " must not read any third-person index");
      assert.equal(result.pairMemoryMetrics.thirdPersonSourceOpenedCount, 0, id + " must not open a third-person Legacy source");
      assert.equal(result.temporalExtraText, null, id + " must not inject dynamic history");
      assertBaselineSlots(result, { expectedRecent: "QA_SOURCE_", forbidden: ["BC1080_MATTER_", "BD_HEARS_C", "CB_PRIVATE_SENTINEL"] });
      checks.push({ id, status: "PASS", level: result.thirdPersonDecision.level,
        reason: result.thirdPersonDecision.reasonCode, indexHits: result.pairMemoryMetrics.thirdPersonIndexHitCount });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    const test = createFixtureEngine("TP-05-06");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const cases = [
        ["TP-05", "你还记得玛蒂尔达吗？"],
        ["TP-06", "你以前和玛蒂尔达关系怎么样？"]
      ];
      for (const [id, query] of cases) {
        const { result } = retrievePlayerQuery(test.engine, fixture, query);
        assert.equal(result.thirdPersonDecision.level, "L1", id + " should permit a bounded index-only history lookup");
        assert(result.pairMemoryMetrics.thirdPersonIndexHitCount > 0, id + " should hit B→C's pair index");
        assert(result.pairMemoryMetrics.thirdPersonInjectedItems <= 16, id + " may inject at most 16 items");
        assert.equal(result.pairMemoryMetrics.thirdPersonSourceOpenedCount, 0, id + " must not open a Legacy source at L1");
        assert(!result.temporalExtraText?.includes("QA_SOURCE_bc"), id + " must not inject source narratives at L1");
        assert(!result.temporalExtraText?.includes("CB_PRIVATE_SENTINEL"), id + " cannot read C→B private source");
        assert(thirdPersonItems(result).some(item => !item.text.includes("玛蒂尔达")),
          id + " should retrieve relevant relationship-scoped matters even when the item omits C's name");
        checks.push({ id, status: "PASS", level: result.thirdPersonDecision.level,
          injectedItems: result.pairMemoryMetrics.thirdPersonInjectedItems,
          sourceOpened: result.pairMemoryMetrics.thirdPersonSourceOpenedCount });
      }
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    fixture.pairSummaries = [
      { ownerId: 2, counterpartId: 1, summaries: [makeLegacySummary(2, 1, "tp-l2-baseline", "1199.1.1", [])] },
      { ownerId: 2, counterpartId: 3, summaries: [makeLegacySummary(2, 3, "tp-l2-tax", "1090.1.1", [
        "1090年，乙与玛蒂尔达因边境税收发生争执，双方约定由账册核验后再议。TP_L2_SOURCE_SENTINEL。"
      ])] }
    ];
    const test = createFixtureEngine("TP-07");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const { result } = retrievePlayerQuery(test.engine, fixture,
        "1090年你和玛蒂尔达为了税收具体争执过什么？", { tokenBudget: 100000 });
      assert.equal(result.thirdPersonDecision.level, "L2");
      assert(result.pairMemoryMetrics.thirdPersonIndexHitCount > 0, "L2 detail should be grounded in a matching ledger item");
      assert(result.pairMemoryMetrics.thirdPersonSourceOpenedCount > 0, "L2 may open a source after an indexed item hit");
      assert(result.pairMemoryMetrics.thirdPersonSourceOpenedCount <= 2, "L2 may open at most two exact Legacy sources");
      assert(result.temporalExtraText.includes("TP_L2_SOURCE_SENTINEL"), "the opened source must be the indexed 1090 Legacy");
      assert(result.pairMemoryMetrics.finalInjectedTokens <= result.tokenBudget, "L2 ledger plus source must share the remaining budget");
      checks.push({ id: "TP-07", status: "PASS", level: result.thirdPersonDecision.level,
        injectedItems: result.pairMemoryMetrics.thirdPersonInjectedItems,
        sourceOpened: result.pairMemoryMetrics.thirdPersonSourceOpenedCount });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    fixture.pairSummaries = [
      { ownerId: 2, counterpartId: 1, summaries: [makeLegacySummary(2, 1, "tp-three-baseline", "1199.1.1", [])] },
      { ownerId: 2, counterpartId: 3, summaries: [makeLegacySummary(2, 3, "tp-three", "1192.1.1", [
        "TP3_ONE：边境税收安排。", "TP3_TWO：宫廷使节往来。", "TP3_THREE：长命锁的交付时间。"
      ])] }
    ];
    const test = createFixtureEngine("TP-08");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const { result } = retrievePlayerQuery(test.engine, fixture, "你还记得玛蒂尔达吗？", { tokenBudget: 100000 });
      assert.equal(result.thirdPersonDecision.level, "L1");
      assert.equal(result.pairMemoryMetrics.thirdPersonIndexHitCount, 3);
      assert.equal(result.pairMemoryMetrics.thirdPersonInjectedItems, 3, "L1 should use the three available items, not pad to 16");
      assert.equal(result.pairMemoryMetrics.thirdPersonSourceOpenedCount, 0);
      checks.push({ id: "TP-08", status: "PASS", available: 3, injected: 3 });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    const test = createFixtureEngine("TP-09-10");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const many = retrievePlayerQuery(test.engine, fixture, "你还记得玛蒂尔达吗？", { tokenBudget: 100000 }).result;
      assert(many.pairMemoryMetrics.thirdPersonIndexHitCount > 16, "fixture should offer more than the per-target limit");
      assert(many.pairMemoryMetrics.thirdPersonInjectedItems <= 16, "80-item history must be capped at 16 items per target");
      assert(many.pairMemoryMetrics.thirdPersonInjectedItems > 1, "cap must remain useful without requiring a full 16");
      assert(new Set(thirdPersonItems(many).map(item => item.conversationDate?.split(/[.\-/]/u)[0])).size > 1,
        "the selected 16 should represent multiple conversation years");

      const two = retrievePlayerQuery(test.engine, fixture, "你以前和玛蒂尔达、丁大人的关系如何？", {
        tokenBudget: 7000, turnEpoch: 2
      }).result;
      assert.equal(two.thirdPersonDecision.level, "L1");
      assert.equal(two.pairMemoryMetrics.thirdPersonTargetCount, 2);
      const counts = new Map();
      for (const item of thirdPersonItems(two)) counts.set(item.targetCharacterId,
        (counts.get(item.targetCharacterId) || 0) + 1);
      assert([...counts.values()].every(count => count <= 16), "each target is independently capped at 16");
      assert(two.pairMemoryMetrics.finalInjectedTokens <= 7000, "multi-target retrieval must share one final budget");
      checks.push({ id: "TP-09", status: "PASS", visible: many.pairMemoryMetrics.thirdPersonIndexHitCount,
        injected: many.pairMemoryMetrics.thirdPersonInjectedItems });
      checks.push({ id: "TP-10", status: "PASS", targets: two.pairMemoryMetrics.thirdPersonTargetCount,
        injectedByTarget: Object.fromEntries(counts), finalTokens: two.pairMemoryMetrics.finalInjectedTokens });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    const test = createFixtureEngine("TP-11-12");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const ambiguous = retrievePlayerQuery(test.engine, fixture, "你还记得玛蒂尔达吗？", {
        entityProfiles: makeEntityProfiles(true)
      }).result;
      assert.equal(ambiguous.thirdPersonDecision.level, "L0", "same-name distinct IDs must remain ambiguous");
      assert.equal(ambiguous.pairMemoryMetrics.thirdPersonIndexHitCount, 0);

      const cache = new Map();
      const first = retrievePlayerQuery(test.engine, fixture, "你还记得玛蒂尔达吗？", {
        sessionRecallCache: cache, conversationId: "tp-followup-session", turnEpoch: 1
      }).result;
      const followup = retrievePlayerQuery(test.engine, fixture, "那后来呢？", {
        sessionRecallCache: cache, conversationId: "tp-followup-session", turnEpoch: 2
      }).result;
      const expired = retrievePlayerQuery(test.engine, fixture, "那后来呢？", {
        sessionRecallCache: cache, conversationId: "tp-followup-session", turnEpoch: 3
      }).result;
      assert.equal(first.thirdPersonDecision.level, "L1");
      assert.equal(followup.thirdPersonDecision.level, "L1", "a one-turn follow-up may use the bound target");
      assert.equal(followup.thirdPersonDecision.targetEvidence, "BOUND_FOLLOWUP");
      assert.deepEqual(followup.thirdPersonDecision.targetCharacterIds, [3]);
      assert.equal(expired.thirdPersonDecision.level, "L0", "the target binding must expire after the authorized follow-up turn");
      assert.equal(expired.pairMemoryMetrics.thirdPersonIndexHitCount, 0);
      checks.push({ id: "TP-11", status: "PASS", ambiguousLevel: ambiguous.thirdPersonDecision.level });
      checks.push({ id: "TP-12", status: "PASS", followup: followup.thirdPersonDecision.targetEvidence,
        expiredLevel: expired.thirdPersonDecision.level });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    const test = createFixtureEngine("TP-13-14-18-20");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const history = [...fixture.history, makePlayerTurn(9011, "今天宫廷如何？"),
        { id: 9012, role: "assistant", speakerCharacterId: 3, content: "我记得和乙谈过边境税收。" }];
      const npcOnly = retrievePlayerQuery(test.engine, fixture, "今天宫廷如何？", {
        turnEpoch: 11, currentPlayerMessageId: 9011, history,
        activeParticipantIds: [1, 2, 3]
      }).result;
      assert.equal(npcOnly.thirdPersonDecision.level, "L0", "NPC speech after the user turn cannot authorize the lookup");
      assert.equal(npcOnly.pairMemoryMetrics.thirdPersonIndexHitCount, 0);
      assertBaselineSlots(npcOnly, { forbidden: ["BC1080_MATTER_", "CB_PRIVATE_SENTINEL"] });
      assertLedgerItemRendering(npcOnly);

      const bypass = retrievePlayerQuery(test.engine, fixture, "玛蒂尔达刚刚走了。", {
        mentionedEntityIds: [3], explicitTargetEntityIds: [3], queryEntityIds: [3],
        temporalSummaryRecallEnabled: true, identityUnresolved: false
      }).result;
      assert.equal(bypass.thirdPersonDecision.level, "L0");
      assert.equal(bypass.pairMemoryMetrics.thirdPersonIndexHitCount, 0);
      assert.equal(bypass.pairMemoryMetrics.thirdPersonSourceOpenedCount, 0);
      checks.push({ id: "TP-13", status: "PASS", npcSpeechLevel: npcOnly.thirdPersonDecision.level });
      checks.push({ id: "TP-14", status: "PASS", activeNonPlayerDidNotChangeFixedAnchor: true });
      checks.push({ id: "TP-18", status: "PASS", mentionedFlagDidNotAuthorize: true });
      checks.push({ id: "TP-19", status: "PASS", entityTargetFlagDidNotAuthorize: true });
      checks.push({ id: "TP-20", status: "PASS", temporalTopicFlagsDidNotAuthorize: true });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    fixture.pairSummaries = [
      { ownerId: 2, counterpartId: 1, summaries: [makeLegacySummary(2, 1, "tp-miss-baseline", "1199.1.1", [])] }
    ];
    const test = createFixtureEngine("TP-15");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const { result } = retrievePlayerQuery(test.engine, fixture, "你还记得玛蒂尔达吗？");
      assert.equal(result.thirdPersonDecision.level, "L1");
      assert.equal(result.pairMemoryMetrics.thirdPersonIndexHitCount, 0);
      assert.equal(result.pairMemoryMetrics.thirdPersonLegacyFallbackStatus, "INDEX_MISS");
      assert.equal(result.pairMemoryMetrics.thirdPersonSourceOpenedCount, 0);
      assert.equal(result.temporalExtraText, null, "L1 index miss must not fall back to full Legacy source scans");
      checks.push({ id: "TP-15", status: "PASS", fallback: result.pairMemoryMetrics.thirdPersonLegacyFallbackStatus });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    fixture.pairSummaries = [
      { ownerId: 2, counterpartId: 1, summaries: [makeLegacySummary(2, 1, "tp16-baseline", "1199.1.1", [])] },
      { ownerId: 2, counterpartId: 3, summaries: [makeLegacySummary(2, 3, "tp16-no-ledger", "1190.1.1", [], {
        content: "TP16_LEGACY_FALLBACK_SENTINEL：乙在旧谈话中与玛蒂尔达讨论了税收，但该旧版摘要没有结构化事项标题。"
      })] }
    ];
    const test = createFixtureEngine("TP-16");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const { result } = retrievePlayerQuery(test.engine, fixture,
        "你以前和玛蒂尔达具体讨论过税收吗？", { tokenBudget: 100000 });
      assert.equal(result.thirdPersonDecision.level, "L2");
      assert.equal(result.pairMemoryMetrics.thirdPersonIndexHitCount, 0, "fixture intentionally has no index items");
      assert(result.pairMemoryMetrics.legacyFallbackUsed, "L2 index miss may use the explicitly bounded Legacy fallback");
      assert(result.pairMemoryMetrics.openedSummaryCount <= 2, "the Legacy fallback may open no more than two sources");
      assert(result.temporalExtraText.includes("TP16_LEGACY_FALLBACK_SENTINEL"), "fallback must return the verified owner-scoped source");
      checks.push({ id: "TP-16", status: "PASS", fallback: result.pairMemoryMetrics.thirdPersonLegacyFallbackStatus,
        opened: result.pairMemoryMetrics.openedSummaryCount });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    fixture.pairSummaries = [
      { ownerId: 2, counterpartId: 1, summaries: [makeLegacySummary(2, 1, "tp17-baseline", "1199.1.1", [])] },
      { ownerId: 2, counterpartId: 3, summaries: [makeLegacySummary(2, 3, "tp17-source", "1190.1.1", [
        "TP17_OLD_REVISION_SENTINEL：边境税收的旧版本。"
      ])] }
    ];
    const test = createFixtureEngine("TP-17");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const file = pairSummaryPath(test.engine, 2, 3);
      const originalResolve = test.engine.store.pairLedger.resolveSource.bind(test.engine.store.pairLedger);
      let edited = false;
      test.engine.store.pairLedger.resolveSource = (scope, pointer, options) => {
        if (!edited && Number(scope?.counterpartId) === 3) {
          edited = true;
          const rows = test.engine.store.readJson(file, []);
          rows[0].content = rows[0].content.replace("TP17_OLD_REVISION_SENTINEL", "TP17_NEW_REVISION_SENTINEL");
          test.engine.store.writeJson(file, rows);
          test.engine.store.invalidateFolderSummaryCache([2]);
        }
        return originalResolve(scope, pointer, options);
      };
      const { result } = retrievePlayerQuery(test.engine, fixture,
        "你以前和玛蒂尔达具体讨论过税收吗？", { tokenBudget: 100000 });
      test.engine.store.pairLedger.resolveSource = originalResolve;
      assert(edited, "the adversarial source revision must change between index read and source open");
      assert(!result.temporalExtraText?.includes("TP17_OLD_REVISION_SENTINEL"), "the stale source revision cannot be emitted");
      assert(!result.temporalExtraText?.includes("TP17_NEW_REVISION_SENTINEL"), "a changed source cannot be rebound to the stale pointer in the same request");
      assert.equal(result.pairMemoryMetrics.thirdPersonSourceOpenedCount, 0);
      checks.push({ id: "TP-17", status: "PASS", stalePointerRejected: true,
        fallbackStatus: result.pairMemoryMetrics.thirdPersonLegacyFallbackStatus });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    fixture.pairSummaries = [
      { ownerId: 2, counterpartId: 1, summaries: [makeLegacySummary(2, 1, "tp-bd-baseline", "1199.1.1", [])] },
      { ownerId: 2, counterpartId: 3, summaries: [makeLegacySummary(2, 3, "tp-bc-direct", "1196.1.1", [
        "TP21_DIRECT_C：玛蒂尔达与乙约定核验边境税收。"
      ])] },
      { ownerId: 2, counterpartId: 4, summaries: [makeLegacySummary(2, 4, "tp-bd-cross", "1197.1.1", [
        "TP21_CROSS_D：丁告诉乙，玛蒂尔达曾拒绝边境税收。"
      ])] },
      { ownerId: 3, counterpartId: 2, summaries: [makeLegacySummary(3, 2, "tp-cb-private", "1198.1.1", [
        "TP22_CB_PRIVATE_SENTINEL：丙的私人视角，不得由乙读取。"
      ])] }
    ];
    const test = createFixtureEngine("TP-21-22");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const { result } = retrievePlayerQuery(test.engine, fixture, "你以前和玛蒂尔达关系怎么样？", { tokenBudget: 100000 });
      assert.equal(result.thirdPersonDecision.level, "L1");
      const dynamicItems = thirdPersonItems(result);
      const cross = dynamicItems.find(item => item.text.includes("TP21_CROSS_D"));
      assert(cross, "a B-owned B→D item that explicitly names C may support a C lookup");
      assert.equal(Number(cross.scope?.counterpartId), 4, "cross-pair recall must retain its actual B→D source scope");
      assert(dynamicItems.some(item => item.text.includes("TP21_DIRECT_C")), "direct B→C index matter should be available");
      assert(!result.temporalExtraText.includes("TP22_CB_PRIVATE_SENTINEL"), "B can never use C→B's private perspective");
      assert(result.sourcePairIds.includes(3) && result.sourcePairIds.includes(4), "retrieved C history must retain B→C and B→D audit scopes");
      const scopes = [...new Set(dynamicItems.map(item => item.scope?.counterpartId))];
      checks.push({ id: "TP-21", status: "PASS", sourceScopes: scopes });
      checks.push({ id: "TP-22", status: "PASS", reversePrivateSourceExcluded: true });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    const test = createFixtureEngine("TP-23");
    try {
      const source = makeLegacySummary(2, 3, "tp23-forget", "1198.1.1", [
        "TP23_FORGET_SENTINEL：乙与玛蒂尔达约定稍后核验边境税收。"
      ]);
      const segmentId = "qa-tp23-segment";
      const sourceSegmentIds = ["qa-source-tp23-segment"];
      const sourceMessageIds = [203];
      const memoryId = createMemoryId("v936-tp23-projection");
      const lineage = createProjectionLineage({ campaignToken, ownerId: 2, counterpartId: 3,
        conversationId: source.conversationId, finalizationId: source.finalizationId,
        segmentIds: [segmentId], sourceSegmentIds, sourceMessageIds });
      source.perspectiveMemoryIds = [memoryId];
      source.perspectiveSummarySegmentIds = [segmentId];
      source.sourceSegmentIds = sourceSegmentIds;
      source.sourceMessageIds = sourceMessageIds;
      source.projectionId = lineage.projectionId;
      test.engine.store.saveMemory({ memoryId, type: "information", subtype: "legacy_projection_source",
        eventDate: source.date, totalDays: source.totalDays, participants: [2, 3], subjects: [3],
        content: source.content, importance: 0.99, confidence: 1, source: "imported", visibility: "known_group",
        knownBy: [2], provenance: { campaignToken, campaignBinding: { status: "bound", source: "qa_fixture" },
          conversationId: source.conversationId, finalizationId: source.finalizationId, projectionId: lineage.projectionId,
          projectionLineages: [lineage], sourceSegmentIds, sourceMessageIds, segmentIds: [segmentId],
          perspectiveSummarySegmentIds: [segmentId], counterpartId: 3, perspectiveMemoryIds: [memoryId] } });
      test.engine.store.markKnownBy(2, memoryId, { awareness: "imported", acquiredAt: source.totalDays });
      fixture.pairSummaries = [
        { ownerId: 2, counterpartId: 1, summaries: [makeLegacySummary(2, 1, "tp23-baseline", "1199.1.1", [])] },
        { ownerId: 2, counterpartId: 3, summaries: [source] }
      ];
      seedAdversarialFixture(test.engine, fixture);
      const cache = new Map();
      const before = retrievePlayerQuery(test.engine, fixture, "你还记得玛蒂尔达吗？", {
        sessionRecallCache: cache, conversationId: "tp23-forget-session", turnEpoch: 1
      }).result;
      assert(before.temporalExtraText?.includes("TP23_FORGET_SENTINEL"), "control query must retrieve the source before Forget");
      const forgotten = test.engine.forgetSummaryProjection(source, { ownerId: 2, counterpartId: 3 });
      assert.equal(forgotten.status, "FORGOTTEN");
      const afterL1 = retrievePlayerQuery(test.engine, fixture, "你还记得玛蒂尔达吗？", {
        sessionRecallCache: cache, conversationId: "tp23-forget-session", turnEpoch: 2
      }).result;
      const afterL2 = retrievePlayerQuery(test.engine, fixture, "你以前和玛蒂尔达具体讨论税收的原委吗？", {
        sessionRecallCache: cache, conversationId: "tp23-forget-session", turnEpoch: 3
      }).result;
      assert(!afterL1.temporalExtraText?.includes("TP23_FORGET_SENTINEL"), "Forget must remove the ledger item");
      assert(!afterL2.temporalExtraText?.includes("TP23_FORGET_SENTINEL"), "Forget must also block source/fallback recall");
      assert(![...thirdPersonItems(afterL1), ...thirdPersonItems(afterL2)].some(item => item.text.includes("TP23_FORGET_SENTINEL")));
      checks.push({ id: "TP-23", status: "PASS", forgottenIndexAndSource: true });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    const test = createFixtureEngine("TP-24");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const originalRead = test.engine.store.pairLedger.read.bind(test.engine.store.pairLedger);
      let corruptedScopeReads = 0;
      test.engine.store.pairLedger.read = (scope, options) => {
        if (Number(scope?.counterpartId) === 3) {
          corruptedScopeReads++;
          const error = new Error("PAIR_INDEX_SOURCE_STALE");
          error.code = "PAIR_INDEX_SOURCE_STALE";
          throw error;
        }
        return originalRead(scope, options);
      };
      const l0 = retrievePlayerQuery(test.engine, fixture, "玛蒂尔达刚刚走了？", { turnEpoch: 40 }).result;
      assert.equal(l0.thirdPersonDecision.level, "L0");
      assert.equal(corruptedScopeReads, 0, "L0 must not inspect the damaged third-person index");
      const l1 = retrievePlayerQuery(test.engine, fixture, "你还记得玛蒂尔达吗？", { turnEpoch: 41 }).result;
      assert.equal(l1.thirdPersonDecision.level, "L1");
      assert(!l1.temporalExtraText?.includes("BC1080_MATTER_"), "a corrupt index cannot make L1 open Legacy sources");
      const l2 = retrievePlayerQuery(test.engine, fixture, "你以前和玛蒂尔达具体讨论过税收吗？", { turnEpoch: 42 }).result;
      assert.equal(l2.thirdPersonDecision.level, "L2");
      assert(!l2.temporalExtraText?.includes("CB_PRIVATE_SENTINEL"));
      assert(l2.pairMemoryMetrics.openedSummaryCount <= 2, "even a fallback attempt stays bounded");
      test.engine.store.pairLedger.read = originalRead;
      checks.push({ id: "TP-24", status: "PASS", l0ScopeReads: 0, l1FailureClosed: true,
        l2FallbackSources: l2.pairMemoryMetrics.openedSummaryCount });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    fixture.pairSummaries = [
      { ownerId: 2, counterpartId: 1, summaries: [makeLegacySummary(2, 1, "tp25-baseline", "1199.1.1", [])] },
      { ownerId: 2, counterpartId: 3, summaries: [makeLegacySummary(2, 3, "tp25-event-vs-conversation", "1195.1.1", [
        "事件发生在1090年：玛蒂尔达与乙因边境税收争执。TP25_DUAL_TIME_SENTINEL。"
      ])] }
    ];
    const test = createFixtureEngine("TP-25");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const { result } = retrievePlayerQuery(test.engine, fixture,
        "1090年玛蒂尔达具体和你争执了什么？", { tokenBudget: 100000 });
      assert.equal(result.thirdPersonDecision.level, "L2");
      assert(result.temporalExtraText.includes("TP25_DUAL_TIME_SENTINEL"));
      assert(result.temporalExtraText.includes("事件发生在1090年"), "event time remains in the source's event narration");
      assert(result.temporalExtraText.includes("谈话记录日期1195.1.1"), "the source header retains the distinct conversation date");
      checks.push({ id: "TP-25", status: "PASS", eventYear: 1090, conversationYear: 1195 });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    const test = createFixtureEngine("TP-26");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const cache = new Map();
      const nameOnly = retrievePlayerQuery(test.engine, fixture, "玛蒂尔达刚刚走了。", {
        sessionRecallCache: cache, conversationId: "tp26-name-then-ask", turnEpoch: 1
      }).result;
      assert.equal(nameOnly.thirdPersonDecision.level, "L0");
      assert.equal(nameOnly.pairMemoryMetrics.thirdPersonIndexHitCount, 0, "the name-only turn stays unloaded");
      assert(!nameOnly.temporalExtraText?.includes("BC1080_MATTER_"));
      const followup = retrievePlayerQuery(test.engine, fixture, "你以前和玛蒂尔达关系如何？", {
        sessionRecallCache: cache, conversationId: "tp26-name-then-ask", turnEpoch: 2
      }).result;
      assert.equal(followup.thirdPersonDecision.level, "L1", "explicit history intent may upgrade only the follow-up turn");
      assert.deepEqual(followup.thirdPersonDecision.targetCharacterIds, [3]);
      assert(followup.temporalExtraText?.includes("玛蒂尔达的历史事项"));
      checks.push({ id: "TP-26", status: "PASS", nameOnlyLevel: nameOnly.thirdPersonDecision.level,
        followupLevel: followup.thirdPersonDecision.level, target: followup.thirdPersonDecision.targetCharacterIds[0] });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    fixture.pairSummaries = [
      { ownerId: 2, counterpartId: 1, summaries: [makeLegacySummary(2, 1, "mp-ba", "1198.1.1", ["MP_BA_FIXED：乙对甲事项。"])] },
      { ownerId: 2, counterpartId: 3, summaries: [makeLegacySummary(2, 3, "mp-bc", "1198.2.1", ["MP_BC_FORBIDDEN：乙对丙事项。"])] },
      { ownerId: 2, counterpartId: 4, summaries: [makeLegacySummary(2, 4, "mp-bd", "1198.3.1", ["MP_BD_FORBIDDEN：乙对丁事项。"])] },
      { ownerId: 3, counterpartId: 1, summaries: [makeLegacySummary(3, 1, "mp-ca", "1197.1.1", ["MP_CA_FIXED：丙对甲事项。"])] },
      { ownerId: 3, counterpartId: 2, summaries: [makeLegacySummary(3, 2, "mp-cb", "1197.2.1", ["MP_CB_FORBIDDEN：丙对乙私聊事项。"])] },
      { ownerId: 4, counterpartId: 1, summaries: [makeLegacySummary(4, 1, "mp-da", "1196.1.1", ["MP_DA_FIXED：丁对甲事项。"])] }
    ];
    const test = createFixtureEngine("MP-01-05");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const cache = new Map();
      const b = retrievePlayerQuery(test.engine, fixture, "今天宫廷如何？", {
        characterId: 2, trustedPlayerAnchorId: 1, activeParticipantIds: [1, 2, 3, 4],
        history: [...fixture.history, makePlayerTurn(9201, "今天宫廷如何？"),
          { id: 9202, role: "assistant", speakerCharacterId: 3, content: "丙最近先说了话。" }],
        currentPlayerMessageId: 9201, turnEpoch: 21, sessionRecallCache: cache
      }).result;
      assert(b.pairMemoryItems.some(item => item.text.includes("MP_BA_FIXED")));
      assert(![b.directStableText, b.playerLedgerFrozenText].join("\n").includes("MP_BC_FORBIDDEN")
        && ![b.directStableText, b.playerLedgerFrozenText].join("\n").includes("MP_BD_FORBIDDEN"));
      assertLedgerItemRendering(b);
      assert.deepEqual(b.routing.directCounterpartIds, [1], "player anchor remains A despite C's recent speech and all participants");
      assert(b.sourcePairIds.every(id => Number(id) === 1), "L0 fixed snapshot must guard only the player pair");

      const c = retrievePlayerQuery(test.engine, fixture, "今天宫廷如何？", {
        characterId: 3, trustedPlayerAnchorId: 1, activeParticipantIds: [1, 2, 3],
        turnEpoch: 22, sessionRecallCache: cache
      }).result;
      const d = retrievePlayerQuery(test.engine, fixture, "今天宫廷如何？", {
        characterId: 4, trustedPlayerAnchorId: 1, activeParticipantIds: [1, 2, 4],
        turnEpoch: 23, sessionRecallCache: cache
      }).result;
      assert(c.pairMemoryItems.some(item => item.text.includes("MP_CA_FIXED"))
        && ![c.directStableText, c.playerLedgerFrozenText].join("\n").includes("MP_CB_FORBIDDEN"));
      assert(d.pairMemoryItems.some(item => item.text.includes("MP_DA_FIXED")));
      assertLedgerItemRendering(c);
      assertLedgerItemRendering(d);
      assert.deepEqual(c.routing.directCounterpartIds, [1]);
      assert.deepEqual(d.routing.directCounterpartIds, [1]);

      const orders = [];
      for (const [index, participants] of fixture.participantOrders.entries()) {
        const reordered = retrievePlayerQuery(test.engine, fixture, "今天宫廷如何？", {
          characterId: 2, trustedPlayerAnchorId: 1, activeParticipantIds: participants,
          turnEpoch: 30 + index, sessionRecallCache: new Map()
        }).result;
        orders.push([reordered.directStableText, reordered.officialRecollectionText,
          reordered.playerLedgerFrozenText].join("\n"));
        assert.deepEqual(reordered.routing.directCounterpartIds, [1]);
      }
      assert(orders.every(value => value === orders[0]), "participant ordering cannot alter the frozen B→A blocks");
      checks.push({ id: "MP-01", status: "PASS", bAnchor: "B→A" });
      checks.push({ id: "MP-02", status: "PASS", cAnchor: "C→A" });
      checks.push({ id: "MP-03", status: "PASS", recentSpeakerDidNotChangeAnchor: true });
      checks.push({ id: "MP-04", status: "PASS", participantOrders: orders.length });
      checks.push({ id: "MP-05", status: "PASS", responderScopes: ["B→A", "C→A", "D→A"] });
    } finally {
      test.cleanup();
    }
  }

  {
    const fixture = createAdversarialFixtureData();
    fixture.pairSummaries = [
      { ownerId: 2, counterpartId: 1, summaries: [
        makeLegacySummary(2, 1, "mp-group-witnessed", "1198.1.1", ["MP_GROUP_WITNESSED：公开账册安排。"], {
          conversationType: "group", participants: [{ id: 1 }, { id: 2 }, { id: 3 }]
        }),
        makeLegacySummary(2, 1, "mp-group-presence-unknown", "1199.1.1", ["MP_GROUP_UNDETERMINED：在场边界未明的账册安排。"], {
          conversationType: "group", participants: [{ id: 1 }, { id: 2 }, { id: 3 }],
          presenceJoins: [{ characterId: 2, messageId: 3 }]
        })
      ] }
    ];
    const test = createFixtureEngine("MP-06-07");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const { result } = retrievePlayerQuery(test.engine, fixture, "今天宫廷如何？", { tokenBudget: 100000 });
      assert(result.playerLedgerFrozenText.includes("共同见证"), "group evidence must be identified as witnessed, not direct");
      assert(result.playerLedgerFrozenText.includes("交谈方式未确定"), "a relevant presence boundary must remain undetermined");
      assert(!result.playerLedgerFrozenText.includes("MP_WHISPER_SENTINEL"));
      checks.push({ id: "MP-06", status: "PASS", groupEvidence: true, presenceUncertain: true });
    } finally {
      test.cleanup();
    }
  }

  {
    const participants = [{ id: 1, name: "甲" }, { id: 2, name: "乙" }, { id: 3, name: "玛蒂尔达" }];
    const context = {
      participants,
      participantPresence: [
        { characterId: 1, joinedAtMessageId: 1, leftAtMessageId: null },
        { characterId: 2, joinedAtMessageId: 1, leftAtMessageId: null },
        { characterId: 3, joinedAtMessageId: 3, leftAtMessageId: 6 }
      ],
      messages: [
        { id: 1, role: "assistant", speakerCharacterId: 2, content: "乙在丙加入前谈到边境税收。" },
        { id: 2, role: "user", speakerCharacterId: 1, content: "甲回应账册安排。" },
        { id: 3, role: "system", kind: "presence_join", characterId: 3, content: "玛蒂尔达加入。" },
        { id: 4, role: "assistant", speakerCharacterId: 3, content: "丙心想，绝不向乙透露秘密。" },
        { id: 5, role: "assistant", speakerCharacterId: 2, content: "乙对丙公开说明边境税收安排。" },
        { id: 6, role: "system", kind: "presence_leave", characterId: 3, content: "玛蒂尔达离开。" },
        { id: 7, role: "assistant", speakerCharacterId: 2, content: "乙在丙离场后继续讨论边境税收。" }
      ]
    };
    const messageProvenance = (messageId, speakerId) => ({ messageIds: [messageId], speakerIds: [speakerId] });
    const beforeJoin = { memoryId: "mp-before-join", content: "MP_BEFORE_JOIN_SENTINEL：丙加入前的转述。",
      knownBy: [2], participants: [2, 3], subjects: [3], visibility: "participants", source: "spoken",
      provenance: messageProvenance(1, 2) };
    const privateThought = { memoryId: "mp-c-private", content: "MP_C_PRIVATE_SENTINEL：丙心想不向乙透露。",
      knownBy: [3], participants: [3], subjects: [2], visibility: "private", source: "spoken",
      provenance: messageProvenance(4, 3) };
    const afterJoin = { memoryId: "mp-after-join", content: "MP_AFTER_JOIN：乙对丙公开说明税收安排。",
      knownBy: [2], participants: [2, 3], subjects: [3], visibility: "participants", source: "spoken",
      provenance: messageProvenance(5, 2) };
    const afterLeave = { memoryId: "mp-after-leave", content: "MP_AFTER_LEAVE_SENTINEL：丙离场后乙继续谈税收。",
      knownBy: [2], participants: [2, 3], subjects: [3], visibility: "participants", source: "spoken",
      provenance: messageProvenance(7, 2) };
    const afterJoinSegment = { segmentId: "mp-segment-after-join", content: "MP_SEGMENT_AFTER_JOIN：共同在场后的叙事。",
      knownBy: [2, 3], provenance: messageProvenance(5, 2) };
    const beforeJoinSegment = { segmentId: "mp-segment-before-join", content: "MP_SEGMENT_BEFORE_JOIN_SENTINEL：丙缺席时的叙事。",
      knownBy: [2, 3], provenance: messageProvenance(1, 2) };
    const afterLeaveSegment = { segmentId: "mp-segment-after-leave", content: "MP_SEGMENT_AFTER_LEAVE_SENTINEL：丙离场后的叙事。",
      knownBy: [2, 3], provenance: messageProvenance(7, 2) };
    const extraction = { memories: [beforeJoin, privateThought, afterJoin, afterLeave],
      summarySegments: [beforeJoinSegment, afterJoinSegment, afterLeaveSegment] };

    const visibilityGood = validateVisibilityBoundaries(context, { memories: [privateThought, afterJoin], summarySegments: [] });
    assert.equal(visibilityGood.success, true, "a private owner thought and after-join dialogue must validate for their actual audience");
    const visibilityBad = validateVisibilityBoundaries(context, { memories: [beforeJoin], summarySegments: [] });
    assert.equal(visibilityBad.success, false, "a late participant cannot be added to an earlier message's audience");
    assert(visibilityBad.failures.some(failure => failure.reason === "visibility_presence_invalid"));

    const projections = buildPerspectiveSummaryMap(context, extraction);
    assert(!projections.get("2->3").memoryIds.includes("mp-before-join"), "B→C cannot include a pre-join item");
    assert(projections.get("2->3").memoryIds.includes("mp-after-join"), "B→C may include a shared after-join item");
    assert(!projections.get("2->3").memoryIds.includes("mp-after-leave"), "B→C cannot include an after-leave item");
    assert(!projections.get("2->3").memoryIds.includes("mp-c-private"), "C's private thought is not known by B");
    assert(projections.get("3->2").memoryIds.includes("mp-c-private"), "C may retain its own private perspective toward B");
    assert(!projections.get("2->3").summarySegmentIds.includes("mp-segment-before-join"));
    assert(projections.get("2->3").summarySegmentIds.includes("mp-segment-after-join"));
    assert(!projections.get("2->3").summarySegmentIds.includes("mp-segment-after-leave"));
    assert.equal(validatePerspectiveSummaryMap(context, extraction, projections).success, true);
    checks.push({ id: "MP-07", status: "PASS", preJoinExcluded: true, afterJoinIncluded: true,
      afterLeaveExcluded: true, reversePrivatePerspectiveIsolated: true });
  }

  {
    const fixture = createAdversarialFixtureData();
    fixture.pairSummaries = [
      { ownerId: 2, counterpartId: 1, summaries: [makeLegacySummary(2, 1, "mp08-ba", "1199.1.1", ["MP08_PLAYER_FIXED：乙对甲事项。"])] },
      { ownerId: 2, counterpartId: 3, summaries: [makeLegacySummary(2, 3, "mp08-bc", "1198.1.1", [
        "MP08_BC_RECOVERABLE：乙对丙的边境税收安排。"
      ])] }
    ];
    const test = createFixtureEngine("MP-08");
    try {
      seedAdversarialFixture(test.engine, fixture);
      const cache = new Map();
      const before = retrievePlayerQuery(test.engine, fixture, "今天宫廷如何？", {
        sessionRecallCache: cache, conversationId: "mp08-later-history", turnEpoch: 1
      }).result;
      assert(before.pairMemoryItems.some(item => item.text.includes("MP08_PLAYER_FIXED")));
      assertLedgerItemRendering(before);
      assert(!before.playerLedgerFrozenText.includes("MP08_BC_RECOVERABLE"), "B→C remains out of the fixed baseline");
      const after = retrievePlayerQuery(test.engine, fixture, "你还记得玛蒂尔达吗？", {
        sessionRecallCache: cache, conversationId: "mp08-later-history", turnEpoch: 2,
        tokenBudget: 100000
      }).result;
      assert.equal(after.thirdPersonDecision.level, "L1");
      assert(after.temporalExtraText.includes("MP08_BC_RECOVERABLE"), "an explicit later question may retrieve B's saved B→C matter");
      checks.push({ id: "MP-08", status: "PASS", fixedExcludedThenExplicitlyRetrieved: true });
    } finally {
      test.cleanup();
    }
  }

  return checks;
}

async function runSourceReviewBehaviorChecks() {
  const fixture = createAdversarialFixtureData();
  const sharedContent = "甲与玛蒂尔达谈过边境税收的旧约定。REVIEW_L0_CROSS_PAIR_SOURCE_SENTINEL。";
  const sharedC = makeLegacySummary(2, 3, "review-shared-finalization", "1198.1.1", []);
  Object.assign(sharedC, { conversationId: "review-shared-conversation", content: sharedContent,
    participants: [{ id: 2, name: "乙" }, { id: 3, name: "玛蒂尔达" }, { id: 1, name: "甲" }] });
  const sharedA = makeLegacySummary(2, 1, "review-shared-finalization", "1198.1.1", []);
  Object.assign(sharedA, { conversationId: "review-shared-conversation", content: sharedContent,
    participants: [{ id: 2, name: "乙" }, { id: 3, name: "玛蒂尔达" }, { id: 1, name: "甲" }] });
  const recentA = makeLegacySummary(2, 1, "review-newer-player-summary", "1199.9.1", []);
  recentA.content = "REVIEW_NEWER_BA_RECENT_SENTINEL：较新的玩家关系摘要。";
  fixture.pairSummaries = [
    { ownerId: 2, counterpartId: 3, summaries: [sharedC] },
    { ownerId: 2, counterpartId: 1, summaries: [sharedA, recentA] }
  ];
  const test = createFixtureEngine("review-l0-cross-pair");
  try {
    seedAdversarialFixture(test.engine, fixture);
    const ownerMemories = test.engine.store.loadFolderSummariesForCharacter(2);
    const sharedMemory = ownerMemories.find(memory => memory.content.includes("REVIEW_L0_CROSS_PAIR_SOURCE_SENTINEL"));
    assert(sharedMemory, "byte-identical B→A/B→C projections should be present in the merged owner snapshot");
    assert.deepEqual([...sharedMemory.provenance.counterpartIds].sort((a, b) => a - b), [1, 3]);
    const sourceByCounterpart = new Map(sharedMemory.provenance.pairLedgerSources.map(source =>
      [Number(source.counterpartId), source.sourceSummaryKey]));
    assert(sourceByCounterpart.get(1) && sourceByCounterpart.get(3), "both directed source pointers must remain represented");
    const cPointerIndex = sharedMemory.provenance.pairLedgerSources.findIndex(source => Number(source.counterpartId) === 3);
    if (cPointerIndex > 0) sharedMemory.provenance.pairLedgerSources.unshift(sharedMemory.provenance.pairLedgerSources.splice(cPointerIndex, 1)[0]);

    const sourceCalls = { read: [], resolve: [] };
    const originalRead = test.engine.store.pairLedger.read.bind(test.engine.store.pairLedger);
    const originalResolve = test.engine.store.pairLedger.resolveSource.bind(test.engine.store.pairLedger);
    test.engine.store.pairLedger.read = (scope, ...args) => {
      sourceCalls.read.push(Number(scope.counterpartId));
      return originalRead(scope, ...args);
    };
    test.engine.store.pairLedger.resolveSource = (scope, ...args) => {
      sourceCalls.resolve.push(Number(scope.counterpartId));
      return originalResolve(scope, ...args);
    };
    const request = makeCandidateRequest(fixture, "nameOnly", {
      playerContent: "你以前和甲谈过边境税收什么？",
      entityProfiles: makeEntityProfiles()
    });
    const result = test.engine.retrieveForResponder(request);
    assert.equal(result.thirdPersonDecision.level, "L0", "self-history wording must not authorize a third-person target");
    assertBaselineSlots(result, { expectedRecent: "REVIEW_NEWER_BA_RECENT_SENTINEL" });
    assert.equal(sourceCalls.read.filter(counterpartId => counterpartId === 3).length, 0,
      "L0 self-history may not read the merged B→C PairLedger scope");
    assert.equal(sourceCalls.resolve.filter(counterpartId => counterpartId === 3).length, 0,
      "L0 self-history may not resolve the merged B→C Legacy source");
    assert(!result.pairMemorySources.some(source => source.sourceSummaryKey === sourceByCounterpart.get(3)),
      "an authorized B→A fallback must never return B→C's source key");
    assert(result.pairMemorySources.every(source => source.sourceSummaryKey === sourceByCounterpart.get(1)),
      "any L0 historical source returned here must be the exact B→A projection");
    return [{ id: "QA-L0-MERGED-CROSS-PAIR", status: "PASS", level: result.thirdPersonDecision.level,
      readScopes: sourceCalls.read, resolvedScopes: sourceCalls.resolve,
      returnedSafePlayerSource: result.pairMemorySources.length > 0 }];
  } finally {
    test.cleanup();
  }
}

function assertFixtureScaffold() {
  assert.equal(caseDescriptions.length, 62, "FR/TP/MP/TK catalogue should mirror all 62 spec rows");
  assert.equal(new Set(caseDescriptions.map(item => item.id)).size, caseDescriptions.length);
  assert.deepEqual(
    ["FR", "TP", "MP", "TK"].map(prefix => caseDescriptions.filter(item => item.id.startsWith(prefix + "-")).length),
    [18, 26, 8, 10]
  );
  const fixture = createAdversarialFixtureData();
  assert.equal(fixture.pairSummaries.find(pair => pair.ownerId === 2 && pair.counterpartId === 1).summaries[0].content
    .match(/BA30_MATTER_/g).length, 30);
  assert(fixture.pairSummaries.some(pair => pair.ownerId === 3 && pair.counterpartId === 2));
  assert(fixture.pairSummaries.some(pair => pair.ownerId === 2 && pair.counterpartId === 3 &&
    pair.summaries.some(summary => summary.date === "1201.1.1")));
  assert.equal(makeCandidateRequest(fixture, "nameOnly").trustedPlayerAnchorId, 1);
  return fixture;
}

if (require.main === module) {
  const fixture = assertFixtureScaffold();
  const report = checks => {
    const executedIds = new Set(checks.map(check => check.id));
    const crossCoverage = checks.flatMap(check => check.crossCoverage || []);
    const crossCoveredIds = new Set(crossCoverage.map(item => item.catalogId));
    const notRun = caseDescriptions.filter(item => !executedIds.has(item.id))
      .map(item => ({ id: item.id,
        status: item.id === "TK-09" ? "NOT_RUN_SOAK"
          : item.id === "TK-10" ? "NOT_RUN_LIVE_PROVIDER_API"
            : crossCoveredIds.has(item.id) ? "PARTIAL_CROSS_COVERAGE_NOT_CREDITED" : "NOT_RUN" }));
    const catalogIds = new Set(caseDescriptions.map(item => item.id));
    const covered = new Set(checks.map(check => check.id).filter(id => catalogIds.has(id)));
    return { executed: checks, catalogCoverage: { passedRows: covered.size, totalRows: caseDescriptions.length },
      crossCoverage, notRun };
  };
  const runAndPrint = (label, runner) => runner().then(checks => {
      const failures = checks.filter(check => check.status !== "PASS");
      const result = report(checks);
      console.log("V9.3.6 independent " + label + ": " + (failures.length ? "FAIL" : "PASS") +
        " (" + checks.length + " executed behavior checks; " + result.catalogCoverage.passedRows + "/" +
        result.catalogCoverage.totalRows + " catalog rows covered)");
      console.log(JSON.stringify(report(checks)));
      if (failures.length) process.exitCode = 1;
    }).catch(error => {
      console.error(error.stack || error.message || error);
      process.exitCode = 1;
    });
  if (process.argv.includes("--list-fixtures")) {
    console.log("Fixture catalogue only: " + caseDescriptions.length + " FR/TP/MP/TK rows; " +
      fixture.pairSummaries.length + " directed synthetic pair groups; no behavior checks executed.");
  } else if (process.argv.includes("--run-fr-baseline")) {
    runAndPrint("FR baseline", runFrBaselineBehaviorChecks);
  } else if (process.argv.includes("--run-tp-mp")) {
    runAndPrint("TP/MP", runThirdPersonAndMultiPartyBehaviorChecks);
  } else if (process.argv.includes("--run-source-review")) {
    runAndPrint("source review", runSourceReviewBehaviorChecks);
  } else if (process.argv.includes("--run-budget-edge")) {
    runAndPrint("budget edge", runBudgetBoundaryBehaviorChecks);
  } else {
    const runAll = async () => [
      ...await runFrBaselineBehaviorChecks(),
      ...await runThirdPersonAndMultiPartyBehaviorChecks(),
      ...await runSourceReviewBehaviorChecks(),
      ...await runBudgetBoundaryBehaviorChecks()
    ];
    runAndPrint("behavior suite", runAll);
  }
}

module.exports = {
  caseDescriptions,
  createAdversarialFixtureData,
  seedAdversarialFixture,
  createFixtureEngine,
  makeCandidateRequest,
  assertFixtureScaffold,
  createFrBaselineFixtureData,
  baselineSlots,
  runFrBaselineBehaviorChecks,
  runThirdPersonAndMultiPartyBehaviorChecks,
  runSourceReviewBehaviorChecks,
  runBudgetBoundaryBehaviorChecks
};
