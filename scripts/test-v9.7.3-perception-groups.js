"use strict";

const assert = require("node:assert/strict");
const policy = require("../src/app/main/prompts/social-recognition-policy");
const { resolveTraitVisibility } = require("../src/app/main/prompts/trait-visibility-policy");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");
const { Conversation } = require("../src/app/main/conversation/conversation");
const person = (id, ids) => ({ id, shortName: `Name${id}`, traits: ids.map(traitId => ({ traitId, name: traitId, desc: `PRIVATE_${traitId}` })) });
const data = (left, right) => ({ playerID: 1, aiID: 2, campaignToken: "groups", date: "1200.1.1", totalDays: 100,
  characters: new Map([[1, person(1, left)], [2, person(2, right)], [3, person(3, ["psychic"])], [4, person(4, ["demon"])]]) });
const sense = (left, right, options = {}) => {
  const gameData = data(left, right);
  return policy.getSupernaturalPerception(gameData.characters.get(1), gameData.characters.get(2), gameData, { activeParticipantIds: [1, 2], ...options });
};
const groups = {
  BLOOD: ["vampire", "ghoul", "revenant", "dhampir", "turnedhunter"],
  BEAST: ["werewolf", "ajaba", "ananasi", "apis", "bastet", "camazotz", "corax", "grondr", "gurahl", "kitsune", "mokole", "nagah", "nuwisha", "ratkin", "rokea", "entomos", "kinfolk", "abomination"],
  LEGEND: ["fae", "changeling", "kinain", "kueijin", "dhampyr", "mummy", "asekh_sen"],
  HELL: ["demon", "laham", "nephilim", "wraith"],
  SPIRIT: ["spirit", "laibon_spirit", "fomori", "drone", "gorgon", "kami"],
  SUPERNATURAL: ["automaton", "alien", "zombu", "mindless_clone", "wight", "the_hollow", "POD_asakku_soul_infection", "POD_asakku_asakku", "POD_asakku_iryi_ascendant", "POD_asakku_elioud", "POD_asakku_lich", "mm_asc_dragon_body"],
  HUNTER: ["mage", "supehunter", "shih", "psychic", "sorcerer", "theurgist", "rune_wise"]
};
const labels = { BLOOD: "血族感知", BEAST: "兽族感知", LEGEND: "传说感知", HELL: "地狱感知", SPIRIT: "生灵感知", SUPERNATURAL: "超自然感知", HUNTER: "猎人感知" };
const relatedLegend = [["fae", "changeling", "kinain"], ["kueijin", "dhampyr"], ["mummy", "asekh_sen"]];
let combinations = 0;
for (const [group, ids] of Object.entries(groups)) for (const target of ids) {
  const observer = group === "HUNTER" ? "alien" : "psychic";
  const result = sense([observer], [target]);
  assert.equal(result.group, group, `${target} category`);
  assert.equal(result.level, "SUPERNATURAL");
  assert(result.cue.includes(labels[group]));
  assert.deepEqual(result.traitKeys, []);
  assert(!result.cue.includes(target), "coarse cue contains no original ID");
  for (const [otherGroup, observers] of Object.entries(groups)) for (const own of observers) {
    const directed = sense([own], [target]);
    assert.equal(directed.group, group, `${own} -> ${target}`);
    const exact = own === target || otherGroup === group && ["BLOOD", "HELL", "SPIRIT"].includes(group)
      || relatedLegend.some(family => family.includes(own) && family.includes(target))
      || ["vampire", "werewolf", "supehunter"].includes(own) && ["vampire", "werewolf", "supehunter"].includes(target);
    assert.equal(directed.level, exact ? "SPECIES" : "SUPERNATURAL", `${own} -> ${target} precision`);
    combinations++;
  }
}
assert.equal(sense(["vampire"], ["vampire", "werewolf", "abomination"]).group, "BEAST");
assert.equal(sense(["vampire"], ["vampire", "werewolf", "abomination"]).level, "SUPERNATURAL", "base traits cannot bypass the more specific abomination identity");
assert.equal(sense(["vampire"], ["vampire", "salubri_healer"]).group, "BLOOD");
assert.deepEqual(sense(["vampire"], ["vampire", "ventrue", "salubri_healer"]).traitKeys, ["trait_vampire"], "clan and caste remain private");
assert.deepEqual(sense(["myv_wyvern"], ["mummy", "banemummy"]).traitKeys, ["trait_mummy"], "even pure dragons do not bypass subtype disclosure");
assert.equal(sense(["vampire"], ["vampire", "werewolf", "abomination"], { hiddenTraitKeys: ["trait_abomination"] }).level, "NONE", "hiding the specific identity cannot expose retained base races instead");
assert.equal(sense(["vampire"], ["mummy", "banemummy"], { hiddenTraitKeys: ["trait_mummy"] }).level, "NONE", "a hidden race cannot leak through its subtype");
for (const mundane of ["mortal", "hunter", "witch", "brave", "greedy", "bastard"]) {
  assert.equal(sense([mundane], ["vampire"]).level, "NONE");
  assert.equal(sense(["vampire"], [mundane]).level, "NONE");
}
for (const detail of ["ventrue", "banemummy", "sidhe", "risen", "eshieho", "salubri_healer"]) {
  assert.equal(resolveTraitVisibility({ traitId: detail, category: "appearance" }).status, "NON_OBSERVABLE");
}
const gameData = data(["vampire"], ["mummy", "banemummy"]);
policy.captureRecognitionEvidence(gameData, []);
policy.activateSocialRecognition(gameData, [1, 2, 3]);
const perceive = (owner, target, active = [1, 2, 3]) => policy.getSupernaturalPerception(gameData.characters.get(owner), gameData.characters.get(target), gameData, { activeParticipantIds: active });
for (const owner of [1, 2, 3]) for (const target of [1, 2, 3]) if (owner !== target) assert.notEqual(perceive(owner, target).level, "NONE", "all present pairs, including NPC -> NPC");
assert.equal(perceive(2, 3, [1, 2]).level, "NONE", "temporary absence");
assert.equal(perceive(2, 4).level, "NONE", "waiting/exported-only NPC");
assert.equal(sense(["vampire"], ["mummy"], { hiddenTraitKeys: ["trait_mummy"] }).level, "NONE");
const projection = createTraitProfileView(gameData, gameData.characters.get(1), { activeParticipantIds: [1, 2, 3] }).gameData.characters.get(2);
assert(projection.supernaturalPerception.includes("传说感知"));
assert.deepEqual(projection.traits, []);
assert(!JSON.stringify(projection).includes("mummy"));
Conversation.prototype.end.call({ gameData, isActive: true, clearHistory() {} });
assert.equal(perceive(1, 2).level, "NONE", "end disables perception even if an old caller retains the presence IDs");
assert.equal(perceive(2, 3).level, "NONE", "end also disables NPC pairs");
policy.activateSocialRecognition(gameData, [1, 2, 3]);
assert.equal(perceive(1, 2).group, "LEGEND", "next opening enables a fresh on-demand judgment");
gameData.playerID = 4;
assert.equal(perceive(1, 2).level, "NONE", "controlled character switch invalidates the prior opening");
console.log(`PASS seven perception groups: ${combinations} directed species pairs, specificity, private subtypes and dialogue lifecycle`);
