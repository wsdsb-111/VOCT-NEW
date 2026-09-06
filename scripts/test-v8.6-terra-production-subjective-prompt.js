"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Handlebars = require("../resources/app/node_modules/handlebars");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");
const { buildSubjectiveWorldView } = require("../resources/app/out/main/worldline/subjective-world-builder");
const { buildHistoricalReferenceReplacement } = require("../resources/app/out/main/worldline/subjective-prompt-context");
const { classifySelectedWorldFacts } = require("../resources/app/out/main/worldline/world-knowledge-classifier");
const { createPromptBuilder } = require("../resources/app/out/main/prompts/prompt-builder");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v86-terra-production-"));
const autosavePath = path.join(root, "autosave.ck3");
fs.writeFileSync(autosavePath, "fixture");
const settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION", lastValidationStatus: "VALID" };
const checkpointDate = "1170.6.6";
const selected = {
  gameTruth: [{
    id: "character:2", category: "GAME_TRUTH", kind: "CHARACTER", sourceTier: "GAME_TRUTH", gameDate: checkpointDate,
    entityRefs: { characters: ["2"] }, title: "乙",
    payload: { id: "2", character: { id: "2", firstName: "乙", location: "临安" }, match: { displayName: "乙" } }
  }],
  delta: [{
    id: "delta:war", category: "DELTA", kind: "DELTA", sourceTier: "ANNUAL_DELTA", eventType: "WAR_STARTED", gameDate: checkpointDate,
    entityRefs: { characters: ["2"] }, title: "WAR_STARTED", payload: { type: "WAR_STARTED", date: checkpointDate }
  }],
  supplemental: []
};

