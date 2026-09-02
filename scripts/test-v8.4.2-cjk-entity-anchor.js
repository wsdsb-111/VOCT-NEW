"use strict";

const assert = require("assert");
const { analysisTextMatches, analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

const snapshot = { characters: {}, nameToCharacterIds: {}, definitionToRuntime: {}, runtimeToDefinitions: {}, titles: {} };
const generic = analyzeSharedQuery({ snapshot, query: "现在在哪里怎么说", findLocalizedKeys: () => ({ status: "NO_MATCH", matches: [], sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] }) });
assert.deepEqual(generic.entityAnchoredTerms, [], "CJK question words alone must not count as entity anchors");
assert.ok(generic.genericTerms.includes("现在") && generic.genericTerms.includes("哪里"), "common CJK question terms must be classified for diagnostics");
assert.equal(analysisTextMatches(generic, "岳飞正在襄阳。"), false, "generic CJK questions must not retrieve unrelated supplemental knowledge");

const anchored = analyzeSharedQuery({ snapshot, query: "岳飞现在在哪里", findLocalizedKeys: () => ({ status: "NO_MATCH", matches: [], sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] }) });
assert.ok(anchored.entityAnchoredTerms.includes("岳飞"), "a historical entity mention remains an explicit supplemental recall anchor");
assert.equal(analysisTextMatches(anchored, "岳飞正在襄阳。"), true, "an explicit entity anchor may retrieve related supplemental knowledge");
console.log("V8.4.2 CJK Entity Anchor: PASS (generic-question isolation and explicit entity recall)");
