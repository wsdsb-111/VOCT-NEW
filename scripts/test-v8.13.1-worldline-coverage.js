"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const mainDir = path.resolve(__dirname, "../resources/app/out/main");
const { buildSubjectiveWorldBaselinePrompt } = require(path.join(mainDir, "worldline/subjective-prompt-context"));
const { buildFrozenCoverageManifest, hasFrozenCoverage, buildCoveragePatchKey } = require(path.join(mainDir, "worldline/frozen-coverage-manifest"));
const { WorldlineService } = require(path.join(mainDir, "worldline/worldline-service"));
const { Conversation } = require(path.join(mainDir, "conversation/conversation"));
const { buildSubjectiveWorldView } = require(path.join(mainDir, "worldline/subjective-world-builder"));
const { parseGameState } = require(path.join(mainDir, "worldline/game-state-adapter"));

const fact = (factId, entityId, field, value, queryPriority = 0) => ({ factId, entityId, field, value, sourceTier: "GAME_TRUTH", queryPriority });
const promptFacts = [
  ...Array.from({ length: 15 }, (_, i) => fact(`identity-${i}`, String(i + 1), "IDENTITY", `人物 ${i}`, 90 - i)),
  fact("war-1", "war-1", "WAR", "当前北境战争", 1),
  fact("loc-1", "1", "LOCATION", "赵甲位于临安", 1),
  fact("alive-1", "1", "ALIVE", "赵甲在世", 1),
  fact("title-1", "1", "PRIMARY_TITLE", "赵甲持有临安", 1)
];
const baseline = buildSubjectiveWorldBaselinePrompt({ responderId: "1", checkpointId: "cp-1", promptFacts, candidateSetComplete: false }, { tokenBudget: 900 });
assert(baseline.text.includes("当前北境战争"), "war lane must survive high-priority identity facts");
assert(baseline.text.includes("赵甲位于临安"), "location lane must survive high-priority identity facts");
assert(baseline.tokens <= 900);
const manifest = buildFrozenCoverageManifest({ responderId: "1", checkpointId: "cp-1", candidateSetComplete: false }, baseline.selectedFacts);
const plan = (intent, characters = [], timeMode = "CURRENT") => ({ intent, entities: { characters, titles: [], realms: [], wars: [] }, eventTypes: [], time: { mode: timeMode } });
assert(hasFrozenCoverage({ queryPlan: plan("WAR_STATUS"), manifest }).hit, "broad war hit");
const scopedWar = buildFrozenCoverageManifest({ responderId: "1", checkpointId: "cp-1" }, [{ ...fact("world:war:9:WAR", "war:9", "WAR", "甲乙之战"), scopeEntityIds: ["2", "3"], scopeTitleIds: ["100"] }]);
assert(hasFrozenCoverage({ queryPlan: plan("WAR_STATUS", ["2"]), manifest: scopedWar }).hit, "named war participant hit");
assert(!hasFrozenCoverage({ queryPlan: plan("WAR_STATUS", ["4"]), manifest: scopedWar }).hit, "other war participant miss");
assert(hasFrozenCoverage({ queryPlan: plan("CHARACTER_LOCATION", ["1"]), manifest }).hit, "known location hit");
assert(!hasFrozenCoverage({ queryPlan: plan("CHARACTER_LOCATION", ["2"]), manifest }).hit, "entity-specific miss");
assert(!hasFrozenCoverage({ queryPlan: plan("CHARACTER_STATE", ["2"]), manifest }).hit, "state miss");
assert.strictEqual(buildCoveragePatchKey({ responderId: "1", checkpointId: "cp-1", queryPlan: plan("CHARACTER_LOCATION", ["2"]) }), buildCoveragePatchKey({ responderId: "1", checkpointId: "cp-1", queryPlan: plan("CHARACTER_LOCATION", ["2"]) }));
assert(!hasFrozenCoverage({ queryPlan: plan("CHARACTER_LOCATION", ["1"], "AS_OF"), manifest }).eligible, "historical query stays separate");

