"use strict";

const assert = require("assert");
const path = require("path");
const { splitCharacterProfile } = require("../resources/app/out/main/prompts/character-profile-split");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { Character } = require("../resources/app/out/main/game-data/character");

const person = (id, name) => ({ id, shortName: name, firstName: name, fullName: name, gender: "male", sheHe: "他", age: 30, gold: 100, prowess: 5, personality: "Calm", culture: "Han", faith: "Confucian", traits: [], parents: [], children: [], siblings: [], relationsToCharacters: [], opinions: [], opinionBreakdowns: [], titleRankConcept: "concept_none" });
const player = person(1, "玩家");
player.nickname = "铁面";
player.traits = [
  { category: "身体特质", name: "美丽的外貌", desc: "拥有悦人的外表" },
  { category: "身体特质", name: "强壮", desc: "体格强健" },
  { category: "性格特质", name: "勇敢", desc: "不惧危险" },
  { category: "生活方式特质", name: "猎手", desc: "善于狩猎" }
];
const npc = person(2, "父亲");
const child = { ...person(3, "儿子"), age: 10, parents: [2] };
npc.children = [3];
const data = { playerID: 1, aiID: 2, date: "1186.1.1", location: "宫廷", locationController: "玩家", scene: "garden", characters: new Map([[1, player], [2, npc], [3, child]]) };
for (const scriptName of ["pListMccTest2.js", "pListMccTest2_ZH.js"]) {
  const script = path.resolve(__dirname, "../resources/app/default_userdata/prompts/character_description/standard", scriptName);
  const before = PromptScriptSandbox.executeDescription(script, { gameData: data, currentCharacterId: 2 });
  const split = splitCharacterProfile(before);
  assert(split.stableContent.includes("父亲"));
  assert(split.dynamicContent.includes("宫廷"));
  assert.doesNotMatch(split.stableContent, /(?:age:|年龄：|marital status:|婚姻状况：)/);
  // Every original item remains in exactly one profile, including family and
  // privacy-filtered content. Only headings/separators may be repeated.
  for (const item of before.split(/; \r?\n/).slice(1, -1)) {
    if (item.includes("]\n[")) continue;
    assert(split.stableContent.includes(item) || split.dynamicContent.includes(item), item);
  }
  npc.age = 31;
  npc.gold = 300;
  npc.primaryTitle = "新头衔";
  data.date = "1187.1.1";
  const after = splitCharacterProfile(PromptScriptSandbox.executeDescription(script, { gameData: data, currentCharacterId: 2 }));
  assert.strictEqual(after.stableContent, split.stableContent);
  assert.notStrictEqual(after.dynamicContent, split.dynamicContent);
  assert(after.dynamicContent.includes("新头衔"));
  assert(after.dynamicContent.includes("1187.1.1"));
  npc.age = 30; npc.gold = 100; delete npc.primaryTitle; data.date = "1186.1.1";
}
for (const scriptName of ["pListMccTest2_ZH.js", "pListMccTest2JE_ZH.js"]) {
  const chineseScript = path.resolve(__dirname, "../resources/app/default_userdata/prompts/character_description/standard", scriptName);
  const playerDescription = PromptScriptSandbox.executeDescription(chineseScript, { gameData: data, currentCharacterId: 2 });
  const playerStart = playerDescription.indexOf("[玩家的角色信息：");
  const nextCharacterStart = playerDescription.indexOf("\n[", playerStart + 1);
  const playerLine = playerDescription.slice(playerStart, nextCharacterStart < 0 ? undefined : nextCharacterStart).replace(/\n/g, " ");
  assert(playerStart >= 0, "the player must have a separate character description");
  assert.match(playerLine, /绰号：铁面/);
  assert.match(playerLine, /外貌特质：美丽的外貌（拥有悦人的外表）/);
  assert.match(playerLine, /身体特质：强壮（体格强健）/);
  const appearanceField = playerLine.match(/外貌特质：([^;；\]]+)/)?.[1] || "";
  const bodyField = playerLine.match(/身体特质：([^;；\]]+)/)?.[1] || "";
  assert.doesNotMatch(appearanceField, /勇敢|猎手/, "unrelated traits must not enter the appearance field");
  assert.doesNotMatch(bodyField, /勇敢|猎手/, "unrelated traits must not enter the body field");
  assert.match(playerLine, /性格特质：勇敢/);
  assert.match(playerLine, /其他特质：猎手/);
  const playerProfileSplit = splitCharacterProfile(playerDescription);
  assert(playerProfileSplit.dynamicContent.includes("绰号：铁面"));
  assert(playerProfileSplit.dynamicContent.includes("身体特质：强壮"));
  assert(!playerProfileSplit.stableContent.includes("绰号：铁面"), "current nickname and appearance must remain in the live tail");
}
const characterData = Array(27).fill("");
characterData[0] = "1";
characterData[1] = "玩家";
characterData[2] = "玩家，铁面";
characterData[4] = "他";
characterData[5] = "30";
characterData[18] = "玩家";
assert.equal(new Character(characterData).nickname, "", "older CK3 character rows without a nickname field remain supported");
assert.equal(new Character([...characterData, "铁面"]).nickname, "铁面", "the appended CK3 nickname field is parsed explicitly");
const custom = "Custom identity and fresh family runtime";
assert.deepStrictEqual(splitCharacterProfile(custom), { stableContent: "", dynamicContent: custom });
console.log("V8.9.1 runtime profile PASS: shipped EN/ZH scripts, stable identity, fresh state, preserved items, custom fallback");
