"use strict";

const assert = require("assert");
const path = require("path");
const { splitCharacterProfile } = require("../resources/app/out/main/prompts/character-profile-split");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");

const person = (id, name) => ({ id, shortName: name, firstName: name, fullName: name, gender: "male", sheHe: "他", age: 30, gold: 100, prowess: 5, personality: "Calm", culture: "Han", faith: "Confucian", traits: [], parents: [], children: [], siblings: [], relationsToCharacters: [], opinions: [], opinionBreakdowns: [], titleRankConcept: "concept_none" });
const player = person(1, "玩家");
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
const custom = "Custom identity and fresh family runtime";
assert.deepStrictEqual(splitCharacterProfile(custom), { stableContent: "", dynamicContent: custom });
console.log("V8.9.1 runtime profile PASS: shipped EN/ZH scripts, stable identity, fresh state, preserved items, custom fallback");
