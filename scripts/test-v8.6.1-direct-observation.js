"use strict";

const assert = require("assert");
const { buildPresenceObservationFacts } = require("../resources/app/out/main/worldline/direct-observation-producer");
const { buildSubjectiveWorldView } = require("../resources/app/out/main/worldline/subjective-world-builder");

const facts = buildPresenceObservationFacts({ responderId: 1, presentCharacterIds: [1, 2], characters: new Map([[2, { firstName: "乙" }]]), asOf: "1170.6.6" });
assert.equal(facts.length, 1);
assert.equal(facts[0].knowledgeLevel, "DIRECT_OBSERVATION");
assert(facts[0].value.includes("本次对话场景"));
assert.equal(buildPresenceObservationFacts({ responderId: 1, presentCharacterIds: [2], characters: new Map([[2, { firstName: "乙" }]]) }).length, 0, "an absent responder cannot receive invented observation");
const view = buildSubjectiveWorldView({ responder: { id: "1" }, candidates: facts, scope: { asOf: "1170.6.6", completeness: "COMPLETE" } });
assert.equal(view.allowedFacts.length, 1, "the listed observer receives the current-presence fact");
console.log("V8.6.1 Direct Observation: PASS (current presence only, observer-bound)");
