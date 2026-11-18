"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { captureCharacterBackgrounds, getCharacterBackground } = require("../src/app/main/game-data/character-background");
const { buildOfficialRecollectionSummary, hasOfficialRecollectionContent } = require("../src/app/main/memory-system/official-recollection-provider");
const { createLogParser } = require("../src/app/main/game-data/log-parser");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");
const person = id => ({ id, shortName: "同名人物", traits: [], memories: [] });
const data = () => ({ playerID: 1, campaignToken: "votc8c-123456789012", date: "1200.1.1", totalDays: 100,
  characters: new Map([1, 2, 3, 4].map(id => [id, person(id)])) });
const row = (ownerId, historyId, text, prefix = "POD_investigate.desc.") => ({ ownerId, historyId, localizationKey: prefix + historyId, text });
const summary = (gameData, id, sessionId = "scene-a") => buildOfficialRecollectionSummary({ character: gameData.characters.get(id), gameData, sessionId });

const gameData = data();
gameData.characters.get(2).memories = [{ creationDate: "1199.1.1", creationDateTotalDays: 90, desc: "ANNA_OFFICIAL_MEMORY" }];
captureCharacterBackgrounds(gameData, [[2, "790004"], [3, "790005"], [4, "0"]], [
  row(2, "790004", "ANNA_OWN_BACKGROUND\n第二段包含 #bold 重点#!。"), row(3, "790005", "OTHER_OWN_BACKGROUND"),
  row(4, "0", "MUST_NOT_BIND_NEWBORN"), row(2, "790005", "MUST_NOT_BIND_SAME_NAME"),
  { ...row(3, "790005", "MUST_NOT_BIND_WRONG_KEY"), localizationKey: "POD_investigate.desc.790004" }
]);
assert(getCharacterBackground(gameData, 2).text.includes("ANNA_OWN_BACKGROUND"));
const own = summary(gameData, 2);
assert(own.content.indexOf("个人背景故事") < own.content.indexOf("CK3 官方人物追忆"));
assert(own.content.indexOf("ANNA_OWN_BACKGROUND") < own.content.indexOf("ANNA_OFFICIAL_MEMORY"));
assert(!own.content.includes("OTHER_OWN_BACKGROUND") && !own.content.includes("MUST_NOT_BIND"));
assert.equal(own.memoryCount, 1);
assert.equal(summary(gameData, 3).memoryCount, 0);
assert(hasOfficialRecollectionContent(summary(gameData, 3)), "biography alone must be recalled even with zero official memories");
assert.equal(getCharacterBackground(gameData, 4), null);
assert.equal(hasOfficialRecollectionContent(summary(gameData, 4)), false);
assert.equal(summary(gameData, 4).content, "当前对话未导出该角色的官方追忆。", "no biography preserves the old behavior");
assert.equal(getCharacterBackground({ ...gameData }, 2), null, "unbound copies cannot inherit a biography capture");
const view = createTraitProfileView(gameData, gameData.characters.get(1), { activeParticipantIds: [1, 2, 3] });
assert(!JSON.stringify(view.gameData).includes("ANNA_OWN_BACKGROUND"), "private biography does not become observer profile data");
const previousFingerprint = own.personalBackgroundFingerprint;
captureCharacterBackgrounds(gameData, [[2, "790004"], [3, "790005"]], [row(2, "790004", "REVISED_OWN_BACKGROUND")]);
assert.notEqual(summary(gameData, 2).personalBackgroundFingerprint, previousFingerprint);
const oldCampaign = gameData.campaignToken;
gameData.campaignToken = "different-campaign";
assert.equal(getCharacterBackground(gameData, 2), null);
gameData.campaignToken = oldCampaign;
gameData.playerID = 3;
assert.equal(getCharacterBackground(gameData, 2), null, "character switch cannot carry the old capture");

const duplicates = data();
captureCharacterBackgrounds(duplicates, [[2, "790004"], [3, "790004"]], [row(2, "790004", "DUPLICATE_HISTORY")]);
assert.equal(getCharacterBackground(duplicates, 2), null, "ambiguous historical identities cannot be guessed");
captureCharacterBackgrounds(duplicates, [[2, "790004"], [2, "790005"]], [row(2, "790004", "CONFLICT_HISTORY")]);
assert.equal(getCharacterBackground(duplicates, 2), null);
captureCharacterBackgrounds(duplicates, [[2, "790004"]], [row(2, "790004", "POD_investigate.desc.790004")]);
assert.equal(getCharacterBackground(duplicates, 2), null, "unlocalized keys do not become stories");
for (const [prefix, historyId] of [["POD_investigate.desc.", "790004"], ["POD_persistentpodlore.desc.", "793278"],
  ["POD_podlore.100.desc.", "POD_fae_character_203"], ["POD_patronlore.100.desc.", "560027"]]) {
  captureCharacterBackgrounds(duplicates, [[2, historyId]], [row(2, historyId, "MATCHED_BACKGROUND", prefix)]);
  assert.equal(getCharacterBackground(duplicates, 2)?.text, "MATCHED_BACKGROUND", "native biography key family " + prefix);
}

