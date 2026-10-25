"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { parseGameState } = require("../src/app/main/worldline/game-state-adapter");
const { WorldlineService } = require("../src/app/main/worldline/worldline-service");

const CONVERSATION_ID = "v96-world-canon-independent-qa";
const CURRENT_DATE = "1200.1.1";
const worldlineSettings = {
  autosavePath: "C:\\synthetic\\autosave.ck3",
  autoWatchEnabled: false,
  promptIntegrationEnabled: true,
  subjectiveWorldMode: "PRODUCTION",
  lastValidationStatus: "VALID",
  v812HistoricalRetrievalEnabled: false,
  v812HistoricalPromptInjection: false
};
const worldlineSettingsRepository = {
  getWorldlineSettings: () => worldlineSettings,
  saveWorldlineSettings: next => Object.assign(worldlineSettings, next),
  getCK3DebugLogPath: () => null
};
const promptSettingsRepository = {
  getPromptSettings: () => ({
    mainTemplate: "{{! VOTC_SEGMENT:stable_global }}V96_STABLE_PROMPT_RULE",
    blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "V96_TEST_INSTRUCTION" }
    ],
    suffix: { enabled: false, template: "" }
  }),
  getChatPromptV89Settings: () => ({
    chatPromptV89Layout: true,
    chatPromptV89RuntimeProfileSplit: true,
    chatPromptV810ProviderAdapter: true
  }),
  getChatPromptV813Layout: () => true,
  getActiveProviderConfig: () => ({ providerType: "openai-compatible", defaultParameters: { max_tokens: 1024 } })
};
const TokenCounter = {
  estimateTokens(value) { return Math.ceil(String(value || "").length / 4); },
  estimateMessageTokens(message) { return this.estimateTokens(`${message?.role || ""}\n${message?.name || ""}\n${message?.content || ""}`); },
  calculateTotalTokens(messages) { return (messages || []).reduce((total, message) => total + this.estimateMessageTokens(message), 0); }
};
const PromptBuilder = createPromptBuilder({
  TemplateEngine: class {
    renderTemplateString(template, context) {
      return String(template)
        .replace(/\{\{!\s*VOTC_SEGMENT:[^}]+\}\}/g, "")
        .replace(/\{\{fullName\}\}/g, context.character?.fullName || "")
        .replace(/\{\{gameData\.date\}\}/g, context.gameData?.date || "");
    }
  },
  PromptScriptLoader: class {},
  promptConfigManager: { getDefaultMainTemplateContent: () => "V96_STABLE_PROMPT_RULE", resolvePath: value => value },
  settingsRepository: promptSettingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
  defaultChatInstruction: "V96_TEST_INSTRUCTION"
});

function makeSnapshot() {
  const snapshot = parseGameState(`date=${CURRENT_DATE} played_character=1
living={
  1={first_name="甲" alive_data={location="长安"}}
  2={first_name="乙" alive_data={location="长安"}}
}`);
  snapshot.playthroughId = "v96-synthetic-campaign";
  snapshot.playerId = "1";
  snapshot.characters["1"] = { ...snapshot.characters["1"], id: "1", firstName: "甲", fullName: "甲", alive: true, location: "长安", faith: "信仰甲", culture: "文化甲", liege: "1", courtEmployer: "1" };
  snapshot.characters["2"] = { ...snapshot.characters["2"], id: "2", firstName: "乙", fullName: "乙", alive: true, location: "长安", faith: "信仰甲", culture: "文化甲", liege: "1", courtEmployer: "1" };
  return snapshot;
}

function makeGameData() {
  const characters = new Map([
    [1, { id: 1, shortName: "甲", firstName: "甲", fullName: "甲", age: 40, gold: 100, traits: [] }],
    [2, { id: 2, shortName: "乙", firstName: "乙", fullName: "乙", age: 35, gold: 50, traits: [] }]
  ]);
  return {
    date: CURRENT_DATE,
    year: 1200,
    scene: "宫廷",
    location: "长安",
    playerID: 1,
    playerName: "甲",
    campaignToken: "v96-synthetic-campaign",
    characters,
    mentionedCharactersInContext: new Set(),
    getActiveParticipantRelationshipInfo: () => "",
    getMentionableCharacterProfiles: () => characters,
    findMentionedCharacterIdsInHistory: () => [],
    getMentionedCharactersInfo: () => ""
  };
}

