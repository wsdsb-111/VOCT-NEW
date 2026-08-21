"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const template = fs.readFileSync(path.join(root, "resources", "app", "default_userdata", "prompts", "system", "default.hbs"), "utf8");

const methodStart = mainSource.indexOf("  static buildResponderGameFacts(char) {");
const methodEnd = mainSource.indexOf("\n  /**", methodStart);
assert(methodStart >= 0 && methodEnd > methodStart, "Responder game fact builder must exist");
const factBuilderSource = mainSource.slice(methodStart, methodEnd).replace("  static buildResponderGameFacts", "globalThis.__testBuildResponderGameFacts = function buildResponderGameFacts");
eval(factBuilderSource);
const buildResponderGameFacts = globalThis.__testBuildResponderGameFacts;

const facts = buildResponderGameFacts({
  shortName: "张三",
  fullName: "河间公张三",
  age: 37,
  primaryTitle: "河间公",
  heldCourtAndCouncilPositions: "宰相",
  titleRankConcept: "title_rank_duchy"
});
assert.match(facts, /年龄：37岁/, "Exact age must be present in authoritative facts");
assert.match(facts, /主要头衔：河间公/, "Primary title must be present in authoritative facts");
assert.match(facts, /宫廷／议会职位：宰相/, "Court position must be present in authoritative facts");
assert.match(facts, /不得用年龄阶段替代具体岁数/, "Facts must instruct exact factual answers");
assert.match(template, /年龄：\{\{age\}\} 岁/, "Default template must expose exact numeric age");

const helperStart = mainSource.indexOf("function removeTooltip$1");
const characterStart = mainSource.indexOf("class Character {");
const characterEnd = mainSource.indexOf("\nclass ", characterStart + 1);
assert(helperStart >= 0 && characterStart > helperStart && characterEnd > characterStart, "Character parser must be extractable");
eval(mainSource.slice(helperStart, characterEnd).replace("class Character", "globalThis.__TestCharacter = class Character"));
const rawCharacter = Array(27).fill("");
rawCharacter[0] = 2;
rawCharacter[1] = "张三";
rawCharacter[2] = "河间公张三";
rawCharacter[3] = "<i>河间公</i>";
rawCharacter[4] = "他";
rawCharacter[5] = "<b>37</b>岁";
rawCharacter[8] = "未知";
const parsedCharacter = new globalThis.__TestCharacter(rawCharacter);
assert.strictEqual(parsedCharacter.age, 37, "Rich-text age must retain its numeric value");
assert.strictEqual(parsedCharacter.primaryTitle, "河间公", "Rich-text title must retain its visible value");

const descriptionPath = path.join(root, "resources", "app", "default_userdata", "prompts", "character_description", "standard", "pListMccTest2.js");
const buildDescription = require(descriptionPath);
const makeCharacter = (primaryTitle) => ({
  id: 2,
  shortName: "张三",
  firstName: "张三",
  fullName: "河间公张三",
  primaryTitle,
  age: 37,
  traits: [],
  relationsToCharacters: [],
  opinionBreakdowns: [],
  relationsToPlayer: [],
  isRuler: true,
  isIndependentRuler: false,
  consort: "",
  liege: "皇帝",
  faith: "儒教",
  culture: "汉",
  sexuality: "",
  personality: "冷静",
  gold: 100,
  opinionOfPlayer: 0,
  titleRankConcept: "concept_duchy"
});
const titled = makeCharacter("河间公");
const noTitle = makeCharacter("None");
const gameData = {
  playerID: 1,
  aiID: 2,
  date: "1066年1月1日",
  location: "开封",
  locationController: "河间公张三",
  scene: "throne_room",
  characters: new Map([[1, { ...makeCharacter("皇帝"), id: 1, shortName: "玩家", fullName: "皇帝玩家" }], [2, titled]])
};
assert.match(buildDescription(gameData, 2), /age: 37/, "Description script must retain exact age");
assert.match(buildDescription(gameData, 2), /primary title: 河间公/, "Description script must retain valid title");
gameData.characters.set(2, noTitle);
assert.doesNotMatch(buildDescription(gameData, 2), /primary title: None/, "None title placeholder must not reach the prompt");

const descriptionDir = path.dirname(descriptionPath);
for (const file of fs.readdirSync(descriptionDir).filter((name) => /^pListMccTest2(?:JE)?(?:_[A-Z]{2})?\.js$/.test(name))) {
  const content = fs.readFileSync(path.join(descriptionDir, file), "utf8");
  assert(!content.includes('char.primaryTitle !== "None of" ||'), `${file} must not use the always-true title check`);
}

console.log("VOTC character game facts: PASS (exact age, title, court position, and None-title boundaries)");
