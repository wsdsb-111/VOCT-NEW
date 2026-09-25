"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const mainDir = path.resolve(__dirname, "../resources/app/out/main");
const { INTENTS, buildWorldQueryPlan } = require(path.join(mainDir, "worldline/world-query-planner"));
const { buildFrozenCoverageManifest, hasFrozenCoverage } = require(path.join(mainDir, "worldline/frozen-coverage-manifest"));
const { buildSubjectiveWorldBaselinePrompt } = require(path.join(mainDir, "worldline/subjective-prompt-context"));
const { WorldlineService } = require(path.join(mainDir, "worldline/worldline-service"));
const { parseGameState } = require(path.join(mainDir, "worldline/game-state-adapter"));

const plan = (intent, requestedFields, characters = []) => ({ intent, requestedFields,
  entities: { characters, titles: [], realms: [], wars: [] }, eventTypes: [], time: { mode: "CURRENT" } });
const fact = (factId, entityId, field, value) => ({ factId, entityId, field, value, sourceTier: "GAME_TRUTH" });

const overviewPlan = buildWorldQueryPlan({ query: "岳飞怎么样？", analysis: { resolvedCharacters: [{ id: 12 }] }, checkpointDate: "1162.5.19" });
assert.equal(overviewPlan.intent, INTENTS.CHARACTER_OVERVIEW);
assert.deepEqual(overviewPlan.requestedFields, ["IDENTITY", "ALIVE", "PRIMARY_TITLE"]);
const overviewFacts = [fact("name", "12", "IDENTITY", "岳飞"), fact("alive", "12", "ALIVE", false), fact("title", "12", "PRIMARY_TITLE", 0)];
const fullManifest = buildFrozenCoverageManifest({ responderId: "12", checkpointId: "cp", candidateSetComplete: true }, overviewFacts);
assert.equal(hasFrozenCoverage({ queryPlan: overviewPlan, manifest: fullManifest }).hit, true, "false and zero-valued game facts still count as known");
const incompleteManifest = buildFrozenCoverageManifest({ responderId: "12", checkpointId: "cp", candidateSetComplete: true }, overviewFacts.slice(0, 1));
assert.deepEqual(hasFrozenCoverage({ queryPlan: overviewPlan, manifest: incompleteManifest }).missingFields.map(item => item.field), ["ALIVE", "PRIMARY_TITLE"]);

const warPlan = plan("WAR_STATUS", ["WAR"]);
const recentPlan = plan("WORLD_RECENT", ["WORLD_EVENT"]);
const incompleteLanes = buildFrozenCoverageManifest({ responderId: "12", checkpointId: "cp", candidateSetComplete: true,
  laneCoverage: { WAR: { candidateCount: 4, selectedCount: 3, complete: false }, WORLD_EVENT: { candidateCount: 2, selectedCount: 1, complete: false } } }, []);
assert.equal(hasFrozenCoverage({ queryPlan: warPlan, manifest: incompleteLanes }).hit, false, "partial war candidates cannot be mistaken for complete broad coverage");
assert.equal(hasFrozenCoverage({ queryPlan: recentPlan, manifest: incompleteLanes }).hit, false, "partial recent-event candidates cannot be mistaken for complete broad coverage");
const completeLanes = buildFrozenCoverageManifest({ responderId: "12", checkpointId: "cp", candidateSetComplete: true,
  laneCoverage: { WAR: { candidateCount: 0, selectedCount: 0, complete: true }, WORLD_EVENT: { candidateCount: 0, selectedCount: 0, complete: true } } }, []);
assert.equal(hasFrozenCoverage({ queryPlan: warPlan, manifest: completeLanes }).hit, true, "complete empty lane proves there are no active wars");
assert.equal(hasFrozenCoverage({ queryPlan: recentPlan, manifest: completeLanes }).hit, true, "complete empty lane proves there are no recent world events");
const scopedWar = buildFrozenCoverageManifest({ responderId: "12", checkpointId: "cp", candidateSetComplete: true,
  laneCoverage: { WAR: { candidateCount: 4, selectedCount: 3, complete: false } } }, [{ ...fact("war-1", "war:1", "WAR", "甲乙之战"), scopeEntityIds: ["1", "2"] }]);