const snapshot = { gameDate: "1162.5.19", playerId: "1", characters: {
  1: { id: "1", firstName: "甲", spouse: "2", parents: {}, children: [], location: "临安" },
  2: { id: "2", firstName: "乙", parents: {}, children: [], location: "建康" },
  3: { id: "3", firstName: "丙", parents: {}, children: [], location: "襄阳" }
}, titles: {}, wars: { 9: { attacker: ["2"], defender: ["3"], startDate: "1162.1.1" } } };
const baselineService = { currentCheckpoint: { snapshot }, _currentCampaignDelta: () => [], _activeLegacySupplemental: () => [] };
const baselineCandidates = WorldlineService.prototype._baselinePolicyFacts.call(baselineService, "1", ["1", "2"]);
assert(baselineCandidates.some((item) => item.field === "WAR"), "opening candidate pipeline must include active wars even without a war query");
assert(baselineCandidates.some((item) => item.entityId === "2" && item.field === "LOCATION"), "selected waiting NPC enters opening work set");
const aclView = buildSubjectiveWorldView({ responder: { id: "1" }, candidates: baselineCandidates,
  scope: { sameCourt: true, sameRealm: true, asOf: snapshot.gameDate, verificationMode: "CHECKPOINT", completeness: "COMPLETE" },
  scopeResolver: (item) => ({ closeKnowledge: item.entityId === "2" ? "SPOUSE" : null }), snapshotMode: "CONVERSATION_BASELINE" });
