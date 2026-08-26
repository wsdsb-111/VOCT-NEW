"use strict";

const fs$1 = require("fs");

function removeTooltip$1(text) {
  return text.replace(/<.*?>.*?<\/.*?>/gi, "").trim();
}
function inferGenderFromPronoun(value) {
  const text = removeTooltip$1(String(value ?? "")).trim().toLowerCase();
  const maleValues = /* @__PURE__ */ new Set(["he", "him", "his", "male", "man", "m", "他", "男", "男性", "男人", "il", "er", "el", "él", "on", "он", "его", "彼", "그"]);
  const femaleValues = /* @__PURE__ */ new Set(["she", "her", "hers", "female", "woman", "f", "她", "女", "女性", "女人", "elle", "sie", "ella", "ona", "она", "ее", "её", "彼女", "그녀"]);
  if (maleValues.has(text)) return "male";
  if (femaleValues.has(text)) return "female";
  return "unknown";
}
class Character {
  constructor(data) {
    this.conversationSummaries = [];
    const ageText = String(data[5] ?? "").replace(/<[^>]*>/g, "").trim();
    const parsedAge = Number(ageText);
    this.id = Number(data[0]), this.shortName = data[1], this.fullName = data[2], this.primaryTitle = String(data[3] ?? "").replace(/<[^>]*>/g, "").trim(), this.sheHe = data[4], this.gender = inferGenderFromPronoun(data[4]), this.age = Number.isFinite(parsedAge) ? Math.floor(parsedAge) : Number.parseInt(ageText.match(/\d+/)?.[0] || "", 10), this.gold = Math.floor(Number(data[6])), this.opinionOfPlayer = Number(data[7]), this.sexuality = removeTooltip$1(data[8]), this.personality = data[9], this.greed = Number(data[10]), this.boldness = 0, this.compassion = 0, this.energy = 0, this.honor = 0, this.rationality = 0, this.sociability = 0, this.vengefulness = 0, this.zeal = 0, this.isIndependentRuler = !!Number(data[11]), this.liege = data[12], this.consort = data[13], this.culture = data[14], this.faith = data[15], this.house = data[16], this.isRuler = !!Number(data[17]), this.firstName = data[18], this.capitalLocation = data[19], this.topLiege = data[20], this.prowess = Number(data[21]), this.isKnight = !!Number(data[22]), this.liegeRealmLaw = data[23], this.isLandedRuler = !!Number(data[24]), this.heldCourtAndCouncilPositions = data[25], this.titleRankConcept = data[26], this.secrets = [], this.knownSecrets = [], this.modifiers = [], this.laws = [], this.memories = [], this.traits = [], this.relationsToPlayer = [], this.relationsToCharacters = [], this.opinionBreakdowns = [], this.opinions = [], this.parents = [], this.children = [], this.siblings = [];
  }
  /**
   * Check if the character has a trait with a given name.
   * @param name - the name of the trait
   * @return {boolean} 
   */
  hasTrait(name) {
    return this.traits.some((trait) => trait.name.toLowerCase() == name.toLowerCase());
  }
  /**
   * Append a new trait to the character.
   * @param {Trait }trait
   * @returns {void} 
   */
  addTrait(trait) {
    this.traits.push(trait);
  }
  removeTrait(name) {
    this.traits = this.traits.filter((trait) => {
      return trait.name.toLowerCase() !== name.toLowerCase();
    });
  }
  /**
   * Get the opinion breakdown to a specific character
   * @param {number} targetId - the ID of the target character
   * @returns {OpinionModifier[]} - array of opinion modifiers, or empty array if not found
   */
  getOpinionBreakdownTo(targetId) {
    const breakdown = this.opinionBreakdowns.find((ob) => ob.id === targetId);
    return breakdown ? breakdown.breakdown : [];
  }
  /**
   * Get the value of the opinion modifier with the given reason text towards a specific character
   * @param {number} targetId - the ID of the target character
   * @param {string} reason - the opinion modifier's reason text
   * @returns {number} - opinion modifier's value. returns 0 if doesn't exist.
   */
  getOpinionModifierValue(targetId, reason) {
    const breakdown = this.getOpinionBreakdownTo(targetId);
    let target = breakdown.find((modifier) => modifier.reason === reason);
    if (target !== void 0) {
      return target.value;
    } else {
      return 0;
    }
  }
  /**
   * Sets the opinion modifier's value towards a specific character. Creates a new opinion modifier if it doesn't exist.
   * @param {number} targetId - the ID of the target character
   * @param {string} reason - The opinion modifier's reason text.
   * @param {number} value - The value to set the opinion modifier.
   * @returns {void}
   */
  setOpinionModifierValue(targetId, reason, value) {
    let breakdownEntry = this.opinionBreakdowns.find((ob) => ob.id === targetId);
    if (!breakdownEntry) {
      breakdownEntry = { id: targetId, breakdown: [] };
      this.opinionBreakdowns.push(breakdownEntry);
    }
    let targetIndex = breakdownEntry.breakdown.findIndex((om) => {
      return om.reason.toLowerCase() == reason.toLowerCase();
    });
    if (targetIndex != -1) {
      breakdownEntry.breakdown[targetIndex].value = value;
    } else {
      breakdownEntry.breakdown.push({
        reason,
        value
      });
    }
  }
  saveSummaries(summariesPath) {
    fs$1.writeFileSync(summariesPath, JSON.stringify(this.conversationSummaries, null, "	"));
  }
  loadSummaries(summariesPath) {
    if (fs$1.existsSync(summariesPath)) {
      this.conversationSummaries = JSON.parse(fs$1.readFileSync(summariesPath, "utf8"));
    }
  }
}


module.exports = { Character, inferGenderFromPronoun };
