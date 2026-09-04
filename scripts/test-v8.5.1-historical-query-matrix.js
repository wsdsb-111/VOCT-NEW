"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildHistoricalDefinitionIndex, lookup } = require("../resources/app/out/main/worldline/historical-definition-index");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

const people = [
  ["岳", "飞"], ["辛", "弃疾"], ["韩", "世忠"], ["秦", "桧"], ["赵", "构"],
  ["吴", "玠"], ["宗", "泽"], ["张", "浚"], ["张", "俊"], ["李", "纲"],
  ["范", "仲淹"], ["王", "安石"], ["苏", "轼"], ["文", "天祥"], ["赵", "匡胤"]
].map(([surname, given], index) => ({ surname, given, name: `${surname}${given}`, definitionId: `fixture_${index}`, runtimeId: String(90000 + index), birth: index === 0 ? "1103.3.24" : index === 1 ? "1140.5.28" : "1090.1.1" }));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v851-matrix-"));
const source = path.join(root, "source");
function write(relativePath, text) {
  const filePath = path.join(source, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}
function makeSnapshot(entries = people) {
  return {
    gameDate: "1155.1.1",
    characters: Object.fromEntries(entries.map((person) => [person.runtimeId, { id: person.runtimeId, firstName: person.given, birth: person.birth, gender: "male", alive: true }])),
    definitionToRuntime: Object.fromEntries(entries.map((person) => [person.definitionId, person.runtimeId])),
    runtimeToDefinitions: Object.fromEntries(entries.map((person) => [person.runtimeId, [person.definitionId]])),
    nameToCharacterIds: {},
    titles: {}
  };
}
function analyze(index, snapshot, query, resolver = lookup) {
  return analyzeSharedQuery({ snapshot, query, historicalDefinitionLookup: (value) => resolver(index, value) });
}

try {
  write("history/characters/fixture.txt", people.map((person) => `${person.definitionId} = {\n name = \"${person.given}\"\n dynasty = dynn_${person.definitionId}\n culture = han\n female = no\n ${person.birth} = { birth = yes }\n}`).join("\n"));
  write("common/dynasties/fixture.txt", people.map((person) => `dynn_${person.definitionId} = {\n name = surname_${person.definitionId}\n}`).join("\n"));
  write("localization/simp_chinese/fixture_l_simp_chinese.yml", `l_simp_chinese:\n${people.map((person) => `surname_${person.definitionId}:0 \"${person.surname}\"`).join("\n")}\n`);
  const aliases = people.map((person) => ({ aliases: [`${person.name}别`], candidateDefinitionIds: [person.definitionId] }));
  const index = buildHistoricalDefinitionIndex({ sources: [{ root: source, sourceId: "fixture", modId: "fixture" }], aliases });
  const completeSnapshot = makeSnapshot();
  let total = 0;

  for (const person of people) for (const query of [person.name, `${person.name}在哪里`]) {
    const result = analyze(index, completeSnapshot, query);
    assert.deepEqual(result.characters.map((character) => character.id), [person.runtimeId], query);
    total += 1;
  }
  for (const person of people) {
    const result = analyze(index, completeSnapshot, `${person.name}别`);
    assert.ok(result.candidateCharacters.some(character => character.runtimeId === person.runtimeId), `${person.name} explicit alias must recall the runtime candidate`);
    assert.equal(result.characters.length, 0, "alias 0.45 + age 0.22 + gender 0.08 does not meet the unchanged 0.85 threshold");
    total += 1;
  }
  for (const person of people) {
    const ambiguous = makeSnapshot([person]);
    const duplicateId = `${person.runtimeId}9`;
    ambiguous.characters[duplicateId] = { ...ambiguous.characters[person.runtimeId], id: duplicateId };
    ambiguous.runtimeToDefinitions[duplicateId] = [person.definitionId];
    const result = analyze(index, ambiguous, person.name);
    assert.equal(result.characters.length, 0, `${person.name} duplicate runtime must not become a fact`);
    assert.equal(result.historicalCoverage[0].status, "AMBIGUOUS");
    total += 1;
  }
  for (const person of people.slice(2, 12)) {
    const result = analyze(index, makeSnapshot([]), person.name);
    assert.equal(result.historicalCoverage[0].status, "DEFINITION_FOUND_RUNTIME_MISSING");
    total += 1;
  }
  for (const person of people.slice(2, 12)) {
    const result = analyze(index, completeSnapshot, person.name, (currentIndex, value) => {
      const found = lookup(currentIndex, value);
      return found.status === "FOUND" ? { ...found, candidates: found.candidates.map((candidate) => ({ ...candidate, metadata: { birthDate: null, gender: "unknown" } })) } : found;
    });
    assert.equal(result.characters.length, 0, `${person.name} missing metadata must stay a candidate`);
    assert.equal(result.historicalCoverage[0].status, "REJECTED_BY_EVIDENCE");
    total += 1;
  }
  for (const person of people.slice(0, 10)) {
    assert.equal(lookup(index, `${person.name}异`).status, "NAME_INDEX_MISS", `${person.name} localization anomaly`);
    total += 1;
  }
  for (let indexNumber = 0; indexNumber < 10; indexNumber += 1) {
    assert.equal(lookup(index, `不存在${indexNumber}`).status, "NAME_INDEX_MISS", "negative lookup");
    total += 1;
  }
  assert.equal(total, 100, "the V8.5.1 deterministic query matrix must keep one hundred distinct audit cases");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("V8.5.1 Historical Query Matrix: PASS (100 cases across exact, alias, ambiguity, missing runtime, metadata, localization and negative paths)");
