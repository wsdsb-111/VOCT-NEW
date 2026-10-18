"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  createAdversarialFixtureData,
  createFixtureEngine,
  makeCandidateRequest,
  makePromptRuntime
} = require("./test-v9.3.6-independent-qa");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { ConversationTurnManager } = require("../src/app/main/conversation/conversation-turn-manager");
const { GenerationManager } = require("../src/app/main/conversation/generation-manager");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const { resolveTrustedPlayerTurn } = require("../src/app/main/memory-system/pair-memory-routing");
const { Character } = require("../src/app/main/game-data/character");
const { createGameData } = require("../src/app/main/game-data/game-data");
const { TokenCounter } = require("../resources/app/out/main/provider-service");

const PLAYER_ID = 1;
const OWNER_ID = 2;
const TARGET_ID = 3;
const OTHER_TARGET_ID = 4;
const CAMPAIGN = "qa-v9363-integration-campaign";
const GAME_DATE = "1200.1.1";
const CONVERSATION_ID = "qa-v9363-integration-conversation";
const ORIGINAL_SOURCE = "V936_SOURCE_ORIGINAL：乙与玛蒂尔达为边境税收发生了具体争执。";
const EDITED_SOURCE = "V936_SOURCE_MODIFIED：乙与玛蒂尔达为边境税收发生了详细争执。";
const PRIVATE_SOURCE = "V936_PRIVATE_OWNER_SENTINEL：丙的私人视角。";
const OWNER4_PRIVATE_SOURCE = "V936_PRIVATE_OWNER_FOUR_SENTINEL：丁和玛蒂尔达去年就边境税收发生了争论，这是丁的私人视角。";
const OLD_YEAR_INDEX = "V936_INDEX_1198：乙与玛蒂尔达讨论边境税收。";
const LAST_YEAR_INDEX = "V936_INDEX_1199：乙与玛蒂尔达讨论边境税收。";
const MEMORY_BLOCK_IDS = new Set(["memory-stable", "memory-direct-frozen", "memory-player-ledger-frozen",
  "memory-official-recollection", "memory-mentioned-snapshot", "memory-temporal-extra",
  "memory-session-topic-anchor", "memory-topic-patch", "third-party-evidence-patch"]);
const ACTUAL_GAME_DATA_CLASS = createGameData({ fs, path, memorySystem: {}, summariesDir: "",
  getHistoricalReferenceByYear: () => null });

const fingerprint = value => crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
Conversation.configure({ createPromptFingerprint: fingerprint });

function syntheticSummary(ownerId, counterpartId, finalizationId, date, content) {
  const ownerName = ownerId === 2 ? "乙" : ownerId === 4 ? "丁" : "丙";
  const counterpartName = counterpartId === 1 ? "甲" : counterpartId === 2 ? "乙" : counterpartId === 3 ? "玛蒂尔达" : "丁";
  return {
    date,
    totalDays: normalizeGameDate(date).serial,
    content,
    playerId: ownerId,
    playerName: ownerName,
    characterId: counterpartId,
    characterName: counterpartName,
    perspectiveOwnerId: ownerId,
    campaignToken: CAMPAIGN,
    campaignBinding: { status: "bound", source: "qa_fixture", version: 1 },
    finalizationId,
    conversationId: "qa-conversation-" + finalizationId,
    conversationType: "pair",
    participants: [{ id: ownerId, name: ownerName }, { id: counterpartId, name: counterpartName }]
  };
}

function fixtureData() {
  const fixture = createAdversarialFixtureData();
  fixture.campaignToken = CAMPAIGN;
  fixture.currentGameDate = GAME_DATE;
  fixture.currentTotalDays = normalizeGameDate(GAME_DATE).serial;
  fixture.pairSummaries = [
    { ownerId: OWNER_ID, counterpartId: PLAYER_ID, summaries: [syntheticSummary(OWNER_ID, PLAYER_ID,
      "qa-v9363-player-baseline", "1199.12.1", "QA_PLAYER_BASELINE：仅合成玩家锚点摘要。\n【需要长期记住的事项】\n无\n【其他事项】\n无。" )] },
    { ownerId: OWNER_ID, counterpartId: TARGET_ID, summaries: [
      syntheticSummary(OWNER_ID, TARGET_ID, "qa-v9363-target-1198", "1198.1.1",
        "QA_1198_SUMMARY：合成历史来源。\n【需要长期记住的事项】\n- " + OLD_YEAR_INDEX + "\n【其他事项】\nV936_SOURCE_1198：较早来源正文。"),
      syntheticSummary(OWNER_ID, TARGET_ID, "qa-v9363-target-1199", "1199.1.1",
        "QA_1199_SUMMARY：合成历史来源。\n【需要长期记住的事项】\n- " + LAST_YEAR_INDEX + "\n【其他事项】\n" + ORIGINAL_SOURCE)
    ] },
    { ownerId: OWNER_ID, counterpartId: OTHER_TARGET_ID, summaries: [syntheticSummary(OWNER_ID, OTHER_TARGET_ID,
      "qa-v9363-other-target", "1199.2.1",
      "QA_OTHER_TARGET：合成备用身份来源。\n【需要长期记住的事项】\n- V936_OTHER_TARGET_INDEX：丁与乙去年讨论边境税收。\n【其他事项】\nV936_OTHER_TARGET_SOURCE：备用源。" )] },
    { ownerId: 3, counterpartId: OWNER_ID, summaries: [syntheticSummary(3, OWNER_ID,
      "qa-v9363-private-reverse", "1199.3.1",
      "QA_PRIVATE_OWNER：合成反向私人来源。\n【需要长期记住的事项】\n- " + PRIVATE_SOURCE + "\n【其他事项】\n" + PRIVATE_SOURCE)] },
    { ownerId: 4, counterpartId: TARGET_ID, summaries: [syntheticSummary(4, TARGET_ID,
      "qa-v9363-private-owner-four", "1199.4.1",
      "QA_PRIVATE_OWNER_FOUR：合成另一 Owner 的私人来源。\n【需要长期记住的事项】\n- " + OWNER4_PRIVATE_SOURCE + "\n【其他事项】\n" + OWNER4_PRIVATE_SOURCE)] }
  ];
  return fixture;
}

function seedSyntheticFixture(engine, fixture) {
  for (const pair of fixture.pairSummaries) {
    const ownerName = pair.ownerId === 2 ? "乙" : pair.ownerId === 4 ? "丁" : "丙";
    const counterpartName = pair.counterpartId === 1 ? "甲" : pair.counterpartId === 2 ? "乙"
      : pair.counterpartId === 3 ? "玛蒂尔达" : "丁";
    const folder = path.join(engine.store.summaryFoldersDir, pair.ownerId + "_" + ownerName);
    const file = path.join(folder, "与" + counterpartName + "的对话.json");
    fs.mkdirSync(folder, { recursive: true });
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    fs.writeFileSync(file, JSON.stringify([...existing, ...pair.summaries], null, 2), "utf8");
    engine.store.invalidateFolderSummaryCache([pair.ownerId]);
  }
}

function normalizeMtimeForPortableRewrite(filePath) {
  const before = fs.statSync(filePath);
  fs.utimesSync(filePath, before.atime, new Date(Math.trunc(before.mtimeMs)));
  return fs.statSync(filePath);
}

function setCurrentChildren(gameData, childIds) {
  const owner = gameData.characters.get(OWNER_ID);
  owner.children = childIds.map(childId => {
    const child = gameData.characters.get(childId);
    return {
      id: childId,
      name: child?.fullName || child?.shortName || String(childId),
      gender: child?.gender || "unknown",
      directParentEvidence: {
        source: "CK3_DIRECT_PARENT",
        sourceOwnerId: childId,
        childId,
        parentId: OWNER_ID,
        relationType: "parent",
        sourceRelation: "parents",
        publicStatus: "PUBLIC_LEGAL_PARENT",
        knowledgeStatus: "UNKNOWN",
        campaignToken: gameData.campaignToken,
        sourceSnapshotId: `${gameData.date}/${gameData.totalDays}`
      }
    };
  });
}

function makeGameData(promptRuntime, { children = [TARGET_ID] } = {}) {
  const gameData = promptRuntime.gameData;
  gameData.campaignToken = CAMPAIGN;
  gameData.date = GAME_DATE;
  gameData.totalDays = normalizeGameDate(GAME_DATE).serial;
  gameData.scene = "合成宫廷场景";
  gameData.location = "合成地点";
  gameData.locationController = null;
  gameData.aiID = OWNER_ID;
  gameData.characters.get(TARGET_ID).gender = "male";
  gameData.characters.get(TARGET_ID).shortName = "玛蒂尔达";
  gameData.characters.get(TARGET_ID).fullName = "玛蒂尔达";
  gameData.characters.set(OTHER_TARGET_ID, { id: OTHER_TARGET_ID, shortName: "丁", fullName: "丁", gender: "male", age: 30,
    traits: [], parents: [], children: [] });
  setCurrentChildren(gameData, children);
  return gameData;
}

function sceneRevision(gameData) {
  return JSON.stringify([gameData.scene || null, gameData.location || null, gameData.locationController || null]);
}

function trackPairLedger(engine) {
  const calls = { reads: [], resolves: [] };
  const ledger = engine.store.pairLedger;
  const read = ledger.read.bind(ledger);
  const resolveSource = ledger.resolveSource.bind(ledger);
  ledger.read = (scope, ...args) => {
    calls.reads.push({ ownerId: Number(scope.ownerId), counterpartId: Number(scope.counterpartId) });
    return read(scope, ...args);
  };
  ledger.resolveSource = (scope, pointer, ...args) => {
    calls.resolves.push({ ownerId: Number(scope.ownerId), counterpartId: Number(scope.counterpartId) });
    return resolveSource(scope, pointer, ...args);
  };
  return calls;
}

function clearCalls(calls) {
  calls.reads.length = 0;
  calls.resolves.length = 0;
}

function thirdPersonCalls(calls, key) {
  return calls[key].filter(call => call.ownerId === OWNER_ID && call.counterpartId !== PLAYER_ID);
}

