"use strict";

const assert = require("assert");
const { figures } = require("../resources/app/out/main/historical-system/historical-data/figures");
const { HISTORICAL_ALIAS_CATALOG } = require("../resources/app/out/main/worldline/historical-alias-catalog");
const { resolveHistoricalIdentity } = require("../resources/app/out/main/worldline/historical-identity-resolver");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

function character(id, birth = "1103.3.24") {
  return { id, firstName: `runtime_${id}`, birth, gender: "male", culture: "汉", alive: true };
}

const canonicalNames = new Map(figures.map((figure) => [figure.figureKey, figure.identity.name]));
for (const entry of HISTORICAL_ALIAS_CATALOG) assert.equal(entry.aliases[0], canonicalNames.get(entry.figureKey), "the alias catalog must reuse the canonical Historical Figure name");

const ambiguousSnapshot = {
  gameDate: "1155.1.1",
  characters: { "96896": character("96896"), "96897": character("96897") },
  nameToCharacterIds: {},
  definitionToRuntime: { nansong_yue_085: "96896", tangyin_yue_014: "96897" },
  runtimeToDefinitions: { "96896": ["nansong_yue_085"], "96897": ["tangyin_yue_014"] },
  titles: {}
};
const ambiguous = resolveHistoricalIdentity({ alias: "岳飞", figureKey: "yue_fei", candidateDefinitionIds: ["nansong_yue_085", "tangyin_yue_014"], snapshot: ambiguousSnapshot });
assert.equal(ambiguous.status, "AMBIGUOUS", "two equally evidenced runtime candidates must fail closed");
assert.equal(ambiguous.resolvedRuntimeId, null, "an ambiguous identity must not select a runtime ID");
assert.equal(ambiguous.candidates.length, 2, "all observed bindings must remain reviewable candidates");

const analysis = analyzeSharedQuery({ snapshot: ambiguousSnapshot, query: "岳飞在哪里", findLocalizedKeys: () => ({ status: "NO_MATCH", matches: [], sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] }) });
assert.deepEqual(analysis.characters, [], "ambiguous historical candidates must not enter compatibility Game Truth characters");
assert.equal(analysis.candidateCharacters.length, 2, "the analyzer must expose ambiguous candidates separately");
assert.equal(analysis.identityResolution.status, "AMBIGUOUS", "the shared query model must surface ambiguity explicitly");

const resolvedSnapshot = {
  ...ambiguousSnapshot,
  characters: { "96896": character("96896") },
  definitionToRuntime: { nansong_yue_085: "96896" },
  runtimeToDefinitions: { "96896": ["nansong_yue_085"] }
};
const resolved = resolveHistoricalIdentity({ alias: "岳飞", figureKey: "yue_fei", candidateDefinitionIds: ["nansong_yue_085", "tangyin_yue_014"], snapshot: resolvedSnapshot });
assert.equal(resolved.status, "RESOLVED", "one evidence-complete candidate must resolve through the V8.3 threshold");
assert.equal(resolved.resolvedRuntimeId, "96896", "only the thresholded runtime may become Game Truth");
assert.ok(resolved.candidates[0].evidence.some((item) => item.code === "AGE_MATCH_STRONG"), "the resolver must retain V8.3 age evidence");
assert.ok(resolved.candidates[0].evidence.some((item) => item.code === "GENDER_MATCH"), "the resolver must retain V8.3 gender evidence");

const rejectedSnapshot = { ...resolvedSnapshot, characters: { "96896": { ...character("96896", "1060.1.1"), gender: "female" } } };
const rejectedAnalysis = analyzeSharedQuery({ snapshot: rejectedSnapshot, query: "岳飞", findLocalizedKeys: () => ({ status: "NO_MATCH", matches: [], sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] }) });
assert.equal(rejectedAnalysis.identityResolution.status, "NO_MATCH", "the shared Query contract must map resolver rejection to NO_MATCH");
assert.equal(rejectedAnalysis.characters.length, 0, "rejected candidates must remain outside Game Truth");
console.log("V8.4.2 Historical Identity: PASS (candidate split, threshold resolution and fail-closed ambiguity)");
