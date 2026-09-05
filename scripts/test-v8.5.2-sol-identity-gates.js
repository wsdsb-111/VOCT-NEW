"use strict";

const assert = require("assert");
const { resolveHistoricalIdentity } = require("../resources/app/out/main/worldline/historical-identity-resolver");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");
const { lookup, scanHistoricalNames } = require("../resources/app/out/main/worldline/historical-definition-index");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

function record(definitionId = "yue") {
  return { definitionId, displayName: "韩世忠", names: ["韩世忠"], metadata: { birthDate: "1089.1.1", gender: "male" }, conflicts: [], sourceComplete: true };
}

function snapshot(overrides = {}) {
  return {
    gameDate: "1168.1.1",
    characters: {
      "100": { id: "100", firstName: "世忠", fullName: "韩世忠", birth: "900.1.1", gender: "male", father: "different", children: ["changed"] },
      "1168": { id: "1168", firstName: "某人", fullName: "某人", gender: "male" }
    },
    nameToCharacterIds: { "韩世忠": ["100"] },
    definitionToRuntime: { yue: "100" },
    runtimeToDefinitions: { "100": ["yue"] },
    titles: {},
    ...overrides
  };
}

const baseRecord = record();
const resolve = (state = snapshot(), extra = {}) => resolveHistoricalIdentity({ alias: "韩世忠", candidateDefinitionIds: ["yue"], definitionRecords: [baseRecord], snapshot: state, ...extra });

const shifted = resolve();
assert.equal(shifted.status, "RESOLVED", "age and family divergence cannot lower Historical Identity");
assert.equal(shifted.reason, "HISTORICAL_IDENTITY_CORE_CONFIRMED");
assert(shifted.evidence.filter(item => item.category === "IDENTITY_CORE").every(item => !/AGE|FATHER|MOTHER|SIBLING|SPOUSE|CHILD/.test(item.code)));
assert(!shifted.evidence.some(item => item.code.startsWith("AGE_")), "age evidence must leave the identity gate entirely");

const unknownGender = resolve(snapshot({ characters: { ...snapshot().characters, "100": { ...snapshot().characters["100"], gender: "unknown" } } }));
assert.equal(unknownGender.status, "RESOLVED", "unknown runtime gender is neutral");
assert(unknownGender.evidence.some(item => item.code === "GENDER_UNKNOWN" && item.category === "IDENTITY_SUPPORT"));

const genderConflict = resolve(snapshot({ characters: { ...snapshot().characters, "100": { ...snapshot().characters["100"], gender: "female" } } }));
assert.equal(genderConflict.status, "REJECTED");
assert.equal(genderConflict.reason, "GENDER_CONFLICT");
assert.equal(genderConflict.resolvedRuntimeId, null);

const multipleDefinitions = resolveHistoricalIdentity({ alias: "韩世忠", candidateDefinitionIds: ["yue", "yue_copy"], definitionRecords: [baseRecord, record("yue_copy")], snapshot: snapshot({ definitionToRuntime: { yue: "100", yue_copy: "101" }, runtimeToDefinitions: { "100": ["yue"], "101": ["yue_copy"] }, characters: { ...snapshot().characters, "101": { id: "101", fullName: "韩世忠", gender: "male" } } }) });
assert.equal(multipleDefinitions.status, "AMBIGUOUS");
assert.equal(multipleDefinitions.reason, "MULTIPLE_DEFINITIONS");
assert.equal(multipleDefinitions.resolvedRuntimeId, null);

const multipleRuntime = resolve(snapshot({ characters: { ...snapshot().characters, "101": { id: "101", fullName: "韩世忠", gender: "male" } }, runtimeToDefinitions: { "100": ["yue"], "101": ["yue"] } }));
assert.equal(multipleRuntime.status, "AMBIGUOUS");
assert.equal(multipleRuntime.reason, "DEFINITION_RUNTIME_BINDING_CONFLICT");

const reverseOnly = resolve(snapshot({ definitionToRuntime: {} }));
assert.equal(reverseOnly.status, "REJECTED");
assert.equal(reverseOnly.reason, "DEFINITION_RUNTIME_BINDING_CONFLICT");

const sourceConflict = resolveHistoricalIdentity({ alias: "韩世忠", candidateDefinitionIds: ["yue"], definitionRecords: [{ ...baseRecord, conflicts: ["DEFINITION_SOURCE_CONFLICT"] }], snapshot: snapshot() });
assert.equal(sourceConflict.status, "REJECTED");
assert.equal(sourceConflict.reason, "DEFINITION_SOURCE_CONFLICT");