function makeEngineRequest(engine, fixture, gameData, query, { turnEpoch = 1, conversationId = CONVERSATION_ID,
  sessionRecallCache = new Map(), messageId = 9001, history: suppliedHistory = null, playerSpeakerId = PLAYER_ID,
  tokenBudget = 50000, responderId = OWNER_ID, campaignToken = CAMPAIGN, sceneRevisionOverride = null } = {}) {
  const history = Array.isArray(suppliedHistory) ? suppliedHistory
    : [{ id: messageId, role: "user", speakerCharacterId: playerSpeakerId, content: query }];
  return makeCandidateRequest(fixture, "nameOnly", {
    playerContent: query,
    currentPlayerMessageId: messageId,
    history,
    characterId: responderId,
    trustedPlayerAnchorId: PLAYER_ID,
    directCounterpartIds: [PLAYER_ID],
    activeParticipantIds: [PLAYER_ID, responderId],
    conversationId,
    sceneRevision: sceneRevisionOverride || sceneRevision(gameData),
    turnEpoch,
    campaignToken,
    currentGameDate: GAME_DATE,
    currentTotalDays: fixture.currentTotalDays,
    gameData,
    entityProfiles: [...gameData.getMentionableCharacterProfiles().values()],
    sessionRecallCache,
    mentionedRecallCache: new Map(),
    tokenBudget,
    estimateTokens: text => TokenCounter.estimateTokens(String(text || "")),
    estimateMessageTokens: message => TokenCounter.estimateMessageTokens(message)
  });
}

function renderActualPrompt(promptRuntime, context) {
  const built = promptRuntime.build("openai", {
    ...context,
    activeParticipantIds: [PLAYER_ID, OWNER_ID],
    cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() },
    stableProfileCache: new Map(),
    stableDescriptionCache: new Map(),
    freezePromptPrefix: true
  }, OWNER_ID);
  return {
    built,
    metadata: Conversation.buildPromptBlockMetadata(built),
    text: (built.messages || []).map(message => String(message.content || "")).join("\n")
  };
}

function makeActualAgeCharacter(id, name, { age = null, gender = "male", birthDate = null, birthDateTotalDays = null } = {}) {
  const raw = Array(28).fill("");
  raw[0] = id;
  raw[1] = name;
  raw[2] = name;
  raw[4] = gender === "female" ? "she" : gender === "male" ? "he" : "";
  raw[5] = age == null ? "" : String(age);
  const character = new Character(raw);
  character.alive = true;
  if (birthDate) character.birthDate = birthDate;
  if (birthDateTotalDays != null) character.birthDateTotalDays = birthDateTotalDays;
  return character;
}

function makeActualAgeGameData({ children = [], date = "1200年5月2日" } = {}) {
  const currentTotalDays = normalizeGameDate(date).serial;
  const gameData = new ACTUAL_GAME_DATA_CLASS([PLAYER_ID, "甲", OWNER_ID, "乙", date,
    "___________talk_scene", "合成地点", "", currentTotalDays]);
  gameData.campaignToken = "qa-v9363-actual-age-campaign";
  const owner = makeActualAgeCharacter(OWNER_ID, "乙", { age: 40 });
  owner.children = children.map(child => ({ id: child.id, name: child.name, gender: child.gender,
    directParentEvidence: { source: "CK3_DIRECT_PARENT", sourceOwnerId: child.id, childId: child.id,
      parentId: OWNER_ID, relationType: "parent", sourceRelation: "parents", publicStatus: "PUBLIC_LEGAL_PARENT",
      knowledgeStatus: "UNKNOWN", campaignToken: gameData.campaignToken,
      sourceSnapshotId: `${gameData.date}/${gameData.totalDays}` } }));
  const player = makeActualAgeCharacter(PLAYER_ID, "甲", { age: 39 });
  gameData.characters = new Map([[PLAYER_ID, player], [OWNER_ID, owner], ...children.map(child => [child.id, child])]);
  gameData.scene = "合成宫廷场景";
  gameData.location = "合成地点";
  gameData.getOfficialRecollectionSummary = () => null;
  return gameData;
}

function buildActualAgePrompt(promptRuntime, gameData, query, stableText = "") {
  const owner = gameData.characters.get(OWNER_ID);
  const previousLog = console.log;
  console.log = () => {};
  try {
    return promptRuntime.builder.buildMessagesWithTokenCount([{ role: "user", speakerCharacterId: PLAYER_ID,
      content: query }], owner, gameData, "", {
      subjectiveWorldPolicyActive: true,
      activeParticipantIds: [OWNER_ID],
      stableText,
      stableProfileCache: new Map(),
      stableDescriptionCache: new Map(),
      cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() },
      freezePromptPrefix: true
    }, { providerType: "openai-compatible", defaultModel: "qa-model" });
  } finally {
    console.log = previousLog;
  }
}

async function testActualPromptAgeAuthority() {
  const promptRuntime = makePromptRuntime();
  const child = makeActualAgeCharacter(3, "合成年子", { age: 17, birthDate: "1182年5月1日" });
  child.primaryTitle = "QA_PRIVATE_TITLE_SENTINEL";
  child.traits = [{ name: "QA_PRIVATE_TRAIT_SENTINEL", desc: "合成私密特质" }];
  child.secrets = [{ name: "QA_PRIVATE_SECRET_SENTINEL" }];
  const gameData = makeActualAgeGameData({ children: [child] });
  const query = "你儿子今年几岁？";
  const conflictingMemory = "QA_OLD_AGE_SOURCE：旧 Legacy 记载合成年子18岁。";
  const agePrompt = buildActualAgePrompt(promptRuntime, gameData, query, conflictingMemory);
  const ageBlock = agePrompt.blocks.find(entry => entry.block?.id === "responder-family-facts")?.content || "";
  const finalPrompt = agePrompt.messages.map(message => String(message.content || "")).join("\n");
  assert(ageBlock.includes("合成年子") && ageBlock.includes("17岁"),
    "actual GameData and PromptBuilder must put CK3 current age 17 into the final family block");
  assert(!ageBlock.includes("18岁"), "birthday/calendar age 18 and conflicting old Memory cannot replace CK3 current age 17");
  assert(finalPrompt.includes(conflictingMemory) && finalPrompt.includes("Memory 只可补充过去经历与主观感受，不得覆盖这些事实"),
    "the final Prompt must retain provenance context while explicitly making structured current age authoritative");
  assert(!/QA_PRIVATE_TITLE_SENTINEL|QA_PRIVATE_TRAIT_SENTINEL|QA_PRIVATE_SECRET_SENTINEL/u.test(finalPrompt),
    "the age query must not disclose unrelated title, trait, or secret fields from the target Character");
  assert.equal(agePrompt.ageDiagnostics.length, 1);
  assert.deepEqual({ source: agePrompt.ageDiagnostics[0].ageSource, rawAge: agePrompt.ageDiagnostics[0].rawAge,
    calendarAge: agePrompt.ageDiagnostics[0].calculatedCalendarAge, conflict: agePrompt.ageDiagnostics[0].ageConflict,
    asOf: agePrompt.ageDiagnostics[0].asOfGameDate },
  { source: "CK3_CURRENT_AGE", rawAge: 17, calendarAge: 18, conflict: true, asOf: "1200.5.2" });
  assert(!JSON.stringify(agePrompt.ageDiagnostics).includes("合成年子"), "age diagnostics must not retain person names");

  const ordinaryPrompt = buildActualAgePrompt(promptRuntime, gameData, "你儿子最近怎么样？");
  const ordinaryText = ordinaryPrompt.messages.map(message => String(message.content || "")).join("\n");
  const ordinaryFamilyBlock = ordinaryPrompt.blocks.find(entry => entry.block?.id === "responder-family-facts")?.content || "";
  assert(!/17岁|1182年5月1日/u.test(ordinaryFamilyBlock),
    "non-age conversation must not expose a relative's exact current age or birth date");
  assert(!ordinaryText.includes("17岁") && !ordinaryText.includes("1182年5月1日"),
    "the final non-age Prompt must omit private current-age details");
  assert.equal(ordinaryPrompt.ageDiagnostics.length, 0, "non-age conversation must not produce age diagnostics");

  const twinA = makeActualAgeCharacter(5, "QA_TWIN_A", { age: 16 });
  const twinB = makeActualAgeCharacter(6, "QA_TWIN_B", { age: 17 });
  const twinsGameData = makeActualAgeGameData({ children: [twinA, twinB] });
  const twinsPrompt = buildActualAgePrompt(promptRuntime, twinsGameData, query);
  const twinsBlock = twinsPrompt.blocks.find(entry => entry.block?.id === "responder-family-facts")?.content || "";
  assert(twinsBlock.includes("多个候选"), "two sons must remain an unresolved kinship target");
  assert(!/16岁|17岁|QA_TWIN_A|QA_TWIN_B/u.test(twinsBlock)
    && !twinsPrompt.messages.some(message => /16岁|17岁|QA_TWIN_A|QA_TWIN_B/u.test(String(message.content || ""))),
  "ambiguous children must not cause either candidate's name or age to be selected into the Prompt");
  assert.equal(twinsPrompt.ageDiagnostics.length, 0, "ambiguous family query must produce no selected-age diagnostic");

  const unknownChild = makeActualAgeCharacter(7, "合成未知年龄子女", { birthDateTotalDays: 100000 });
  const unknownGameData = makeActualAgeGameData({ children: [unknownChild] });
  const oldSource = "QA_OLD_AGE_SOURCE：Legacy 旧摘要记录合成未知年龄子女18岁。";
  const unknownPrompt = buildActualAgePrompt(promptRuntime, unknownGameData, query, oldSource);
  const unknownFamilyBlock = unknownPrompt.blocks.find(entry => entry.block?.id === "responder-family-facts")?.content || "";
  assert(unknownFamilyBlock.includes("当前年龄未知") && !unknownFamilyBlock.includes("18岁"),
    "unmapped ordinal birth day and old Legacy age must resolve to unknown current age");
  assert(unknownPrompt.ageDiagnostics.length === 1 && unknownPrompt.ageDiagnostics[0].ageSource === "UNKNOWN"
    && unknownPrompt.ageDiagnostics[0].calculatedCalendarAge === null,
  "unknown age evidence must stay unknown in Prompt diagnostics");
  assert(unknownFamilyBlock.includes("Memory 只可补充过去经历与主观感受，不得覆盖这些事实"),
    "unknown current-age output must still forbid old Memory from supplying the missing current fact");
  return { freshCurrentAge: 17, conflictingBirthdayAge: 18, ordinaryAgeDisclosure: false,
    ambiguousSonsSelected: false, oldSourceCurrentAge: "UNKNOWN", usedActualGameDataClass: true };
}

