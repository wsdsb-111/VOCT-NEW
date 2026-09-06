"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");
const { buildWorldQueryPlan } = require("../resources/app/out/main/worldline/world-query-planner");
const { buildWorldCandidates } = require("../resources/app/out/main/worldline/world-retriever");
const { rankWorldCandidates } = require("../resources/app/out/main/worldline/world-ranker");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");
const { createPlayerWorldKnowledge } = require("../resources/app/out/main/worldline/world-presentation");
const { create: createPlayerPresentation } = require("../resources/app/out/renderer/worldline-player-presentation");

class SettingsFixture {
  constructor(autosavePath) {
    this.settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: true, lastValidatedAt: "fixture", lastValidationStatus: "VALID" };
  }
  getWorldlineSettings() { return this.settings; }
  saveWorldlineSettings(settings) { this.settings = settings; }
  getCK3DebugLogPath() { return null; }
}

function snapshot() {
  return {
    gameDate: "1155.1.1",
    playerId: "100",
    playthroughId: "terra-fixture",
    diagnostics: { characterCount: 2, activeWarCount: 1 },
    characters: {
      "100": { id: "100", firstName: "思昭", alive: true },
      "101": { id: "101", firstName: "Yuefei", fullName: "Yuefei", alive: true, location: "xiangyang" }
    },
    nameToCharacterIds: { yuefei: ["101"], "思昭": ["100"] },
    indexes: { verifiedFullNameToRuntimeIds: { "赵思昭": ["100"], yuefei: ["101"] }, givenNameToRuntimeIds: { "思昭": ["100"] } },
    definitionToRuntime: {},
    runtimeToDefinitions: {},
    titles: {},
    wars: {}
  };
}

const analysis = {
  resolvedCharacters: [{ id: "101", rawKey: "yuefei", displayName: "Yuefei", aliases: ["yuefei", "101"] }],
  resolvedTitles: [],
  candidateCharacters: [],
  candidateTitles: [],
  entityAnchoredTerms: ["yuefei"],
  identityResolution: { status: "RESOLVED", candidates: [] }
};
const plan = buildWorldQueryPlan({ query: "Yuefei在哪里", analysis });
assert.equal(plan.intent, "CHARACTER_LOCATION", "location wording with a resolved character must produce a character-location plan");
assert.deepEqual(plan.entities.characters, ["101"], "only resolved identities may become factual entity anchors");
assert.equal(buildWorldQueryPlan({ query: "今年发生了什么战争", analysis: { resolvedCharacters: [], resolvedTitles: [], candidateCharacters: [], candidateTitles: [] } }).broadWorldIntent, true, "broad current-events questions must explicitly opt into broad-world Delta retrieval");
assert.equal(buildWorldQueryPlan({ query: "岳飞还活着吗", analysis }).intent, "CHARACTER_STATE", "life-state wording must use the deterministic character-state intent");
assert.equal(buildWorldQueryPlan({ query: "谁拥有 h_china", analysis }).intent, "TITLE_HOLDER", "holder wording must use the title-holder intent without requiring a guessed title match");
assert.equal(buildWorldQueryPlan({ query: "1168 年某人物发生了什么", analysis }).intent, "HISTORY_LOOKUP", "explicit historical dates must use the history lookup intent");
assert.equal(buildWorldQueryPlan({ query: "思昭现在是谁的领主", analysis }).intent, "TITLE_HOLDER", "liege wording must remain within the bounded title-holder intent set");

