"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = { id: versionPath, filename: versionPath, loaded: true, exports: { MEMORY_ENGINE_VERSION: "3.0" } };
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");
const { createGameData } = require("../src/app/main/game-data/game-data");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { createTemplateEngine } = require("../src/app/main/prompts/template-engine");
const { PromptScriptSandbox } = require("../src/app/main/prompts/prompt-script-sandbox");
const { TokenCounter } = require("../resources/app/out/main/provider-service");
const Handlebars = require("../resources/app/node_modules/handlebars").create();

const root = path.resolve(__dirname, "..");
const prompts = path.join(root, "src/app/default_userdata/prompts");
const template = fs.readFileSync(path.join(prompts, "system/default.hbs"), "utf8");
const GameData = createGameData({ fs, path, summariesDir: "", memorySystem: {}, getHistoricalReferenceByYear: () => null });
const TemplateEngine = createTemplateEngine({ Handlebars, fs, path, defaultPromptsDir: prompts,
  promptsHelpersDir: path.join(prompts, "helpers"), PromptScriptSandbox });
let layout = "v813";
let custom = false;
const settings = {
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: layout !== "v5", chatPromptV89RuntimeProfileSplit: layout === "v7", chatPromptV810ProviderAdapter: true }),
  getChatPromptV813Layout: () => layout === "v813",
  getPromptSettings: () => ({ mainTemplate: custom
    ? "PLAYER={{gameData.playerName}};SCENE={{gameData.scene}};{{#each gameData.characters}}{{firstName}};{{fullName}};{{primaryTitle}};{{heldCourtAndCouncilPositions}};{{house}};{{/each}}" : template,
    blocks: [{ id: "main", type: "main", enabled: true, role: "system" },
      { id: "description", type: "description", enabled: true, scriptPath: path.join(prompts, "character_description/standard/pListMccTest2JE_ZH.js") },
      { id: "history", type: "history", enabled: true }] })
};
const Builder = createPromptBuilder({ TemplateEngine, PromptScriptLoader: class {
  executeDescription(file, gameData, currentCharacterId) { return PromptScriptSandbox.executeDescription(file, { gameData, currentCharacterId }); }
}, settingsRepository: settings, promptConfigManager: { resolvePath: value => value, getDefaultMainTemplateContent: () => template },
path, TokenCounter, createPromptFingerprint: value => crypto.createHash("sha256").update(String(value)).digest("hex"), defaultChatInstruction: "" });

function fixture() {
  const person = (id, name, gender = "male") => ({ id, name, shortName: name, firstName: name, fullName: name,
    gender, sheHe: gender === "female" ? "她" : "他", age: 30, ageSource: "CK3_CURRENT_AGE", alive: true,
    gold: 0, prowess: 10, traits: [], parents: [], children: [], siblings: [], relationsToCharacters: [], relationsToPlayer: [], opinions: [] });
  const player = { ...person(1, "岳飞"), fullName: "山南制置使，岳飞", primaryTitle: "山南制置使", house: "相州岳氏",
    titleRankConcept: "concept_duchy", heldCourtAndCouncilPositions: "神武右军都统制",
    traits: [{ traitId: "beauty_good_3", name: "美丽", desc: "岳飞相貌出众，山南制置使气度不凡。" }] };
  const han = { ...person(2, "韩世忠"), liege: "岳飞" };
  const liang = person(3, "梁红玉", "female");
  const data = Object.assign(Object.create(GameData.prototype), { playerID: 1, playerName: player.fullName, aiID: 2,
    campaignToken: "synthetic-first-meeting", date: "1132.3.8", totalDays: 413000, year: 1132,
    scene: "岳飞进入大厅", location: "大厅", locationController: player.fullName,
    currentEmperor: player.shortName, currentEmperorTitle: player.primaryTitle,
    characters: new Map([[1, player], [2, han], [3, liang]]), mentionedCharactersInContext: new Set(), findMentionedCharacterIdsInHistory: () => [] });
  return { player, han, liang, data };
}
function fact(sample, ownerId, factType, value, overrides = {}) {
  return { factType, value, factKey: factType.toLowerCase(), ownerId, entityId: 1,
    campaignToken: sample.data.campaignToken, current: true, effectiveKnown: true,
    status: "AUTO_DISCLOSED", firstAcquiredDate: sample.data.date, ...overrides };
}
function memory(facts = []) {
  return { activeParticipantIds: [1, 2, 3], disclosureProfiles: new Map([[1, facts]]),
    cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() } };
}
function build(sample, responder = sample.han, facts = [], text = "您便是韩将军吧？这位夫人是梁氏？") {
  const history = [{ role: "user", name: sample.player.fullName, content: text }];
  const originalFirstName = sample.player.firstName;
  const result = Builder.buildMessagesWithTokenCount(history, responder, sample.data, "", memory(facts), { providerType: "deepseek", defaultModel: "deepseek-v4-flash" });
  assert.equal(history[0].name, sample.player.fullName, "UI history labels are not mutated");
  assert.equal(sample.player.firstName, originalFirstName, "the original game profile is not mutated");
  return result.messages.map(message => message.content).join("\n");
}

