"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { inferGenderFromPronoun } = require("../resources/app/out/main/game-data/character");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");

const GameData = createGameData({
  fs, path, memorySystem: {}, memoryEngine: { findMentionedCharactersInHistory: () => [] },
  summariesDir: "", getHistoricalReferenceByYear: () => ({})
});
const makeCharacter = (id, name, gender, age = 40) => ({
  id, shortName: name, fullName: name, firstName: name, gender, age,
  opinionOfPlayer: null, opinions: [], relationsToPlayer: [], relationsToCharacters: [],
  parents: [], children: [], siblings: [], traits: [], consort: "", liege: ""
});
const makeGame = ({ siblingGender, siblingPronoun, siblingBirth, playerBirth = 418500, reverseOrder = false, conflictingSiblingEdge = false }) => {
  const game = new GameData([1, "玩家", 2, "母亲", "976年5月3日", "talk_scene_court", "开封", "玩家", 419000]);
  const player = makeCharacter(1, "玩家", "male", 21);
  const mother = makeCharacter(2, "母亲", "female", 45);
  player.siblings.push({ id: 3, name: "第三人", sheHe: siblingPronoun, gender: siblingGender, birthDateTotalDays: siblingBirth });
  mother.children.push(
    { id: 1, name: "玩家", sheHe: "他", gender: "male", birthDateTotalDays: playerBirth },
    { id: 3, name: "第三人", sheHe: siblingPronoun, gender: siblingGender, birthDateTotalDays: siblingBirth }
  );
  if (conflictingSiblingEdge) mother.siblings.push({ id: 3, name: "第三人", sheHe: siblingPronoun, gender: siblingGender, birthDateTotalDays: siblingBirth });
  const entries = reverseOrder ? [[2, mother], [1, player]] : [[1, player], [2, mother]];
  game.characters = new Map(entries);
  return { game, player, mother };
};
const verify = (options, expectedSibling, expectedChild) => {
  const { game, player, mother } = makeGame(options);
  const profiles = game.getMentionableCharacterProfiles();
  const relative = profiles.get(3);
  assert.strictEqual(game.relationshipResolver.resolveDirectKinship(relative, profiles.get(player.id)).label, expectedSibling);
  assert.strictEqual(game.relationshipResolver.resolveDirectKinship(relative, profiles.get(mother.id)).label, expectedChild);
  return { game, profiles, relative };
};

verify({ siblingGender: "male", siblingPronoun: "he", siblingBirth: 418000 }, "哥哥", "儿子");
verify({ siblingGender: "male", siblingPronoun: "他", siblingBirth: 418800 }, "弟弟", "儿子");
verify({ siblingGender: "female", siblingPronoun: "she", siblingBirth: 418000 }, "姐姐", "女儿");
verify({ siblingGender: "female", siblingPronoun: "她", siblingBirth: 418800 }, "妹妹", "女儿");

const sameIntegerAge = verify({ siblingGender: "male", siblingPronoun: "he", siblingBirth: 418400, playerBirth: 418500 }, "哥哥", "儿子");
assert.strictEqual(sameIntegerAge.relative.age, sameIntegerAge.profiles.get(1).age, "R5 fixture must have the same integer age");

const normal = makeGame({ siblingGender: "male", siblingPronoun: "he", siblingBirth: 418000 });
const reversed = makeGame({ siblingGender: "male", siblingPronoun: "he", siblingBirth: 418000, reverseOrder: true });
const project = ({ game }) => {
  const profiles = game.getMentionableCharacterProfiles();
  const relative = profiles.get(3);
  return {
    gender: relative.gender,
    birthDateTotalDays: relative.birthDateTotalDays,
    playerKinship: game.relationshipResolver.resolveDirectKinship(relative, profiles.get(1)).label,
    motherKinship: game.relationshipResolver.resolveDirectKinship(relative, profiles.get(2)).label
  };
};
assert.deepStrictEqual(project(normal), project(reversed), "R6 result must not depend on Map insertion order");

const unknownThenMale = makeGame({ siblingGender: "unknown", siblingPronoun: "", siblingBirth: 418000 });
unknownThenMale.mother.children[1].gender = "male";
unknownThenMale.mother.children[1].sheHe = "he";
assert.strictEqual(unknownThenMale.game.getMentionableCharacterProfiles().get(3).gender, "male", "R7 later known evidence must enrich an earlier unknown source");

const conflict = makeGame({ siblingGender: "male", siblingPronoun: "he", siblingBirth: 418000 });
conflict.mother.children[1].gender = "female";
conflict.mother.children[1].sheHe = "she";
const conflictProfiles = conflict.game.getMentionableCharacterProfiles();
const conflictRelative = conflictProfiles.get(3);
assert.strictEqual(conflictRelative.gender, "unknown", "R8 conflicting gender evidence must fail closed");
assert.match(conflict.game.relationshipResolver.resolveDirectKinship(conflictRelative, conflictProfiles.get(1)).label, /手足/);
assert.strictEqual(conflict.game.relationshipResolver.resolveDirectKinship(conflictRelative, conflictProfiles.get(2)).label, "子女");
assert(conflict.game.relationshipDiagnostics.some((item) => item.code === "RELATION_CONFLICT_GENDER"));

const birthConflict = makeGame({ siblingGender: "male", siblingPronoun: "he", siblingBirth: 418000 });
birthConflict.mother.children[1].birthDateTotalDays = 418900;
const birthConflictProfiles = birthConflict.game.getMentionableCharacterProfiles();
const birthConflictRelative = birthConflictProfiles.get(3);
assert.strictEqual(birthConflictRelative.birthDateTotalDays, null, "conflicting exact birth dates must fail closed");
assert.strictEqual(birthConflict.game.relationshipResolver.resolveDirectKinship(birthConflictRelative, birthConflictProfiles.get(1)).label, "兄弟", "birth conflict must not guess older or younger");
assert(birthConflict.game.relationshipDiagnostics.some((item) => item.code === "RELATION_CONFLICT_BIRTHDATE"));

const typeConflict = makeGame({ siblingGender: "male", siblingPronoun: "he", siblingBirth: 418000, conflictingSiblingEdge: true });
const typeProfiles = typeConflict.game.getMentionableCharacterProfiles();
assert.strictEqual(typeConflict.game.relationshipResolver.resolveDirectKinship(typeProfiles.get(3), typeProfiles.get(2)), null, "V8.6.2 conflicting relation types must fail closed");
assert(typeConflict.game.relationshipDiagnostics.some((item) => item.code === "RELATION_CONFLICT_TYPE"));

assert.strictEqual(inferGenderFromPronoun("he"), "male");
assert.strictEqual(inferGenderFromPronoun("他"), "male");
assert.strictEqual(inferGenderFromPronoun("she"), "female");
assert.strictEqual(inferGenderFromPronoun("她"), "female");
console.log("VOTC v7.10-RC6 Final Rev2 Relationship Resolver: PASS (R1-R10 canonical merge, exact birth, priority, conflict fail-closed)");
