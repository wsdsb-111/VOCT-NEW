"use strict";

const assert = require("node:assert/strict");
const { getCharacterMentionAliases } = require("../resources/app/out/main/memory-system/character-identity");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");

const DERIVED_TITLE_ALIASES = ["陛下", "殿下", "皇帝", "天子", "官家", "皇后"];

function getFolderProfile(character) {
  const profiles = MemoryEngine.prototype.getMentionableProfilesFromFolderMemories.call({}, [{
    totalDays: 1,
    provenance: { participantProfiles: [character] }
  }]);
  return profiles.get(Number(character.id));
}

function assertTitleAliases(fixture, expectedAliases = [], expectedFolderAliases = expectedAliases) {
  const expected = [...expectedAliases].sort();
  const expectedFolder = [...expectedFolderAliases].sort();
  const directAliases = getCharacterMentionAliases(fixture);
  const folderProfile = getFolderProfile(fixture);
  const folderAliases = getCharacterMentionAliases(folderProfile);
  const directTitles = DERIVED_TITLE_ALIASES.filter((alias) => directAliases.includes(alias)).sort();
  const folderTitles = DERIVED_TITLE_ALIASES.filter((alias) => folderAliases.includes(alias)).sort();

  assert.deepEqual(directTitles, expected, `${fixture.caseName}: live profile aliases`);
  assert.deepEqual(folderTitles, expectedFolder, `${fixture.caseName}: folder-memory aliases`);
  assert(directAliases.includes(fixture.fullName), `${fixture.caseName}: raw full name remains a literal alias`);
  assert(folderAliases.includes(fixture.fullName), `${fixture.caseName}: folder-memory raw full name remains a literal alias`);
}

const orientalEmpiresCases = [
  {
    name: "reigning emperor",
    fixtures: [
      { id: 101, caseName: "OE emperor by primary title", firstName: "赵某", shortName: "赵某", fullName: "赵某", primaryTitle: "大宋皇帝", titleRankConcept: "concept_none" },
      { id: 102, caseName: "OE emperor by rank", firstName: "李某", shortName: "李某", fullName: "李某", primaryTitle: "", titleRankConcept: "concept_emperor" }
    ],
    expected: ["陛下", "皇帝", "天子", "官家"],
    expectedFolder: ["陛下", "皇帝", "天子"]
  },
  {
    name: "retired emperor",
    fixtures: [
      { id: 103, caseName: "OE retired emperor raw style", firstName: "韦大闵", shortName: "太上皇 韦大闵", fullName: "太上皇帝 韦大闵", primaryTitle: "", titleRankConcept: "concept_none", mentionAliases: ["太上皇"] }
    ],
    expected: []
  },
  {
    name: "untitled courtier",
    fixtures: [
      { id: 104, caseName: "OE untitled courtier", firstName: "韦某", shortName: "韦某", fullName: "韦某", primaryTitle: "", titleRankConcept: "concept_none" }
    ],
    expected: []
  },
  {
    name: "king, duke, and marquis",
    fixtures: [
      { id: 105, caseName: "OE king", firstName: "张某", shortName: "齐王 张某", fullName: "张某", primaryTitle: "齐王", titleRankConcept: "concept_kingdom" },
      { id: 106, caseName: "OE duke", firstName: "王某", shortName: "安国公 王某", fullName: "王某", primaryTitle: "安国公", titleRankConcept: "concept_duchy" },
      { id: 107, caseName: "OE marquis", firstName: "刘某", shortName: "永安侯 刘某", fullName: "刘某", primaryTitle: "永安侯", titleRankConcept: "concept_county" }
    ],
    expectedByCase: { "OE king": ["陛下"], "OE duke": [], "OE marquis": [] }
  },
  {
    name: "female character",
    fixtures: [
      { id: 108, caseName: "OE empress", firstName: "武某", shortName: "皇后 武某", fullName: "武某", primaryTitle: "皇后", titleRankConcept: "concept_none", sheHe: "她" }
    ],
    expected: ["陛下", "皇后"]
  },
  {
    name: "minor",
    fixtures: [
      { id: 109, caseName: "OE untitled child with style-like name", firstName: "赵某", shortName: "太子 赵某", fullName: "太子 赵某", primaryTitle: "", titleRankConcept: "concept_none", age: 12 }
    ],
    expected: []
  },
  {
    name: "nickname",
    fixtures: [
      { id: 110, caseName: "OE nickname contains emperor word", firstName: "李某", shortName: "李某『皇帝梦』", fullName: "李某『皇帝梦』", nickname: "皇帝梦", primaryTitle: "", titleRankConcept: "concept_none" }
    ],
    expected: []
  },
  {
    name: "no primary title",
    fixtures: [
      { id: 111, caseName: "OE anomalous raw full name", firstName: "韦大闵", shortName: "韦大闵", fullName: "太上皇帝 韦大闵", primaryTitle: "", titleRankConcept: "concept_none" }
    ],
    expected: []
  }
];