for (layout of ["v5", "v7", "v813"]) for (custom of [false, true]) {
  const sample = fixture();
  for (const responder of [sample.han, sample.liang]) {
    const prompt = build(sample, responder);
    assert.doesNotMatch(prompt, /岳飞|山南制置使|神武右军都统制|相州岳氏/, `${layout} custom=${custom}: first meeting hides names, titles, headers and generated metadata`);
    assert.match(prompt, /您便是韩将军吧/u, "actual spoken content stays intact");
  }
}
layout = "v813";
custom = false;
{
  const sample = fixture();
  const named = build(sample, sample.han, [fact(sample, 2, "NAME", "岳飞")]);
  assert.match(named, /岳飞/u);
  assert.doesNotMatch(named, /山南制置使|神武右军都统制|相州岳氏/);
  const titled = build(sample, sample.han, [fact(sample, 2, "TITLE", "山南制置使")]);
  assert.match(titled, /山南制置使/u);
  assert.doesNotMatch(titled, /岳飞|神武右军都统制|相州岳氏/);
  assert.doesNotMatch(build(sample, sample.liang, [fact(sample, 2, "NAME", "岳飞")]), /岳飞/u, "name disclosure is audience-specific");
  for (const patch of [{ campaignToken: "other" }, { ownerId: 3 }, { entityId: 3 }, { current: false }, { firstAcquiredDate: "1133.1.1" }, { status: "MANUAL_HIDDEN" }]) {
    assert.doesNotMatch(build(sample, sample.han, [fact(sample, 2, "NAME", "岳飞", patch)]), /岳飞/u);
  }
  assert.match(build(sample, sample.han, [], "我叫岳飞。"), /我叫岳飞。/u, "explicit spoken introductions are not scrubbed");
  sample.han.parents = [{ id: 1, source: "CK3_DIRECT_PARENT", sourceOwnerId: 2, childId: 2, parentId: 1,
    relationType: "parent", sourceRelation: "parents", publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN",
    campaignToken: sample.data.campaignToken, sourceSnapshotId: `${sample.data.date}/${sample.data.totalDays}` }];
  const relative = createTraitProfileView(sample.data, sample.han).gameData.characters.get(1);
  assert.equal(relative.firstName, "岳飞");
  assert.equal(relative.primaryTitle, "山南制置使");
  assert.equal(relative.age, 30, "the family age fix remains intact");
  const stranger = fixture();
  const unrelatedView = createTraitProfileView(stranger.data, stranger.han, null, { sourceGameData: sample.data }).gameData;
  assert.equal(unrelatedView.characters.get(1).firstName, "未获知姓名的人物", "a same-day foreign source object cannot grant a family exception");
}
{
  const sample = fixture();
  sample.player.firstName = "鹏举";
  sample.player.shortName = "岳二郎";
  sample.player.fullName = "岳飞";
  const prompt = build(sample, sample.han, [fact(sample, 2, "NAME", "岳二郎")]);
  assert.match(prompt, /岳二郎/u);
  assert.doesNotMatch(prompt, /岳飞|鹏举/u, "one disclosed name value cannot unlock other name aliases");
}
{
  const sample = fixture();
  sample.player.heldCourtAndCouncilPositions = "已知官职、未公开官职";
  sample.data.scene = "相州岳氏；concept_duchy；已知官职；未公开官职";
  const view = createTraitProfileView(sample.data, sample.han, memory([fact(sample, 2, "TITLE", "已知官职")])).gameData;
  assert.match(view.scene, /已知官职/u);
  assert.doesNotMatch(view.scene, /相州岳氏|concept_duchy|未公开官职/u, "generated metadata hides each unauthorized title and family alias independently");
  sample.player.name = sample.player.firstName = sample.player.shortName = sample.player.fullName = "Al";
  sample.player.primaryTitle = "None of";
  sample.data.scene = "Always sunny. None of the banners moved. Al entered.";
  const text = createTraitProfileView(sample.data, sample.han).gameData.scene;
  assert.match(text, /Always sunny\. None of the banners moved\./);
  assert.doesNotMatch(text, /\bAl entered/u);
}
{
  layout = "v5";
  const sample = fixture();
  const context = { ...memory([fact(sample, 2, "NAME", "岳飞"), fact(sample, 2, "TITLE", "山南制置使")]),
    stableDescriptionCache: new Map(), stableProfileCache: new Map() };
  const run = () => Builder.buildMessagesWithTokenCount([{ role: "user", name: sample.player.fullName, content: "阁下好。" }],
    sample.han, sample.data, "", context).messages.map(message => message.content).join("\n");
  assert.match(run(), /岳飞/u);
  context.disclosureProfiles = new Map();
  assert.deepEqual(run().split("\n").filter(line => /岳飞|山南制置使/u.test(line)), [], "legacy description memoization cannot retain revoked identity");
  const executeDescription = Builder.scriptLoader.executeDescription;
  try {
    Builder.scriptLoader.executeDescription = (_file, data, id) => data.characters.get(id).location;
    sample.han.location = "岳飞在大厅";
    context.disclosureProfiles = new Map([[1, [fact(sample, 2, "NAME", "岳飞")]]]);
    assert.match(run(), /岳飞在大厅/u);
    context.disclosureProfiles = new Map();
    assert.doesNotMatch(run(), /岳飞/u, "a custom script reading any projected field cannot reuse a previously authorized description");
    sample.han.location = "后院";
    assert.match(run(), /后院/u, "custom script input changes are rendered from the current projection");
  } finally {
    Builder.scriptLoader.executeDescription = executeDescription;
  }
}
console.log("V9.6 first-meeting identity: PASS (three actors, two responders, real scripts/templates, metadata/history labels, scoped NAME/TITLE, family and raw/UI preservation)");
