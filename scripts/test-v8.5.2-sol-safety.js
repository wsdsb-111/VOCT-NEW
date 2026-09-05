"use strict";

const assert = require("assert");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");
const { lookup, scanHistoricalNames } = require("../resources/app/out/main/worldline/historical-definition-index");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

function historicalRecord(definitionId, name) {
  return { definitionId, displayName: name, names: [name], sourceComplete: true, conflicts: [], metadata: { birthDate: "1090.1.1", gender: "male", parents: {}, spouses: [], children: [] } };
}

const record = historicalRecord("han", "韩世忠");
const index = { revision: "sol-stage-3", state: "READY", sourceComplete: true, exactNames: { "韩世忠": ["han"] }, exactAliases: {}, byId: { han: record } };
const historicalSnapshot = {
  gameDate: "1169.1.1",
  characters: { "1": { id: "1", fullName: "韩世忠", firstName: "世忠", birth: "900.1.1", gender: "male" } },
  nameToCharacterIds: { "韩世忠": ["1"] }, definitionToRuntime: { han: "1" }, runtimeToDefinitions: { "1": ["han"] }, titles: {},
  auditSentinel: "X".repeat(200000)
};
const historical = analyzeSharedQuery({ snapshot: historicalSnapshot, query: "韩世忠", historicalDefinitionLookup: (value) => lookup(index, value), historicalNameScan: (value) => scanHistoricalNames(index, value) });
assert.equal(historical.identityResolution.status, "RESOLVED");
assert(!Object.hasOwn(historical.identityResolution, "snapshot"), "legacy identityResolution must never carry the full checkpoint snapshot");
assert(!Object.hasOwn(historical.identityResolution, "definitionRecords"), "legacy identityResolution must not gain internal source records");
assert(!JSON.stringify(historical).includes(historicalSnapshot.auditSentinel), "query diagnostics must not serialize unrelated checkpoint payloads");
assert(JSON.stringify(historical).length < 20000, "one resolved identity must remain a bounded IPC payload");
assert.deepEqual(historical.entityResolutions[0].worldlineDifferences.map((item) => item.code), ["AGE_WORLDLINE_SHIFT"]);
assert(historical.entityResolutions[0].identityEvidence.every((item) => item.category !== "WORLDLINE_DIFFERENCE"));

const truncatedNames = {};
const truncatedCharacters = {};
for (let number = 0; number < 33; number += 1) {
  const name = `人物${String(number).padStart(2, "0")}`;
  truncatedNames[name] = [String(1000 + number)];
  truncatedCharacters[String(1000 + number)] = { id: String(1000 + number), fullName: name };
}
const truncated = analyzeSharedQuery({ snapshot: { characters: truncatedCharacters, nameToCharacterIds: truncatedNames, definitionToRuntime: {}, runtimeToDefinitions: {}, titles: {} }, query: Object.keys(truncatedNames).join("、") });
assert.equal(truncated.characters.length, 0, "an incomplete Runtime name scan cannot inject partial Game Truth");
assert(truncated.entityResolutions.length > 0 && truncated.entityResolutions.every((item) => item.resolutionStatus === "SOURCE_INCOMPLETE" && item.candidateSetComplete === false));

const mixedSnapshot = { characters: { "10": { fullName: "同名人物" }, "11": { fullName: "同名人物" } }, nameToCharacterIds: { "同名人物": ["10", "11"] }, definitionToRuntime: { historical: "10" }, runtimeToDefinitions: { "10": ["historical"] }, titles: {} };
const mixed = analyzeSharedQuery({ snapshot: mixedSnapshot, query: "同名人物" });
assert.equal(mixed.characters.length, 0, "a mixed historical/native same-name set cannot enter the native shortcut");
assert(!mixed.entityResolutions.some((item) => item.identityKind === "RUNTIME_NATIVE"));

const numeric = analyzeSharedQuery({ snapshot: { characters: { "1168": { fullName: "数字人物" } }, nameToCharacterIds: {}, definitionToRuntime: {}, runtimeToDefinitions: {}, titles: {} }, query: "岳飞在1168年在哪里" });
assert(!numeric.characters.some((item) => item.id === "1168"), "a year inside prose cannot enter Runtime Direct");

const incompleteCandidate = analyzeSharedQuery({
  snapshot: historicalSnapshot,
  query: "韩世忠",
  historicalDefinitionLookup: () => ({ status: "FOUND", candidates: [record], candidateTotal: 500, candidateSetComplete: false, sourceComplete: true })
});
assert.equal(incompleteCandidate.entityResolutions[0].resolutionStatus, "SOURCE_INCOMPLETE");
assert.equal(incompleteCandidate.entityResolutions[0].candidateTotal, 500, "Domain DTO must preserve the authoritative untruncated candidate total");
assert.equal(incompleteCandidate.characters.length, 0);

function mapping(indexResult) {
  return WorldlineService.prototype.getHistoricalBindings.call({
    currentCheckpoint: { snapshot: { characters: {}, definitionToRuntime: {}, runtimeToDefinitions: {} } },
    getLiveState: () => ({ characters: [] }),
    historicalDefinitionIndex: { find: () => indexResult }
  }, { query: "韩世忠" });
}
const missingRuntime = mapping({ status: "FOUND", candidates: [record], candidateTotal: 1, candidateSetComplete: true, sourceComplete: true });
const missingEntity = analyzeSharedQuery({ snapshot: { ...historicalSnapshot, characters: {}, definitionToRuntime: {}, runtimeToDefinitions: {}, nameToCharacterIds: {} }, query: "韩世忠", historicalDefinitionLookup: value => lookup(index, value), historicalNameScan: value => scanHistoricalNames(index, value) });
assert.equal(missingEntity.entityResolutions[0].resolutionStatus, "DEFINITION_FOUND_RUNTIME_MISSING", "Domain DTO must preserve missing-runtime coverage");
assert.equal(missingRuntime.coverageStatus, "DEFINITION_FOUND_RUNTIME_MISSING");
assert.equal(missingRuntime.playerView.coverageStatus, "DEFINITION_FOUND_RUNTIME_MISSING");
const sourceIncomplete = mapping({ status: "FOUND", candidates: [record], candidateTotal: 1, candidateSetComplete: true, sourceComplete: false });
assert.equal(sourceIncomplete.coverageStatus, "SOURCE_INCOMPLETE", "source incompleteness must outrank missing Runtime in Mapping and Player DTO");

console.log("V8.5.2 Sol Stage 3 Safety: PASS (bounded DTO, native truncation, false-resolution, namespace and coverage priority)");