async function createCanon(service, branchToken, title, content, options = {}) {
  return service.mutateCanon({
    token: branchToken,
    operation: "create",
    payload: {
      title,
      content,
      type: "PLAYER_CANON",
      entities: ["2"],
      entityRefs: [{ namespace: "character", id: "2" }],
      knownBy: [],
      visibility: "PUBLIC_WORLD",
      importance: "NORMAL",
      status: "ACTIVE",
      conversationStable: false,
      temporalMode: "CURRENT_DATE",
      temporalSemantics: "PAST_EVENT",
      ...options
    }
  });
}

function makeRecallArgs({ query, tokenBudget = 512, excludeIds = [] }) {
  const gameData = makeGameData();
  return {
    responderId: 2,
    query,
    assistContext: "",
    mentionedEntityIds: [2],
    activeParticipantIds: [1, 2],
    conversationId: CONVERSATION_ID,
    turnEpoch: 1,
    sceneRevision: `${CURRENT_DATE}\n宫廷`,
    presenceRevision: "1,2",
    directObservationFactIds: [],
    directObservationFacts: [],
    runtimeGameData: gameData,
    excludeIds,
    tokenBudget
  };
}

function countOccurrences(text, marker) {
  return String(text || "").split(marker).length - 1;
}

function joinedMessages(build) {
  return (build?.messages || []).map(message => String(message.content || "")).join("\n");
}

