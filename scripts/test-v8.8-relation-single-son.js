"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveRelationMention } = require("../resources/app/out/main/worldline/relation-mention-resolver");

const graph = buildKinshipGraph({
  1: { id: 1, fullName: "父亲", gender: "male", children: [2] },
  2: { id: 2, fullName: "长子", gender: "male", alive: true }
});
const result = resolveRelationMention({ query: "你儿子近日如何", responderId: 1, graph });
assert.equal(result.status, "RELATION_RESOLVED");
assert.equal(result.targetRuntimeId, "2");
assert.deepEqual(result.relation.structuredPath, [{ type: "CHILD_OF", from: "2", to: "1" }]);
console.log("V8.8 Relation Single Son: PASS");