function digestRenderedMemoryBlocks(blocks = []) {
  const projection = blocks.filter(block => MEMORY_BLOCK_IDS.has(block?.id))
    .map(block => [block.id, block.fingerprint || null,
      Number.isSafeInteger(block.tokens) && block.tokens >= 0 ? block.tokens : null]);
  return fingerprint(JSON.stringify(projection));
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function retrieveAndRender(engine, fixture, promptRuntime, gameData, query, options = {}) {
  const request = makeEngineRequest(engine, fixture, gameData, query, options);
  const context = engine.retrieveForResponder(request);
  return { request, context, rendered: renderActualPrompt(promptRuntime, context) };
}

function assertRouteBudget({ id, context, rendered, calls, expectedLevel, indexMarker = null, sourceMarker = null }) {
  assert.equal(context.thirdPersonDecision.level, expectedLevel,
    id + ": expected route level, reason=" + String(context.thirdPersonDecision?.reasonCode || "unknown")
      + ", targetCount=" + String(context.thirdPersonDecision?.targetCharacterIds?.length || 0));
  const reads = thirdPersonCalls(calls, "reads").length;
  const resolves = thirdPersonCalls(calls, "resolves").length;
  const pairItems = (context.pairMemoryItems || []).filter(item => ["third_direct_pair", "third_cross_pair"].includes(item.routeKind));
  if (expectedLevel === "L0") {
    assert.equal(reads, 0, id + ": L0 must issue zero third-person PairLedger reads");
    assert.equal(resolves, 0, id + ": L0 must issue zero third-person source resolves");
    assert.equal(pairItems.length, 0, id + ": L0 must inject no third-person ledger item");
  } else if (expectedLevel === "L1") {
    assert(reads > 0, id + ": L1 must consult the actual third-person PairLedger index");
    assert.equal(resolves, 0, id + ": L1 is index-only and must not resolve source files");
    assert(!sourceMarker || !rendered.text.includes(sourceMarker), id + ": L1 leaked third-person source prose");
  } else {
    assert.equal(expectedLevel, "L2", id + ": unknown expected access level");
    assert(reads > 0, id + ": L2 must read the actual PairLedger index");
    const reportedAttempts = Number(context.pairMemoryMetrics?.totalSourceResolveAttemptCount) || 0;
    assert(Math.max(resolves, reportedAttempts) <= 2, id + ": L2 source attempts must be at most two");
    assert(sourceMarker && rendered.text.includes(sourceMarker), id + ": L2 source text must appear in the final built Prompt");
  }
  if (indexMarker) assert(rendered.text.includes(indexMarker), id + ": expected index-only or temporal matter absent from final Prompt");
  assert(!rendered.text.includes(PRIVATE_SOURCE), id + ": another Owner's private source leaked into the final Prompt");
  return { level: expectedLevel, thirdPersonReads: reads, thirdPersonSourceResolveAttempts: resolves,
    injectedThirdPersonItemCount: pairItems.length, promptMemoryBlocks: rendered.metadata.blocks.filter(block => block.id.startsWith("memory-")).length };
}

async function testPreviousYearAndLevelBoundaries() {
  const fixture = fixtureData();
  const test = createFixtureEngine("v9363-integration-time-window");
  try {
    seedSyntheticFixture(test.engine, fixture);
    const promptRuntime = makePromptRuntime();
    const gameData = makeGameData(promptRuntime);
    const calls = trackPairLedger(test.engine);
    const sessionRecallCache = new Map();
    const priorYear = retrieveAndRender(test.engine, fixture, promptRuntime, gameData,
      "去年你和玛蒂尔达具体为边境税收争论过什么？", { turnEpoch: 1, messageId: 9001, sessionRecallCache });
    const l2 = assertRouteBudget({ id: "IQA-01-last-year", ...priorYear, calls,
      expectedLevel: "L2", sourceMarker: ORIGINAL_SOURCE });
    assert.equal(priorYear.context.temporal.targetGameYear, 1199,
      "IQA-01-last-year: the actual engine must resolve 去年 to the prior game year");
    assert(priorYear.rendered.text.includes(LAST_YEAR_INDEX));
    assert(!priorYear.rendered.text.includes(OLD_YEAR_INDEX), "IQA-01-last-year: the previous-year window selected an older source");
    const firstInjectionDigest = digestRenderedMemoryBlocks(priorYear.rendered.metadata.blocks);

    clearCalls(calls);
    const regeneratedYear = retrieveAndRender(test.engine, fixture, promptRuntime, gameData,
      "去年你和玛蒂尔达具体为边境税收争论过什么？", { turnEpoch: 2, messageId: 9001, sessionRecallCache });
    assert.equal(regeneratedYear.context.thirdPersonDecision.level, "L2");
    assert.equal(regeneratedYear.context.temporal.targetGameYear, priorYear.context.temporal.targetGameYear,
      "IQA-02: a new physical attempt must preserve the prior-year window");
    assert.equal(digestRenderedMemoryBlocks(regeneratedYear.rendered.metadata.blocks), firstInjectionDigest,
      "IQA-02: final Prompt memory-block fingerprints must remain equal for an unchanged snapshot");

    clearCalls(calls);
    const future = retrieveAndRender(test.engine, fixture, promptRuntime, gameData,
      "等明年以后你准备如何安排玛蒂尔达？", { turnEpoch: 3, messageId: 9002 });
    const l0 = assertRouteBudget({ id: "IQA-02-future-plan", ...future, calls, expectedLevel: "L0" });
    assert(!future.rendered.text.includes(ORIGINAL_SOURCE), "IQA-02-future-plan: future plans cannot inject history source text");

    clearCalls(calls);
    const relationship = retrieveAndRender(test.engine, fixture, promptRuntime, gameData,
      "你以前和玛蒂尔达关系如何？", { turnEpoch: 4, messageId: 9003 });
    const l1 = assertRouteBudget({ id: "IQA-03-l1-index-only", ...relationship, calls,
      expectedLevel: "L1", indexMarker: LAST_YEAR_INDEX, sourceMarker: ORIGINAL_SOURCE });

    clearCalls(calls);
    const age = retrieveAndRender(test.engine, fixture, promptRuntime, gameData,
      "玛蒂尔达现在几岁？", { turnEpoch: 5, messageId: 9004 });
    assertRouteBudget({ id: "IQA-04-age-is-not-history", ...age, calls, expectedLevel: "L0" });
    return { previousYear: l2, previousYearReplayPromptDigestStable: true, futurePlan: l0,
      relationshipL1: l1, ageL0: true };
  } finally {
    test.cleanup();
  }
}

async function testKinshipTargetResolutionAndAmbiguity() {
  const fixture = fixtureData();
  const test = createFixtureEngine("v9363-integration-kinship");
  try {
    seedSyntheticFixture(test.engine, fixture);
    const promptRuntime = makePromptRuntime();
    const uniqueGameData = makeGameData(promptRuntime, { children: [TARGET_ID] });
    const calls = trackPairLedger(test.engine);
    const unique = retrieveAndRender(test.engine, fixture, promptRuntime, uniqueGameData,
      "你儿子以前与你关系如何？", { conversationId: "qa-v9363-unique-son" });
    const uniqueCounts = assertRouteBudget({ id: "IQA-05-unique-kinship", ...unique, calls,
      expectedLevel: "L1", sourceMarker: ORIGINAL_SOURCE });
    assert.deepEqual(unique.context.thirdPersonDecision.targetCharacterIds, [TARGET_ID],
      "IQA-05-unique-kinship: a unique son must resolve to his real GameData ID");

    clearCalls(calls);
    const ambiguousGameData = makeGameData(promptRuntime, { children: [TARGET_ID, OTHER_TARGET_ID] });
    const cache = new Map();
    retrieveAndRender(test.engine, fixture, promptRuntime, ambiguousGameData,
      "你以前和玛蒂尔达关系如何？", { conversationId: "qa-v9363-ambiguous-son", sessionRecallCache: cache,
        turnEpoch: 1, messageId: 9011 });
    clearCalls(calls);
    const ambiguous = retrieveAndRender(test.engine, fixture, promptRuntime, ambiguousGameData,
      "你儿子以前与你关系如何？", { conversationId: "qa-v9363-ambiguous-son", sessionRecallCache: cache,
        turnEpoch: 2, messageId: 9012 });
    const ambiguousCounts = assertRouteBudget({ id: "IQA-06-ambiguous-kinship", ...ambiguous, calls, expectedLevel: "L0" });
    assert.deepEqual(ambiguous.context.thirdPersonDecision.targetCharacterIds, [],
      "IQA-06-ambiguous-kinship: recent named focus must not disambiguate two sons");
    return { unique: uniqueCounts, ambiguous: ambiguousCounts };
  } finally {
    test.cleanup();
  }
}

async function testIdentityCampaignSceneAndLineageIsolation() {
  const fixture = fixtureData();
  const test = createFixtureEngine("v9363-integration-identity-scope-isolation");
  try {
    seedSyntheticFixture(test.engine, fixture);
    const promptRuntime = makePromptRuntime();
    const calls = trackPairLedger(test.engine);

    const duplicateNameGameData = makeGameData(promptRuntime, { children: [] });
    const duplicateNameCache = new Map();
    const priorNamedTarget = retrieveAndRender(test.engine, fixture, promptRuntime, duplicateNameGameData,
      "你以前和玛蒂尔达关系如何？", { conversationId: "qa-v9363-duplicate-name",
        sessionRecallCache: duplicateNameCache, turnEpoch: 1, messageId: 9061 });
    assert.equal(priorNamedTarget.context.thirdPersonDecision.level, "L1");
    assert.deepEqual(priorNamedTarget.context.thirdPersonDecision.targetCharacterIds, [TARGET_ID]);
    duplicateNameGameData.characters.get(OTHER_TARGET_ID).shortName = "玛蒂尔达";
    duplicateNameGameData.characters.get(OTHER_TARGET_ID).fullName = "玛蒂尔达";
    clearCalls(calls);
    const duplicateName = retrieveAndRender(test.engine, fixture, promptRuntime, duplicateNameGameData,
      "去年玛蒂尔达与你的关系如何？", { conversationId: "qa-v9363-duplicate-name",
        sessionRecallCache: duplicateNameCache, turnEpoch: 2, messageId: 9067 });
    const duplicateNameCounts = assertRouteBudget({ id: "IQA-13-same-name-distinct-ids", ...duplicateName,
      calls, expectedLevel: "L0" });
    assert.deepEqual(duplicateName.context.thirdPersonDecision.targetCharacterIds, [],
      "T13: identical names on distinct Runtime IDs must stay ambiguous even when ID3 was the prior focus");

    clearCalls(calls);
    const kinshipGameData = makeGameData(promptRuntime, { children: [TARGET_ID] });
    const lineageCache = new Map();
    const kinshipQuery = "你儿子去年说过什么边境税收？";
    const firstKinship = retrieveAndRender(test.engine, fixture, promptRuntime, kinshipGameData, kinshipQuery,
      { conversationId: "qa-v9363-lineage-change", sessionRecallCache: lineageCache, turnEpoch: 1, messageId: 9062 });
    assert.equal(firstKinship.context.thirdPersonDecision.level, "L1");
    assert.deepEqual(firstKinship.context.thirdPersonDecision.targetCharacterIds, [TARGET_ID]);
    assert(firstKinship.rendered.text.includes(LAST_YEAR_INDEX));
    assert(!firstKinship.rendered.text.includes("V936_OTHER_TARGET_INDEX"));

    setCurrentChildren(kinshipGameData, [OTHER_TARGET_ID]);
    clearCalls(calls);
    const changedKinship = retrieveAndRender(test.engine, fixture, promptRuntime, kinshipGameData, kinshipQuery,
      { conversationId: "qa-v9363-lineage-change", sessionRecallCache: lineageCache, turnEpoch: 2, messageId: 9063 });
    const targetFourIndex = test.engine.store.pairLedger.read({ ownerId: OWNER_ID, counterpartId: OTHER_TARGET_ID,
      campaignToken: CAMPAIGN }, { currentGameDate: GAME_DATE, currentTotalDays: fixture.currentTotalDays,
      memories: test.engine.store.loadFolderSummariesForCharacter(OWNER_ID), readOnly: true });
    const targetFourIndexEvidence = targetFourIndex.items.map(item => ({ text: item.text, date: item.conversationDate,
      ambiguous: item.ambiguous, confirmed: item.confirmed }));
    assert.equal(changedKinship.context.thirdPersonDecision.level, "L1");
    assert.deepEqual(changedKinship.context.thirdPersonDecision.targetCharacterIds, [OTHER_TARGET_ID],
      "T13: changed CK3 parent/child edges must change the authorized Runtime ID under the same conversation cache");
    assert(changedKinship.rendered.text.includes("V936_OTHER_TARGET_INDEX"),
      "T13: changed-target index must reach the Prompt; evidence=" + JSON.stringify({
        decision: changedKinship.context.thirdPersonDecision,
        items: (changedKinship.context.pairMemoryItems || []).map(item => ({ routeKind: item.routeKind,
          counterpartId: item.counterpartId ?? item.scope?.counterpartId,
          text: String(item.text || "").slice(0, 160) })),
        memoryBlocks: changedKinship.rendered.built.blocks.filter(block => MEMORY_BLOCK_IDS.has(block.block?.id))
          .map(block => ({ id: block.block.id, hasOther: String(block.content || "").includes("V936_OTHER_TARGET_INDEX"),
            hasPrior: String(block.content || "").includes(LAST_YEAR_INDEX) })),
        directTargetFourIndex: targetFourIndexEvidence
      }));
    assert(!changedKinship.rendered.text.includes(LAST_YEAR_INDEX), "T13: prior counterpart matter cannot survive a lineage change");
    assert(!changedKinship.rendered.text.includes(ORIGINAL_SOURCE), "T13: an L1 lineage change cannot open source prose");

    clearCalls(calls);
    const otherCampaign = retrieveAndRender(test.engine, fixture, promptRuntime, kinshipGameData, kinshipQuery,
      { conversationId: "qa-v9363-lineage-change", sessionRecallCache: lineageCache, turnEpoch: 3, messageId: 9064,
        campaignToken: "qa-v9363-other-campaign" });
    assert.equal(otherCampaign.context.thirdPersonDecision.level, "L1");
    assert.deepEqual(otherCampaign.context.thirdPersonDecision.targetCharacterIds, [OTHER_TARGET_ID]);
    assert(!otherCampaign.rendered.text.includes("V936_OTHER_TARGET_INDEX")
      && !otherCampaign.rendered.text.includes(LAST_YEAR_INDEX),
    "T13: a Campaign switch must not reuse prior Campaign's index or source under the same session cache");

    clearCalls(calls);
    const sceneCache = new Map();
    const sceneGameData = makeGameData(promptRuntime);
    const namedHistory = retrieveAndRender(test.engine, fixture, promptRuntime, sceneGameData,
      "你以前和玛蒂尔达关系如何？", { conversationId: "qa-v9363-scene-switch", sessionRecallCache: sceneCache,
        turnEpoch: 1, messageId: 9065 });
    assert.equal(namedHistory.context.thirdPersonDecision.level, "L1");
    sceneGameData.scene = "另一个合成场景";
    clearCalls(calls);
    const crossSceneFollowup = retrieveAndRender(test.engine, fixture, promptRuntime, sceneGameData,
      "那后来呢？", { conversationId: "qa-v9363-scene-switch", sessionRecallCache: sceneCache,
        turnEpoch: 2, messageId: 9066 });
    const crossSceneCounts = assertRouteBudget({ id: "IQA-13-scene-switch-expires-binding", ...crossSceneFollowup,
      calls, expectedLevel: "L0" });
    assert.deepEqual(crossSceneFollowup.context.thirdPersonDecision.targetCharacterIds, [],
      "T13: a scene change expires the immediately-bound named-history target");
    return { duplicateName: duplicateNameCounts, changedKinshipIds: [TARGET_ID, OTHER_TARGET_ID],
      campaignSwitchClearedPriorIndex: true, crossSceneFollowup: crossSceneCounts };
  } finally {
    test.cleanup();
  }
}

async function testSourceEditAndForgetRevalidatePrompt() {
  const fixture = fixtureData();
  const test = createFixtureEngine("v9363-integration-source-guard");
  try {
    seedSyntheticFixture(test.engine, fixture);
    const promptRuntime = makePromptRuntime();
    const gameData = makeGameData(promptRuntime);
    const calls = trackPairLedger(test.engine);
    const sessionRecallCache = new Map();
    const query = "你以前和玛蒂尔达具体讨论边境税收时发生过什么？";
    const sourceFile = path.join(test.engine.store.summaryFoldersDir, "2_乙", "与玛蒂尔达的对话.json");
    const beforeStat = normalizeMtimeForPortableRewrite(sourceFile);
    const before = retrieveAndRender(test.engine, fixture, promptRuntime, gameData, query,
      { conversationId: "qa-v9363-source-guard", sessionRecallCache, turnEpoch: 1, messageId: 9021 });
    assert.equal(before.context.thirdPersonDecision.level, "L2");
    assert(before.rendered.text.includes(ORIGINAL_SOURCE), "IQA-07: initial actual Prompt must contain the current L2 source");

    const rows = test.engine.store.readJson(sourceFile, []);
    const editedRows = rows.map(row => row.finalizationId === "qa-v9363-target-1199"
      ? { ...row, content: row.content.replace(ORIGINAL_SOURCE, EDITED_SOURCE) } : row);
    assert.notDeepEqual(editedRows, rows, "IQA-07 fixture must edit one synthetic source");
    assert.equal(Buffer.byteLength(ORIGINAL_SOURCE, "utf8"), Buffer.byteLength(EDITED_SOURCE, "utf8"),
      "T14 fixture replacements must preserve UTF-8 bytes exactly");
    const editedBytes = Buffer.from(JSON.stringify(editedRows, null, 2), "utf8");
    assert.equal(editedBytes.length, beforeStat.size, "T14 synthetic source edit must retain file size");
    fs.writeFileSync(sourceFile, editedBytes);
    fs.utimesSync(sourceFile, beforeStat.atime, beforeStat.mtime);
    const afterStat = fs.statSync(sourceFile);
    assert.equal(afterStat.size, beforeStat.size, "T14 rewrite must keep the same file size");
    assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs, "T14 rewrite must keep the original mtime");
    const staleAfterEdit = test.engine.validatePlayerMemoryContext(before.context, gameData, before.request.conversationId);
    assert.equal(staleAfterEdit.valid, false, "IQA-07: an already-rendered Prompt context becomes invalid after source edit");

    clearCalls(calls);
    const edited = retrieveAndRender(test.engine, fixture, promptRuntime, gameData, query,
      { conversationId: "qa-v9363-source-guard", sessionRecallCache, turnEpoch: 2, messageId: 9022 });
    assert(!edited.rendered.text.includes(ORIGINAL_SOURCE), "IQA-07: old source bytes cannot survive a source edit");
    assert(edited.rendered.text.includes(EDITED_SOURCE), "IQA-07: a fresh request may use the edited, current source");
    const editedRecord = editedRows.find(row => row.finalizationId === "qa-v9363-target-1199");
    const forgotten = test.engine.forgetSummaryProjection(editedRecord, { ownerId: OWNER_ID, counterpartId: TARGET_ID });
    assert.equal(forgotten.status, "FORGOTTEN", "IQA-08: the synthetic Pair projection is actually forgotten");
    assert.equal(test.engine.validatePlayerMemoryContext(edited.context, gameData, edited.request.conversationId).valid, false,
      "IQA-08: the context captured before Forget is stale");

    clearCalls(calls);
    const afterForget = retrieveAndRender(test.engine, fixture, promptRuntime, gameData, query,
      { conversationId: "qa-v9363-source-guard", sessionRecallCache, turnEpoch: 3, messageId: 9023 });
    assert(!afterForget.rendered.text.includes(ORIGINAL_SOURCE), "IQA-08: forgotten original prose is absent from the final Prompt");
    assert(!afterForget.rendered.text.includes(EDITED_SOURCE), "IQA-08: forgotten edited prose is absent from the final Prompt");
    assert(!JSON.stringify(afterForget.context.pairMemoryItems || []).includes("V936_SOURCE_"),
      "IQA-08: Forget removes both source prose and its derived Pair item from the fresh context");
    assert(!afterForget.rendered.text.includes(PRIVATE_SOURCE), "IQA-09: cross-Owner private text stays out of the final Prompt");
    return { sameSizeSameMtimeEditInvalidatedOldContext: true, editedSourceFreshlyRendered: true,
      forgetInvalidatedOldContext: true, forgottenSourceAbsent: true };
  } finally {
    test.cleanup();
  }
}