const normalized = buildWorldCandidates({
  snapshot: snapshot(),
  analysis,
  annualDelta: [
    { id: "unrelated", type: "IMPORTANT_CHARACTER_DIED", date: "1155.1.1", source: "GAMESTATE", actors: [{ runtimeId: "999" }] },
    { id: "related", type: "WAR_NO_LONGER_ACTIVE", date: "1155.1.1", source: "DERIVED_GAMESTATE", actors: [{ runtimeId: "101" }] }
  ],
  supplemental: [
    { id: "public", title: "Yuefei note", body: "public", entities: ["yuefei"], visibility: "PUBLIC_WORLD", hidden: false },
    { id: "secret", title: "Yuefei secret", body: "secret", entities: ["yuefei"], visibility: "SECRET", hidden: false }
  ]
});
const ranked = rankWorldCandidates(normalized, { plan, checkpointDate: "1155.1.1" });
assert.equal(ranked.selected.delta.length, 1, "entity queries may select only the related Delta");
assert.equal(ranked.selected.delta[0].payload.id, "related", "the related Delta must win deterministic ranking");
assert.equal(ranked.selected.supplemental.length, 1, "public matching Supplemental may be selected");
assert.ok(ranked.trimmed.some((item) => item.id === "unrelated" && item.reason === "UNRELATED_DELTA"), "recent but unrelated Delta must be diagnosed and excluded");
assert.ok(ranked.trimmed.some((item) => item.id === "secret" && item.reason === "VISIBILITY_BLOCKED"), "non-public Supplemental must be blocked before ranking");
const historicalPlan = buildWorldQueryPlan({ query: "1168 年岳飞发生了什么", analysis });
const temporalRanked = rankWorldCandidates(normalized.filter((candidate) => candidate.category === "GAME_TRUTH"), { plan: historicalPlan, checkpointDate: "1155.1.1" });
assert.ok(temporalRanked.trimmed.some((item) => item.reason === "TEMPORAL_UNSAFE"), "current Checkpoint facts must not answer a different historical as-of date");

const playerKnowledge = createPlayerWorldKnowledge([{ id: "primary-title", field: "PRIMARY_TITLE", value: "h_china", displayName: "h_china", source: "GAME_TRUTH" }]);
assert.equal(playerKnowledge[0].value, "名称未解析", "Player DTO must never turn an unresolved raw title key into default player copy");

