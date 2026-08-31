"use strict";

const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { buildHistoricalFigureInput } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-figure-input"));
const { parseGameDateStrict } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "temporal-knowledge-gate"));

let profileBuilds = 0;
const canonical = {
  id: 2,
  shortName: "寇准",
  fullName: "寇准",
  firstName: "准",
  gender: "male",
  age: 49,
  birthDateTotalDays: 350000,
  culture: "汉",
  faith: "儒教",
  house: "寇氏",
  primaryTitle: "无",
  heldCourtAndCouncilPositions: "同平章事",
  titleRankConcept: "官员",
  liege: "宋真宗",
  topLiege: "宋真宗",
  capitalLocation: "开封",
  consort: "王氏、李氏",
  isRuler: false,
  isIndependentRuler: false,
  isLandedRuler: false,
  parents: [{ id: 3, name: "寇相" }],
  children: [],
  siblings: [],
  evidence: {
    conflicts: { gender: false, birthDate: false },
    relations: [{ ownerId: 4, relationType: "child" }]
  }
};
const relationshipResolver = {
  buildCanonicalProfiles() {
    profileBuilds += 1;
    return new Map([
      [2, canonical],
      [99, { id: 99, shortName: "仅关系边人物", fullName: "仅关系边人物", firstName: "", evidence: { conflicts: {}, relations: [] } }]
    ]);
  }
};
const gameData = { date: "1010年5月3日", totalDays: 368900, characters: new Map([[2, canonical]]) };
const input = buildHistoricalFigureInput({ gameData, relationshipResolver, inferGenderFromPronoun: () => "unknown", parseGameDateStrict });

assert.strictEqual(profileBuilds, 1, "relationship profiles must be built once per GameData snapshot");
assert.deepStrictEqual(input.date, { valid: true, year: 1010, month: 5, day: 3, precision: "day", reason: null });
assert.strictEqual(input.characters[0].id, 2);
assert.strictEqual(input.characters.length, 1, "relation-only synthetic profiles must not become figure candidates");
assert.strictEqual(input.characters[0].names.fullName, "寇准");
assert(input.characters[0].familyEvidence.some((entry) => entry.relation === "parent" && entry.names.includes("寇相")));
assert(input.characters[0].familyEvidence.some((entry) => entry.relation === "spouse" && entry.names.includes("王氏") && entry.names.includes("李氏")), "consort must become spouse evidence");
assert(Object.isFrozen(input));
assert(Object.isFrozen(input.characters));
assert(Object.isFrozen(input.characters[0]));
assert(Object.isFrozen(input.characters[0].familyEvidence));
assert.strictEqual(gameData.dynamicHistory, undefined, "input builder must not mutate GameData");

const invalid = buildHistoricalFigureInput({
  gameData: { date: "invalid", totalDays: 356000, characters: new Map() },
  relationshipResolver: { buildCanonicalProfiles: () => new Map() },
  inferGenderFromPronoun: () => "unknown",
  parseGameDateStrict
});
assert.strictEqual(invalid.date.valid, false);
assert.strictEqual(invalid.date.year, null, "invalid dates must not use a legacy fallback year");
const missingNumeric = buildHistoricalFigureInput({
  gameData: { date: "invalid", totalDays: null, characters: new Map() },
  relationshipResolver: { buildCanonicalProfiles: () => new Map() },
  inferGenderFromPronoun: () => "unknown",
  parseGameDateStrict
});
assert.strictEqual(missingNumeric.totalDays, null, "missing numeric evidence must remain null rather than coercing to zero");

console.log("VOTC v8.3 Figure Input: PASS (single canonical build, strict date, deep-frozen evidence snapshot)");