try {
  const service = new WorldlineService({
    dataDir: root,
    memoryEngine: { store: {
      getCharacterKnowledge: (id) => String(id) === "1" ? [{ memoryId: "private-plan" }] : [],
      getMemory: (id) => id === "private-plan" ? { memoryId: id, visibility: "private", type: "secret", participants: [1], eventDate: checkpointDate, content: "绝密计划正文" } : null
    } },
    settingsRepository: {
      getWorldlineSettings: () => settings,
      saveWorldlineSettings: (next) => Object.assign(settings, next),
      getCK3UserFolderPath: () => null,
      getCK3DebugLogPath: () => null
    }
  });
  service.currentCheckpoint = { id: "checkpoint", source: { path: autosavePath }, snapshot: {
    gameDate: checkpointDate, playerId: "1", diagnostics: { characterCount: 3, activeWarCount: 1 },
    characters: {
      "1": { id: "1", firstName: "甲", courtEmployer: "10", liege: "20" },
      "2": { id: "2", firstName: "乙", courtEmployer: "10", liege: "20" },
      "3": { id: "3", firstName: "丙", courtEmployer: "99", liege: "99" },
      "4": { id: "4", firstName: "丁", courtEmployer: "10", liege: "20" }
    },
    nameToCharacterIds: {}, definitionToRuntime: {}, runtimeToDefinitions: {}, titles: {}
  } };
  service.buildState = "ACTIVE";
  service.getLiveState = () => ({ connected: false, gameDate: null, totalDays: null, characters: [] });
  service.getPromptContext = () => ({ queryFingerprint: "q", queryPlan: { entities: { characters: ["2"] } }, retrieval: { selected } });

  const owner = service.getSubjectivePromptContext({ responderId: "1", query: "乙在哪里", conversationId: "c", turnEpoch: 1, sceneRevision: "scene", presenceRevision: "1,2", directObservationFactIds: [], historicalReferenceInfo: { period: "宋", context: "旧背景", notableEvents: ["旧事"], notableFigures: ["旧人"] } });
  const outsider = service.getSubjectivePromptContext({ responderId: "3", query: "乙在哪里", conversationId: "c", turnEpoch: 1, sceneRevision: "scene", presenceRevision: "1,2", directObservationFactIds: [], historicalReferenceInfo: { period: "宋", context: "旧背景", notableEvents: [], notableFigures: [] } });
  const uninformedPeer = service.getSubjectivePromptContext({ responderId: "4", query: "乙在哪里", conversationId: "c", turnEpoch: 1, sceneRevision: "scene", presenceRevision: "1,2,4", directObservationFactIds: [], historicalReferenceInfo: { period: "宋", context: "旧背景", notableEvents: [], notableFigures: [] } });
  assert(owner?.worldText.includes("乙当前位于 临安"), "same-court responder receives court-public location with checkpoint provenance");
  assert(owner.worldText.includes("记录到一场新战争"), "same-realm annual delta reaches the responder-scoped production prompt");
  assert(!owner.worldText.includes("绝密计划正文") && !owner.worldText.includes("private-plan"), "production prompt never serializes personal secret memory");
  assert(!outsider?.worldText.includes("乙") && !outsider?.worldText.includes("临安"), "different-court responder does not receive an arbitrary character name or location");
  assert(!outsider?.worldText.includes("记录到一场新战争"), "different-realm responder does not receive realm-scoped war history");
  assert(uninformedPeer?.worldText.includes("乙当前位于 临安") && !uninformedPeer.worldText.includes("绝密计划正文"), "same-court peer receives only scoped public facts, not another responder's secret");
  assert(owner.historicalReferenceInfo.context.includes("不得引用后续事件"), "Phase B replaces legacy history context with an explicit temporal boundary");
  assert(!JSON.stringify(owner.historicalReferenceInfo).includes("旧背景") && !JSON.stringify(owner.historicalReferenceInfo).includes("旧事"), "Phase B does not relabel and forward unfiltered legacy history");

  const unscopedWarFacts = classifySelectedWorldFacts({ delta: [{ ...selected.delta[0], entityRefs: { characters: [], titles: [] } }] }, checkpointDate);
  assert.equal(unscopedWarFacts.length, 0, "a war without a character scope anchor remains unknown instead of becoming globally public");

  const selfWins = buildSubjectiveWorldView({
    responder: { id: "1" },
    candidates: [
      { factId: "old", entityId: "1", field: "NAME", value: "旧名", sourceTier: "PERSONAL_MEMORY", knowledgeLevel: "PERSONAL_MEMORY", ownerId: "1" },
      { factId: "self", entityId: "1", field: "NAME", value: "现名", sourceTier: "GAME_TRUTH", knowledgeLevel: "SELF", selfKnowledgeVerified: true }
    ],
    scope: { asOf: checkpointDate, completeness: "COMPLETE" }
  });
  assert.deepEqual(selfWins.allowedFacts.map((item) => item.value), ["现名"], "Current Self retains priority over stale memory");

  const future = buildSubjectiveWorldView({
    responder: { id: "1" },
    candidates: [{ factId: "future", entityId: "world", field: "WORLD_EVENT", value: "未来结局", sourceTier: "ANNUAL_DELTA", knowledgeLevel: "PUBLIC_WORLD", public: true, temporalSafe: false }],
    scope: { asOf: checkpointDate, completeness: "COMPLETE" }
  });
  assert(!JSON.stringify(future).includes("未来结局"), "temporal-unsafe history is excluded before production formatting");

  const legacy = buildHistoricalReferenceReplacement({ period: "宋", context: "背景", notableEvents: [], notableFigures: [] }, checkpointDate);
  assert.equal(legacy.period, "截至 1170 年的时代背景", "old custom templates can still read the legacy historicalReferenceInfo shape");
  assert.equal(typeof legacy.context, "string", "Phase B replacement is safe for templates without a new block");
  const beforeJingkang = buildHistoricalReferenceReplacement({ period: "旧时期", context: "靖康之变已经发生", notableEvents: ["靖康之变(1127)"], notableFigures: ["岳飞"] }, "1126.1.1");
  assert(!JSON.stringify(beforeJingkang).includes("靖康之变") && !JSON.stringify(beforeJingkang).includes("岳飞"), "future and undated legacy entries are excluded at the historical adapter boundary");
  assert.equal(buildHistoricalReferenceReplacement({ period: "旧时期", context: "旧背景", notableEvents: [], notableFigures: [] }, "bad-date"), null, "invalid checkpoint dates fail closed so the caller can use the compatible legacy fallback");

  class TemplateEngine {
    renderTemplateString(template, context) {
      return Handlebars.compile(template)({ ...context.character, ...context }, { allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true });
    }
  }
  class PromptScriptLoader {}
  const promptSettings = {
    mainTemplate: "LEGACY_CONTEXT={{gameData.historicalReferenceInfo.context}}\nLEGACY_EVENTS={{#each gameData.historicalReferenceInfo.notableEvents}}{{this}}{{/each}}\nEMPEROR={{gameData.currentEmperor}}",
    blocks: [
      { id: "main", type: "main", label: "Main", enabled: true, role: "system" },
      { id: "history", type: "history", label: "History", enabled: true, role: "system" }
    ],
    suffix: { enabled: false, template: "" }
  };
  const PromptBuilder = createPromptBuilder({
    TemplateEngine,
    PromptScriptLoader,
    promptConfigManager: { getDefaultMainTemplateContent: () => promptSettings.mainTemplate },
    settingsRepository: { getPromptSettings: () => promptSettings },
    path,
    TokenCounter: {
      estimateTokens: (value) => String(value || "").length,
      calculateTotalTokens: (messages) => messages.reduce((sum, message) => sum + String(message.content || "").length, 0)
    },
    createPromptFingerprint: (value) => String(value || ""),
    defaultChatInstruction: "回应"
  });
  const promptCharacter = { id: 1, shortName: "甲", firstName: "甲", fullName: "甲", age: 30, primaryTitle: "无", heldCourtAndCouncilPositions: "无", titleRankConcept: "concept_none" };
  const uninformedCharacter = { ...promptCharacter, id: 4, shortName: "丁", firstName: "丁", fullName: "丁" };
  const promptGameData = {
    characters: new Map([[1, promptCharacter], [4, uninformedCharacter]]),
    historicalReferenceInfo: { period: "旧时期", context: "旧背景不得进入生产 Prompt", notableEvents: ["旧未来事件不得进入生产 Prompt"], notableFigures: [] },
    currentEmperor: "未授权帝王",
    currentEmperorTitle: "未授权头衔",
    currentEraName: "未授权年号",
    getActiveParticipantRelationshipInfo: () => "",
    findMentionedCharacterIdsInHistory: () => [],
    getMentionedCharactersInfo: () => ""
  };
  const promptBuild = PromptBuilder.buildMessagesWithTokenCount(
    [{ role: "user", content: "乙在哪里" }],
    promptCharacter,
    promptGameData,
    "",
    { engineVersion: "2.5", activeParticipantIds: [1], stableText: "绝密计划正文", subjectiveWorldText: owner.worldText, historicalReferenceInfo: owner.historicalReferenceInfo }
  );
  const providerPrompt = promptBuild.messages.map((message) => message.content).join("\n");
  assert.equal(promptBuild.blocks.filter((entry) => entry.block.id === "worldline-subjective").length, 1, "the actual PromptBuilder emits exactly one Subjective World block");
  assert.equal((providerPrompt.match(/回应角色可知的世界事实/g) || []).length, 1, "the provider-visible Prompt contains the responder-scoped world context once");
  assert(!providerPrompt.includes("旧背景不得进入生产 Prompt") && !providerPrompt.includes("旧未来事件不得进入生产 Prompt"), "the provider-visible Prompt does not duplicate unfiltered legacy historical context");
  assert(!providerPrompt.includes("未授权帝王") && providerPrompt.includes("不得引用后续事件"), "unfiltered ruler fields are removed while the temporal replacement is rendered");
  assert(!["真实历史原本会", "你已经偏离史实", "历史上的你其实"].some((phrase) => providerPrompt.includes(phrase)), "the provider-visible Prompt contains no forbidden meta-history language");
  const uninformedPromptBuild = PromptBuilder.buildMessagesWithTokenCount(
    [{ role: "user", content: "乙在哪里" }],
    uninformedCharacter,
    promptGameData,
    "",
    { engineVersion: "2.5", activeParticipantIds: [4], subjectiveWorldText: uninformedPeer.worldText, historicalReferenceInfo: uninformedPeer.historicalReferenceInfo }
  );
  const uninformedProviderPrompt = uninformedPromptBuild.messages.map((message) => message.content).join("\n");
  assert(providerPrompt.includes("绝密计划正文") && !uninformedProviderPrompt.includes("绝密计划正文"), "same-court, same-realm, same-query responder B receives zero of responder A's secret in the actual PromptBuilder output");

  const performanceCandidates = Array.from({ length: 128 }, (_, index) => ({
    factId: `public:${index}`,
    entityId: `world:${index}`,
    field: "WORLD_EVENT",
    value: `公开事件 ${index}`,
    sourceTier: "ANNUAL_DELTA",
    knowledgeLevel: "PUBLIC_WORLD",
    public: true,
    temporalSafe: true
  }));
  const durations = [];
  for (const responderCount of [1, 3, 5, 10]) {
    for (const candidateCount of [10, 32, 64, 128]) {
      const startedAt = Date.now();
      for (let responder = 1; responder <= responderCount; responder += 1) {
        const view = buildSubjectiveWorldView({ responder: { id: String(responder) }, candidates: performanceCandidates.slice(0, candidateCount), scope: { asOf: checkpointDate, completeness: "COMPLETE" } });
        assert(view.allowedFacts.length <= 24, "production subjective output remains bounded at every responder/candidate matrix point");
      }
      durations.push(Date.now() - startedAt);
    }
  }
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.floor((durations.length - 1) * 0.95)];
  assert(p95 < 5000, `synthetic 1/3/5/10 x 10/32/64/128 policy p95 must stay bounded (${p95}ms)`);
  service.dispose();
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const conversationSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/conversation/conversation.js"), "utf8");
const builderSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/prompts/prompt-builder.js"), "utf8");
assert(conversationSource.includes("isSubjectivePromptIntegrationEnabled?.()") && conversationSource.includes("getSubjectivePromptContext({"), "production Conversation path is server-side and explicitly gated");
const productionStart = conversationSource.indexOf("isSubjectivePromptIntegrationEnabled?.()");
const productionEnd = conversationSource.indexOf("} else {", productionStart);
assert(productionStart >= 0 && productionEnd > productionStart && !conversationSource.slice(productionStart, productionEnd).includes("getPromptContext"), "production failure cannot fall back to unfiltered legacy recall");
assert(builderSource.includes('id: "worldline-subjective"') && builderSource.includes("historicalReferenceInfo: memoryContext.historicalReferenceInfo") && builderSource.includes("currentEmperor: null"), "PromptBuilder emits one responder-scoped block and replaces unfiltered legacy world fields");

console.log("V8.6 Terra Production Subjective Prompt: PASS (classification, Phase B replacement, production privacy and compatibility)");
