"use strict";

const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { FIGURE_STATUS, resolveHistoricalFigures } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-figure-resolver"));

const figure = (overrides = {}) => ({
  figureKey: "figure_a",
  identity: { name: "人物甲", aliases: [] },
  life: { birthYear: 980, deathYear: null },
  activeWindow: { earliestYear: 980, latestYear: null },
  ...overrides
});
const matching = (overrides = {}) => ({
  figureKey: "figure_a",
  resolverReady: true,
  intrinsic: { gender: "male", birthYear: 980 },
  hints: { cultures: ["汉"], houses: [], titles: [], positions: [], realms: [], locations: [] },
  familyHints: [],
  confidencePolicy: "standard",
  reviewed: true,
  sources: ["fixture"],
  ...overrides
});
const character = (id, name = "人物甲", overrides = {}) => ({
  id,
  names: { shortName: name, fullName: name, firstName: name, canonicalNames: [name] },
  gender: "male",
  age: 30,
  birthDateTotalDays: null,
  culture: "汉",
  faith: "",
  house: "",
  primaryTitle: "",
  heldCourtAndCouncilPositions: "",
  titleRankConcept: "",
  liege: "",
  topLiege: "",
  capitalLocation: "",
  isRuler: false,
  isIndependentRuler: false,
  isLandedRuler: false,
  familyEvidence: [],
  conflicts: { gender: false, birthDate: false },
  ...overrides
});
const input = (characters, date = { valid: true, year: 1010, month: 1, day: 1 }) => ({ date, totalDays: null, characters });
const resolveOne = (historicalFigure, matchingRecord, resolverInput) => resolveHistoricalFigures({
  figures: [historicalFigure],
  matchingRecords: [matchingRecord],
  input: resolverInput
}).results[0];

const exact = resolveOne(figure(), matching(), input([character(1)]));
assert.strictEqual(exact.status, FIGURE_STATUS.RESOLVED);
assert.strictEqual(exact.matchedCharacterId, 1);
assert(exact.evidence.some((entry) => entry.code === "NAME_EXACT"));

const aliasFigure = figure({ identity: { name: "人物甲", aliases: ["甲别名"] } });
const alias = resolveOne(aliasFigure, matching(), input([character(2, "甲别名")]));
assert.strictEqual(alias.status, FIGURE_STATUS.CANDIDATE);
assert.strictEqual(alias.matchedCharacterId, null);
assert(alias.evidence.some((entry) => entry.code === "NAME_ALIAS"));

const ambiguous = resolveOne(figure(), matching(), input([character(3), character(4)]));
assert.strictEqual(ambiguous.status, FIGURE_STATUS.AMBIGUOUS);
assert.strictEqual(ambiguous.matchedCharacterId, null);

const ageResolved = resolveOne(figure(), matching(), input([character(5), character(6, "人物甲", { age: 65 })]));
assert.strictEqual(ageResolved.status, FIGURE_STATUS.RESOLVED);
assert.strictEqual(ageResolved.matchedCharacterId, 5);

const roleDivergence = resolveOne(figure(), matching({ hints: { cultures: ["汉"], houses: [], titles: ["宰相"], positions: ["同平章事"], realms: [], locations: [] } }), input([character(7, "人物甲", { primaryTitle: "农夫", heldCourtAndCouncilPositions: "" })]));
assert.strictEqual(roleDivergence.status, FIGURE_STATUS.RESOLVED, "role mismatch must not negate identity");

const familyRecord = matching({ familyHints: [{ relation: "parent", names: ["父亲甲"] }] });
const familyResolved = resolveOne(figure(), familyRecord, input([
  character(8, "人物甲", { familyEvidence: [{ relation: "parent", relatedCharacterId: 80, names: ["父亲甲"] }] }),
  character(9)
]));
assert.strictEqual(familyResolved.status, FIGURE_STATUS.RESOLVED);
assert.strictEqual(familyResolved.matchedCharacterId, 8);
assert(familyResolved.evidence.some((entry) => entry.code === "FAMILY_MATCH"));

const relationshipConflict = resolveOne(figure(), matching(), input([character(10, "人物甲", { conflicts: { gender: true, birthDate: true } })]));
assert.notStrictEqual(relationshipConflict.status, FIGURE_STATUS.RESOLVED, "canonical conflicts must not become high-confidence evidence");

const notDue = resolveOne(figure(), matching(), input([], { valid: true, year: 900, month: 1, day: 1 }));
assert.strictEqual(notDue.status, FIGURE_STATUS.NOT_DUE);

const invalidDate = resolveOne(figure(), matching(), input([character(11)], { valid: false, year: null, month: null, day: null }));
assert.notStrictEqual(invalidDate.status, FIGURE_STATUS.NOT_DUE);
assert.strictEqual(invalidDate.temporalStatus, "unknown");

const survived = resolveOne(figure({ life: { birthYear: 980, deathYear: 1040 } }), matching(), input([character(12, "人物甲", { age: 70 })], { valid: true, year: 1050, month: 1, day: 1 }));
assert.strictEqual(survived.status, FIGURE_STATUS.RESOLVED);
assert(survived.evidence.some((entry) => entry.code === "SURVIVED_BEYOND_BASELINE_DEATH"));

const unsupported = resolveOne(figure(), matching({ resolverReady: false }), input([character(13)]));
assert.strictEqual(unsupported.status, FIGURE_STATUS.UNSUPPORTED);
const missing = resolveOne(figure(), matching(), input([]));
assert.strictEqual(missing.status, FIGURE_STATUS.DUE_UNRESOLVED);

console.log("VOTC v8.3 Figure Resolution: PASS (name gate, ambiguity, identity scoring, temporal and divergence boundaries)");
