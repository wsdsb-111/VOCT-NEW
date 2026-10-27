"use strict";

const assert = require("node:assert/strict");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");

function person(id) {
  return { id, name: `外部人物编号${id}甲乙`, firstName: `外部人物编号${id}甲乙`,
    fullName: `外部人物编号${id}甲乙`, shortName: `外部人物编号${id}甲乙`,
    primaryTitle: `封号编号${id}甲乙`, house: `家族编号${id}甲乙`,
    age: 30, ageSource: "CK3_CURRENT_AGE", traits: [], parents: [], children: [], siblings: [], spouses: [] };
}
const characters = new Map(Array.from({ length: 6000 }, (_, index) => [index + 1, person(index + 1)]));
const unknown = characters.get(5999);
const data = { campaignToken: "identity-scale", date: "1130.1.1", totalDays: 410000,
  playerID: 5999, aiID: 1, playerName: unknown.name, aiName: characters.get(1).name, characters,
  scene: `${unknown.name}与${unknown.primaryTitle}在${unknown.house}见面`,
  location: `${unknown.name}府`, locationController: unknown.fullName,
  currentEmperor: unknown.shortName, currentEmperorTitle: unknown.primaryTitle };
characters.get(1).description = data.scene;
const original = JSON.stringify(data.scene);
const start = performance.now();
const view = createTraitProfileView(data, characters.get(1)).gameData;
const elapsedMs = performance.now() - start;
for (const value of [view.scene, view.location, view.locationController, view.playerName, view.currentEmperor, view.currentEmperorTitle, view.characters.get(1).description]) {
  for (const alias of [unknown.name, unknown.primaryTitle, unknown.house]) assert(!String(value).includes(alias), "directory aliases beyond the graph cap must be masked");
}
assert.equal(view.characters.size, 6000);
assert.equal(view.characters.get(5999).age, null);
assert.equal(JSON.stringify(data.scene), original, "source metadata is unchanged");
assert.equal(unknown.name, "外部人物编号5999甲乙");

// Shared aliases never grant the other person's ID, while short/common words
// and Latin substrings retain their ordinary word-boundary behavior.
const ann = person(7001);
Object.assign(ann, { name: "Ann", firstName: "Ann", fullName: "Ann", shortName: "Ann" });
const single = person(7002);
Object.assign(single, { name: "王", firstName: "王", fullName: "王", shortName: "王" });
characters.set(ann.id, ann); characters.set(single.id, single);
data.scene = "Ann met Annabelle at 王国";
assert.equal(createTraitProfileView(data, characters.get(1)).gameData.scene, "未获知姓名的人物 met Annabelle at 王国");
console.log(`V9.6.1 identity directory scale: PASS (6000 profiles, ${elapsedMs.toFixed(1)} ms)`);
