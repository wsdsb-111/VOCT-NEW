"use strict";

const assert = require("assert");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

const snapshot = {
  characters: { "96896": { id: "96896", firstName: "Yuefei_name", alive: true, location: "8841" } },
  nameToCharacterIds: { yuefei_name: ["96896"] },
  definitionToRuntime: { nansong_yue_085: "96896" },
  runtimeToDefinitions: { "96896": ["nansong_yue_085"] },
  titles: {}
};
const analysis = analyzeSharedQuery({ snapshot, query: "岳飞", findLocalizedKeys: () => ({ status: "NO_MATCH", matches: [], sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] }) });
assert.deepEqual(analysis.characters.map((item) => item.id), ["96896"], "a frozen historical alias must bridge directly to the checkpoint runtime ID");
assert.ok(analysis.characters[0].matchSources.includes("historical_alias"), "historical aliases must retain independent identity provenance");
assert.deepEqual(analysis.resolverTrace.historical.matchedDefinitionIds, ["nansong_yue_085", "tangyin_yue_014"], "the trace must disclose every catalog definition instead of silently choosing one");
assert.equal(analysis.resolverTrace.historical.status, "AMBIGUOUS", "a multi-definition historical alias must remain explicitly ambiguous");
assert.deepEqual(analysis.resolverTrace.historical.matchedRuntimeIds, ["96896"], "only directly observed definition-to-runtime bindings may yield a runtime character");
console.log("V8.4.1 Hotfix Historical Alias: PASS (catalog bridge, provenance and ambiguity)");
