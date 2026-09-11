"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveRelationMention } = require("../resources/app/out/main/worldline/relation-mention-resolver");
const { createRelationshipResolver } = require("../resources/app/out/main/game-data/relationship-resolver");
const { formatStructuredCharacter } = require("../resources/app/out/main/worldline/character-family-facts");

const graph = buildKinshipGraph({
  1: { id: 1, fullName: "父亲", gender: "male", children: [2] },
  2: { id: 2, fullName: "孩子", gender: "unknown", evidence: { conflicts: { gender: true } } }
});
const result = resolveRelationMention({ query: "你儿子怎么样", responderId: 1, graph });
assert.equal(result.status, "RELATION_GENDER_CONFLICT");
assert.equal(graph.relationBetween(2, 1).relation.label, "子女", "a conflicted gender must not produce a gendered kinship label");
const formatted = formatStructuredCharacter({ id: 2, fullName: "孩子", gender: "male", evidence: { conflicts: { gender: true } } });
assert(formatted.text.includes("性别：未知"));
assert(!formatted.text.includes("性别：男性"));
const profiles = createRelationshipResolver({ onDiagnostic: () => false }).buildCanonicalProfiles(new Map([
  [1, { id: 1, fullName: "父亲", children: [{ id: 2, name: "孩子", gender: "female" }] }],
  [2, { id: 2, fullName: "孩子", gender: "male" }]
]), 430000, () => "unknown");
assert.equal(profiles.get(2).gender, "male", "canonical Runtime gender must outrank relation-entry payload gender");
assert.equal(profiles.get(2).evidence.conflicts.gender, false);
assert.equal(profiles.get(2).evidence.conflicts.genderDisagreement, true, "the lower-authority disagreement must remain diagnosable");
console.log("V8.8 Relation Gender Conflict: PASS");
