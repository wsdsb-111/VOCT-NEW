"use strict";
const assert = require("assert");
const { createRelationshipResolver } = require("../resources/app/out/main/game-data/relationship-resolver");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const resolver = createRelationshipResolver({ onDiagnostic: () => false });
const subject = { id: 1, gender: "male", parents: [{ id: 2 }], children: [{ id: 2 }], siblings: [], evidence: { relations: [] } };
const other = { id: 2, gender: "female", parents: [], children: [], siblings: [], evidence: { relations: [] } };
assert.equal(resolver.resolveDirectKinship(subject, other), null);
const graph = buildKinshipGraph({
  1: { id: 1, gender: "male", children: [2], spouses: [2] },
  2: { id: 2, gender: "female" }
});
const graphConflict = graph.relationBetween(1, 2);
assert.equal(graphConflict.relation, null);
assert.equal(graphConflict.diagnostic.code, "RELATION_CONFLICT_TYPE");
console.log("V8.6.2 Relation Conflict Fail Closed: PASS");
