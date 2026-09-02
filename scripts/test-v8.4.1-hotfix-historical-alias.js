"use strict";

const assert = require("assert");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

const snapshot = {
  gameDate: "1155.1.1",
  characters: {
    "96896": { id: "96896", firstName: "Yuefei_name", birth: "1103.3.24", gender: "male", culture: "汉", alive: true, location: "8841" },
    "96897": { id: "96897", firstName: "Yuefei_copy", birth: "1103.3.24", gender: "male", culture: "汉", alive: true, location: "8842" }
  },
  nameToCharacterIds: { yuefei_name: ["96896"], yuefei_copy: ["96897"] },
  definitionToRuntime: { nansong_yue_085: "96896", tangyin_yue_014: "96897" },
  runtimeToDefinitions: { "96896": ["nansong_yue_085"], "96897": ["tangyin_yue_014"] },
  titles: {}
};
const analysis = analyzeSharedQuery({ snapshot, query: "岳飞", findLocalizedKeys: () => ({ status: "NO_MATCH", matches: [], sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] }) });
assert.deepEqual(analysis.characters, [], "ambiguous historical aliases must never become authoritative Game Truth");
assert.equal(analysis.candidateCharacters.length, 2, "each runtime binding must remain visible as a candidate");
assert.ok(analysis.candidateCharacters.every((item) => !Object.hasOwn(item, "displayName")), "candidate aliases must not expose an authoritative localized identity");
assert.deepEqual(analysis.resolverTrace.historical.matchedDefinitionIds, ["nansong_yue_085", "tangyin_yue_014"], "the trace must disclose every catalog definition instead of silently choosing one");
assert.equal(analysis.resolverTrace.historical.status, "AMBIGUOUS", "a multi-definition historical alias must remain explicitly ambiguous");
assert.deepEqual(analysis.resolverTrace.historical.matchedRuntimeIds, ["96896", "96897"], "only directly observed definition-to-runtime bindings may yield candidates");
assert.equal(analysis.identityResolution.status, "AMBIGUOUS", "equal historical evidence must fail closed instead of choosing a runtime");
console.log("V8.4.1 Hotfix Historical Alias: PASS (catalog candidates, ambiguity and authoritative gate)");