const vanillaCases = [
  {
    name: "ordinary earl",
    fixtures: [
      { id: 201, caseName: "Vanilla earl with polluted raw name", firstName: "Edwin", shortName: "Edwin", fullName: "Emperor's favored earl Edwin", primaryTitle: "伯爵领", titleRankConcept: "concept_county" }
    ],
    expected: []
  },
  {
    name: "king",
    fixtures: [
      { id: 202, caseName: "Vanilla king by rank", firstName: "Harold", shortName: "Harold", fullName: "Harold", primaryTitle: "Wessex", titleRankConcept: "concept_kingdom" }
    ],
    expected: ["陛下"]
  },
  {
    name: "emperor",
    fixtures: [
      { id: 203, caseName: "Vanilla emperor by primary title", firstName: "Henry", shortName: "Henry", fullName: "Henry", primaryTitle: "Emperor of Germany", titleRankConcept: "concept_none" }
    ],
    expected: ["陛下", "皇帝", "天子", "官家"],
    expectedFolder: ["陛下", "皇帝", "天子"]
  },
  {
    name: "courtier nickname",
    fixtures: [
      { id: 204, caseName: "Vanilla courtier nickname contains emperor word", firstName: "John", shortName: "John", fullName: "John『the Emperor』", nickname: "the Emperor", primaryTitle: "", titleRankConcept: "concept_none" }
    ],
    expected: []
  },
  {
    name: "spouse",
    fixtures: [
      { id: 205, caseName: "Vanilla spouse name mentions empress", firstName: "Geoffrey", shortName: "Geoffrey", fullName: "Geoffrey, consort of the Empress", primaryTitle: "", titleRankConcept: "concept_none" }
    ],
    expected: []
  },
  {
    name: "unlanded character",
    fixtures: [
      { id: 206, caseName: "Vanilla unlanded raw name says king", firstName: "Robert", shortName: "King Robert", fullName: "King Robert", primaryTitle: "", titleRankConcept: "concept_none" }
    ],
    expected: []
  }
];

assert.equal(orientalEmpiresCases.length, 8);
assert.equal(vanillaCases.length, 6);

let fixtureCount = 0;
for (const group of [...orientalEmpiresCases, ...vanillaCases]) {
  for (const fixture of group.fixtures) {
    assertTitleAliases(
      fixture,
      group.expectedByCase?.[fixture.caseName] ?? group.expected,
      group.expectedFolderByCase?.[fixture.caseName] ?? group.expectedFolder ?? group.expectedByCase?.[fixture.caseName] ?? group.expected
    );
    if (group.name === "retired emperor") {
      assert(getCharacterMentionAliases(fixture).includes("太上皇"), "OE former-emperor honorific remains an explicit alias");
      assert(getCharacterMentionAliases(getFolderProfile(fixture)).includes("太上皇"), "folder profile keeps the explicit OE honorific");
    }
    fixtureCount++;
  }
}

console.log(`V8.14 hotfix name authority: ${orientalEmpiresCases.length} OE categories, ${vanillaCases.length} Vanilla categories, ${fixtureCount} character fixtures PASS`);
