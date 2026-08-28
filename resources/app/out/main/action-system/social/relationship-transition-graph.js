"use strict";

const RELATION_LABELS = Object.freeze({
  friend: ["friend", "ami", "freund", "友人", "친구", "przyjaciel", "друг", "朋友", "amigo"],
  best_friend: ["best friend", "meilleur ami", "bester freund", "親友", "단짝 친구", "najlepszy przyjaciel", "лучший друг", "至交", "mejor amigo"],
  lover: ["lover", "amant", "affäre", "恋人", "연인", "kochanek", "любовник/любовница", "情人", "amante"],
  soulmate: ["soulmate", "âme sœur", "seelengefährte", "運命の人", "천생연분", "bratnia dusza", "родственная душа", "灵魂伴侣", "alma gemela"],
  rival: ["rival", "rivale", "好敵手", "경쟁자", "rywal", "соперник", "仇敌"],
  nemesis: ["nemesis", "ennemi juré", "erzfeind", "宿敵", "천적", "śmiertelny wróg", "заклятый враг", "死敌", "némesis"],
  blood_brother: ["blood brother", "frère de sang", "blutsbruder", "兄弟分", "의형제", "brat krwi", "побратим", "结义兄弟", "hermano de sangre"]
});

const ACTION_RELATION = Object.freeze({
  becomeFriendsWith: "friend",
  becomeBestFriendsWith: "best_friend",
  becomeLoversWith: "lover",
  becomeSoulmatesWith: "soulmate",
  becomeRivalsWith: "rival",
  becomeNemesisWith: "nemesis",
  becomeBloodBrothersWith: "blood_brother"
});

const REQUIRED_PREVIOUS = Object.freeze({
  becomeBestFriendsWith: ["friend"],
  becomeSoulmatesWith: ["lover"],
  becomeNemesisWith: ["rival"]
});

function normalizeRelation(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase();
  return Object.entries(RELATION_LABELS).find(([, labels]) => labels.includes(normalized))?.[0] || null;
}

function relationsBetween(character, targetId) {
  const entry = character?.relationsToCharacters?.find((item) => Number(item.id) === Number(targetId));
  return (entry?.relations || []).map(normalizeRelation).filter(Boolean);
}

function currentRelations(sourceCharacter, targetCharacter) {
  return [...new Set([
    ...relationsBetween(sourceCharacter, targetCharacter?.id),
    ...relationsBetween(targetCharacter, sourceCharacter?.id)
  ])];
}

function canTransition({ actionId, sourceCharacter, targetCharacter }) {
  const desired = ACTION_RELATION[actionId];
  if (!desired) return { allowed: false, reason: "unknown_relationship_action", currentState: [] };
  if (!sourceCharacter || !targetCharacter || Number(sourceCharacter.id) === Number(targetCharacter.id)) {
    return { allowed: false, reason: "invalid_participants", currentState: [] };
  }
  const currentState = currentRelations(sourceCharacter, targetCharacter);
  if (currentState.includes(desired)) return { allowed: false, reason: "relationship_already_exists", currentState };
  const required = REQUIRED_PREVIOUS[actionId];
  if (required && !required.some((relation) => currentState.includes(relation))) {
    return { allowed: false, reason: "missing_previous_relationship", currentState };
  }
  if (actionId === "becomeLoversWith" && currentState.some((relation) => ["rival", "nemesis", "soulmate"].includes(relation))) {
    return { allowed: false, reason: "incompatible_relationship", currentState };
  }
  if (actionId === "becomeRivalsWith" && currentState.some((relation) => ["lover", "soulmate", "nemesis"].includes(relation))) {
    return { allowed: false, reason: "incompatible_relationship", currentState };
  }
  if (actionId === "becomeBloodBrothersWith" && currentState.some((relation) => ["rival", "nemesis", "blood_brother"].includes(relation))) {
    return { allowed: false, reason: "incompatible_relationship", currentState };
  }
  return { allowed: true, reason: "allowed", currentState };
}

module.exports = {
  RELATION_LABELS,
  ACTION_RELATION,
  REQUIRED_PREVIOUS,
  normalizeRelation,
  currentRelations,
  canTransition
};