async function testLogCapture() {
  const root = fs.mkdtempSync(path.join(__dirname, "../.build/personal-background-"));
  class GameData {
    constructor(values) { Object.assign(this, data()); this.date = values[4]; this.totalDays = Number(values[8]); }
  }
  class Character { constructor(values) { Object.assign(this, person(Number(values[0]))); } }
  const init = "VOTC:IN/;/init/;/1/;/玩家/;/2/;/同名人物/;/1200.1.1/;/hall/;/room/;/player/;/100";
  const header = [init, "VOTC:CAMPAIGN/votc8c-123456789012", "VOTC:IN/;/character/;/2/;/同名人物", "VOTC:IN/;/character/;/3/;/同名人物",
    "VOTC:IN/;/character_history/;/2/;/790004", "VOTC:IN/;/character_history/;/3/;/790005"];
  try {
    const log = path.join(root, "debug.log");
    fs.writeFileSync(log, [...header,
      "VOTC:IN/;/character_background/;/2/;/790004/;/POD_investigate.desc.790004/;/STARTMULTILINE#ANNA_NATIVE_FIRST",
      "native #bold BOLD#! and hash # ordinary /;/ text",
      "ANNA_NATIVE_LAST#ENDMULTILINE",
      "VOTC:IN/;/character_background/;/3/;/790005/;/POD_investigate.desc.790005/;/STARTMULTILINE#OTHER_NATIVE#ENDMULTILINE"
    ].join("\n"));
    const parsed = await createLogParser({ GameData, Character })(log);
    const anna = summary(parsed, 2).content;
    assert(anna.includes("ANNA_NATIVE_FIRST") && anna.includes("ANNA_NATIVE_LAST") && anna.includes("BOLD"));
    assert(anna.includes("hash # ordinary /;/ text"), "ordinary hash signs and delimiters survive multiline parsing");
    assert(!anna.includes("OTHER_NATIVE") && !anna.includes("#bold") && !anna.includes("#!"));
    assert(summary(parsed, 3).content.includes("OTHER_NATIVE"));
    fs.writeFileSync(log, [...header, "VOTC:IN/;/character_background/;/2/;/790004/;/POD_investigate.desc.790004/;/STARTMULTILINE#INCOMPLETE",
      "VOTC:IN/;/trait/;/2/;/brave/;/personality/;/勇敢/;/test"].join("\n"));
    const incomplete = await createLogParser({ GameData, Character: class extends Character { addTrait() {} } })(log);
    assert.equal(getCharacterBackground(incomplete, 2), null, "unfinished biography cannot swallow the next record or become usable");
    fs.writeFileSync(log, header.join("\n"));
    const legacy = await createLogParser({ GameData, Character })(log);
    assert.equal(getCharacterBackground(legacy, 2), null, "old exports continue to work");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function testRecallLifecycle() {
  const versionPath = require.resolve("../src/app/main/version");
  require.cache[versionPath] = { id: versionPath, filename: versionPath, loaded: true, exports: require("../resources/app/out/main/version") };
  const { createGameData } = require("../src/app/main/game-data/game-data");
  const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
  const { retrievePlayerCenteredMemory, validatePlayerMemorySources } = require("../src/app/main/memory-system/player-centered-memory");
  const root = fs.mkdtempSync(path.join(__dirname, "../.build/personal-background-recall-"));
  try {
    const summariesDir = path.join(root, "summaries");
    const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
    const GameData = createGameData({ fs, path, memorySystem: require("../src/app/main/memory-system"), memoryEngine: engine,
      summariesDir, getHistoricalReferenceByYear: () => null });
    const live = Object.assign(new GameData([1, "玩家", 2, "同名人物", "1200.1.1", "hall", "room", "player", 100]), data());
    const history = [[2, "790004"], [3, "790005"]];
    captureCharacterBackgrounds(live, history, [row(2, "790004", "RECALL_ANNA_BACKGROUND"), row(3, "790005", "RECALL_OTHER_BACKGROUND")]);
    live.syncOfficialRecollectionSummaries("scene-a");
    const anna = live.getOfficialRecollectionSummary(2, "scene-a");
    const other = live.getOfficialRecollectionSummary(3, "scene-a");
    assert(anna.content.includes("RECALL_ANNA_BACKGROUND") && !anna.content.includes("RECALL_OTHER_BACKGROUND"));
    assert(other.content.includes("RECALL_OTHER_BACKGROUND") && !other.content.includes("RECALL_ANNA_BACKGROUND"));
    assert.equal(anna.memoryCount, 0);
    assert.equal(live.getOfficialRecollectionSummary(2, "different-scene"), null);
    assert.equal(live.getOfficialRecollectionSummary(4, "scene-a"), null);
    assert.deepEqual(engine.loadOwnerFolderMemories(2), [], "background stays out of cross-person and temporal memory routes");
    const options = { characterId: 2, trustedPlayerAnchorId: 1, campaignToken: live.campaignToken, conversationId: "scene-a",
      currentGameDate: live.date, currentTotalDays: live.totalDays, officialSummary: anna, sessionRecallCache: new Map(),
      gameData: live, sceneRevision: 1, turnEpoch: 1, budgetPolicyRevision: "v9.3.9", tokenBudget: 10000,
      estimateTokens: text => Math.ceil(String(text).length / 2) };
    const initial = retrievePlayerCenteredMemory(engine, options);
    assert(initial.officialRecollectionText.includes("RECALL_ANNA_BACKGROUND"));
    assert(!initial.officialRecollectionText.includes("RECALL_OTHER_BACKGROUND"));
    assert.equal(initial.pairMemoryMetrics.officialRecollectionPresent, true);
    const again = retrievePlayerCenteredMemory(engine, { ...options, turnEpoch: 2 });
    assert.equal(again.pairMemoryMetrics.frozenSnapshotReuse, true);
    assert.equal(again.officialRecollectionText, initial.officialRecollectionText);
    const { makePromptRuntime } = require("./test-v9.3.6-independent-qa");
    for (const layout of ["legacy", "v813", "glm"]) {
      const prompt = makePromptRuntime();
      prompt.gameData.campaignToken = live.campaignToken;
      const context = { ...initial, temporalExtraText: "VOLATILE_TURN_RECALL" };
      const built = prompt.build(layout, context);
      const officialIndex = built.blocks.findIndex(entry => entry.block.id === "memory-official-recollection");
      const officialBlock = built.blocks[officialIndex];
      assert(officialBlock?.content.includes("RECALL_ANNA_BACKGROUND"), layout + " must emit the responder's biography");
      assert.equal(officialBlock.block.stable, true, layout + " biography belongs to the upper stable context");
      for (const id of ["history", "memory-temporal-extra", "responder-game-facts"]) {
        const index = built.blocks.findIndex(entry => entry.block.id === id);
        if (index >= 0) assert(officialIndex < index, layout + " biography must precede " + id);
      }
      const sent = built.messages.map(message => String(message.content || "")).join("\n");
      assert.equal(sent.split("RECALL_ANNA_BACKGROUND").length - 1, 1, "biography is injected once");
      assert(!sent.includes("RECALL_OTHER_BACKGROUND"));
      assert.equal(prompt.build(layout, { ...again, temporalExtraText: "NEXT_VOLATILE_TURN" })
        .blocks.find(entry => entry.block.id === "memory-official-recollection").content, officialBlock.content,
      "later turns keep exactly the same stable biography bytes");
    }
    assert.throws(() => retrievePlayerCenteredMemory(engine, { ...options, tokenBudget: 1 }), error =>
      error.code === "MEMORY_CONTEXT_OVERFLOW" && error.memoryBudgetDetails.breakdown.official > 0,
    "biography must consume the shared memory budget rather than bypassing it or silently disappearing");
    const wrongOwner = retrievePlayerCenteredMemory(engine, { ...options, characterId: 3, sessionRecallCache: new Map() });
    assert(!wrongOwner.officialRecollectionText, "the responder cannot recall another owner's biography summary");
    captureCharacterBackgrounds(live, history, [row(2, "790004", "REVISED_ANNA_BACKGROUND")]);
    assert.equal(live.getOfficialRecollectionSummary(2, "scene-a"), null, "old file cannot override revised native background evidence");
    assert.equal(validatePlayerMemorySources(engine, initial, live, "scene-a").valid, false);
    live.syncOfficialRecollectionSummaries("scene-a");
    const revised = retrievePlayerCenteredMemory(engine, { ...options, officialSummary: live.getOfficialRecollectionSummary(2, "scene-a") });
    assert(revised.officialRecollectionText.includes("REVISED_ANNA_BACKGROUND"));
    assert(!revised.officialRecollectionText.includes("RECALL_ANNA_BACKGROUND"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
testLogCapture().then(() => testRecallLifecycle()).then(() => console.log("PASS personal background: exact binding, native multiline, owner-scoped recall, freeze, revision and budget"))
  .catch(error => { console.error(error); process.exitCode = 1; });