assert.equal(resolve(snapshot(), { candidateSetComplete: false }).reason, "CANDIDATE_SET_INCOMPLETE");
assert.equal(resolve(snapshot(), { sourceComplete: false, candidateSetComplete: false }).reason, "SOURCE_INCOMPLETE", "source incompleteness has first refusal priority");
assert.equal(resolveHistoricalIdentity({ alias: "韩世忠", candidateDefinitionIds: ["yue"], definitionRecords: [{ ...baseRecord, sourceComplete: false }], snapshot: snapshot() }).reason, "SOURCE_INCOMPLETE", "record-level incompleteness must also fail closed");

const index = { revision: "sol-stage-1", state: "READY", sourceComplete: true, exactNames: { "韩世忠": ["yue"] }, exactAliases: {}, byId: { yue: baseRecord } };
const analyze = (query, state = snapshot(), source = index, extra = {}) => analyzeSharedQuery({ snapshot: state, query, historicalNameScan: text => scanHistoricalNames(source, text), historicalDefinitionLookup: text => lookup(source, text), ...extra });
const dated = analyze("韩世忠在1168年在哪里？", snapshot({ definitionToRuntime: { yue: "100", "1168": "1168" } }));
assert.deepEqual(dated.characters.map(item => item.id), ["100"]);
assert(!dated.resolvedCharacters.some(item => item.id === "1168"), "a year inside a sentence cannot enter Runtime ID namespace");
assert(!dated.entityAnchoredTerms.includes("1168"), "a parsed year cannot become an entity anchor");
const exactAdversarial = analyzeSharedQuery({ snapshot: snapshot(), query: "岳飞在1168年在哪里？" });
assert(!exactAdversarial.resolvedCharacters.some(item => item.id === "1168"), "the specified 岳飞 + 1168 adversarial query cannot resolve the year as a character");
assert.deepEqual(analyze("1168").characters.map(item => item.id), ["1168"], "a whole-query numeric ID remains Runtime Direct");
assert.deepEqual(analyze("#1168").characters.map(item => item.id), ["1168"], "an explicit #RuntimeId remains Runtime Direct");

const rejectedState = snapshot({ characters: { ...snapshot().characters, "100": { ...snapshot().characters["100"], gender: "female" } } });
const localizationBypass = analyze("韩世忠", rejectedState, index, { mentionedEntityIds: ["100"], findLocalizedKeys: () => ({ status: "MATCHED", matches: [{ rawKey: "韩世忠" }], sourceComplete: true }) });
assert.equal(localizationBypass.characters.length, 0, "mentioned, memory and localization paths cannot bypass a rejected historical identity");

const partialIndex = { ...index, state: "PARTIAL", sourceComplete: false, byId: { yue: { ...baseRecord, sourceComplete: false } } };
const partial = analyze("韩世忠", snapshot({ definitionToRuntime: {} }), partialIndex);
assert.equal(partial.historicalCoverage[0].status, "SOURCE_INCOMPLETE");
assert.equal(partial.characters.length, 0);

const missingRuntime = analyze("韩世忠", snapshot({ definitionToRuntime: {}, runtimeToDefinitions: {} }));
assert.equal(missingRuntime.historicalCoverage[0].status, "DEFINITION_FOUND_RUNTIME_MISSING");
const rejected = analyze("韩世忠", rejectedState);
assert.equal(rejected.historicalCoverage[0].status, "REJECTED_BY_EVIDENCE");
const miss = analyze("欧阳修");
assert.equal(miss.historicalCoverage[0].status, "NAME_INDEX_MISS");

const mappingResult = WorldlineService.prototype.getHistoricalBindings.call({
  currentCheckpoint: { snapshot: snapshot({ definitionToRuntime: {} }) },
  getLiveState: () => ({ characters: [] }),
  historicalDefinitionIndex: { find: () => ({ status: "FOUND", candidates: [baseRecord], sourceComplete: false, candidateSetComplete: true }) }
}, { query: "韩世忠" });
assert.equal(mappingResult.coverageStatus, "SOURCE_INCOMPLETE", "Historical Mapping cannot overwrite source incompleteness with runtime missing");
assert.equal(mappingResult.playerView.coverageStatus, "SOURCE_INCOMPLETE", "the additive Player DTO must preserve the same priority");

console.log("V8.5.2 Sol identity gates: PASS (core identity, numeric namespace, coverage priority and false-injection safety)");