async function testPairLedgerConfirmRetractionAndCacheInvalidation() {
  const fixture = fixtureData();
  const test = createFixtureEngine("v9363-integration-confirm-retract");
  try {
    seedSyntheticFixture(test.engine, fixture);
    const promptRuntime = makePromptRuntime();
    const gameData = makeGameData(promptRuntime);
    const sourceFile = path.join(test.engine.store.summaryFoldersDir, "2_乙", "与玛蒂尔达的对话.json");
    const sentinel = "QA_AMBIGUOUS_ITEM_SENTINEL";
    const matter = `玛蒂尔达的${sentinel}：盐税账册需复核。`;
    const ambiguousContent = `旧式记忆段落。\n\n【需要长期记住的事项】\n${matter}\n\n此处没有项目符号，边界无法确定。\n【其他事项】\n旧式尾段。`;
    const rows = test.engine.store.readJson(sourceFile, []);
    const ambiguousSummary = syntheticSummary(OWNER_ID, TARGET_ID, "qa-v9363-confirm-retract", "1199.3.1", ambiguousContent);
    ambiguousSummary.finalizationId = null;
    ambiguousSummary.conversationId = null;
    fs.writeFileSync(sourceFile, JSON.stringify([...rows, ambiguousSummary], null, 2), "utf8");
    test.engine.store.invalidateFolderSummaryCache([OWNER_ID]);
    normalizeMtimeForPortableRewrite(sourceFile);

    const calls = trackPairLedger(test.engine);
    const sessionRecallCache = new Map();
    const query = `你以前和玛蒂尔达之间的${sentinel}盐税账册关系如何？`;
    const requestOptions = { conversationId: "qa-v9363-confirm-retract", sessionRecallCache,
      turnEpoch: 1, messageId: 9071 };
    const beforeConfirm = retrieveAndRender(test.engine, fixture, promptRuntime, gameData, query, requestOptions);
    assert.equal(beforeConfirm.context.thirdPersonDecision.level, "L1",
      "T14 confirmation fixture must exercise actual L1 PairLedger retrieval");
    assert(!JSON.stringify(beforeConfirm.context.pairMemoryItems || []).includes(sentinel),
      "an ambiguous source matter stays hidden until the real preview/apply confirmation");

    const scope = { ownerId: OWNER_ID, counterpartId: TARGET_ID, campaignToken: CAMPAIGN };
    const memories = test.engine.store.loadFolderSummariesForCharacter(OWNER_ID);
    const preview = test.engine.store.pairLedger.preview(scope, { currentGameDate: GAME_DATE,
      currentTotalDays: fixture.currentTotalDays, memories });
    const candidate = preview.pairs.flatMap(pair => pair.items).find(item => item.text.includes(sentinel));
    assert(candidate && candidate.ambiguous === true && candidate.confirmed === false,
      "T14 must identify the real ambiguous legacy item in PairLedger preview");
    const applied = test.engine.store.pairLedger.apply(scope, { previewRevision: preview.previewRevision,
      currentGameDate: GAME_DATE, currentTotalDays: fixture.currentTotalDays, memories });
    assert.equal(applied.success, true, "T14 confirmation must use the real PairLedger preview/apply transaction");
    clearCalls(calls);

    const afterConfirm = retrieveAndRender(test.engine, fixture, promptRuntime, gameData, query, requestOptions);
    const confirmedIndex = test.engine.store.pairLedger.read(scope, { currentGameDate: GAME_DATE,
      currentTotalDays: fixture.currentTotalDays, memories: test.engine.store.loadFolderSummariesForCharacter(OWNER_ID),
      readOnly: true });
    const confirmedIndexEvidence = confirmedIndex.items.filter(item => item.text.includes(sentinel))
      .map(item => ({ ambiguous: item.ambiguous, confirmed: item.confirmed, text: item.text }));
    assert(JSON.stringify(afterConfirm.context.pairMemoryItems || []).includes(sentinel),
      "T14: PairLedger confirmation must invalidate an unchanged request/cache and make the item recallable; evidence="
        + JSON.stringify({ decision: afterConfirm.context.thirdPersonDecision,
          items: (afterConfirm.context.pairMemoryItems || []).map(item => String(item.text || "").slice(0, 200)),
          diagnostics: afterConfirm.context.pairMemoryMetrics,
          directConfirmedIndex: confirmedIndexEvidence,
          previewCandidate: { ambiguous: candidate.ambiguous, confirmed: candidate.confirmed, text: candidate.text } }));
    assert(afterConfirm.rendered.built.blocks.some(block => MEMORY_BLOCK_IDS.has(block.block?.id)
      && String(block.content || "").includes(sentinel)),
    "T14: confirmed legacy matter must reach the actual final Prompt memory block");

    const beforeRetractStat = fs.statSync(sourceFile);
    const currentRows = test.engine.store.readJson(sourceFile, []);
    const currentSummary = currentRows.find(row => row.date === "1199.3.1" && row.content.includes(sentinel));
    assert(currentSummary, "T14 retract fixture must find the confirmed source in the raw synthetic file");
    const replacement = "R".repeat(Buffer.byteLength(matter, "utf8"));
    const retractedRows = currentRows.map(row => row === currentSummary
      ? { ...row, content: row.content.replace(matter, replacement) } : row);
    const retractedBytes = Buffer.from(JSON.stringify(retractedRows, null, 2), "utf8");
    assert.equal(retractedBytes.length, beforeRetractStat.size,
      "T14 retraction rewrite must preserve file size despite replacing multibyte prose");
    fs.writeFileSync(sourceFile, retractedBytes);
    fs.utimesSync(sourceFile, beforeRetractStat.atime, beforeRetractStat.mtime);
    const afterRetractStat = fs.statSync(sourceFile);
    assert.equal(afterRetractStat.size, beforeRetractStat.size);
    assert.equal(afterRetractStat.mtimeMs, beforeRetractStat.mtimeMs,
      "T14 retraction rewrite must retain the original source mtime");

    clearCalls(calls);
    const afterRetract = retrieveAndRender(test.engine, fixture, promptRuntime, gameData, query,
      { ...requestOptions, turnEpoch: 2, messageId: 9072 });
    assert(!JSON.stringify(afterRetract.context.pairMemoryItems || []).includes(sentinel),
      "T14: same-size/same-mtime source retraction must invalidate confirmed cached matter");
    assert(!afterRetract.rendered.built.blocks.some(block => MEMORY_BLOCK_IDS.has(block.block?.id)
      && String(block.content || "").includes(sentinel)),
    "T14: retracted source matter must not resurrect in a fresh actual Prompt");
    return { ambiguousPreview: candidate.ambiguous, realPairApply: applied.success,
      confirmedItemReachedPrompt: true, sameSizeSameMtimeRetractionRemovedItem: true };
  } finally {
    test.cleanup();
  }
}

