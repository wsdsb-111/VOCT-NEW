"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseGameState } = require("../resources/app/out/main/worldline/game-state-adapter");
const { digest } = require("../resources/app/out/main/worldline/historical-query-projection");
const { TemporalArchiveStore } = require("../resources/app/out/main/worldline/temporal-archive-store");
const { HistoricalCheckpointIndex } = require("../resources/app/out/main/worldline/historical-checkpoint-index");
const { retrieveHistorical, getCharacterStateAt, getCharacterTimeline, getTitleTimeline, getWarTimeline } = require("../resources/app/out/main/worldline/historical-retriever");
const { buildHistoricalPrompt } = require("../resources/app/out/main/worldline/historical-prompt-context");
const { resolveHistoricalKnowledge } = require("../resources/app/out/main/worldline/historical-scope-resolver");
const { buildWorldQueryPlan, parseTimeHint } = require("../resources/app/out/main/worldline/world-query-planner");
const { WorldlineService, normalizeSettings } = require("../resources/app/out/main/worldline/worldline-service");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v812-history-"));
const dataDir = path.join(root, "service");
const archiveRoot = path.join(dataDir, "worldline-v8.12");
const autosavePath = path.join(dataDir, "autosave.ck3");
const branchId = `branch_${crypto.randomUUID()}`;
const campaignId = `campaign_${digest("part2-fixture")}`;
const scope = { campaignId, branchId, state: "SAME_BRANCH", token: "fixture-token" };

function save(date, variant) {
  const characterOne = variant === 1150
    ? 'dead_unprunable={1={first_name="岳飞" birth=1100.1.1 dead_data={date=1149.1.1} family_data={real_father=4} landed_data={domain={13} liege=5} court_data={employer=5}}}'
    : `living={1={first_name="岳飞" birth=1100.1.1 family_data={spouse=${variant === 1145 ? 2 : 0} real_father=4} alive_data={location=${variant === 1145 ? 100 : 200}} landed_data={domain={${variant === 1145 ? 11 : 13}} liege=${variant === 1145 ? 3 : 5}} court_data={employer=${variant === 1145 ? 3 : 5}}}
      2={first_name="乙" birth=1101.1.1 alive_data={location=100} court_data={employer=3}}
      3={first_name="宋主" birth=1080.1.1 alive_data={location=100} court_data={employer=3}}
      4={first_name="岳父" birth=1070.1.1 alive_data={location=900} court_data={employer=9}}
      5={first_name="新主" birth=1085.1.1 alive_data={location=200} court_data={employer=5}}
      6={first_name="路人" birth=1090.1.1 alive_data={location=800} court_data={employer=8}}}`;
  const otherLiving = variant === 1150 ? 'living={2={first_name="乙" birth=1101.1.1 alive_data={location=100} court_data={employer=3}} 3={first_name="宋主" birth=1080.1.1 alive_data={location=100} court_data={employer=3}} 4={first_name="岳父" birth=1070.1.1 alive_data={location=900} court_data={employer=9}} 5={first_name="新主" birth=1085.1.1 alive_data={location=200} court_data={employer=5}} 6={first_name="路人" birth=1090.1.1 alive_data={location=800} court_data={employer=5}}}' : "";
  const wars = variant === 1145
    ? 'wars={active_wars={10={attacker={character=1} defender={title=12} start_date=1144.1.1 name="宋金之战"} 20={attacker={faction=peasant_revolt title=999} defender={character=3} start_date=1145.1.1 name="民变"}}}'
    : variant === 1147
      ? 'wars={active_wars={20={attacker={title=11} defender={character=3} start_date=1145.1.1 name="民变"}}}'
      : 'wars={active_wars={30={attacker={character=5} defender={faction=north_rebels} start_date=1149.1.1 name="北地叛乱"}}}';
  return `date=${date} playthrough_id="part2-fixture" played_character=4 ${characterOne} ${otherLiving}
    landed_titles={11={key="k_song" holder=${variant === 1145 ? 1 : 2} de_facto_liege=${variant === 1150 ? 12 : 0} title_name_data={name="宋"}}
      12={key="k_jin" holder=3 de_facto_liege=0 title_name_data={name="金"}}
      13={key="d_lin_an" holder=1 de_facto_liege=11 title_name_data={name="临安"}}} ${wars}`;
}

