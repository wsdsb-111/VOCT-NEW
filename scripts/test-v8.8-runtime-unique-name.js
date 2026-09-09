"use strict";

const assert = require("assert");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

const snapshot = {
  characters: { 1: { id: 1, firstName: "赵明", fullName: "赵明" } },
  indexes: { verifiedFullNameToRuntimeIds: { "赵明": ["1"] }, givenNameToRuntimeIds: { "赵明": ["1"] } },
  definitionToRuntime: {}, runtimeToDefinitions: {}
};
const result = analyzeSharedQuery({ snapshot, query: "赵明在哪里" });
assert.deepEqual(result.resolvedCharacters.map((character) => character.id), ["1"]);
assert.equal(result.entityResolutions.find((entity) => entity.identityKind === "RUNTIME_NATIVE").resolutionMode, "RESOLVED_RUNTIME");
console.log("V8.8 Runtime Unique Name: PASS");
