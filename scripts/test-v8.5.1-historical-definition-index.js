"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildHistoricalDefinitionIndex, lookup } = require("../resources/app/out/main/worldline/historical-definition-index");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v851-index-"));
function write(relativePath, text) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}
function makeSource(directory, date = "1090.1.26") {
  write(`${directory}/history/characters/han.txt`, `han_022 = {\n  name = \"世忠\"\n  dynasty = han_dyn\n  culture = han\n  female = no\n  ${date} = { birth = yes }\n}\n`);
  write(`${directory}/common/dynasties/han.txt`, "han_dyn = { name = han_surname }\n");
  write(`${directory}/localization/simp_chinese/han_l_simp_chinese.yml`, "l_simp_chinese:\nhan_surname:0 \"韩\"\n");
}
function snapshot(runtime = true) {
  return {
    gameDate: "1155.1.1",
    characters: runtime ? { "96896": { id: "96896", firstName: "世忠", birth: "1090.1.26", gender: "male", culture: "han", alive: true } } : {},
    definitionToRuntime: runtime ? { han_022: "96896" } : {},
    runtimeToDefinitions: runtime ? { "96896": ["han_022"] } : {},
    nameToCharacterIds: {},
    titles: {}
  };
}

try {
  makeSource("base");
  const index = buildHistoricalDefinitionIndex({ sources: [{ root: path.join(root, "base"), sourceId: "base", modId: null }] });
  const hit = lookup(index, "韩世忠");
  assert.equal(hit.status, "FOUND", "a localized dynasty plus literal given name must form a full-name key");
  assert.equal(hit.candidates[0].definitionId, "han_022");
  assert.equal(lookup(index, "han_022").status, "NAME_INDEX_MISS", "raw definition IDs must not be manufactured as historical display names");
  assert.equal(lookup(index, "赵思昭").status, "NAME_INDEX_MISS", "unindexed names must remain explicit misses");
  const nameIndexMissAnalysis = analyzeSharedQuery({ snapshot: snapshot(), query: "赵思昭", historicalDefinitionLookup: (value) => lookup(index, value) });
  assert.equal(nameIndexMissAnalysis.historicalCoverage[0].status, "NAME_INDEX_MISS", "short CJK diagnostic queries must expose an explicit index miss");

  const resolved = analyzeSharedQuery({ snapshot: snapshot(), query: "韩世忠在哪里", historicalDefinitionLookup: (value) => lookup(index, value) });
  assert.deepEqual(resolved.characters.map((character) => character.id), ["96896"], "generic definition lookup may enter Game Truth only after evidence resolution");
  assert.equal(resolved.historicalCoverage[0].status, "RESOLVED");

  const missingRuntime = analyzeSharedQuery({ snapshot: snapshot(false), query: "韩世忠", historicalDefinitionLookup: (value) => lookup(index, value) });
  assert.equal(missingRuntime.characters.length, 0);
  assert.equal(missingRuntime.historicalCoverage[0].status, "DEFINITION_FOUND_RUNTIME_MISSING", "a definition without a runtime binding is never a fact");

  const reverseOnly = snapshot();
  reverseOnly.definitionToRuntime = {};
  const reverseOnlyAnalysis = analyzeSharedQuery({ snapshot: reverseOnly, query: "韩世忠", historicalDefinitionLookup: (value) => lookup(index, value) });
  assert.deepEqual(reverseOnlyAnalysis.characters, [], "a reverse-only definition mapping cannot satisfy the bidirectional identity gate");
  assert.equal(reverseOnlyAnalysis.historicalCoverage[0].status, "REJECTED_BY_EVIDENCE");

  const inconsistentBinding = snapshot();
  inconsistentBinding.runtimeToDefinitions = {};
  const inconsistentAnalysis = analyzeSharedQuery({ snapshot: inconsistentBinding, query: "韩世忠", historicalDefinitionLookup: (value) => lookup(index, value) });
  assert.equal(inconsistentAnalysis.characters.length, 0, "a scalar forward mapping without reciprocal evidence must not certify identity");
  assert.equal(inconsistentAnalysis.historicalCoverage[0].status, "REJECTED_BY_EVIDENCE");

  const partial = buildHistoricalDefinitionIndex({ sources: [{ root: path.join(root, "base"), sourceId: "base", modId: null }], complete: false, missing: ["fixture.mod"] });
  const partialAnalysis = analyzeSharedQuery({ snapshot: snapshot(), query: "韩世忠", historicalDefinitionLookup: (value) => lookup(partial, value) });
  assert.equal(partialAnalysis.characters.length, 0, "incomplete sources must not confirm a historical identity");
  assert.equal(partialAnalysis.historicalCoverage[0].status, "SOURCE_INCOMPLETE");

  makeSource("override", "1091.1.1");
  const conflicted = buildHistoricalDefinitionIndex({ sources: [
    { root: path.join(root, "base"), sourceId: "base", modId: null },
    { root: path.join(root, "override"), sourceId: "mod:fixture", modId: "fixture" }
  ] });
  assert.notEqual(conflicted.revision, index.revision, "source content changes must alter the index revision even when the playset name is unchanged");
  assert.ok(lookup(conflicted, "韩世忠").candidates[0].conflicts.includes("DEFINITION_SOURCE_CONFLICT"));
  const conflictAnalysis = analyzeSharedQuery({ snapshot: snapshot(), query: "韩世忠", historicalDefinitionLookup: (value) => lookup(conflicted, value) });
  assert.equal(conflictAnalysis.characters.length, 0, "source conflicts must fail closed instead of selecting a load-order winner");
  assert.equal(conflictAnalysis.historicalCoverage[0].status, "REJECTED_BY_EVIDENCE");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("V8.5.1 Historical Definition Index: PASS (generic names, source completeness, runtime binding and conflict safety)");