async function testBudgetOmissionAndStaleOrQuotedHistory() {
  const fixture = fixtureData();
  const longSource = "预算压力合成正文。".repeat(1000);
  for (const pair of fixture.pairSummaries.filter(row => row.ownerId === OWNER_ID && row.counterpartId === TARGET_ID)) {
    for (const summary of pair.summaries) summary.content += "\n【预算压力正文】\n" + longSource;
  }
  const test = createFixtureEngine("v9363-integration-budget-and-trust");
  try {
    seedSyntheticFixture(test.engine, fixture);
    const promptRuntime = makePromptRuntime();
    const gameData = makeGameData(promptRuntime);
    const calls = trackPairLedger(test.engine);
    const tooSmall = retrieveAndRender(test.engine, fixture, promptRuntime, gameData,
      "去年你和玛蒂尔达具体为边境税收争论过什么？", { tokenBudget: 1200, messageId: 9051 });
    assert.equal(tooSmall.context.thirdPersonDecision.level, "L2", "IQA-10 must authorize the synthetic detail query before budget selection");
    assert(tooSmall.context.pairMemoryMetrics.thirdPersonIndexHitCount > 0,
      "IQA-10 must prove a relevant indexed matter existed before budget omission");
    assert.equal(tooSmall.context.pairMemoryMetrics.thirdPersonLegacyFallbackStatus, "BUDGET_OMITTED",
      "IQA-10 must report budget omission instead of an index miss");
    assert.equal(tooSmall.context.pairMemoryMetrics.thirdPersonSourceOpenedCount, 0,
      "IQA-10's oversized sources must not be injected into the final Prompt");
    assert(!tooSmall.rendered.text.includes(longSource.slice(0, 40)));

    clearCalls(calls);
    const currentUserText = "今天天气如何？";
    const quotedHistory = [
      { id: 9052, role: "user", speakerCharacterId: PLAYER_ID, content: currentUserText },
      { id: 9053, role: "assistant", speakerCharacterId: TARGET_ID,
        content: "丙转述：玩家曾问‘去年你和玛蒂尔达具体争论过什么？’" }
    ];
    const quoted = retrieveAndRender(test.engine, fixture, promptRuntime, gameData, currentUserText,
      { turnEpoch: 2, messageId: 9052, history: quotedHistory });
    const quotedCounts = assertRouteBudget({ id: "IQA-11-npc-quoted-history", ...quoted, calls, expectedLevel: "L0" });
    assert(!quoted.rendered.text.includes(ORIGINAL_SOURCE));

    clearCalls(calls);
    const stale = makeEngineRequest(test.engine, fixture, gameData,
      "去年你和玛蒂尔达具体为边境税收争论过什么？", { turnEpoch: 3, messageId: 9054 });
    stale.history = [
      { id: 9055, role: "system", content: "滚动摘要：玩家曾问去年你和玛蒂尔达具体争论过什么。" },
      { id: 9056, role: "assistant", speakerCharacterId: OWNER_ID, content: "我记得那次争论。" }
    ];
    stale.trustedPlayerTurn = null;
    const staleContext = test.engine.retrieveForResponder(stale);
    const stalePrompt = renderActualPrompt(promptRuntime, staleContext);
    const staleCounts = assertRouteBudget({ id: "IQA-12-compacted-user-missing", context: staleContext,
      rendered: stalePrompt, calls, expectedLevel: "L0" });
    assert(!stalePrompt.text.includes(ORIGINAL_SOURCE));
    return { budgetOmission: { status: tooSmall.context.pairMemoryMetrics.thirdPersonLegacyFallbackStatus,
      indexedItems: tooSmall.context.pairMemoryMetrics.thirdPersonIndexHitCount },
      npcQuotedHistory: quotedCounts, deletedPlayerMessage: staleCounts };
  } finally {
    test.cleanup();
  }
}

