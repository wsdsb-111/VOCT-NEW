"use strict";

const assert = require("assert");
const { parseGameState } = require("../resources/app/out/main/worldline/game-state-adapter");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

function snapshot(overrides = {}) {
  return {
    gameDate: "1170.1.1",
    characters: {
      "101": { id: "101", firstName: "世忠" },
      "102": { id: "102", firstName: "思昭", fullName: "赵思昭" }
    },
    nameToCharacterIds: { "世忠": ["101"], "思昭": ["102"] },
    definitionToRuntime: {},
    runtimeToDefinitions: {},
    titles: {},
    ...overrides
  };
}

const givenOnly = analyzeSharedQuery({ snapshot: snapshot(), query: "韩世忠" });
assert.deepEqual(givenOnly.characters, [], "a unique given-name substring cannot resolve a Runtime-native character");
assert.equal(givenOnly.entityResolutions[0].identityKind, "RUNTIME_NATIVE");
assert.equal(givenOnly.entityResolutions[0].resolutionStatus, "AMBIGUOUS");
assert.equal(givenOnly.entityResolutions[0].nameMatchKind, "GIVEN_NAME");
assert.deepEqual(givenOnly.entityResolutions[0].runtimeIds, ["101"]);

const hinted = analyzeSharedQuery({ snapshot: snapshot(), query: "韩世忠", mentionedEntityIds: ["101"] });
assert.deepEqual(hinted.characters, [], "a memory entity hint cannot upgrade a given-name candidate");

const parserSnapshot = parseGameState("date=1170.1.1 living={ 101={ first_name=世忠 } 102={ first_name=思昭 } } dead_unprunable={} characters={ dead_prunable={} }");
assert.deepEqual(parserSnapshot.nameToCharacterIds["世忠"], ["101"], "the production parser fixture must expose its current given-name-only shape");
assert.deepEqual(analyzeSharedQuery({ snapshot: parserSnapshot, query: "韩世忠" }).characters, [], "real parser output cannot manufacture a full name from query text");
assert.deepEqual(analyzeSharedQuery({ snapshot: parserSnapshot, query: "赵思昭" }).characters, [], "a second real parser given name must remain a candidate");

const unverifiedFullName = analyzeSharedQuery({
  snapshot: snapshot({ characters: { "103": { id: "103", firstName: "世忠", fullName: "韩世忠" } }, nameToCharacterIds: { "韩世忠": ["103"] } }),
  query: "韩世忠"
});
assert.deepEqual(unverifiedFullName.characters, [], "an unproven fullName string or legacy alias map cannot satisfy FULL_VERIFIED_NAME");

const verified = snapshot({
  indexes: {
    verifiedFullNameToRuntimeIds: { "赵思昭": ["102"] },
    givenNameToRuntimeIds: { "思昭": ["102"] }
  }
});
const exact = analyzeSharedQuery({ snapshot: verified, query: "赵思昭" });
assert.deepEqual(exact.characters.map((item) => item.id), ["102"]);
assert.equal(exact.entityResolutions[0].resolutionStatus, "RESOLVED");
assert.equal(exact.entityResolutions[0].nameMatchKind, "FULL_VERIFIED_NAME");

const duplicate = analyzeSharedQuery({
  snapshot: snapshot({
    characters: { "201": { id: "201", firstName: "明" }, "202": { id: "202", firstName: "明" } },
    nameToCharacterIds: { "明": ["201", "202"] },
    indexes: { verifiedFullNameToRuntimeIds: { "李明": ["201", "202"] }, givenNameToRuntimeIds: { "明": ["201", "202"] } }
  }),
  query: "李明"
});
assert.deepEqual(duplicate.characters, []);
assert.equal(duplicate.entityResolutions[0].resolutionStatus, "AMBIGUOUS");

const historicalLatinSnapshot = snapshot({
  characters: { "301": { id: "301", firstName: "John", fullName: "John Smith" } },
  nameToCharacterIds: { "John Smith": ["301"] },
  indexes: { verifiedFullNameToRuntimeIds: { "John Smith": ["301"] }, givenNameToRuntimeIds: { John: ["301"] } },
  definitionToRuntime: { john_history: "301" },
  runtimeToDefinitions: { "301": ["john_history"] }
});
const historicalLatin = analyzeSharedQuery({
  snapshot: historicalLatinSnapshot,
  query: "John Smith"
});
assert.deepEqual(historicalLatin.characters, [], "a historical-bound Latin name cannot bypass Historical Identity through the native alias path");

assert.deepEqual(analyzeSharedQuery({ snapshot: snapshot(), query: "#101" }).characters.map((item) => item.id), ["101"], "an explicit Runtime ID remains available");
assert.deepEqual(analyzeSharedQuery({ snapshot: historicalLatinSnapshot, query: "#301" }).characters.map((item) => item.id), ["301"], "an explicit Runtime ID identifies the save object even when it has a historical binding");

console.log("V8.6 Runtime-native Safety: PASS (verified full names, given-name candidates, hints, aliases and direct IDs)");
