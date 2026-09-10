"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");

const characters = new Map([
  [1, { id: 1, fullName: "父亲", children: [2] }],
  [2, { id: 2, fullName: "孩子", gender: "unknown", evidence: { conflicts: { gender: true } } }]
]);
const graph = buildKinshipGraph(characters);
const result = resolveAnchoredRelationMention({ query: "你儿子怎么样", responderId: 1, graph });
assert.equal(result.status, "RELATION_GENDER_CONFLICT");

const block = buildFamilyFactBlock(characters.get(1), { date: "1175.1.1", getMentionableCharacterProfiles: () => characters }, { query: "你儿子怎么样" });
assert.match(block, /不能确认该人物为男性或女性/);
assert.match(block, /不得依据玩家称谓替代 CK3 性别事实/);
assert.doesNotMatch(block, /必须作为男性亲属处理/);

console.log("V8.8.2 Gender Conflict Authority: PASS");
