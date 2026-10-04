"use strict";

const assert = require("assert/strict");
const { createTraitProfileView, getTraitsForKnownProfile } = require("../resources/app/out/main/prompts/trait-profile-selector");

const target = { id: 1, firstName: "甲", shortName: "明王，甲", fullName: "明王，甲", primaryTitle: "明王",
  heldCourtAndCouncilPositions: "枢密使", titleRankConcept: "concept_kingdom", nickname: "北地之虎",
  traits: [{ name: "私生子" }, { name: "独眼" }, { name: "九天血统", category: "Body" }] };
const observer = { id: 2, traits: [] };
const gameData = { campaignToken: "profile-campaign", date: "1164.5.20", playerID: 1, characters: new Map([[1, target], [2, observer]]) };
const view = createTraitProfileView(gameData, observer).gameData.characters.get(1);
assert.equal(view.primaryTitle, "", "stranger must not receive exact title");
assert.equal(view.heldCourtAndCouncilPositions, "", "stranger must not receive court position");
assert.equal(view.titleRankConcept, "", "stranger must not receive rank identity");
assert(!view.fullName.includes("明王"), "composite name must not bypass title gate");
assert.equal(view.nickname, "北地之虎", "nickname is visible without disclosure");
assert.deepEqual(view.traits.map(trait => trait.name), ["独眼"]);
assert.equal(createTraitProfileView(gameData, target).character.primaryTitle, "明王");
assert.deepEqual(createTraitProfileView(gameData, target).character.traits, target.traits);
assert.equal(target.primaryTitle, "明王", "presentation must not modify CK3 source");
assert.equal(target.traits.length, 3);
const familyGameData = { ...gameData, characters: new Map([[1, { ...target,
  parents: [{ id: 3, name: "河间公，乙", gender: "male" }],
  children: [{ id: 4, name: "鲁王，丙", spouses: [{ id: 5, name: "齐公，丁" }] }]
}], [2, observer]]) };
const familyView = createTraitProfileView(familyGameData, observer).gameData.characters.get(1);
assert.equal(familyView.parents[0].name, "乙", "family name must not expose an undisclosed precise title");
assert.equal(familyView.children[0].spouses[0].name, "丁", "nested spouse name must not bypass the title gate");
assert.equal(familyGameData.characters.get(1).parents[0].name, "河间公，乙", "family projection must not mutate source");

const fact = (factType, factKey, value, status = "AUTO_DISCLOSED") => ({ campaignToken: gameData.campaignToken,
  ownerId: 2, entityId: 1, factType, factKey, value, status, current: true, effectiveKnown: status !== "MANUAL_HIDDEN",
  firstAcquiredDate: "1164.5.20" });
const knowledge = { campaignToken: gameData.campaignToken, currentGameDate: gameData.date, gameData,
  disclosureProfiles: new Map([[1, [fact("TITLE", "title_明王", "明王"), fact("TRAIT", "trait_bastard", "私生子")]]]) };
assert(getTraitsForKnownProfile(observer, target, knowledge).some(trait => trait.name === "私生子"));
assert.equal(createTraitProfileView(gameData, observer, knowledge).gameData.characters.get(1).primaryTitle, "明王");
assert.equal(createTraitProfileView(gameData, observer, knowledge).gameData.characters.get(1).heldCourtAndCouncilPositions, "", "one known title must not unlock all positions");
const changed = { ...target, primaryTitle: "皇帝", traits: target.traits.filter(trait => trait.name !== "私生子") };
const changedGameData = { ...gameData, characters: new Map([[1, changed], [2, observer]]) };
assert.equal(createTraitProfileView(changedGameData, observer, knowledge).gameData.characters.get(1).primaryTitle, "");
assert(!getTraitsForKnownProfile(observer, changed, knowledge).some(trait => trait.name === "私生子"));
assert(!getTraitsForKnownProfile({ id: 3 }, target, knowledge).some(trait => trait.name === "私生子"));
assert(!getTraitsForKnownProfile(observer, target, { ...knowledge, campaignToken: "other" }).some(trait => trait.name === "私生子"));
assert(!getTraitsForKnownProfile(observer, target, { ...knowledge, currentGameDate: "1164.5.19" }).some(trait => trait.name === "私生子"));
assert(!getTraitsForKnownProfile(observer, target, { ...knowledge, disclosureProfiles: new Map([[1, [fact("TRAIT", "trait_bastard", "私生子", "MANUAL_HIDDEN")]]]) }).some(trait => trait.name === "私生子"));
console.log("V8.14.2 disclosure profile: PASS (Self/Observed/Known, specific titles, current truth, nickname, and scope)");
