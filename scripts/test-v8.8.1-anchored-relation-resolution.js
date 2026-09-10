"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { inferGenderFromPronoun } = require("../resources/app/out/main/game-data/character");

const characters = new Map([
  [1, { id: 1, fullName: "岳月娥", gender: "female" }],
  [10, { id: 10, fullName: "赵德昭", shortName: "幽王", primaryTitle: "宋幽王", gender: "male", children: [11, 12, 13] }],
  [11, { id: 11, fullName: "赵允长", gender: "male", birthDateTotalDays: 420000 }],
  [12, { id: 12, fullName: "赵允韬", gender: "male", birthDateTotalDays: 430000 }],
  [13, { id: 13, fullName: "赵静宜", gender: "female", birthDateTotalDays: 435000 }]
]);
const graph = buildKinshipGraph(characters);
const goldenQuery = "嗯~朕听闻最近幽王府又得一子，名唤什么？我一边喝茶一边问道";
const golden = resolveAnchoredRelationMention({ query: goldenQuery, responderId: 1, graph });
assert.equal(golden.status, "RELATION_RESOLVED");
assert.equal(golden.responderRuntimeId, "1");
assert.equal(golden.relationAnchorRuntimeId, "10");
assert.equal(golden.targetRuntimeId, "12");
assert.equal(golden.intent.sexConstraint, "male");
assert.equal(golden.anchor.source, "TITLE_MATCH");

const female = resolveAnchoredRelationMention({ query: "赵德昭最近得的女儿叫什么？", responderId: 1, graph });
assert.equal(female.status, "RELATION_RESOLVED");
assert.equal(female.relationAnchorRuntimeId, "10");
assert.equal(female.targetRuntimeId, "13");
assert.equal(female.target.sex, "female");
assert.equal(female.intent.recency, "latest");

const direct = resolveAnchoredRelationMention({ query: "你儿子近日如何？", responderId: 10, graph });
assert.equal(direct.status, "RELATION_AMBIGUOUS");
assert.equal(direct.relationAnchorRuntimeId, "10");

const familyBlock = buildFamilyFactBlock(characters.get(1), { date: "1175.2.1", getMentionableCharacterProfiles: () => characters }, { query: goldenQuery });
assert.match(familyBlock, /查询关系主体：赵德昭/);
assert.match(familyBlock, /目标人物：赵允韬/);
assert.match(familyBlock, /性别：男性/);
assert.doesNotMatch(familyBlock, /女儿|她|女子/);
assert.equal(buildFamilyFactBlock(characters.get(1), { date: "1175.2.1", getMentionableCharacterProfiles: () => characters }, { query: "今夜月色甚好。" }), null);

const failClosed = buildFamilyFactBlock(characters.get(1), { date: "1175.2.1", getMentionableCharacterProfiles: () => characters }, { query: "听闻某府新得一子。" });
assert.match(failClosed, /男性亲属/);
assert.match(failClosed, /不得将该目标改写为女性/);

const ambiguousTitles = buildKinshipGraph({
  1: { id: 1, fullName: "回应者" },
  20: { id: 20, fullName: "甲", primaryTitle: "幽王", children: [21] },
  21: { id: 21, fullName: "甲子", gender: "male", birthDateTotalDays: 1 },
  30: { id: 30, fullName: "乙", primaryTitle: "幽王", children: [31] },
  31: { id: 31, fullName: "乙子", gender: "male", birthDateTotalDays: 2 }
});
assert.equal(resolveAnchoredRelationMention({ query: "幽王府又得一子", responderId: 1, graph: ambiguousTitles }).status, "ANCHOR_AMBIGUOUS");

const missingBirthGraph = buildKinshipGraph({
  1: { id: 1, fullName: "回应者" },
  40: { id: 40, fullName: "曹王", primaryTitle: "曹王", children: [41, 42] },
  41: { id: 41, fullName: "长子", gender: "male" },
  42: { id: 42, fullName: "次子", gender: "male" }
});
const missingBirth = resolveAnchoredRelationMention({ query: "曹王府又得一子", responderId: 1, graph: missingBirthGraph });
assert.equal(missingBirth.status, "RELATION_AMBIGUOUS");
assert.equal(missingBirth.reason, "BIRTH_ORDER_UNAVAILABLE");

const GameData = createGameData({ fs: {}, path: {}, memorySystem: {}, memoryEngine: { findMentionedCharactersInHistory: () => [] }, summariesDir: "", getHistoricalReferenceByYear: () => ({}) });
const aliasGame = new GameData([1, "父亲", 2, "回应者", "1175年2月1日", "talk_scene_court", "京师", "父亲", 430100]);
aliasGame.characters = new Map([
  [1, { id: 1, fullName: "父亲", shortName: "父亲", firstName: "父亲", gender: "male", parents: [], children: [{ id: 2, name: "长子", gender: "male", birthDateTotalDays: 430000 }, { id: 3, name: "次女", gender: "female", birthDateTotalDays: 430050 }], siblings: [], traits: [], relationsToPlayer: [], relationsToCharacters: [], consort: "" }]
]);
const aliases = aliasGame.getMentionableCharacterProfiles();
assert(aliases.get(2).mentionAliases.includes("儿子") && aliases.get(2).mentionAliases.includes("长子"));
assert(aliases.get(3).mentionAliases.includes("女儿") && aliases.get(3).mentionAliases.includes("长女"));
assert.equal(inferGenderFromPronoun("他"), "male");

console.log("V8.8.1 Anchored Relation Resolution: PASS");
