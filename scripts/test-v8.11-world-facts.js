"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const Handlebars = require("../resources/app/node_modules/handlebars");
const main = "../resources/app/out/main/";
const { WorldlineService } = require(main + "worldline/worldline-service");
const { parseGameState } = require(main + "worldline/game-state-adapter");
const { buildWorldQueryPlan } = require(main + "worldline/world-query-planner");
const { createPromptBuilder } = require(main + "prompts/prompt-builder");
const { TokenCounter } = require(main + "provider-service");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v811-"));
const autosavePath = path.join(root, "autosave.ck3");
const snapshot = parseGameState(`date=1150.1.1 played_character=1
living={
1={first_name="宋臣" court_data={employer=10} family_data={father=80}}
2={first_name="金臣" court_data={employer=20}}
3={first_name="陌生人" court_data={employer=10}}
4={first_name="朋友甲" court_data={employer=30}}
10={first_name="宋帝" landed_data={domain={100}}}
20={first_name="金帝" landed_data={domain={200}}}
30={first_name="他国君主"}
80={first_name="岳飞" female=no birth=1103.3.24 court_data={employer=10} alive_data={location="鄂州密营"} family_data={child=1}}
}
landed_titles={100={key="h_china" holder=10 title_name_data={name="宋" localization_key="宋"}} 200={key="e_jin" holder=20 title_name_data={name="金" localization_key="e_dajin"}}}
wars={active_wars={501={start_date=1149.1.1 attacker={character=20 score=80} defender={character=10}}}}
`);
snapshot.verifiedFullNameToRuntimeIds = { "岳飞": ["80"] };
const settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION", lastValidationStatus: "VALID" };
const service = new WorldlineService({ dataDir: root, settingsRepository: { getWorldlineSettings: () => settings, saveWorldlineSettings: next => Object.assign(settings, next), getCK3DebugLogPath: () => null } });
service.currentCheckpoint = { id: "fixture-1150", source: { path: autosavePath }, snapshot };
service.buildState = "ACTIVE";
service.getLiveState = () => ({ connected: false, gameDate: null, characters: [] });
const titleNames = { h_china: "通用中华帝国", e_jin: "通用金帝国", 宋: "宋国", 金: "金国" };
service.localizationResolver.resolve = (_type, key) => ({ localizedValue: titleNames[key] || key });
service.localizationResolver.findRawKeysByLocalizedValue = (type, value) => {
  const matches = type === "title" ? Object.entries(titleNames).filter(([, name]) => name === value).map(([rawKey]) => ({ rawKey })) : [];
  return { status: matches.length ? "MATCHED" : "NO_MATCH", matches, sourceComplete: true };
};
const runtimeGameData = { playerID: 1, characters: new Map([[4, { id: 4, relationsToCharacters: [{ id: 80, relations: ["朋友"] }] }]]) };
const recall = (responderId, query, extra = {}) => service.getSubjectivePromptContext({ responderId, query, conversationId: "test", turnEpoch: 1, tokenBudget: 900, runtimeGameData, ...extra });

