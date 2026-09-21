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

// Real save shape: a generated character has a localized house name and a
// localized given-name key, but no historical definition or Live conversation.
const { parseGameState } = require("../resources/app/out/main/worldline/game-state-adapter");
const nativeSave = parseGameState(`date=1157.1.1 played_character={character=50979}
living={81358={first_name=Dejun_name2 dynasty_house=15938} 50979={first_name=Gou_69CB}}
dynasties={dynasty_house={15938={localized_name="上官" dynasty=15360}}}`);
assert.equal(nativeSave.dynastyHouses["15938"].localizedName, "上官");
const nativeQuery = (state = nativeSave, confidence = "CONFIRMED", sourceComplete = true) => analyzeSharedQuery({
  snapshot: state, query: "上官德俊在哪里", historicalDefinitionLookup: () => ({ status: "NAME_INDEX_MISS", sourceComplete: true }),
  localize: (_type, key) => ({ rawKey: key, localizedValue: "德俊", confidence }),
  findLocalizedKeys: (type, term) => type === "character" && term === "德俊"
    ? { status: "CONFLICT", matches: [], matchedRawKeys: ["Dejun_unused", "Dejun_name2"], sourceComplete }
    : { status: "NO_MATCH", matches: [], sourceComplete: true }
});
const nativeResolved = nativeQuery();
assert.deepEqual(nativeResolved.characters.map(row => row.id), ["81358"]);
assert.equal(nativeResolved.characters[0].displayName, "上官德俊");
assert.equal(nativeResolved.entityResolutions.length, 1, "a full-name result must not retain a stale UNKNOWN/given-name duplicate");
assert.equal(nativeResolved.entityResolutions[0].candidateTotal, 1);
assert.deepEqual(nativeQuery(nativeSave, "CONFLICT").characters, [], "ambiguous localization values fail closed");
assert.deepEqual(nativeQuery(nativeSave, "CONFIRMED", false).characters, [], "incomplete source cannot authorize a full name");
const sameName = { ...nativeSave, characters: { ...nativeSave.characters, "90000": { id: "90000", firstName: "Dejun_name2", dynastyHouse: "15938" } }, nameToCharacterIds: { ...nativeSave.nameToCharacterIds, dejun_name2: ["81358", "90000"] } };
const nativeAmbiguous = nativeQuery(sameName);
assert.deepEqual(nativeAmbiguous.characters, []);
assert.equal(nativeAmbiguous.entityResolutions[0].candidateTotal, 2, "two distinct runtime IDs keep real ambiguity");

console.log("V8.5.2 Runtime Native: PASS (unique, ambiguous, direct ID, saved house names, localization and historical-gate separation)");