function createActualConversationRig({ label, responderIds = [OWNER_ID], generateFollowing = false,
  beforeSendGuardHook = null } = {}) {
  const fixture = fixtureData();
  const test = createFixtureEngine("v9363-integration-conversation-" + label);
  seedSyntheticFixture(test.engine, fixture);
  const promptRuntime = makePromptRuntime();
  const gameData = makeGameData(promptRuntime);
  gameData.aiID = responderIds[0] || OWNER_ID;
  if (responderIds.includes(OTHER_TARGET_ID)) gameData.characters.get(OTHER_TARGET_ID).children = [TARGET_ID];
  gameData.getOfficialRecollectionSummary = () => null;
  const participants = new Set(responderIds.map(Number));
  const conversation = Object.create(Conversation.prototype);
  conversation.id = CONVERSATION_ID + ":" + label;
  conversation.gameData = gameData;
  conversation.messages = [];
  conversation.isActive = true;
  conversation.nextId = 0;
  conversation.currentSummary = "";
  conversation.lastSummarizedMessageIndex = 0;
  conversation.memoryState = test.engine.createConversationState(conversation.id);
  conversation.customQueue = responderIds.map(id => gameData.characters.get(Number(id))).filter(Boolean);
  conversation.persistCustomQueue = false;
  conversation.isPaused = false;
  conversation.inactiveParticipantIds = new Map();
  conversation.summaryParticipantProfiles = new Map();
  conversation.stableProfileCache = new Map();
  conversation.stableDescriptionCache = new Map();
  conversation.cacheV2FrozenSnapshots = { conversation: null, responders: new Map(), prefixByResponder: new Map() };
  conversation.frozenWorldlineByResponder = new Map();
  conversation.frozenWorldlineCoverageByResponder = new Map();
  conversation.worldlineCoveragePatchCacheByResponder = new Map();
  conversation.selectedCharacterIds = new Set([OWNER_ID, OTHER_TARGET_ID]);
  conversation.presentCharacterIds = participants;
  conversation.waitingCharacterIds = new Set([OWNER_ID, OTHER_TARGET_ID].filter(id => !participants.has(id)));
  conversation.temporarilyAbsentCharacterIds = new Map();
  conversation.departedCharacterIds = new Set();
  conversation.joinEvents = [];
  conversation.leaveEvents = [];
  conversation.presenceInitialized = true;
  conversation.pendingActionApprovals = new Map();
  conversation.generationAttemptsByMessageId = new Map();
  conversation.memoryAttemptDiagnosticsByOwner = new Map();
  conversation.dynamicRecallHistory = new Map();
  conversation.pendingPlayerRecallRequests = new Map();
  conversation.emitUpdate = () => {};
  conversation.captureSummaryParticipantProfiles(gameData.characters.values());
  conversation.getNpcList = () => responderIds.map(id => gameData.characters.get(Number(id))).filter(Boolean);
  conversation.processQueue = function (turnEpoch = this.turnEpoch) {
    this.lastProcessPromise = Conversation.prototype.processQueue.call(this, turnEpoch);
    return this.lastProcessPromise;
  };
  conversation.resumeConversation = function () {
    this.isPaused = false;
    if (this.npcQueue.length > 0) return this.processQueue();
    return Promise.resolve();
  };

  const turnManager = new ConversationTurnManager(conversation);
  const generationManager = new GenerationManager(conversation);
  conversation.runtime = { turnManager, generationManager };
  conversation.turnManager = turnManager;
  conversation.generationManager = generationManager;

  const ledgerCalls = trackPairLedger(test.engine);
  const sourceContexts = [];
  const successfulAttempts = [];
  const rejectedGuards = [];
  let observeParticipantsCount = 0;
  const observeParticipants = test.engine.observeParticipants.bind(test.engine);
  test.engine.observeParticipants = (...args) => {
    observeParticipantsCount += 1;
    return observeParticipants(...args);
  };

  conversation.checkAndSummarizeIfNeeded = async npc => {
    const currentTurn = conversation.getTurnManager().currentTurn;
    const playerMessage = conversation.messages.find(message => message.role === "user"
      && message.id === currentTurn?.playerMessageId);
    const history = conversation.getHistory();
    const request = makeCandidateRequest(fixture, "nameOnly", {
      playerContent: playerMessage?.content || "",
      currentPlayerMessageId: currentTurn?.playerMessageId,
      history,
      characterId: Number(npc.id),
      trustedPlayerAnchorId: PLAYER_ID,
      directCounterpartIds: [PLAYER_ID],
      activeParticipantIds: [...(currentTurn?.activeParticipantIds || [])],
      conversationId: conversation.id,
      sceneRevision: sceneRevision(gameData),
      turnEpoch: conversation.turnEpoch,
      logicalTurnEpoch: currentTurn?.logicalTurnEpoch ?? null,
      campaignToken: CAMPAIGN,
      currentGameDate: GAME_DATE,
      currentTotalDays: fixture.currentTotalDays,
      gameData,
      entityProfiles: [...gameData.getMentionableCharacterProfiles().values()],
      sessionRecallCache: conversation.memoryState.responderRecallCache,
      mentionedRecallCache: conversation.memoryState.mentionedRecallCache,
      tokenBudget: 50000,
      estimateTokens: text => TokenCounter.estimateTokens(String(text || "")),
      estimateMessageTokens: message => TokenCounter.estimateMessageTokens(message)
    });
    request.trustedPlayerTurn = resolveTrustedPlayerTurn({
      history,
      playerAnchorId: PLAYER_ID,
      currentPlayerMessageId: currentTurn?.playerMessageId,
      turnEpoch: conversation.turnEpoch,
      logicalTurnEpoch: currentTurn?.logicalTurnEpoch,
      conversationId: conversation.id,
      sceneRevision: sceneRevision(gameData)
    });
    assert(request.trustedPlayerTurn, "actual Conversation's current player turn must pass the production trust resolver");
    const context = test.engine.retrieveForResponder(request);
    sourceContexts.push({ responderId: Number(npc.id), context });
    return {
      ...context,
      activeParticipantIds: [...(currentTurn?.activeParticipantIds || [])],
      stableProfileCache: conversation.stableProfileCache,
      stableDescriptionCache: conversation.stableDescriptionCache,
      cacheV2FrozenSnapshots: conversation.cacheV2FrozenSnapshots,
      freezePromptPrefix: false,
      presenceText: conversation.buildPresenceContext()
    };
  };

  const llmManager = {
    async sendChatRequest(messages, _signal, _noStream, metadata = {}) {
      try {
        if (typeof beforeSendGuardHook === "function") {
          await beforeSendGuardHook({ engine: test.engine, fixture, gameData, messages, metadata });
        }
        metadata.beforeSendGuard?.();
      } catch (error) {
        rejectedGuards.push({ responderId: Number(metadata.responderId), name: error?.name || "Error" });
        throw error;
      }
      const text = (messages || []).map(message => String(message.content || "")).join("\n");
      const blocks = (metadata.blocks || []).map(block => ({ id: block.id, fingerprint: block.fingerprint || null,
        tokens: Number.isSafeInteger(block.tokens) && block.tokens >= 0 ? block.tokens : null }));
      successfulAttempts.push({
        responderId: Number(metadata.responderId),
        assistantMessageId: conversation.activeResponse?.messageId ?? null,
        logicalTurnEpoch: conversation.getTurnManager().currentTurn?.logicalTurnEpoch ?? null,
        blocks,
        pairMemoryMetrics: metadata.pairMemoryMetrics ? { ...metadata.pairMemoryMetrics } : null,
        memoryAttemptDiagnostics: { ...(metadata.memoryAttemptDiagnostics || {}) },
        hasLastYearIndex: text.includes(LAST_YEAR_INDEX),
        hasOldYearIndex: text.includes(OLD_YEAR_INDEX),
        hasOriginalSource: text.includes(ORIGINAL_SOURCE),
        hasEditedSource: text.includes(EDITED_SOURCE),
        hasPrivateSource: text.includes(PRIVATE_SOURCE),
        hasOwnerFourPrivateSource: text.includes(OWNER4_PRIVATE_SOURCE)
      });
      return { content: "合成回答-" + String(metadata.responderId), finish_reason: "stop" };
    },
    async getProviderCapabilities() { return { contextWindow: 32000, maxOutputTokens: 1024 }; },
    async getCurrentContextLength() { return 32000; }
  };
  Conversation.configure({
    memoryEngine: test.engine,
    PromptBuilder: promptRuntime.builder,
    TokenCounter,
    createPromptFingerprint: fingerprint,
    createMessage: fields => ({ ...fields }),
    createError: fields => ({ ...fields, role: "assistant", type: "error" }),
    settingsRepository: {
      getActiveProviderConfig: () => ({ providerType: "openai-compatible", defaultModel: "qa-model" }),
      getGlobalStreamSetting: () => false,
      getGenerateFollowingMessagesSetting: () => generateFollowing,
      getPauseOnRegenerationSetting: () => false,
      getChatPromptV813Layout: () => false,
      getActionApprovalSettings: () => ({ pauseOnApproval: false })
    },
    llmManager,
    ActionEngine: { evaluateForCharacter: async () => ({ autoApproved: [], needsApproval: [] }) },
    usageAnalytics: { record() {} },
    logVerboseLLM() {}
  });
  return {
    conversation, fixture, engine: test.engine, gameData, ledgerCalls, sourceContexts,
    successfulAttempts, rejectedGuards, test, get observeParticipantsCount() { return observeParticipantsCount; },
    async waitForQueue() { await conversation.lastProcessPromise; }
  };
}

