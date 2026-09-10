"use strict";

const assert = require("assert");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");

const GameData = createGameData({ fs: {}, path: {}, memorySystem: {}, memoryEngine: { findMentionedCharactersInHistory: () => [] }, summariesDir: "", getHistoricalReferenceByYear: () => ({}) });
const game = new GameData([1, "父亲", 9, "回应者", "1175年2月1日", "talk_scene_court", "京师", "父亲", 430100]);
game.characters = new Map([
  [1, {
    id: 1,
    fullName: "父亲",
    shortName: "父亲",
    firstName: "父亲",
    gender: "male",
    parents: [],
    children: [
      { id: 2, name: "同日甲", gender: "male", birthDateTotalDays: 100 },
      { id: 3, name: "同日乙", gender: "male", birthDateTotalDays: 100 },
      { id: 4, name: "缺日期", gender: "female" }
    ],
    siblings: [],
    traits: [],
    relationsToPlayer: [],
    relationsToCharacters: [],
    consort: ""
  }]
]);
const aliases = game.getMentionableCharacterProfiles();
for (const id of [2, 3]) {
  assert(aliases.get(id).mentionAliases.includes("儿子"));
  assert(!aliases.get(id).mentionAliases.some((alias) => ["长子", "次子", "幼子"].includes(alias)), "tied birth dates must not create order aliases");
}
assert(aliases.get(4).mentionAliases.includes("女儿"));
assert(!aliases.get(4).mentionAliases.some((alias) => ["长女", "次女", "幼女"].includes(alias)), "missing birth dates must not create order aliases");

console.log("V8.8.2 Child Alias Tie: PASS");
