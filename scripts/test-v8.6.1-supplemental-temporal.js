"use strict";

const assert = require("assert");
const { buildWorldCandidates } = require("../resources/app/out/main/worldline/world-retriever");
const { classifySelectedWorldFacts } = require("../resources/app/out/main/worldline/world-knowledge-classifier");

const snapshot = { gameDate: "1170.6.6", characters: {}, titles: {} };
const [candidate] = buildWorldCandidates({ snapshot, analysis: {}, supplemental: [{ id: "a", title: "设定", body: "当前可知", visibility: "PUBLIC_WORLD" }] });
assert.equal(candidate.gameDate, "1170.6.6", "missing Supplemental date defaults to its checkpoint date");
const [safe] = classifySelectedWorldFacts({ supplemental: [candidate] }, snapshot.gameDate);
assert.equal(safe.temporalSafe, true);
const [future] = classifySelectedWorldFacts({ supplemental: [{ ...candidate, gameDate: "1171.1.1" }] }, snapshot.gameDate);
assert.equal(future.temporalSafe, false, "future Supplemental cannot become prompt-safe");
console.log("V8.6.1 Supplemental Temporal: PASS (checkpoint default and future exclusion evidence)");
