"use strict";

const assert = require("assert");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

function snapshot(nameToCharacterIds, characters) {
  return {
    gameDate: "1169.1.1",
    nameToCharacterIds,
    indexes: { verifiedFullNameToRuntimeIds: nameToCharacterIds },
    characters,
    definitionToRuntime: {},
    runtimeToDefinitions: {},
    titles: {}
  };
}

const unique = analyzeSharedQuery({
  snapshot: snapshot({ "赵思昭": ["101"] }, { "101": { id: "101", firstName: "思昭", fullName: "赵思昭" } }),
  query: "赵思昭",
  historicalDefinitionLookup: () => ({ status: "NAME_INDEX_MISS", sourceComplete: true })
});
assert.deepEqual(unique.characters.map((item) => item.id), ["101"]);
assert.equal(unique.entityResolutions.find((item) => item.subjectName === "赵思昭").identityKind, "RUNTIME_NATIVE");
assert.equal(unique.entityResolutions.find((item) => item.subjectName === "赵思昭").resolutionStatus, "RESOLVED");
assert.equal(unique.historicalCoverage[0].status, "NAME_INDEX_MISS", "a historical index miss remains diagnostic only");

const ambiguous = analyzeSharedQuery({
  snapshot: snapshot({ "李明": ["201", "202"] }, { "201": { id: "201", fullName: "李明" }, "202": { id: "202", fullName: "李明" } }),
  query: "李明在哪里？"
});
assert.equal(ambiguous.characters.length, 0, "ambiguous native names cannot become current facts");
assert.equal(ambiguous.entityResolutions[0].resolutionStatus, "AMBIGUOUS");
assert.deepEqual(ambiguous.entityResolutions[0].runtimeIds, ["201", "202"]);

const direct = analyzeSharedQuery({
  snapshot: snapshot({ "赵思昭": ["101"] }, { "101": { id: "101", firstName: "思昭", fullName: "赵思昭" } }),
  query: "#101"
});
assert.equal(direct.entityResolutions[0].identityKind, "RUNTIME_NATIVE");
assert.equal(direct.entityResolutions[0].resolutionStatus, "RESOLVED");

const historicalBound = analyzeSharedQuery({
  snapshot: { ...snapshot({ "岳飞": ["301"] }, { "301": { id: "301", fullName: "岳飞" } }), definitionToRuntime: { yue: "301" }, runtimeToDefinitions: { "301": ["yue"] } },
  query: "岳飞在哪里？"
});
assert(!historicalBound.entityResolutions.some((item) => item.identityKind === "RUNTIME_NATIVE"), "a runtime with Historical Definition IDs must never bypass the historical gate as native");

console.log("V8.5.2 Runtime Native: PASS (unique, ambiguous, direct ID and historical-gate separation)");