try {
  assert.deepStrictEqual(snapshot.wars[501].attacker, ["20"], "score metadata must not be parsed as an actor");
  assert.equal(snapshot.titles[100].displayName, "宋", "runtime realm names must be read from title_name_data");
  for (const query of ["宋国与金国正在打仗吗", "宋国金国的战事如何", "最近有哪些战争"]) {
    for (const responderId of [1, 2]) {
      const result = recall(responderId, query);
      assert(result?.worldTurnRecallText?.includes("正在交战"), `${responderId}/${query}: active war must reach prompt without any annual delta`);
      assert(result.worldTurnRecallText.includes("宋国") && result.worldTurnRecallText.includes("金国"));
      assert(result.worldTurnRecallText.includes("1150.1.1") && result.worldTurnRecallTokens <= 900);
    }
  }
  assert(!recall(4, "宋国与金国正在打仗吗")?.worldTurnRecallText?.includes("正在交战"), "unrelated realm is not granted realm-public war");
  const parent = recall(1, "岳飞的行踪下落");
  assert(parent?.worldTurnRecallText?.includes("鄂州密营"), "kinship may know recorded whereabouts");
  assert(parent.worldTurnRecallText.includes("在世"), "game life status beats historical death year");
  const friend = recall(4, "岳飞去了哪里");
  assert(friend?.worldTurnRecallText?.includes("鄂州密营"), "explicit current friendship grants whereabouts across courts");
  const stranger = recall(3, "岳飞在哪");
  assert(!JSON.stringify(stranger).includes("鄂州密营"), "same court must not leak location through IDENTITY or LOCATION");
  assert(stranger.worldTurnRecallText.includes("行踪回答边界"));
  assert(stranger.metrics.whereaboutsBlockedCount > 0);
  runtimeGameData.characters.get(4).relationsToCharacters = [];
  assert(!recall(4, "岳飞去了哪里").worldTurnRecallText.includes("鄂州密营"), "relation revocation invalidates same-turn subjective cache");
  const observed = recall(3, "岳飞在哪", { directObservationFacts: [{ factId: "seen-80", entityId: "80", field: "LOCATION", value: "亲眼见岳飞在眼前厅堂", sourceTier: "GAME_TRUTH", knowledgeLevel: "DIRECT_OBSERVATION", directObserverIds: ["3"], temporalSafe: true, asOf: snapshot.gameDate }] });
  assert(observed.worldTurnRecallText.includes("亲眼见岳飞在眼前厅堂"));
  assert(!observed.worldTurnRecallText.includes("鄂州密营"));
  assert(!recall(1, "1100年宋国与金国的战争").worldTurnRecallText?.includes("正在交战"), "later checkpoint does not answer historical war as current fact");
  assert.equal(buildWorldQueryPlan({ query: "岳飞的下落" }).intent, "CHARACTER_LOCATION");

  class TemplateEngine { renderTemplateString(template, context) { return Handlebars.compile(template)({ ...context.character, ...context }); } }
  const promptSettings = { mainTemplate: "{{! VOTC_SEGMENT:stable_global }}全局规则\n{{! VOTC_SEGMENT:world_context }}{{gameData.historicalReferenceInfo.context}}", blocks: [{ id: "main", type: "main", enabled: true }, { id: "history", type: "history", enabled: true }], suffix: { enabled: false } };
  const builder = createPromptBuilder({ TemplateEngine, PromptScriptLoader: class {}, promptConfigManager: { getDefaultMainTemplateContent: () => promptSettings.mainTemplate }, settingsRepository: { getPromptSettings: () => promptSettings, getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89RuntimeProfileSplit: true, chatPromptV810ProviderAdapter: true }), getActiveProviderConfig: () => ({ providerType: "zhipu", defaultModel: "glm-5.3-flash" }) }, path, TokenCounter, createPromptFingerprint: value => crypto.createHash("sha256").update(String(value)).digest("hex"), defaultChatInstruction: "回答" });
  const character = { id: 3, firstName: "陌生人", fullName: "陌生人", shortName: "陌生人", traits: [] };
  const gameData = { date: "1150.1.1", characters: new Map([[3, character]]), getActiveParticipantRelationshipInfo: () => "", findMentionedCharacterIdsInHistory: () => [], getMentionedCharactersInfo: () => "", historicalReferenceInfo: { context: "岳飞已按历史结局死去" } };
  const memoryContext = { subjectiveWorldPolicyActive: true, cacheV2FrozenSnapshots: { conversation: null, responders: new Map() }, activeParticipantIds: [3] };
  const build = world => builder.buildMessagesWithTokenCount([{ role: "user", content: "岳飞在哪" }], character, gameData, "", { ...memoryContext, ...world });
  const first = build(stranger);
  const second = build(recall(3, "宋国与金国正在打仗吗"));
  const prefix = result => JSON.stringify(result.blocks.slice(0, result.blocks.findIndex(entry => entry.block.stable !== true)).map(entry => [entry.block.id, entry.content]));
  assert.equal(prefix(first), prefix(second), "war/location changes must leave GLM v2 prefix byte-identical");
  for (const result of [first, second]) {
    const index = result.blocks.findIndex(entry => entry.block.id === "worldline-turn-recall");
    assert(index > result.blocks.findIndex(entry => entry.block.stable !== true));
    assert.equal(result.blocks[index].block.lifecycle, "DYNAMIC");
  }
  assert(!first.messages.map(item => item.content).join("\n").includes("鄂州密营"));
  const noRecall = build({});
  assert(!noRecall.messages.map(item => item.content).join("\n").includes("岳飞已按历史结局死去"), "missing world view cannot restore legacy historical destiny");
  assert(noRecall.messages.some(item => item.content.includes("游戏为先")));
  const crowded = JSON.parse(JSON.stringify(snapshot));
  for (let index = 0; index < 10; index += 1) {
    const id = String(900 + index);
    crowded.characters[id] = { id, firstName: `远国君主${index}`, alive: true };
    crowded.wars[`00${index}`] = { attacker: ["30"], defender: [id], startDate: "1149.1.1" };
  }
  service.currentCheckpoint = { ...service.currentCheckpoint, id: "crowded", snapshot: crowded };
  const broad = ids => service.getPromptContext({ query: "最近有哪些战争", runtimeContext: { activeParticipantIds: ids } });
  assert(!broad([4]).retrieval.selected.gameTruth.some(item => item.id === "war:501"));
  assert(broad([1]).retrieval.selected.gameTruth.some(item => item.id === "war:501"), "audience-specific ranking cannot reuse another realm's topic cache");
  assert(broad([1]).cacheHit, "same audience still reuses topic cache");
  for (let index = 0; index < 10; index += 1) crowded.wars[`00${index}`].attacker = ["10"];
  service.currentCheckpoint = { ...service.currentCheckpoint, id: "crowded-pair" };
  const pair = recall(1, "宋国与金国正在打仗吗", { activeParticipantIds: [1] });
  assert(pair.worldTurnRecallText.includes("金国"), "both queried realms outrank ten wars involving only Song within the token budget");
  const setCharacter = patch => {
    const next = JSON.parse(JSON.stringify(snapshot));
    Object.assign(next.characters[80], patch);
    service.currentCheckpoint = { ...service.currentCheckpoint, id: `fixture-${JSON.stringify(patch)}`, snapshot: next };
  };
  setCharacter({ alive: false, bucket: "dead_unprunable", deathDate: "1149.12.1", location: null });
  const dead = recall(1, "岳飞还活着吗");
  assert(dead.worldTurnRecallText.includes("已故") || dead.worldTurnRecallText.includes("去世"));
  assert(!dead.worldTurnRecallText.includes("鄂州密营"));
  setCharacter({ alive: true, deathDate: "1149.12.1" });
  const conflict = recall(1, "岳飞还活着吗");
  assert(conflict.worldTurnRecallText.includes("冲突"));
  assert(!conflict.worldTurnRecallText.includes("当前生死状态为在世"));
  setCharacter({ location: "9847" });
  assert(recall(1, "岳飞在哪").worldTurnRecallText.includes("地名未解析"), "numeric coordinates cannot be mistaken for a readable place");
  service.buildState = "STALE";
  assert.equal(recall(1, "岳飞在哪"), null, "stale checkpoint cannot supply whereabouts");
  console.log("V8.11 World Facts: PASS (parsed wars, both realms, kinship/friend/stranger, revocation, observation, history priority, dynamic-only prompt and prefix invariance)");
} finally {
  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
}
