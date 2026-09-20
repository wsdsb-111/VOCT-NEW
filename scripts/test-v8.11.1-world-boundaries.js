"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const main = "../resources/app/out/main/";
const { WorldlineService } = require(main + "worldline/worldline-service");
const { closeKnowledge } = require(main + "worldline/knowledge-scope-resolver");
const { parseGameState } = require(main + "worldline/game-state-adapter");
const { buildWorldQueryPlan } = require(main + "worldline/world-query-planner");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8111-world-"));
const autosavePath = path.join(root, "autosave.ck3");
const snapshot = parseGameState(`date=1150.6.1 played_character=1
living={
1={first_name="应答者" court_data={employer=10} family_data={spouse=80} alive_data={location=9847}}
10={first_name="宋帝"} 20={first_name="金帝"}
80={first_name="岳飞" court_data={employer=10} family_data={spouse=1} alive_data={location="秘密军营"}}
81={first_name="韩世忠" court_data={employer=10} alive_data={location="秘密驿站"}}
82={first_name="李纲" court_data={employer=10} alive_data={location="秘密府邸"}}
83={first_name="无关人" court_data={employer=10}}
}
landed_titles={100={key="h_china" holder=10 title_name_data={name="宋"}} 200={key="e_jin" holder=20 title_name_data={name="金"}}}
wars={active_wars={501={attacker={character=20} defender={character=10}}}}
`);
snapshot.verifiedFullNameToRuntimeIds = { "岳飞": ["80"], "韩世忠": ["81"], "李纲": ["82"] };
snapshot.wars[502] = { attacker: [], defender: ["10"] };
const settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION", lastValidationStatus: "VALID" };
const service = new WorldlineService({ dataDir: root, settingsRepository: { getWorldlineSettings: () => settings, saveWorldlineSettings: value => Object.assign(settings, value), getCK3DebugLogPath: () => null } });
service.currentCheckpoint = { id: "fixture", source: { path: autosavePath }, snapshot };
service.buildState = "ACTIVE";
service.getLiveState = () => ({ connected: false, gameDate: null, characters: [] });
service.localizationResolver.resolve = (_type, key) => ({ localizedValue: key });
service.localizationResolver.findRawKeysByLocalizedValue = () => ({ status: "NO_MATCH", matches: [], sourceComplete: true });
const runtimeGameData = { playerID: 1, characters: new Map([[1, { id: 1, spouses: [], formerSpouses: [80] }], [80, { id: 80, spouses: [] }]]) };
const recall = (query, extra = {}) => service.getSubjectivePromptContext({ responderId: 1, query, runtimeGameData, activeParticipantIds: [1], conversationId: "fixture", turnEpoch: 1, tokenBudget: 1200, ...extra });
const seen = (id, place, observerId = "1") => ({ factId: `seen-${id}`, entityId: String(id), field: "LOCATION", value: `${id}亲眼所见在${place}`, sourceTier: "GAME_TRUTH", knowledgeLevel: "DIRECT_OBSERVATION", directObserverIds: [observerId], temporalSafe: true, asOf: snapshot.gameDate });

try {
  assert.equal(closeKnowledge(snapshot, "1", "80", null), null, "checkpoint spouse alone cannot authorize location");
  assert(!recall("岳飞在哪里").worldTurnRecallText.includes("秘密军营"));
  runtimeGameData.characters.set(1, { id: 1, spouses: [80] });
  assert(recall("岳飞在哪里").worldTurnRecallText.includes("秘密军营"));
  runtimeGameData.characters.set(1, { id: 1, spouses: [], formerSpouses: [80] });
  assert(!recall("岳飞在哪里").worldTurnRecallText.includes("秘密军营"), "same-turn divorce must revoke cached authorization");
  runtimeGameData.characters.set(80, { id: 80, relationsToPlayer: ["丈夫"] });
  assert.equal(closeKnowledge(snapshot, "1", "80", runtimeGameData), null, "conflicting ex-spouse evidence fails closed");
  runtimeGameData.characters.set(1, { id: 1, spouses: [] });
  assert.equal(closeKnowledge(snapshot, "1", "80", runtimeGameData), "SPOUSE");
  runtimeGameData.characters.set(80, { id: 80, relationsToPlayer: [] });
  const observed = recall("岳飞、韩世忠、李纲现在都在哪里", { directObservationFacts: [seen(80, "厅堂"), seen(81, "庭院"), seen(83, "无关秘密"), seen(82, "别人看见", "2")] });
  assert(observed.worldTurnRecallText.includes("厅堂") && observed.worldTurnRecallText.includes("庭院"));
  for (const value of ["秘密军营", "秘密驿站", "秘密府邸", "无关秘密", "别人看见"]) assert(!observed.worldTurnRecallText.includes(value));
  assert(observed.worldTurnRecallText.includes("行踪回答边界"));
  const broad = recall("最近有哪些战争", { directObservationFacts: [seen(83, "无关秘密")] });
  assert(!broad.worldTurnRecallText.includes("无关秘密"), "broad query cannot admit arbitrary observed entities");
  const self = service._selfPolicyFacts(snapshot, "1");
  assert(self.find(fact => fact.field === "LOCATION").value.includes("地名未解析"));
  assert(self.find(fact => fact.field === "COURT_EMPLOYER").value.includes("宋帝"));
  assert(self.find(fact => fact.field === "ALIVE"));
  for (const query of ["1150年宋金现在还在打吗", "1150.6.1宋金正在打仗吗"]) {
    const result = recall(query);
    assert(result.worldTurnRecallText.includes("正在交战"), query);
    assert.equal(buildWorldQueryPlan({ query, checkpointDate: snapshot.gameDate }).intent, "WAR_STATUS");
  }
  for (const query of ["1149年宋金现在还在打吗", "1150.1.1宋金正在打仗吗", "1150年2月宋金正在打仗吗", "1151年宋金现在还在打吗"]) {
    assert.equal(buildWorldQueryPlan({ query, checkpointDate: snapshot.gameDate }).intent, "HISTORY_LOOKUP");
    assert(!recall(query).worldTurnRecallText?.includes("正在交战"));
  }
  assert.equal(buildWorldQueryPlan({ query: "1150年宋金的战争", checkpointDate: snapshot.gameDate }).intent, "HISTORY_LOOKUP");
  assert.equal(buildWorldQueryPlan({ query: "1150年宋金的战争", assistContext: "现在的战况", checkpointDate: snapshot.gameDate }).intent, "HISTORY_LOOKUP");
  assert.equal(buildWorldQueryPlan({ query: "1150年岳飞现在在哪", analysis: { resolvedCharacters: [{ id: "80" }] }, checkpointDate: snapshot.gameDate }).intent, "CHARACTER_LOCATION");
  assert.equal(buildWorldQueryPlan({ query: "1150年岳飞现在还活着吗", analysis: { resolvedCharacters: [{ id: "80" }] }, checkpointDate: snapshot.gameDate }).intent, "CHARACTER_STATE");
  const context = service.getPromptContext({ query: "正在打什么战争" });
  assert(context.retrieval.trimmedItems.some(item => item.id === "war:502" && item.reason === "WAR_SKIPPED_NO_RUNTIME_ACTOR"));
  console.log("V8.11.1 World Boundaries: PASS (runtime marriage/revocation, multi-subject observation, self truth, explicit current-year queries, skipped war diagnostics)");
} finally {
  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
}