function assertActualAttemptEvidence(attempts, { expectedTotalCount, expectedResponderCount, responderId = OWNER_ID,
  expectedComparison = null } = {}) {
  assert.equal(attempts.length, expectedTotalCount, "actual provider boundary must receive every expected physical attempt");
  const selected = attempts.filter(attempt => attempt.responderId === responderId);
  assert.equal(selected.length, expectedResponderCount, "actual provider boundary must contain each requested responder attempt");
  for (const attempt of selected) {
    const diagnostics = attempt.memoryAttemptDiagnostics;
    assert.match(diagnostics.memoryInjectionDigest || "", /^[a-f0-9]{64}$/u,
      "actual send metadata must contain the privacy-safe memory injection digest");
    assert.equal(diagnostics.memoryInjectionDigest, digestRenderedMemoryBlocks(attempt.blocks),
      "diagnostic injection digest must match independently recomputed hashes from actual sent Prompt blocks");
    assert.match(diagnostics.memoryQueryFingerprint || "", /^[a-f0-9]{64}$/u);
    assert.match(diagnostics.memorySelectionDigest || "", /^[a-f0-9]{64}$/u);
    assert.equal(diagnostics.trustedPlayerTurnResolved, true,
      "actual send diagnostic must confirm the player message was resolved as the trusted turn");
    const totalResolves = Number(attempt.pairMemoryMetrics?.totalSourceResolveAttemptCount) || 0;
    assert(totalResolves <= 2, "actual sent L2 Prompt must stay within the two-source resolve cap");
    if (expectedComparison) assert.equal(diagnostics.comparisonStatus, expectedComparison);
  }
  return selected;
}

async function testActualConversationFiveRegenerationsAndOwnerIsolation() {
  const rig = createActualConversationRig({ label: "five-regen-owner-isolation", responderIds: [OWNER_ID, OTHER_TARGET_ID],
    generateFollowing: true });
  try {
    const query = "去年你和玛蒂尔达具体为边境税收争论过什么？";
    await rig.conversation.sendMessage(query);
    await rig.waitForQueue();
    let previousResponderIds = new Map();
    for (const id of [OWNER_ID, OTHER_TARGET_ID]) {
      const response = rig.conversation.messages.findLast(message => message.role === "assistant"
        && Number(message.speakerCharacterId) === id);
      assert(response, "initial actual Conversation turn must include each selected responder");
      previousResponderIds.set(id, response.id);
    }
    for (let regeneration = 1; regeneration <= 5; regeneration += 1) {
      await rig.conversation.regenerateMessage(previousResponderIds.get(OWNER_ID));
      await rig.waitForQueue();
      for (const id of [OWNER_ID, OTHER_TARGET_ID]) {
        const responses = rig.conversation.messages.filter(message => message.role === "assistant"
          && Number(message.speakerCharacterId) === id);
        const latest = responses.at(-1);
        assert(latest, "regeneration must regenerate each responder in the active queue");
        previousResponderIds.set(id, latest.id);
      }
    }

    assert.equal(rig.observeParticipantsCount, 1,
      "five regeneration attempts must not create new participant observation/finalization windows");
    const ownerTwo = assertActualAttemptEvidence(rig.successfulAttempts, { expectedTotalCount: 12, expectedResponderCount: 6,
      responderId: OWNER_ID });
    const ownerFour = assertActualAttemptEvidence(rig.successfulAttempts, { expectedTotalCount: 12, expectedResponderCount: 6,
      responderId: OTHER_TARGET_ID });
    assert.equal(ownerTwo.length, 6);
    assert.equal(ownerFour.length, 6);

    const playerMessage = rig.conversation.messages.find(message => message.role === "user");
    assert(playerMessage);
    const expectedLogicalIdHash = hashJson(playerMessage.id);
    for (const [responderId, attempts] of [[OWNER_ID, ownerTwo], [OTHER_TARGET_ID, ownerFour]]) {
      assert.equal(attempts[0].memoryAttemptDiagnostics.logicalPlayerMessageIdHash, expectedLogicalIdHash,
        "all physical attempts must retain one logical user message identity");
      assert.deepEqual(attempts.map(attempt => attempt.memoryAttemptDiagnostics.attemptEpoch), [1, 2, 3, 4, 5, 6],
        "initial plus five regenerations must advance the physical attempt epoch");
      assert.equal(attempts[0].memoryAttemptDiagnostics.regenerateOfHash, null,
        "the initial physical attempt has no previous assistant attempt");
      assert.equal(attempts[0].memoryAttemptDiagnostics.comparisonStatus, "FIRST_ATTEMPT");
      for (const attempt of attempts.slice(1)) assert.equal(attempt.memoryAttemptDiagnostics.comparisonStatus, "MATCH",
        "same turn, scope, sources, selected memory, and final Prompt must compare as MATCH");
      for (let index = 1; index < attempts.length; index += 1) {
        assert.equal(attempts[index].memoryAttemptDiagnostics.regenerateOfHash,
          hashJson(attempts[index - 1].assistantMessageId),
          "each regeneration must hash the actual previous assistant message ID for the same responder");
      }
      assert(new Set(attempts.map(attempt => attempt.memoryAttemptDiagnostics.memoryInjectionDigest)).size === 1,
        "all six actual final memory-block sets must hash identically");
      assert(new Set(attempts.map(attempt => attempt.memoryAttemptDiagnostics.memorySelectionDigest)).size === 1,
        "all six actual selected-source sets must hash identically");
      assert(new Set(attempts.map(attempt => attempt.memoryAttemptDiagnostics.memoryQueryFingerprint)).size === 1,
        "all six actual trusted query fingerprints must hash identically");
    }
    for (const attempt of ownerTwo) {
      assert(attempt.hasOriginalSource, "owner 2 actual sent Prompt must contain its authorized L2 source");
      assert(attempt.hasLastYearIndex, "owner 2 actual sent Prompt must retain the last-year matter index");
      assert(!attempt.hasOldYearIndex, "owner 2 actual sent Prompt must exclude the older event year");
      assert(!attempt.hasPrivateSource, "owner 2 actual sent Prompt must not expose another Owner's source");
      assert(!attempt.hasOwnerFourPrivateSource, "owner 2 actual sent Prompt must not expose owner 4's source");
      assert(attempt.assistantMessageId != null, "each actual Provider attempt must map to its assistant message ID");
    }
    const ownerFourSnapshot = rig.engine.store.loadFolderSummariesForCharacter(OTHER_TARGET_ID);
    const ownerFourIndex = rig.engine.store.pairLedger.read({ ownerId: OTHER_TARGET_ID, counterpartId: TARGET_ID,
      campaignToken: CAMPAIGN }, { currentGameDate: GAME_DATE, currentTotalDays: rig.fixture.currentTotalDays,
      memories: ownerFourSnapshot, readOnly: true });
    for (const attempt of ownerFour) {
      assert(attempt.hasOwnerFourPrivateSource, "owner 4 may retrieve only its own synthetic private source; evidence="
        + JSON.stringify({ ownerSnapshotCount: ownerFourSnapshot.length,
          ownerSnapshotHasSentinel: ownerFourSnapshot.some(memory => String(memory.content || "").includes(OWNER4_PRIVATE_SOURCE)),
          index: { sourceSummaries: ownerFourIndex.sourceSummaries.map(source => ({ date: source.conversationDate,
            hasSentinel: String(source.summary?.content || source.rawSummary?.content || "").includes(OWNER4_PRIVATE_SOURCE) })),
            itemCount: ownerFourIndex.items.length,
            itemHasSentinel: ownerFourIndex.items.some(item => String(item.text || "").includes(OWNER4_PRIVATE_SOURCE)),
            diagnostics: ownerFourIndex.diagnostics },
          route: rig.sourceContexts.filter(row => row.responderId === OTHER_TARGET_ID).slice(0, 1).map(row => ({
          level: row.context.thirdPersonDecision?.level,
          reason: row.context.thirdPersonDecision?.reasonCode,
          targetIds: row.context.thirdPersonDecision?.targetCharacterIds,
          targetEvidence: row.context.thirdPersonDecision?.targetEvidence,
          metrics: { indexHits: row.context.pairMemoryMetrics?.thirdPersonIndexHitCount,
            resolves: row.context.pairMemoryMetrics?.totalSourceResolveAttemptCount,
            fallback: row.context.pairMemoryMetrics?.thirdPersonLegacyFallbackStatus },
          items: (row.context.pairMemoryItems || []).map(item => ({ routeKind: item.routeKind,
            target: item.targetCharacterId, hasSentinel: String(item.text || "").includes(OWNER4_PRIVATE_SOURCE) })),
          sources: (row.context.pairMemorySources || []).map(source => ({
            routeKind: source.routeKind,
            scopeOwner: source.sourceScopeCharacterId,
            target: source.targetCharacterId,
            date: source.memory?.eventDate,
            hasPrivate: String(source.memory?.content || "").includes(OWNER4_PRIVATE_SOURCE)
          }))
          })) }));
      assert(!attempt.hasOriginalSource, "owner 4 must not inherit owner 2's source");
    }
    const ownerTwoSources = rig.sourceContexts.filter(row => row.responderId === OWNER_ID)
      .flatMap(row => (row.context.pairMemorySources || []).filter(source => source.routeKind === "third_person_source")
        .map(source => source.memory?.eventDate || null));
    assert(ownerTwoSources.length >= 1, "actual MemoryEngine retrieval must expose at least one last-year source date");
    assert(ownerTwoSources.every(date => date === "1199.1.1"),
      "the actual source records selected for the prior-year query must carry event dates in the resolved prior year");
    const ownerTwoTemporalYears = rig.sourceContexts.filter(row => row.responderId === OWNER_ID)
      .map(row => row.context.temporal?.targetGameYear);
    assert(ownerTwoTemporalYears.every(year => year === 1199),
      "actual Conversation retrieval must retain the 1199 prior-year temporal target for every B attempt");
    return { actualProviderRequests: rig.successfulAttempts.length, attemptsPerOwner: 6,
      independentPromptHashMatches: true, owner2EventDates: [...new Set(ownerTwoSources)], ownerIsolation: true,
      observeParticipantsCalls: rig.observeParticipantsCount };
  } finally {
    rig.test.cleanup();
  }
}

