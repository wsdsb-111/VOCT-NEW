"use strict";

const assert = require("assert");
const { getCachedKinshipGraph, getTargetedKinshipGraph } = require("../resources/app/out/main/worldline/kinship-graph-cache");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");

const gameData = {
  characters: new Map([
    [10, { id: 10, fullName: "父亲", children: [1, 2] }],
    [1, { id: 1, fullName: "回应者", gender: "male", birthDateTotalDays: 100, parents: [10] }],
    [2, { id: 2, fullName: "手足", gender: "male", birthDateTotalDays: 200, parents: [10] }]
  ])
};

const firstBirthGraph = getTargetedKinshipGraph(gameData, [1]);
assert.equal(resolveAnchoredRelationMention({ query: "你弟弟是谁", responderId: 1, graph: firstBirthGraph }).targetRuntimeId, "2");
gameData.characters.set(1, { id: 1, fullName: "回应者", gender: "male", birthDateTotalDays: 300, parents: [10] });
const secondBirthGraph = getTargetedKinshipGraph(gameData, [1]);
assert.notStrictEqual(secondBirthGraph, firstBirthGraph, "birth-date changes must invalidate a targeted kinship graph without an external revision");
assert.equal(resolveAnchoredRelationMention({ query: "你弟弟是谁", responderId: 1, graph: secondBirthGraph }).status, "RELATION_UNKNOWN");

gameData.characters.set(1, { id: 1, fullName: "父亲", children: [2] });
gameData.characters.set(2, { id: 2, fullName: "孩子", gender: "male", parents: [1] });
const firstGenderGraph = getTargetedKinshipGraph(gameData, [1]);
assert.equal(resolveAnchoredRelationMention({ query: "你儿子是谁", responderId: 1, graph: firstGenderGraph }).targetRuntimeId, "2");
gameData.characters.set(2, { id: 2, fullName: "孩子", gender: "female", parents: [1] });
const secondGenderGraph = getTargetedKinshipGraph(gameData, [1]);
assert.notStrictEqual(secondGenderGraph, firstGenderGraph, "gender changes must invalidate a targeted kinship graph without an external revision");
assert.equal(resolveAnchoredRelationMention({ query: "你儿子是谁", responderId: 1, graph: secondGenderGraph }).status, "RELATION_UNKNOWN");

const cachedData = {
  characters: new Map([
    [1, { id: 1, fullName: "父亲", children: [2] }],
    [2, { id: 2, fullName: "孩子", gender: "male", birthDateTotalDays: 200 }]
  ])
};
const firstCachedGraph = getCachedKinshipGraph(cachedData);
assert.equal(resolveAnchoredRelationMention({ query: "你儿子是谁", responderId: 1, graph: firstCachedGraph }).targetRuntimeId, "2");
cachedData.characters.set(2, { id: 2, fullName: "孩子", gender: "female", birthDateTotalDays: 300 });
const secondCachedGraph = getCachedKinshipGraph(cachedData);
assert.notStrictEqual(secondCachedGraph, firstCachedGraph, "the full kinship graph must share demographic invalidation coverage");
assert.equal(resolveAnchoredRelationMention({ query: "你儿子是谁", responderId: 1, graph: secondCachedGraph }).status, "RELATION_UNKNOWN");

console.log("V8.8.2 Relation Cache Demographics: PASS");