assert(aclView.promptFacts.some((item) => item.entityId === "2" && item.field === "LOCATION"));
assert(!aclView.promptFacts.some((item) => item.entityId === "3" && item.field === "LOCATION"), "unrelated whereabouts remain ACL-denied");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8131-coverage-"));
try {
  const autosavePath = path.join(tempRoot, "autosave.ck3");
  const parsed = parseGameState(`date=1150.1.1 played_character=1
living={1={first_name="甲"} 2={first_name="乙" landed_data={domain={100}}} 3={first_name="丙" alive_data={location="秘密营地"} landed_data={domain={200}}}}
landed_titles={100={key="k_east" holder=2} 200={key="k_west" holder=3}}
wars={active_wars={9={start_date=1149.1.1 attacker={character=2} defender={character=3}}}}`);
  const settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION", lastValidationStatus: "VALID" };
  const service = new WorldlineService({ dataDir: tempRoot, settingsRepository: { getWorldlineSettings: () => settings, saveWorldlineSettings: next => Object.assign(settings, next), getCK3DebugLogPath: () => null } });
  service.currentCheckpoint = { id: "cp-war", source: { path: autosavePath }, snapshot: parsed };
  service.buildState = "ACTIVE";
  service.getLiveState = () => ({ connected: false, gameDate: null, characters: [] });
  const opening = service.getSubjectivePromptContext({ responderId: 2, query: "", activeParticipantIds: [2], conversationId: "fixture", snapshotMode: "CONVERSATION_BASELINE", tokenBudget: 900 });
  assert(opening?.baselineFacts?.some((item) => item.field === "WAR"), "real service baseline must admit current war without a war query");
  assert(opening.worldTurnRecallText.includes("正在交战"));
  assert(opening.worldTurnRecallTokens <= 900);
  const unknownLocation = service.getSubjectiveCoveragePatch({ responderId: 2, query: "丙现在在哪里？", mentionedEntityIds: [3], tokenBudget: 300 });
  assert(!unknownLocation?.patchText?.includes("秘密营地"), "coverage patch cannot bypass location ACL");
  const observedLocation = service.getSubjectiveCoveragePatch({ responderId: 2, query: "丙现在在哪里？", mentionedEntityIds: [3], tokenBudget: 300,
    directObservationFactIds: ["seen-3"], directObservationFacts: [{ factId: "seen-3", entityId: "3", field: "LOCATION", value: "亲眼见丙在厅堂", sourceTier: "GAME_TRUTH", knowledgeLevel: "DIRECT_OBSERVATION", directObserverIds: ["2"], temporalSafe: true, asOf: parsed.gameDate }] });
  assert(observedLocation?.patchText?.includes("亲眼见丙在厅堂"), "authorized direct observation may enter dynamic patch");
  assert(!observedLocation.patchText.includes("秘密营地"), "direct observation must suppress conflicting old checkpoint location");
  service.dispose();
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const patchService = {
  isSubjectivePromptIntegrationEnabled: () => true,
  getSubjectiveWorldView: ({ responderId }) => ({ checkpointId: "cp-1", cacheHit: false, filteredCount: responderId === 2 ? 1 : 0,
    secretBlockedCount: responderId === 2 ? 1 : 0, promptFacts: responderId === 2 ? [] : [
      fact("title-1", "1", "PRIMARY_TITLE", "赵甲持有临安"), fact("loc-1", "1", "LOCATION", "赵甲位于临安")
    ] })
};
const allowedPatch = WorldlineService.prototype.getSubjectiveCoveragePatch.call(patchService, { responderId: 1, excludeFactIds: ["title-1"], missingFields: [{ entityId: "1", field: "LOCATION" }], tokenBudget: 300 });
assert(allowedPatch.patchText.includes("赵甲位于临安") && !allowedPatch.patchText.includes("赵甲持有临安"), "only missing Fact IDs enter dynamic patch");
assert(allowedPatch.patchText.includes("不是刚刚发生"));
const deniedPatch = WorldlineService.prototype.getSubjectiveCoveragePatch.call(patchService, { responderId: 2, missingFields: [{ entityId: "1", field: "LOCATION" }], tokenBudget: 300 });
assert.strictEqual(deniedPatch.patchText, null, "ACL-denied fact must not enter patch");

let retrievalCount = 0;
let checkpointId = "cp-1";
const worldlineService = {
  isSubjectivePromptIntegrationEnabled: () => true,
  getCheckpointStatus: () => ({ checkpoint: { id: checkpointId } }),
  getPromptContext: ({ query }) => ({ queryPlan: plan("CHARACTER_LOCATION", ["2"], query.includes("五年前") ? "AS_OF" : "CURRENT") }),
  getSubjectiveCoveragePatch: () => { retrievalCount += 1; return { patchText: "角色 2 位于临安", patchFacts: [fact("loc-2", "2", "LOCATION", "角色 2 位于临安")], patchTokens: 30 }; }
};
Conversation.configure({ worldlineService, usageAnalytics: { record: () => {} } });
const conversation = Object.create(Conversation.prototype);
conversation.id = "coverage-fixture";
conversation.gameData = { date: "1162.5.19", scene: "宫廷", campaignToken: "campaign-1", characters: new Map([[1, { id: 1 }], [2, { id: 2 }]]) };
conversation.gameDataRevision = 1;
conversation.presentCharacterIds = new Set([1]);
conversation.getActiveConversationCharacters = () => [{ id: 1 }];
conversation.frozenWorldlineCoverageByResponder = new Map([["1", buildFrozenCoverageManifest({ responderId: 1, checkpointId: "cp-1" }, [fact("loc-1", "1", "LOCATION", "角色 1 位于临安")])]]);
conversation.worldlineCoveragePatchCacheByResponder = new Map();
conversation.turnEpoch = 1;
const npc = { id: 1 };
assert(conversation.getWorldlineCoveragePatchFor(npc, { worldlineRequest: { query: "赵甲现在在哪里？" } }));
assert(conversation.getWorldlineCoveragePatchFor(npc, { worldlineRequest: { query: "赵甲现在又在哪里？" } }));
assert.strictEqual(retrievalCount, 1, "same intent and entity reuse patch without raw-query key");
conversation.getWorldlineCoveragePatchFor(npc, { worldlineRequest: { query: "赵甲现在在哪里？" }, confirmedActionText: "CK3 已确认变化" });
assert.strictEqual(retrievalCount, 2, "confirmed action invalidates patch cache");
checkpointId = "cp-2";
conversation.getWorldlineCoveragePatchFor(npc, { worldlineRequest: { query: "赵甲现在在哪里？" }, confirmedActionText: "CK3 已确认变化" });
assert.strictEqual(retrievalCount, 3, "checkpoint change invalidates patch cache and frozen coverage decision");
assert.strictEqual(conversation.getWorldlineCoveragePatchFor(npc, { worldlineRequest: { query: "五年前赵甲在哪里？" } }), null);
assert.strictEqual(retrievalCount, 3, "historical query never triggers coverage patch");

console.log("V8.13.1 Worldline Coverage: PASS (baseline diversity, entity-field manifest, time routing)");