function makeConversation({ worldlineService, frozenContext, gameData, cacheV2FrozenSnapshots }) {
  const conversation = Object.create(Conversation.prototype);
  conversation.id = CONVERSATION_ID;
  conversation.turnEpoch = 1;
  conversation.gameData = gameData;
  conversation.selectedCharacterIds = new Set([2]);
  conversation.presentCharacterIds = new Set([1, 2]);
  conversation.frozenWorldlineByResponder = new Map([[2, frozenContext]]);
  conversation.frozenWorldlineCoverageByResponder = new Map();
  conversation.worldlineCoveragePatchCacheByResponder = new Map();
  conversation.cacheV2FrozenSnapshots = cacheV2FrozenSnapshots;
  conversation.pendingPlayerRecallRequests = new Map();
  conversation.history = [{ role: "user", content: "你和甲的赴约约定是什么？" }];
  conversation.getMemoryContextFor = async () => {
    const query = conversation.history.at(-1)?.content || "";
    return {
      ...frozenContext,
      worldStableText: frozenContext.worldStableText,
      worldTurnRecallText: frozenContext.worldTurnRecallText,
      cacheV2FrozenSnapshots,
      baselineSnapshotId: `baseline:${worldlineService.currentCheckpoint.id}`,
      sourceFolderRevision: 1,
      sourceCampaignToken: "v96-synthetic-campaign",
      sourcePairIds: [1, 2],
      playerAnchorId: 1,
      budgetPolicyRevision: "v9.3.9",
      conversationId: CONVERSATION_ID,
      activeParticipantIds: [1, 2],
      subjectiveWorldPolicyActive: true,
      worldlineRequest: { query, assistContext: "", mentionedEntityIds: [2] },
      freezePromptPrefix: false
    };
  };
  conversation.getPromptHistoryForCharacter = () => conversation.history;
  conversation.getPromptSummaryForCharacter = () => "";
  conversation.getActiveConversationCharacters = () => [gameData.characters.get(1), gameData.characters.get(2)];
  conversation.isV813PrefixEnabled = () => true;
  conversation.estimateTokenCount = messages => TokenCounter.calculateTotalTokens(messages);
  conversation.getCharacterDisclosureContext = () => ({});
  conversation.createRollingSummary = async () => ({ committed: false, reason: "fixture_not_needed" });
  return conversation;
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v96-world-canon-"));
  const worldlineService = new WorldlineService({ dataDir: root, settingsRepository: worldlineSettingsRepository });
  const snapshot = makeSnapshot();
  worldlineService.currentCheckpoint = {
    id: "v96-world-canon-checkpoint",
    source: { path: "C:\\synthetic\\autosave.ck3", fingerprint: "a".repeat(64) },
    snapshot
  };
  worldlineService.buildState = "ACTIVE";
  worldlineService.getLiveState = () => ({ connected: false, gameDate: null, totalDays: null, characters: [], loadSessionId: null });
  const gameData = makeGameData();
  const historyQuery = "你和甲的赴约约定是什么？";
  const recordIds = new Map();
  const recallCalls = [];
  let prepareCalls = 0;
  const originalPrepareCanon = worldlineService.prepareCanon.bind(worldlineService);
  worldlineService.prepareCanon = async () => { prepareCalls++; return originalPrepareCanon(); };
  const originalCanonRecall = worldlineService.getCanonTurnRecallAsync?.bind(worldlineService);
  if (originalCanonRecall) worldlineService.getCanonTurnRecallAsync = async args => {
    recallCalls.push({ ...args, excludeIds: [...(args.excludeIds || [])] });
    return originalCanonRecall(args);
  };

  try {
    const beforeEmptyQuery = prepareCalls;
    const emptyQuery = await worldlineService.getCanonTurnRecallAsync(makeRecallArgs({ query: "  " }));
    assert(!emptyQuery?.text, "empty query cannot recall world Canon");
    assert.equal(prepareCalls, beforeEmptyQuery, "empty query exits before Canon preparation");
    const integrationEnabled = worldlineService.isSubjectivePromptIntegrationEnabled.bind(worldlineService);
    worldlineService.isSubjectivePromptIntegrationEnabled = () => false;
    const beforeDisabledRecall = prepareCalls;
    const disabledRecall = await worldlineService.getCanonTurnRecallAsync(makeRecallArgs({ query: "赴约" }));
    assert(!disabledRecall?.text, "disabled subjective integration cannot recall world Canon");
    assert.equal(prepareCalls, beforeDisabledRecall, "disabled integration exits before Canon preparation");
    worldlineService.isSubjectivePromptIntegrationEnabled = integrationEnabled;
    const prepareBeforeToggle = worldlineService.prepareCanon;
    worldlineService.prepareCanon = async () => {
      worldlineService.isSubjectivePromptIntegrationEnabled = () => false;
    };
    assert.equal(await worldlineService.getCanonTurnRecallAsync(makeRecallArgs({ query: "赴约" })), null,
      "disabling integration during async preparation must prevent recall");
    worldlineService.prepareCanon = prepareBeforeToggle;
    worldlineService.isSubjectivePromptIntegrationEnabled = integrationEnabled;
    recallCalls.length = 0;

    const branch = await worldlineService.listCanon();
    for (let index = 1; index <= 4; index++) {
      const entry = await createCanon(worldlineService, branch.branch.token, `赴约事项 ${index}`, `V96_ORDINARY_CANON_${index}：乙和甲谈过赴约安排 ${index}。`);
      recordIds.set(`ordinary${index}`, entry.recordId);
    }
    const stableRule = await worldlineService.mutateCanon({
      token: branch.branch.token,
      operation: "create",
      payload: {
        title: "港口礼制",
        content: "V96_STABLE_RULE：进港时悬挂青色旗帜。",
        type: "WORLD_ANNOTATION",
        entities: [], entityRefs: [], knownBy: [],
        visibility: "PUBLIC_WORLD", importance: "HIGH", status: "ACTIVE",
        conversationStable: true, temporalMode: "TIMELESS", temporalSemantics: "DURABLE_WORLD_RULE"
      }
    });
    recordIds.set("stable", stableRule.recordId);

    await createCanon(worldlineService, branch.branch.token, "赴约未来安排", "V96_FUTURE_CANON：未来才会发生的赴约。", {
      temporalMode: "SPECIFIC_DATE", temporalSemantics: "PAST_EVENT", gameDate: "1201.1.1"
    });
    await createCanon(worldlineService, branch.branch.token, "赴约秘密安排", "V96_DENIED_SECRET_CANON：未授权的秘密赴约。", {
      type: "SECRET_AGREEMENT", visibility: "SECRET", knownBy: ["3"]
    });

    await createCanon(worldlineService, branch.branch.token, "赴约当前状态核对", "乙现在在长安并谈到赴约。", {
      temporalSemantics: "CURRENT_STRUCTURED_CLAIM",
      currentClaim: { entityId: "2", field: "location", value: "长安" }
    });
    snapshot.characters["2"].location = null;
    await worldlineService.prepareCanon();

    const baseline = worldlineService.getSubjectivePromptContext({
      ...makeRecallArgs({ query: "", tokenBudget: 900, excludeIds: [] }),
      snapshotMode: "CONVERSATION_BASELINE"
    });
    assert(baseline?.worldStableText?.includes("V96_STABLE_RULE"), "explicitly stable Canon is frozen at conversation opening");
    assert.deepEqual(baseline?.stableCanonRecordIds, [recordIds.get("stable")], "opening context exposes only the actually selected stable Canon IDs");
    assert(!baseline.worldTurnRecallText?.includes("V96_ORDINARY_CANON_1"), "ordinary non-stable Canon stays out of query-free opening recall");

    const frozenSnapshots = { conversation: null, responders: new Map(), prefixByResponder: new Map() };
    Conversation.configure({
      PromptBuilder,
      TokenCounter,
      createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
      settingsRepository: promptSettingsRepository,
      memoryEngine: { syncRollingStateFromConversationFields() {}, syncConversationRollingFields() {} },
      worldlineService,
      llmManager: { async getProviderCapabilities() { return {
        providerType: "openai-compatible", providerId: "v96-fixture", modelId: "v96-fixture-model",
        contextWindow: 32768, maxOutputTokens: 1024, capabilityRevision: "v96-fixture:32768:1024"
      }; } },
      usageAnalytics: { record() {} }
    });
    const conversation = makeConversation({ worldlineService, frozenContext: baseline, gameData, cacheV2FrozenSnapshots: frozenSnapshots });
    await conversation.prefetchFrozenWorldline();
    assert.deepEqual(conversation.frozenWorldlineByResponder.get(2)?.stableCanonRecordIds, [recordIds.get("stable")],
      "the real V813 opening prefetch retains the actual frozen stable Canon IDs");
    let coveragePatchCalls = 0;
    conversation.getWorldlineCoveragePatchFor = () => { coveragePatchCalls++; return "V96_COVERAGE_PATCH_SENTINEL"; };

    const builds = [];
    const originalBuild = PromptBuilder.buildMessagesWithTokenCount;
    PromptBuilder.buildMessagesWithTokenCount = function (...args) {
      const result = originalBuild.apply(this, args);
      builds.push(result);
      return result;
    };
    try {
      const currentContext = await conversation.checkAndSummarizeIfNeeded(gameData.characters.get(2));
      assert.equal(coveragePatchCalls, 1, "current-query Canon recall preserves the existing coverage-patch call");
      assert.equal(recallCalls.length, 1, "V813 current query invokes the new per-turn Canon service path");
      assert(recallCalls[0].tokenBudget > 0 && recallCalls[0].tokenBudget <= 900, "Canon recall receives bounded current-turn headroom");
      assert.deepEqual(recallCalls[0].excludeIds, [recordIds.get("stable")], "the dynamic query excludes only stable Canon actually frozen at opening");
      assert.deepEqual(currentContext.stableCanonRecordIds, [recordIds.get("stable")]);
      assert(currentContext.coveragePatchText?.includes("V96_COVERAGE_PATCH_SENTINEL"), "the existing patch text remains in the dynamic block");
      assert(currentContext.coveragePatchText?.includes("V96_ORDINARY_CANON_1"), "ordinary player Canon is appended to the dynamic coverage block");
      assert(currentContext.coveragePatchText?.includes("V96_ORDINARY_CANON_4"));
      for (const marker of ["V96_FUTURE_CANON", "V96_DENIED_SECRET_CANON", "乙现在在长安", "V96_STABLE_RULE"]) {
        assert(!currentContext.coveragePatchText.includes(marker), `${marker} must not be duplicated or recalled as ordinary dynamic Canon`);
      }

      const firstBuild = builds.at(-1);
      const firstMetadata = Conversation.buildPromptBlockMetadata(firstBuild);
      const firstText = joinedMessages(firstBuild);
      for (let index = 1; index <= 4; index++) {
        const marker = `V96_ORDINARY_CANON_${index}`;
        assert.equal(countOccurrences(firstText, marker), 1, `${marker} appears exactly once in final messages`);
      }
      assert.equal(countOccurrences(firstText, "V96_STABLE_RULE"), 1, "frozen stable Canon appears once, never again in the dynamic recall");
      assert(firstBuild.blocks.some(({ block, content }) => block.id === "worldline-coverage-patch" && content.includes("V96_ORDINARY_CANON_1")),
        "the ordinary Canon text is projected into the existing dynamic Prompt block");
      const stableBoundary = firstMetadata.stablePrefixEndPosition;
      const dynamicPosition = firstMetadata.blocks.find(block => block.id === "worldline-coverage-patch")?.position;
      assert(dynamicPosition >= stableBoundary, "turn Canon follows the frozen static prefix");

      conversation.history = [{ role: "user", content: "你和甲谈的赴约安排有哪些细节？" }];
      conversation.turnEpoch = 2;
      await conversation.checkAndSummarizeIfNeeded(gameData.characters.get(2));
      const secondBuild = builds.at(-1);
      const secondMetadata = Conversation.buildPromptBlockMetadata(secondBuild);
      assert.equal(secondMetadata.prefixFingerprint, firstMetadata.prefixFingerprint, "query-tail changes do not alter the V813 frozen prefix fingerprint");

      conversation.history = [{ role: "user", content: "五年前乙在哪里？" }];
      conversation.turnEpoch = 3;
      await conversation.checkAndSummarizeIfNeeded(gameData.characters.get(2));
      assert.equal(recallCalls.length, 2, "historical query bypasses the current Canon recall interface");
      assert.equal(coveragePatchCalls, 2, "historical query also bypasses the current-state coverage patch");
    } finally {
      PromptBuilder.buildMessagesWithTokenCount = originalBuild;
    }

    const lowBudget = await worldlineService.getCanonTurnRecallAsync(makeRecallArgs({ query: historyQuery, tokenBudget: 1,
      excludeIds: baseline.stableCanonRecordIds }));
    assert((lowBudget?.tokens || 0) <= 1, "near-zero remaining headroom never exceeds the supplied Canon budget");
    assert.equal(lowBudget?.selected?.length || 0, 0, "records are not injected when the complete row cannot fit");

    const hiddenTarget = (await worldlineService.listCanon()).records.find(record => record.recordId === recordIds.get("ordinary4"));
    await worldlineService.mutateCanon({ token: branch.branch.token, operation: "update", id: hiddenTarget.recordId,
      revision: hiddenTarget.revision, payload: { status: "HIDDEN" } });
    const afterHide = await worldlineService.getCanonTurnRecallAsync(makeRecallArgs({ query: historyQuery, excludeIds: baseline.stableCanonRecordIds }));
    assert(!afterHide?.text?.includes("V96_ORDINARY_CANON_4"), "updated hidden records are invalidated and omitted");

    const currentBranch = await worldlineService.listCanon();
    const fork = worldlineService.forkCanonBranch(currentBranch.branch.token);
    assert.notEqual(fork.branchId, currentBranch.branch.branchId, "the fixture creates a distinct synthetic branch");
    const wrongBranch = await worldlineService.getCanonTurnRecallAsync(makeRecallArgs({ query: historyQuery,
      excludeIds: baseline.stableCanonRecordIds }));
    assert.equal(wrongBranch?.selected?.length || 0, 0, "records from the archived parent branch do not enter its fork");
    console.log("V9.6 World Canon Recall independent QA PASS");
  } finally {
    worldlineService.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { run };