async function testActualConversationLogicalFollowupBinding() {
  const rig = createActualConversationRig({ label: "conversation-logical-followup", responderIds: [OWNER_ID] });
  try {
    await rig.conversation.sendMessage("你以前和玛蒂尔达关系如何？");
    await rig.waitForQueue();
    const initial = rig.sourceContexts.at(-1).context;
    assert.equal(initial.thirdPersonDecision.level, "L1", "the named historical relationship query must authorize L1");
    assert.deepEqual(initial.thirdPersonDecision.targetCharacterIds, [TARGET_ID]);

    await rig.conversation.sendMessage("那后来呢？");
    await rig.waitForQueue();
    const followup = rig.sourceContexts.at(-1).context;
    assert.equal(followup.thirdPersonDecision.level, "L1",
      "the actual next logical turn may use the immediate named-history binding at L1");
    assert.deepEqual(followup.thirdPersonDecision.targetCharacterIds, [TARGET_ID]);
    assert.equal(followup.thirdPersonDecision.targetEvidence, "BOUND_FOLLOWUP");
    const followupAttempt = rig.successfulAttempts.at(-1);
    const followupAssistantId = followupAttempt.assistantMessageId;
    assert.equal(followupAttempt.logicalTurnEpoch, 2);

    await rig.conversation.regenerateMessage(followupAssistantId);
    await rig.waitForQueue();
    const regeneratedFollowup = rig.sourceContexts.at(-1).context;
    assert.equal(regeneratedFollowup.thirdPersonDecision.level, "L1",
      "physical regeneration must preserve the L1 follow-up authorization from the same logical user turn");
    assert.deepEqual(regeneratedFollowup.thirdPersonDecision.targetCharacterIds, [TARGET_ID]);
    assert.equal(regeneratedFollowup.thirdPersonDecision.targetEvidence, "BOUND_FOLLOWUP");
    const regeneratedAttempt = rig.successfulAttempts.at(-1);
    assert.equal(regeneratedAttempt.logicalTurnEpoch, followupAttempt.logicalTurnEpoch,
      "regeneration advances only the physical attempt epoch");
    assert.equal(regeneratedAttempt.memoryAttemptDiagnostics.attemptEpoch,
      followupAttempt.memoryAttemptDiagnostics.attemptEpoch + 1);
    assert.equal(regeneratedAttempt.memoryAttemptDiagnostics.logicalPlayerMessageIdHash,
      followupAttempt.memoryAttemptDiagnostics.logicalPlayerMessageIdHash);
    assert.equal(regeneratedAttempt.memoryAttemptDiagnostics.comparisonStatus, "MATCH");
    assert.equal(regeneratedAttempt.memoryAttemptDiagnostics.memoryInjectionDigest,
      followupAttempt.memoryAttemptDiagnostics.memoryInjectionDigest);
    assert.equal(regeneratedAttempt.memoryAttemptDiagnostics.memoryInjectionDigest,
      digestRenderedMemoryBlocks(regeneratedAttempt.blocks));

    await rig.conversation.sendMessage("今天天气如何？");
    await rig.waitForQueue();
    const expired = rig.sourceContexts.at(-1).context;
    assert.equal(expired.thirdPersonDecision.level, "L0",
      "the follow-up binding must expire after the immediate next logical turn");
    assert.equal(rig.successfulAttempts.at(-1).logicalTurnEpoch, 3);
    return { namedHistory: "L1", immediateFollowup: "L1", followupRegeneration: "L1",
      followupPhysicalAttempts: [2, 3], logicalTurns: [2, 2, 3], expiredNextTurn: "L0" };
  } finally {
    rig.test.cleanup();
  }
}

async function testActualConversationRouteLevelsAndForgetGuard() {
  const runAccessCase = async ({ label, query, expectedLevel }) => {
    const rig = createActualConversationRig({ label, responderIds: [OWNER_ID] });
    try {
      await rig.conversation.sendMessage(query);
      await rig.waitForQueue();
      assert.equal(rig.successfulAttempts.length, 1, label + ": actual Conversation should send exactly one successful synthetic request");
      const context = rig.sourceContexts[0]?.context;
      assert(context, label + ": actual MemoryEngine retrieval should run inside respondAs");
      assert.equal(context.thirdPersonDecision.level, expectedLevel,
        label + ": actual responder route level, reason=" + String(context.thirdPersonDecision?.reasonCode || "unknown"));
      const reads = thirdPersonCalls(rig.ledgerCalls, "reads").length;
      const resolves = thirdPersonCalls(rig.ledgerCalls, "resolves").length;
      const items = (context.pairMemoryItems || []).filter(item => ["third_direct_pair", "third_cross_pair"].includes(item.routeKind));
      if (expectedLevel === "L0") {
        assert.equal(reads, 0, label + ": actual L0 Conversation must make zero third-person PairLedger reads");
        assert.equal(resolves, 0, label + ": actual L0 Conversation must make zero source resolves");
        assert.equal(items.length, 0, label + ": actual L0 Conversation must inject no third-person items");
        assert(!rig.successfulAttempts[0].hasOriginalSource && !rig.successfulAttempts[0].hasLastYearIndex,
          label + ": future plan Prompt cannot contain historical source or index");
      } else if (expectedLevel === "L1") {
        assert(reads > 0, label + ": actual L1 Conversation must query the PairLedger index");
        assert.equal(resolves, 0, label + ": actual L1 Conversation must not open third-person source prose");
        assert(rig.successfulAttempts[0].hasLastYearIndex, label + ": actual L1 Prompt must include the relevant ledger matter");
        assert(!rig.successfulAttempts[0].hasOriginalSource, label + ": actual L1 Prompt must contain no source prose");
      }
      return { level: expectedLevel, thirdPersonReads: reads, thirdPersonSourceResolves: resolves,
        successfulSyntheticSends: rig.successfulAttempts.length };
    } finally {
      rig.test.cleanup();
    }
  };
  const futurePlan = await runAccessCase({ label: "conversation-future-plan-l0",
    query: "等明年以后你准备如何安排玛蒂尔达？", expectedLevel: "L0" });
  const relationship = await runAccessCase({ label: "conversation-relationship-l1",
    query: "你以前和玛蒂尔达关系如何？", expectedLevel: "L1" });

  let forgetStatus = null;
  const rig = createActualConversationRig({ label: "conversation-forget-before-send", responderIds: [OWNER_ID],
    beforeSendGuardHook: ({ engine }) => {
      if (forgetStatus) return;
      const sourceFile = path.join(engine.store.summaryFoldersDir, "2_乙", "与玛蒂尔达的对话.json");
      const rows = engine.store.readJson(sourceFile, []);
      const target = rows.find(row => row.finalizationId === "qa-v9363-target-1199");
      assert(target, "the guard fixture must identify only the synthetic 1199 summary");
      forgetStatus = engine.forgetSummaryProjection(target, { ownerId: OWNER_ID, counterpartId: TARGET_ID }).status;
    }
  });
  try {
    await rig.conversation.sendMessage("去年你和玛蒂尔达具体为边境税收争论过什么？");
    await rig.waitForQueue();
    assert.equal(forgetStatus, "FORGOTTEN", "the test must perform a real synthetic Forget before transport guard");
    assert.equal(rig.successfulAttempts.length, 0,
      "the actual Conversation send boundary must refuse to transport a Prompt whose source was forgotten");
    assert.equal(rig.rejectedGuards.length, 1, "the actual before-send guard must reject the stale prompt exactly once");
    assert.equal(rig.rejectedGuards[0].name, "AbortError");
    assert(rig.sourceContexts[0]?.context?.pairMemorySources?.some(source =>
      source.routeKind === "third_person_source" && source.memory?.content?.includes(ORIGINAL_SOURCE)),
    "the guard test must first build a real pre-Forget source-backed context");
    return { futurePlan, relationship, forgottenBeforeTransport: true, successfulSendsAfterForget: 0 };
  } finally {
    rig.test.cleanup();
  }
}

async function runRegenerateIntegration() {
  const { runRegenerateConsistencyChecks } = require("./test-v9.3.6.3-regenerate-consistency");
  assert.equal(typeof runRegenerateConsistencyChecks, "function",
    "the integrated suite requires the independent actual-Conversation regeneration check");
  const consistency = await runRegenerateConsistencyChecks();
  const actualPrompt = await testActualConversationFiveRegenerationsAndOwnerIsolation();
  const logicalFollowup = await testActualConversationLogicalFollowupBinding();
  return { consistency, actualPrompt, logicalFollowup };
}

async function run() {
  const cases = [
    ["time-window-and-route-levels", testPreviousYearAndLevelBoundaries],
    ["kinship-targeting", testKinshipTargetResolutionAndAmbiguity],
    ["identity-campaign-scene-and-lineage-isolation", testIdentityCampaignSceneAndLineageIsolation],
    ["actual-game-data-age-authority", testActualPromptAgeAuthority],
    ["source-edit-forget-and-privacy", testSourceEditAndForgetRevalidatePrompt],
    ["pair-ledger-confirm-retraction-and-cache-invalidation", testPairLedgerConfirmRetractionAndCacheInvalidation],
    ["budget-omission-and-history-trust", testBudgetOmissionAndStaleOrQuotedHistory],
    ["actual-conversation-l0-l1-and-forget-guard", testActualConversationRouteLevelsAndForgetGuard],
    ["actual-conversation-regeneration", runRegenerateIntegration]
  ];
  const results = [];
  for (const [id, execute] of cases) {
    try {
      results.push({ id, status: "PASS", evidence: await execute() });
    } catch (error) {
      results.push({ id, status: "FAIL", error: String(error?.message || error).slice(0, 2500) });
    }
  }
  const failures = results.filter(result => result.status !== "PASS");
  console.log("V9.3.6.3 integration release QA: " + (failures.length ? "FAIL" : "PASS") +
    " (synthetic .build fixtures; no live CK3 or Provider)");
  console.log(JSON.stringify(results));
  if (failures.length) process.exitCode = 1;
  return results;
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { run, testPreviousYearAndLevelBoundaries, testKinshipTargetResolutionAndAmbiguity,
  testIdentityCampaignSceneAndLineageIsolation, testActualPromptAgeAuthority, testSourceEditAndForgetRevalidatePrompt,
  testPairLedgerConfirmRetractionAndCacheInvalidation };