let reverseLookupCount = 0;
const playerQueryAnalysis = analyzeSharedQuery({
  snapshot: snapshot(),
  query: "赵思昭",
  findLocalizedKeys: () => {
    reverseLookupCount += 1;
    throw new Error("exact current-character matches must not scan localization files");
  }
});
assert.deepEqual(playerQueryAnalysis.resolvedCharacters.map((item) => item.id), ["100"], "a full player name query must retain the exact current-character match");
assert.equal(playerQueryAnalysis.resolverTrace.localization.status, "NOT_REQUIRED_ENTITY_MATCH", "exact entity matches must report that reverse localization lookup was skipped");
assert.equal(reverseLookupCount, 0, "exact current-character matches must not trigger expensive reverse localization scans");
const promptSummary = createPlayerPresentation("zh-CN").promptSummary({
  query: "赵思昭",
  queryAnalysis: { identityResolution: { status: "NO_MATCH", reason: "NO_HISTORICAL_ALIAS", candidates: [] }, resolvedCharacters: [{ id: "100", displayName: "思昭" }], resolvedTitles: [], candidateCharacters: [], candidateTitles: [] },
  gameTruth: { characters: [{ id: "100" }], titles: [] },
  supplemental: [],
  worldPromptTokens: 325
});
assert.equal(promptSummary.identity, "已确认身份", "prompt diagnostics must distinguish a resolved current character from a missing historical alias");
assert.equal(promptSummary.candidateCount, 1, "prompt diagnostics must count the resolved current character");
assert.equal(promptSummary.recognizedObject, "思昭", "prompt diagnostics must show the readable resolved object");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v85-terra-retrieval-"));
try {
  const autosavePath = path.join(tempRoot, "autosave.ck3");
  fs.writeFileSync(autosavePath, "fixture", "utf8");
  const service = new WorldlineService({ settingsRepository: new SettingsFixture(autosavePath), dataDir: tempRoot, stabilityDelayMs: 0 });
  service.currentCheckpoint = { id: "fixture-checkpoint", source: { path: autosavePath }, snapshot: snapshot() };
  service.buildState = "ACTIVE";
  service.getLiveState = () => ({ connected: true, gameDate: "1155.1.1", totalDays: 1, characters: [] });
  const promptSnapshot = service.currentCheckpoint.snapshot;
  const historyDefinitions = {};
  for (let index = 0; index < 600; index += 1) historyDefinitions[`fixture_definition_${index}`] = String(2000 + index);
  historyDefinitions.nansong_yue_085 = "96896";
  historyDefinitions.tangyin_yue_014 = "96895";
  service.currentCheckpoint.snapshot = { ...promptSnapshot, definitionToRuntime: historyDefinitions, runtimeToDefinitions: { "96896": ["nansong_yue_085"], "96895": ["tangyin_yue_014"] } };
  const allBindings = service.getHistoricalBindings();
  assert.equal(allBindings.total, 602, "historical binding totals must cover the complete definition index");
  assert.equal(allBindings.bindings.length, 500, "unfiltered historical bindings may remain UI-bounded");
  const yuefeiBindings = service.getHistoricalBindings({ query: "岳飞" });
  assert.equal(yuefeiBindings.total, 2, "historical search must find Yue Fei definitions beyond the first UI page");
  assert.deepEqual(yuefeiBindings.bindings.map((item) => item.historicalName), ["岳飞", "岳飞"], "historical search results must expose readable historical names");
  service.currentCheckpoint.snapshot = promptSnapshot;
  service.annualDelta = [
    { id: "unrelated", campaignId: "terra-fixture", type: "IMPORTANT_CHARACTER_DIED", date: "1155.1.1", source: "GAMESTATE", actors: [{ runtimeId: "999" }] },
    { id: "related", campaignId: "terra-fixture", type: "WAR_NO_LONGER_ACTIVE", date: "1155.1.1", source: "DERIVED_GAMESTATE", actors: [{ runtimeId: "101" }] }
  ];
  service.worldKnowledgeState.currentCampaignDeltaRevision = 1;
  service.supplemental = [1, 2, 3, 4].map((id) => ({ id: `supp-${id}`, checkpointId: "fixture-checkpoint", title: `Yuefei note ${id}`, body: "Yuefei ".repeat(550), entities: ["yuefei"], visibility: "PUBLIC_WORLD", importance: "HIGH", hidden: false }));

  const first = service.getPromptContext({ query: "Yuefei在哪里" });
  assert.equal(first.queryPlan.intent, "CHARACTER_LOCATION", "Prompt diagnostics must expose the deterministic query plan");
  assert.match(first.currentText, /战争已不再出现在活跃战争记录中/, "selected uncertain War Delta must preserve its non-fabricated conclusion");
  assert.doesNotMatch(first.currentText, /IMPORTANT_CHARACTER_DIED/, "unrelated recent Delta must not be injected into the current world block");
  assert.ok(first.retrieval.trimmedItems.some((item) => item.reason === "UNRELATED_DELTA"), "retrieval diagnostics must retain unrelated-Delta trim reasons");
  assert.ok(first.retrieval.trimmedItems.some((item) => item.reason === "TOKEN_BUDGET"), "oversized Supplemental facts must be trimmed before Prompt injection");
  assert.ok(first.retrieval.worldPromptTokens <= first.retrieval.targetTokenBudget, "the selected recall must stay within its deterministic token target");
  assert.equal(first.cacheHit, false, "the first topic recall is a cache miss");

  const second = service.getPromptContext({ query: "Yuefei在哪里" });
  assert.equal(second.cacheHit, true, "unchanged campaign revision must reuse the topic cache");
  service.supplemental.push({ id: "unrelated-supp", checkpointId: "fixture-checkpoint", title: "Unrelated note", body: "No matching entity", entities: [], visibility: "PUBLIC_WORLD", importance: "NORMAL", hidden: false });
  const unrelatedSupplementalUpdate = service.getPromptContext({ query: "Yuefei在哪里" });
  assert.equal(unrelatedSupplementalUpdate.cacheHit, true, "unrelated Supplemental updates must not invalidate an entity-specific topic cache");
  service.supplemental[0] = { ...service.supplemental[0], body: `${service.supplemental[0].body} revised` };
  const relevantSupplementalUpdate = service.getPromptContext({ query: "Yuefei在哪里" });
  assert.equal(relevantSupplementalUpdate.cacheHit, false, "relevant Supplemental updates must invalidate the affected topic cache");
  service.worldKnowledgeState.currentCampaignDeltaRevision += 1;
  const revisionChanged = service.getPromptContext({ query: "Yuefei在哪里" });
  assert.equal(revisionChanged.cacheHit, false, "current-campaign Delta revision must invalidate topic retrieval without depending on global Delta length");

  const diagnostics = service.getPromptDiagnostics({ query: "Yuefei在哪里" }).promptDiagnostics;
  assert.equal(diagnostics.queryPlan.intent, "CHARACTER_LOCATION", "Prompt diagnostics must keep the query plan visible to developers");
  assert.ok(diagnostics.trimmedItems.some((item) => item.reason === "TOKEN_BUDGET"), "diagnostics must expose token-budget trims");
  service.dispose();
  console.log("V8.5 Terra Retrieval: PASS (plan, visibility, ranked Delta/Supplemental, cache revision, token budget and Player DTO boundary)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
