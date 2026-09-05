"use strict";

const assert = require("assert");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");
const { lookup, scanHistoricalNames } = require("../resources/app/out/main/worldline/historical-definition-index");

const record = {
  definitionId: "subject", displayName: "韩世忠", names: ["韩世忠"], sourceComplete: true, conflicts: [],
  metadata: { birthDate: "1089.1.1", gender: "male", parents: { father: "father", mother: "mother" }, siblings: [], spouses: ["spouse"], children: ["child"] }
};
const index = { revision: "fixture", state: "READY", sourceComplete: true, exactNames: { "韩世忠": ["subject"] }, exactAliases: {}, byId: { subject: record } };
const state = {
  gameDate: "1169.1.1",
  characters: {
    "1": { id: "1", fullName: "韩世忠", birth: "1090.1.1", gender: "male", parents: { father: "20", mother: "21" }, spouse: "31", children: ["41"] },
    "10": { id: "10" }, "11": { id: "11" }, "30": { id: "30" }, "40": { id: "40" }
  },
  nameToCharacterIds: { "韩世忠": ["1"] },
  definitionToRuntime: { subject: "1", father: "10", mother: "11", spouse: "30", child: "40" },
  runtimeToDefinitions: { "1": ["subject"], "10": ["father"], "11": ["mother"], "30": ["spouse"], "40": ["child"] }, titles: {}
};
const result = analyzeSharedQuery({ snapshot: state, query: "韩世忠在哪里？", historicalDefinitionLookup: (value) => lookup(index, value), historicalNameScan: (value) => scanHistoricalNames(index, value) });
const entity = result.entityResolutions[0];
assert.equal(entity.identityKind, "HISTORICAL");
assert.equal(entity.resolutionStatus, "RESOLVED", "worldline differences cannot lower identity resolution");
assert.deepEqual(entity.worldlineDifferences.map((item) => item.code), ["AGE_WORLDLINE_SHIFT", "FATHER_DIFFERENT", "MOTHER_DIFFERENT", "SPOUSE_DIFFERENT", "CHILDREN_DIFFERENT"]);
assert(entity.worldlineDifferences.every((item) => ["INFO", "NOTICE"].includes(item.severity)));

console.log("V8.5.2 Worldline Difference: PASS (informational divergence never changes identity)");