assert.equal(hasFrozenCoverage({ queryPlan: plan("WAR_STATUS", ["WAR"], ["1"]), manifest: scopedWar }).hit, true, "explicitly scoped fact can answer even when the broad lane is incomplete");

let patchSnapshotMode = null;
const observationPatch = WorldlineService.prototype.getSubjectiveCoveragePatch.call({
  isSubjectivePromptIntegrationEnabled: () => true,
  getSubjectiveWorldView: args => {
    patchSnapshotMode = args.snapshotMode;
    return { checkpointId: "cp", promptFacts: [{ ...fact("seen-2", "2", "PRESENCE", "本轮亲眼见乙在厅堂"), knowledgeLevel: "DIRECT_OBSERVATION" }] };
  }
}, { responderId: 1, query: "乙在哪里？", missingFields: [{ entityId: "2", field: "LOCATION" }], tokenBudget: 300 });
assert.equal(patchSnapshotMode, "CONVERSATION_BASELINE");
assert(observationPatch.patchText.includes("【本轮直接观察】"), "direct observation is labeled separately in a coverage patch");
assert(observationPatch.patchText.includes("其中可能包含本轮直接观察"), "patch header must not imply every fact was known at conversation start");

const baseline = buildSubjectiveWorldBaselinePrompt({ responderId: "12", candidateSetComplete: true,
  baselineLaneSourceCoverage: { WAR: { candidateCount: 4, selectedCount: 3, complete: false } },
  promptFacts: [fact("war-a", "war:a", "WAR", "战争甲"), fact("war-b", "war:b", "WAR", "战争乙"), fact("war-c", "war:c", "WAR", "战争丙")] }, { tokenBudget: 900 });
assert.equal(baseline.laneCoverage.WAR.complete, false, "source truncation must propagate to the frozen manifest");

const snapshot = parseGameState(`date=1162.5.19 played_character=1
living={1={first_name="甲"} 2={first_name="乙"} 3={first_name="丙"}}
wars={active_wars={9={start_date=1162.1.1 attacker={character=2} defender={character=3}} 10={start_date=1162.1.2 attacker={character=2} defender={character=3}} 11={start_date=1162.1.3 attacker={character=2} defender={character=3}} 12={start_date=1162.1.4 attacker={character=2} defender={character=3}}}}`);
const service = { currentCheckpoint: { snapshot }, _currentCampaignDelta: () => [], _activeLegacySupplemental: () => [] };
const baselineFacts = WorldlineService.prototype._baselinePolicyFacts.call(service, "2", ["2"]);
assert(baselineFacts.some(item => item.field === "WAR"), "opening baseline includes current active wars");
assert.equal(baselineFacts.laneCoverage?.WAR, undefined, "source coverage is carried separately from the facts to avoid leaking metadata into prompt facts");
assert.equal(baselineFacts.laneSourceCoverage?.WAR?.complete, false, "three selected wars out of four mark the war lane incomplete");
const serviceWarBaseline = buildSubjectiveWorldBaselinePrompt({ responderId: "2", candidateSetComplete: true,
  baselineLaneSourceCoverage: baselineFacts.laneSourceCoverage,
  promptFacts: baselineFacts.filter(item => item.field === "WAR").map(item => ({ ...item, sourceTier: "GAME_TRUTH" })) }, { tokenBudget: 900 });
const serviceWarManifest = buildFrozenCoverageManifest({ responderId: "2", candidateSetComplete: true, laneCoverage: serviceWarBaseline.laneCoverage }, serviceWarBaseline.selectedFacts);
assert.equal(hasFrozenCoverage({ queryPlan: warPlan, manifest: serviceWarManifest }).hit, false, "service-level source cap propagates through the frozen baseline into broad query miss");

console.log("V8.13.2 Worldline Closure: PASS (broad-lane completeness, overview field closure, false/zero facts, cache-source coverage)");
