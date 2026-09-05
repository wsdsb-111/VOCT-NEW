"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { HistoricalNameScanner } = require("../resources/app/out/main/worldline/historical-name-scanner");
const { buildHistoricalDefinitionIndex, scanHistoricalNames, lookup } = require("../resources/app/out/main/worldline/historical-definition-index");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

const names = ["司马光", "欧阳修", "耶律阿保机", "完颜阿骨打", "赵思", "韩世忠"];
const index = { revision: "fixture", state: "READY", sourceComplete: true, exactNames: Object.create(null), exactAliases: Object.create(null), byId: Object.create(null) };
const snapshot = { characters: {}, nameToCharacterIds: { "赵思昭": ["100"], "赵思": ["101"] }, definitionToRuntime: {}, runtimeToDefinitions: {}, titles: {}, gameDate: "1155.1.1" };
for (const [i, name] of names.entries()) {
  const id = `definition_${i}`, runtime = String(i + 1);
  index.exactNames[name] = [id];
  index.byId[id] = { definitionId: id, names: [name], displayName: name, sourceComplete: true, metadata: { birthDate: "1100.1.1", gender: "male" }, conflicts: [] };
  snapshot.characters[runtime] = { firstName: name, birth: "1100.1.1", gender: "male" };
  snapshot.definitionToRuntime[id] = runtime;
  snapshot.runtimeToDefinitions[runtime] = [id];
}
snapshot.characters["100"] = { firstName: "赵思昭" };
snapshot.characters["101"] = { firstName: "赵思" };
const query = "今日请问耶律阿保机与完颜阿骨打、欧阳修、司马光各在何处，赵思昭是否回来？";
const scan = scanHistoricalNames(index, query);
assert.deepEqual(scan.matches.map(m => m.value), ["耶律阿保机", "完颜阿骨打", "欧阳修", "司马光", "赵思"]);
const analyze = (value, source = index) => analyzeSharedQuery({ snapshot, query: value, historicalNameScan: text => scanHistoricalNames(source, text), historicalDefinitionLookup: text => lookup(source, text) });
const result = analyze(query);
assert.deepEqual(result.historicalCoverage.map(item => item.alias), ["耶律阿保机", "完颜阿骨打", "欧阳修", "司马光"]);
assert(!result.candidateCharacterIds.includes("101"), "short runtime name cannot take a longer runtime name's span");
assert(result.candidateCharacterIds.includes("100"), "full runtime name is retained for the later native identity path");
assert(!result.historicalCoverage.some(item => item.alias === "赵思"), "historical prefix cannot hijack a runtime-native full name inside a sentence");
assert.deepEqual(analyze("赵思与赵思昭在哪里").historicalCoverage.map(item => item.alias), ["赵思"], "an independent short-name mention survives a separate long-name mention");
assert.equal(analyze("耶律阿保机").historicalCoverage[0].status, "RESOLVED");
const givenNameSnapshot = { ...snapshot, nameToCharacterIds: { "思昭": ["100"] } };
const givenNameQuery = analyzeSharedQuery({ snapshot: givenNameSnapshot, query: "韩世忠、赵思昭", historicalNameScan: text => scanHistoricalNames(index, text), historicalDefinitionLookup: text => lookup(index, text) });
assert(!givenNameQuery.historicalCoverage.some(item => item.alias === "赵思"), "crossing historical prefix must not split a current character's given name");
const singleGivenName = analyzeSharedQuery({ snapshot: givenNameSnapshot, query: "赵思昭", historicalNameScan: text => scanHistoricalNames(index, text), historicalDefinitionLookup: text => lookup(index, text) });
assert.equal(singleGivenName.entityResolutions.length, 1, "historical index miss cannot create a duplicate entity beside a native given-name match");
assert.equal(singleGivenName.entityResolutions[0].identityKind, "RUNTIME_NATIVE");
const independent = analyzeSharedQuery({ snapshot: givenNameSnapshot, query: "赵思、赵思昭", historicalNameScan: text => scanHistoricalNames(index, text), historicalDefinitionLookup: text => lookup(index, text) });
assert(independent.historicalCoverage.some(item => item.alias === "赵思"), "separate complete historical mention survives");
const partial = analyze("耶律阿保机", { ...index, sourceComplete: false });
assert.equal(partial.characters.length, 0);
assert.equal(partial.historicalCoverage[0].status, "SOURCE_INCOMPLETE");
const scanner = new HistoricalNameScanner(["赵思", "赵思昭", "思昭", "John Smith"]);
assert.deepEqual(scanner.scan("赵思和赵思昭").matches.map(m => m.value), ["赵思", "赵思昭"]);
assert.equal(scanner.scan("Ｊｏｈｎ Ｓｍｉｔｈ").matches[0].value, "john smith");
assert.equal(scanner.scan("赵思，".repeat(33)).candidateSetComplete, false);
assert.equal(scanner.scan("赵思" + "啊".repeat(3000)).candidateSetComplete, false);
const overflow = analyze("耶律阿保机，".repeat(33));
assert.equal(overflow.characters.length, 0, "entity truncation cannot certify a historical match");
const overrideOverflow = analyze("耶律阿保机，".repeat(33) + "岳飞");
assert.equal(overrideOverflow.historicalCoverage.find(item => item.alias === "岳飞").status, "SOURCE_INCOMPLETE", "manual alias overrides cannot bypass an incomplete scanner result");
const originalRead = fs.readFileSync;
try {
  fs.readFileSync = () => { throw new Error("query_file_io_forbidden"); };
  for (let i = 0; i < 100; i++) assert.equal(scanHistoricalNames(index, query).matches.length, 5);
} finally { fs.readFileSync = originalRead; }
const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v852-compound-name-"));
try {
  fs.mkdirSync(path.join(sourceRoot, "history", "characters"), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, "common", "dynasties"), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, "localization", "simp_chinese"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "history", "characters", "fixture.txt"), "compound_001 = { name = \"修\" dynasty = compound_dyn culture = han }\nlong_002 = { name = \"阿保机\" dynasty = long_dyn culture = khitan }\n", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "common", "dynasties", "fixture.txt"), "compound_dyn = { name = compound_surname }\nlong_dyn = { name = long_surname }\n", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "localization", "simp_chinese", "fixture_l_simp_chinese.yml"), "l_simp_chinese:\ncompound_surname:0 \"欧阳\"\nlong_surname:0 \"耶律\"\n", "utf8");
  const compoundIndex = buildHistoricalDefinitionIndex({ sources: [{ root: sourceRoot, sourceId: "fixture", modId: "fixture" }] });
  assert.equal(lookup(compoundIndex, "欧阳修").status, "FOUND", "a verified compound surname must compose a searchable full name");
  assert.equal(lookup(compoundIndex, "耶律阿保机").status, "FOUND", "a verified long-name source chain must compose without raw-key guessing");
} finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
console.log("V8.5.2 historical name scanner: PASS (long names, NFKC, overlap, runtime prefix, per-entity results, bounds and no file IO)");
