"use strict";

const assert = require("assert");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

const snapshot = {
  characters: { 1: { id: 1, firstName: "李青" }, 2: { id: 2, firstName: "李青" } },
  indexes: { verifiedFullNameToRuntimeIds: {}, givenNameToRuntimeIds: { "李青": ["1", "2"] } },
  definitionToRuntime: {}, runtimeToDefinitions: {}
};
const result = analyzeSharedQuery({ snapshot, query: "李青怎么样", runtimeContext: { activeParticipantIds: [2] } });
assert.deepEqual(result.resolvedCharacters.map((character) => character.id), ["2"]);
assert.equal(result.entityResolutions.find((entity) => entity.identityKind === "RUNTIME_NATIVE").resolutionMode, "RESOLVED_CONTEXTUALLY");
console.log("V8.8 Runtime Context Disambiguation: PASS");