function archiveInput(date, variant) {
  const snapshot = parseGameState(save(date, variant));
  return {
    checkpoint: { id: digest(`part2-fixture|${date}|${snapshot.contentFingerprint}`).slice(0, 24), state: "ACTIVE", snapshot, source: { path: autosavePath, fingerprint: snapshot.contentFingerprint } },
    scope,
    parserComplete: true,
    pipelineState: "ACTIVE",
    freshness: "FRESH",
    sourceMatches: true
  };
}

(async () => {
  let service;
  try {
    const store = new TemporalArchiveStore({ root: archiveRoot });
    const checkpoints = [archiveInput("1145.1.1", 1145), archiveInput("1147.1.1", 1147), archiveInput("1150.1.1", 1150)];
    checkpoints.forEach(input => assert.equal(store.commit(input).status, "COMMITTED"));

    assert.deepEqual(parseTimeHint("岳飞五年前在哪里", "1150.1.1"), { mode: "AS_OF", from: "1145.1.1", to: null, year: 1145, relativeYears: 5 });
    assert.deepEqual(parseTimeHint("过去十年有哪些战争", "1150.1.1"), { mode: "RANGE", from: "1140.1.1", to: "1150.1.1", year: null, relativeYears: 10 });
    const plan = buildWorldQueryPlan({ query: "岳飞五年前在哪里", checkpointDate: "1150.1.1", analysis: { resolvedCharacters: [{ id: "1" }] } });
    assert.equal(plan.time.mode, "AS_OF");
    assert.equal(plan.intent, "HISTORY_LOOKUP");
    const comparisonPlan = buildWorldQueryPlan({ query: "1150相比1149战争发生了什么变化", checkpointDate: "1150.1.1", analysis: {} });
    assert.deepEqual([comparisonPlan.time.from, comparisonPlan.time.to, comparisonPlan.time.toClampedToCheckpoint], ["1149.1.1", "1150.1.1", true]);
    assert.equal(parseTimeHint("岳飞什么时候获得这个头衔", "1150.1.1").openStart, true);

    const exact = retrieveHistorical({ store, scope, queryPlan: { ...plan, time: { mode: "AS_OF", from: "1145.6.3", to: null }, entities: plan.entities }, query: "岳飞在哪里", currentDate: "1150.1.1", responderId: "4" });
    assert(exact.success);
    assert.equal(exact.diagnostics.checkpointDate, "1145.1.1");
    assert(exact.diagnostics.temporalDistance > 0);
    assert(exact.selected.some(item => item.field === "LOCATION" && item.value === "100"));
    const mixedFields = retrieveHistorical({ store, scope, queryPlan: { ...plan, time: { mode: "AS_OF", from: "1145.1.1", to: null } }, query: "岳飞在哪里以及有什么头衔", currentDate: "1150.1.1", responderId: "4" });
    assert(mixedFields.selected.some(item => item.field === "LOCATION"));
    assert(mixedFields.selected.some(item => item.field === "TITLE_IDS"));
    assert.equal(getCharacterStateAt({ store, scope, characterId: "1", asOf: "1140.1.1", currentDate: "1150.1.1" }).reason, "HISTORY_UNAVAILABLE");
    assert.equal(getCharacterStateAt({ store, scope, characterId: "1", asOf: "1160.1.1", currentDate: "1150.1.1" }).reason, "HISTORY_FUTURE_BLOCKED");
    assert.equal(getCharacterStateAt({ store, scope, characterId: "999", asOf: "1145.1.1", currentDate: "1150.1.1" }).reason, "HISTORY_ENTITY_NOT_PRESENT");
    assert(getCharacterStateAt({ store, scope, characterId: "1", asOf: "1150.1.1", currentDate: "1150.1.1", responderId: "4" }).selected.some(item => item.field === "LIFE_STATUS" && item.value === "DEAD"));

    const projection1145 = store.read(scope, checkpoints[0].checkpoint.id);
    assert.equal(projection1145.characters["1"].primaryTitleId, null, "domain title order must not masquerade as primary title");
    assert.deepEqual(projection1145.characters["1"].titleIds, ["11"]);
    assert.equal(projection1145.wars[10].defenderActors[0].type, "TITLE");
    assert.equal(projection1145.wars[20].attackerActors[0].type, "FACTION");
    assert(projection1145.wars[20].attackerActors.some(actor => actor.type === "UNKNOWN" && actor.opaqueId === "999"));
    assert.equal(resolveHistoricalKnowledge({ projection: projection1145, responderId: "4", subjectId: "1", field: "LOCATION" }).reason, "HISTORICAL_BLOOD_KINSHIP");
    assert.equal(resolveHistoricalKnowledge({ projection: projection1145, responderId: "3", subjectId: "1", field: "LOCATION" }).decision, "DENY", "same court cannot reveal exact location");
    assert.equal(resolveHistoricalKnowledge({ projection: projection1145, responderId: "3", subjectId: "1", field: "COURT_EMPLOYER" }).reason, "HISTORICAL_COURT");
    assert.equal(resolveHistoricalKnowledge({ projection: projection1145, responderId: "6", subjectId: "1", field: "LOCATION" }).decision, "DENY", "current friendship must never authorize a past private location");
    const genericMemory = retrieveHistorical({ store, scope, queryPlan: { ...plan, time: { mode: "AS_OF", from: "1145.1.1", to: null }, entities: plan.entities }, query: "岳飞在哪里", currentDate: "1150.1.1", responderId: "6", memoryFacts: [{ ownerId: "6", knownBy: ["6"], participantIds: ["1"], asOf: "1144.1.1" }] });
    assert(!genericMemory.selected.some(item => item.knowledgeReason === "HISTORICAL_PERSONAL_MEMORY"), "generic narrative memory must not reveal private historical location");
    const remembered = retrieveHistorical({ store, scope, queryPlan: { ...plan, time: { mode: "AS_OF", from: "1145.1.1", to: null }, entities: plan.entities }, query: "岳飞在哪里", currentDate: "1150.1.1", responderId: "6", memoryFacts: [{ ownerId: "6", knownBy: ["6"], entityId: "1", field: "LOCATION", value: "100", structured: true, sourceTier: "PERSONAL_MEMORY", asOf: "1144.1.1" }] });
    assert(remembered.selected.some(item => item.field === "LOCATION" && item.knowledgeReason === "HISTORICAL_PERSONAL_MEMORY"));
    const observed = retrieveHistorical({ store, scope, queryPlan: { ...plan, time: { mode: "AS_OF", from: "1145.1.1", to: null }, entities: plan.entities }, query: "岳飞在哪里", currentDate: "1150.1.1", responderId: "6", directObservationFacts: [{ factId: "obs-1", entityId: "1", field: "LOCATION", value: "100", knowledgeLevel: "DIRECT_OBSERVATION", directObserverIds: ["6"], asOf: "1144.1.1" }] });
    assert(observed.selected.some(item => item.field === "LOCATION" && item.knowledgeReason === "HISTORICAL_PERSONAL_MEMORY"));
    const ambiguous = retrieveHistorical({ store, scope, queryPlan: { ...plan, ambiguity: { status: "AMBIGUOUS" }, entities: { ...plan.entities, characters: ["1", "2"] } }, query: "这个人在哪里", currentDate: "1150.1.1", responderId: "4" });
    assert.equal(ambiguous.reason, "HISTORY_AMBIGUOUS_IDENTITY");
    assert.equal(ambiguous.diagnostics.candidateCount, 2);
    const multiEntity = retrieveHistorical({ store, scope, queryPlan: { ...plan, entities: { ...plan.entities, characters: ["1", "2"] } }, query: "这两人的生死和头衔", currentDate: "1150.1.1", responderId: "4" });
    assert(multiEntity.success);
    assert(new Set(multiEntity.selected.map(item => item.entityId)).size >= 2, "uniquely resolved multi-entity queries must remain multi-entity");

    const timeline = getCharacterTimeline({ store, scope, characterId: "1", from: "1145.1.1", to: "1150.1.1", responderId: "4" });
    assert(timeline.success);
    assert(timeline.selected.some(item => item.eventType === "LOCATION_CHANGED"), JSON.stringify(timeline, null, 2));
    assert(timeline.selected.some(item => item.eventType === "LIFE_STATUS_CHANGED"));
    assert(timeline.selected.some(item => item.eventType === "SPOUSE_CHANGED"));
    assert(timeline.selected.some(item => item.eventType === "LIEGE_CHANGED"));
    assert(timeline.selected.some(item => item.eventType === "COURT_CHANGED"));
    assert(timeline.selected.some(item => item.eventType === "TITLE_GAINED"));
    assert(timeline.selected.some(item => item.eventType === "TITLE_LOST"));
    const warParticipation = getCharacterTimeline({ store, scope, characterId: "1", from: "1145.1.1", to: "1150.1.1", fields: ["WAR_PARTICIPATION"], responderId: "4" });
    assert(warParticipation.selected.some(item => item.eventType === "WAR_PARTICIPATION_CHANGED"));
    const titleSideParticipation = getCharacterTimeline({ store, scope, characterId: "2", from: "1145.1.1", to: "1150.1.1", fields: ["WAR_PARTICIPATION"], responderId: "2" });
    assert(titleSideParticipation.selected.some(item => item.eventType === "WAR_PARTICIPATION_CHANGED" && item.value.after.includes("20")));

    const rangePlan = { intent: "HISTORY_LOOKUP", entities: { characters: [], titles: [], candidateCharacters: [], candidateTitles: [] }, time: { mode: "RANGE", from: "1145.1.1", to: "1150.1.1" } };
    const wars = retrieveHistorical({ store, scope, queryPlan: rangePlan, query: "过去这些年有哪些战争", currentDate: "1150.1.1", responderId: "6" });
    assert(wars.selected.some(item => item.eventType === "WAR_ACTIVE_AT"));
    assert(wars.selected.some(item => item.eventType === "WAR_NO_LONGER_ACTIVE"));
    assert(wars.selected.some(item => item.eventType === "WAR_SIDE_CHANGED"));
    assert(wars.diagnostics.reasonCodes.includes("WAR_ACTOR_UNRESOLVED"));
    const warPrompt = buildHistoricalPrompt(wars, { tokenBudget: 1200 }).text;
    assert(warPrompt.includes("不得推断谁获胜"));
    assert(warPrompt.includes("派系"));
    assert(warPrompt.includes("头衔"));
    const broadChanges = retrieveHistorical({ store, scope, queryPlan: rangePlan, query: "1145到1150发生了哪些变化", currentDate: "1150.1.1", responderId: "4" });
    assert(broadChanges.success, "entity-free bounded RANGE must search the bounded broad scope");
    assert(broadChanges.selected.some(item => ["HISTORICAL_CHARACTER_CHANGE", "HISTORICAL_TITLE_CHANGE"].includes(item.type)));
    assert(broadChanges.selected.some(item => item.field === "WAR"), "broad RANGE includes major wars without a war keyword");
    const readable = buildHistoricalPrompt(retrieveHistorical({ store, scope, queryPlan: { ...plan, time: { mode: "AS_OF", from: "1145.1.1", to: null } }, query: "岳飞的头衔", currentDate: "1150.1.1", responderId: "4" }), { tokenBudget: 1200 }).text;
    assert(readable.includes("岳飞"));
    assert(readable.includes("宋 (#11)"), readable);
    const realmWarPlan = { intent: "WAR_STATUS", entities: { characters: [], titles: ["11", "12"], realms: ["k_song", "k_jin"], candidateCharacters: [], candidateTitles: [] }, time: { mode: "RANGE", from: "1145.1.1", to: "1150.1.1" } };
    const realmWars = retrieveHistorical({ store, scope, queryPlan: realmWarPlan, query: "宋金有哪些战争", currentDate: "1150.1.1", responderId: "4" });
    assert(realmWars.selected.some(item => item.entityId === "10"), "realm-scoped war query must include Character WarActors");
    assert(realmWars.selected.find(item => item.entityId === "10").entityRefs.realms.length > 0);
    const fallbackTitle = retrieveHistorical({ store, scope, queryPlan: { ...rangePlan, entities: { ...rangePlan.entities, candidateTitles: ["11"] } }, query: "1145到1150头衔变化", currentDate: "1150.1.1", responderId: "4" });
    assert(fallbackTitle.selected.some(item => item.entityId === "11"), "candidateTitles is used when titles is empty");
    const unavailableFriends = retrieveHistorical({ store, scope, queryPlan: { ...plan, time: { mode: "AS_OF", from: "1145.1.1", to: null } }, query: "岳飞的朋友", currentDate: "1150.1.1", responderId: "4" });
    assert.equal(unavailableFriends.reason, "HISTORY_FIELD_UNAVAILABLE");
    assert.equal(unavailableFriends.diagnostics.unsupportedFields[0], "FRIEND");

    const titlePlan = { intent: "HISTORY_LOOKUP", entities: { characters: [], titles: ["11"], candidateCharacters: [], candidateTitles: [] }, time: { mode: "RANGE", from: "1145.1.1", to: "1150.1.1" } };
    const titles = retrieveHistorical({ store, scope, queryPlan: titlePlan, query: "1145到1150宋的头衔变化", currentDate: "1150.1.1", responderId: "6" });
    assert(titles.selected.some(item => item.eventType === "TITLE_HOLDER_CHANGED"));
    assert(titles.selected.some(item => item.eventType === "LIEGE_TITLE_CHANGED" || item.eventType === "REALM_ROOT_CHANGED"));
    assert(getTitleTimeline({ store, scope, titleId: "11", from: "1145.1.1", to: "1150.1.1" }).selected.some(item => item.eventType === "TITLE_HOLDER_CHANGED"));
    assert(getWarTimeline({ store, scope, from: "1145.1.1", to: "1150.1.1" }).selected.some(item => item.eventType === "WAR_NO_LONGER_ACTIVE"));

    const otherScope = { campaignId, branchId: `branch_${crypto.randomUUID()}`, state: "SAME_BRANCH" };
    assert.equal(retrieveHistorical({ store, scope: otherScope, queryPlan: plan, query: "岳飞五年前在哪里", currentDate: "1150.1.1", responderId: "4" }).reason, "HISTORY_UNAVAILABLE");
    assert.equal(retrieveHistorical({ store, scope: { ...scope, reason: "load_session_changed" }, queryPlan: plan, query: "岳飞五年前在哪里", currentDate: "1150.1.1", responderId: "4" }).reason, "HISTORY_BRANCH_MISMATCH");
    const historyIndex = new HistoricalCheckpointIndex(store.root, scope);
    const validHistoryIndexBytes = fs.readFileSync(historyIndex.file);
    fs.writeFileSync(historyIndex.file, "corrupt index");
    assert.equal(retrieveHistorical({ store, scope, queryPlan: plan, query: "岳飞五年前在哪里", currentDate: "1150.1.1", responderId: "4" }).reason, "HISTORY_INDEX_CORRUPT");
    fs.writeFileSync(historyIndex.file, validHistoryIndexBytes);
    const historyNode = historyIndex.load().nodes[0];
    const historyNodeFile = path.join(historyIndex.directory, historyNode.file);
    const validHistoryNodeBytes = fs.readFileSync(historyNodeFile);
    fs.writeFileSync(historyNodeFile, "corrupt checkpoint");
    assert.equal(retrieveHistorical({ store, scope, queryPlan: plan, query: "岳飞五年前在哪里", currentDate: "1150.1.1", responderId: "4" }).reason, "HISTORY_CHECKPOINT_CORRUPT");
    fs.writeFileSync(historyNodeFile, validHistoryNodeBytes);

    const settings = { autosavePath, lastValidationStatus: "VALID", promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION", v812HistoricalRetrievalEnabled: true, v812HistoricalPromptInjection: false };
    service = new WorldlineService({ dataDir, settingsRepository: { getWorldlineSettings: () => settings, saveWorldlineSettings: value => Object.assign(settings, value) } });
    service.currentCheckpoint = checkpoints[2].checkpoint;
    service.buildState = "ACTIVE";
    service.getLiveState = () => ({ connected: false, gameDate: null, totalDays: null, characters: [] });
    service.canon.branch = () => scope;
    await service.canon.mutate({ token: scope.token, operation: "create", payload: { title: "岳飞旧事", content: "1145年曾在鄂州整军。", type: "NARRATIVE_EVENT", entities: ["1"], entityRefs: [{ namespace: "character", id: "1" }], visibility: "PUBLIC_WORLD", importance: "HIGH", gameDate: "1145.1.1", temporalMode: "SPECIFIC_DATE", temporalSemantics: "PAST_EVENT" } });
    await service.canon.mutate({ token: scope.token, operation: "create", payload: { title: "岳飞无日期传闻", content: "这条无日期记录不能进入精确历史查询。", type: "PLAYER_CANON", entities: ["1"], entityRefs: [{ namespace: "character", id: "1" }], visibility: "PUBLIC_WORLD", importance: "HIGH", temporalMode: "TIMELESS", temporalSemantics: "DURABLE_WORLD_RULE" } });
    await service.prepareCanon();
    const preview = service.getPromptDiagnostics({ query: "岳飞五年前在哪里" }).promptDiagnostics.historicalRetrieval;
    assert(preview.success);
    assert(preview.promptText.includes("CK3 存档时间线"));
    assert.equal(preview.canon.selectedCount, 1);
    assert.equal(preview.canon.selected[0].type, "HISTORICAL_CANON");
    assert(preview.promptText.includes("1145年曾在鄂州整军"));
    assert(!preview.promptText.includes("无日期记录"));
    assert.equal(preview.canon.temporalBlockedCount, 1);
    await service.canon.mutate({ token: scope.token, operation: "create", payload: { title: "岳飞私密旧事", content: "后来同宫廷不能反推路人早年知道此事。", type: "NARRATIVE_EVENT", entities: ["1"], entityRefs: [{ namespace: "character", id: "1" }], scopeEntityId: "1", visibility: "COURT_PUBLIC", importance: "HIGH", gameDate: "1145.1.1", temporalMode: "SPECIFIC_DATE", temporalSemantics: "PAST_EVENT" } });
    await service.canon.mutate({ token: scope.token, operation: "create", payload: { title: "岳飞更早旧事", content: "1130年的事件不能进入1145至1150范围。", type: "NARRATIVE_EVENT", entities: ["1"], entityRefs: [{ namespace: "character", id: "1" }], visibility: "PUBLIC_WORLD", importance: "HIGH", gameDate: "1130.1.1", temporalMode: "SPECIFIC_DATE", temporalSemantics: "PAST_EVENT" } });
    await service.prepareCanon();
    const rangePreview = service.getHistoricalQueryContext({ responderId: "6", query: "1145到1150岳飞发生了哪些变化", tokenBudget: 900 });
    assert.equal(rangePreview.canon.selectedCount, 1);
    assert(rangePreview.promptText.includes("1145年曾在鄂州整军"));
    assert(!rangePreview.promptText.includes("1130年的事件"));
    assert(!rangePreview.promptText.includes("后来同宫廷"));
    assert.equal(rangePreview.canon.visibilityBlockedCount, 1);
    service.getPromptDiagnostics({ query: "岳飞五年前在哪里" });
    assert.equal(service.getPromptDiagnostics({ query: "岳飞五年前在哪里" }).promptDiagnostics.historicalRetrieval.cacheHit, true);
    assert.equal(normalizeSettings({}).v812HistoricalRetrievalEnabled, true);
    service.setRecallSettings({ v812HistoricalPromptInjection: true });
    const workerPreview = await service.getHistoricalQueryContextAsync({ responderId: "6", query: "1145到1150岳飞发生了哪些变化", tokenBudget: 900 });
    assert.equal(workerPreview.success, true, "historical retrieval worker must return the same safe timeline");
    assert(workerPreview.promptText.includes("1145年曾在鄂州整军"));
    assert.equal(workerPreview.canon.selectedCount, 1);
    const asyncDiagnostics = await service.getPromptDiagnosticsAsync({ query: "岳飞五年前在哪里" });
    assert.equal(asyncDiagnostics.promptDiagnostics.historicalRetrieval.success, true, "developer diagnostics must use the worker result");
    const workerPrompt = await service.getSubjectivePromptContextAsync({ responderId: "4", query: "岳飞五年前在哪里", tokenBudget: 900 });
    assert(workerPrompt.worldTurnRecallText.includes("Dynamic Tail"));
    const historicalPrompt = service.getSubjectivePromptContext({ responderId: "4", query: "岳飞五年前在哪里", tokenBudget: 900 });
    const rangeHistoricalPrompt = service.getSubjectivePromptContext({ responderId: "4", query: "过去十年有哪些战争", tokenBudget: 900 });
    const currentPrompt = service.getSubjectivePromptContext({ responderId: "4", query: "岳飞现在在哪里", tokenBudget: 900 });
    assert(historicalPrompt.worldTurnRecallText.includes("Dynamic Tail"));
    assert(rangeHistoricalPrompt.worldTurnRecallText.includes("Dynamic Tail"));
    assert(!currentPrompt.worldTurnRecallText?.includes("本轮历史检索"));
    assert.equal(historicalPrompt.worldStableText, currentPrompt.worldStableText, "historical queries must not alter the stable prefix block");
    assert.equal(rangeHistoricalPrompt.worldStableText, currentPrompt.worldStableText, "range and WarActor queries must not alter the stable prefix block");
    assert.notEqual(preview.dynamicTailFingerprint, preview.stablePrefixFingerprint);
    const renderer = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
    for (const marker of ["V8.12 历史检索与时间线", "v812HistoricalRetrievalEnabled", "v812HistoricalPromptInjection", "Stable Prefix Fingerprint", "Dynamic Tail Fingerprint"]) assert(renderer.includes(marker), marker);
    console.log("V8.12 Part 2 Historical Retrieval: PASS (AS_OF, RANGE, timelines, scope, WarActor, branch, Dynamic Tail)");
  } finally {
    service?.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
