"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveRelationMention } = require("../resources/app/out/main/worldline/relation-mention-resolver");

const graph = buildKinshipGraph({
  1: { id: 1, fullName: "父亲", gender: "male", children: [2, 3] },
  2: { id: 2, fullName: "长子", gender: "male", alive: true },
  3: { id: 3, fullName: "次子", gender: "male", alive: true }
});
const result = resolveRelationMention({ query: "你儿子近日如何", responderId: 1, graph });
assert.equal(result.status, "RELATION_AMBIGUOUS");
assert.deepEqual(result.candidates.map((candidate) => candidate.runtimeId), ["2", "3"]);
console.log("V8.8 Relation Multiple Sons Ambiguous: PASS");
