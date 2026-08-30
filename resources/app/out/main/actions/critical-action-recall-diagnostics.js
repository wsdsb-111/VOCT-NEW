"use strict";

const CRITICAL_ACTION_IDS = new Set([
  "isInjured",
  "characterIsKilled",
  "becomeFriendsWith",
  "becomeLoversWith",
  "becomeSoulmatesWith",
  "becomeRivalsWith",
  "becomeNemesisWith",
  "becomeBloodBrothersWith",
  "becomeBestFriendsWith"
]);

const RELATIONS = {
  friend: ["friend", "ami", "freund", "友人", "친구", "przyjaciel", "друг", "朋友", "amigo"],
  bestFriend: ["best friend", "meilleur ami", "bester freund", "親友", "단짝 친구", "najlepszy przyjaciel", "лучший друг", "至交", "mejor amigo"],
  lover: ["lover", "amant", "affäre", "恋人", "연인", "kochanek", "любовник/любовница", "情人", "amante"],
  soulmate: ["soulmate", "âme sœur", "seelengefährte", "運命の人", "천생연분", "bratnia dusza", "родственная душа", "灵魂伴侣", "alma gemela"],
  rival: ["rival", "rivale", "好敵手", "경쟁자", "rywal", "соперник", "仇敌"],
  nemesis: ["nemesis", "ennemi juré", "erzfeind", "宿敵", "천적", "śmiertelny wróg", "заклятый враг", "死敌", "némesis"],
  bloodBrother: ["blood brother", "frère de sang", "blutsbruder", "兄弟分", "의형제", "brat krwi", "побратим", "结义兄弟", "hermano de sangre"]
};

function relationSet(sourceCharacter, targetId) {
  const entry = sourceCharacter?.relationsToCharacters?.find((relation) => Number(relation.id) === Number(targetId));
  return new Set((entry?.relations || []).map((relation) => String(relation).toLowerCase()));
}

function hasAnyRelation(sourceCharacter, targetId, names) {
  const relations = relationSet(sourceCharacter, targetId);
  return names.some((name) => relations.has(name));
}

function classifyUnavailable(actionId, sourceCharacter, gameData) {
  const targetIds = Array.from(gameData?.characters?.keys?.() || []).filter((id) => Number(id) !== Number(sourceCharacter?.id));
  if (targetIds.length === 0) return "UNAVAILABLE_PREREQUISITE";
  const allHave = (names) => targetIds.every((id) => hasAnyRelation(sourceCharacter, id, names));
  if (actionId === "becomeFriendsWith") return allHave([...RELATIONS.friend, ...RELATIONS.bestFriend]) ? "UNAVAILABLE_ALREADY_HAS_STATE" : "UNAVAILABLE_CONFLICTING_RELATION";
  if (actionId === "becomeLoversWith") return allHave([...RELATIONS.lover, ...RELATIONS.soulmate]) ? "UNAVAILABLE_ALREADY_HAS_STATE" : "UNAVAILABLE_CONFLICTING_RELATION";
  if (actionId === "becomeRivalsWith") return allHave([...RELATIONS.rival, ...RELATIONS.nemesis]) ? "UNAVAILABLE_ALREADY_HAS_STATE" : "UNAVAILABLE_CONFLICTING_RELATION";
  if (actionId === "becomeBloodBrothersWith") return allHave(RELATIONS.bloodBrother) ? "UNAVAILABLE_ALREADY_HAS_STATE" : "UNAVAILABLE_CONFLICTING_RELATION";
  if (actionId === "becomeBestFriendsWith") return allHave(RELATIONS.bestFriend) ? "UNAVAILABLE_ALREADY_HAS_STATE" : "UNAVAILABLE_PREREQUISITE";
  if (actionId === "becomeNemesisWith") return allHave(RELATIONS.nemesis) ? "UNAVAILABLE_ALREADY_HAS_STATE" : "UNAVAILABLE_PREREQUISITE";
  if (actionId === "becomeSoulmatesWith") {
    if (allHave(RELATIONS.soulmate)) return "UNAVAILABLE_ALREADY_HAS_STATE";
    if (targetIds.some((id) => hasAnyRelation(sourceCharacter, id, [...RELATIONS.rival, ...RELATIONS.nemesis]))) return "UNAVAILABLE_CONFLICTING_RELATION";
  }
  return "UNAVAILABLE_PREREQUISITE";
}

class CriticalActionRecallObserver {
  constructor(sourceCharacter, gameData) {
    this.sourceCharacter = sourceCharacter;
    this.gameData = gameData;
    this.observations = new Map();
  }

  observeCheck(actionId, checkResult) {
    if (!CRITICAL_ACTION_IDS.has(actionId)) return;
    const validTargetCharacterIds = Array.isArray(checkResult?.validTargetCharacterIds) ? checkResult.validTargetCharacterIds.map(Number).filter(Number.isFinite) : [];
    const wasAvailable = checkResult?.canExecute === true;
    this.observations.set(actionId, {
      actionId,
      wasAvailable,
      validTargetCharacterIds,
      sourceCharacterId: Number(this.sourceCharacter?.id),
      availabilityReason: wasAvailable ? "AVAILABLE" : classifyUnavailable(actionId, this.sourceCharacter, this.gameData),
      selected: false,
      selectedTarget: null,
      validationResult: "NOT_SELECTED",
      missCategory: wasAvailable ? null : classifyUnavailable(actionId, this.sourceCharacter, this.gameData)
    });
  }

  observeCheckFailure(actionId) {
    if (!CRITICAL_ACTION_IDS.has(actionId)) return;
    this.observations.set(actionId, {
      actionId,
      wasAvailable: false,
      validTargetCharacterIds: [],
      sourceCharacterId: Number(this.sourceCharacter?.id),
      availabilityReason: "VALIDATION_REJECTED",
      selected: false,
      selectedTarget: null,
      validationResult: "ACTION_CHECK_FAILED",
      missCategory: "VALIDATION_REJECTED"
    });
  }

  observeMissingActions(loadedActionIds) {
    const loaded = new Set(loadedActionIds || []);
    for (const actionId of CRITICAL_ACTION_IDS) {
      if (!loaded.has(actionId)) this.observeCheckFailure(actionId);
    }
  }

  build({ selectedInvocations = [], autoApproved = [], needsApproval = [], evaluationStatus = "completed" } = {}) {
    const selectedById = new Map();
    for (const invocation of selectedInvocations) {
      if (CRITICAL_ACTION_IDS.has(invocation?.actionId) && !selectedById.has(invocation.actionId)) selectedById.set(invocation.actionId, invocation);
    }
    const executedById = new Map(autoApproved.map((result) => [result.actionId, result]));
    const pendingIds = new Set(needsApproval.map((result) => result.actionId));
    return [...this.observations.values()].map((diagnostic) => {
      const invocation = selectedById.get(diagnostic.actionId);
      if (!invocation) {
        if (diagnostic.wasAvailable && (evaluationStatus === "invalid_schema" || evaluationStatus === "invalid_json")) {
          return { ...diagnostic, validationResult: "RESPONSE_VALIDATION_REJECTED", missCategory: "VALIDATION_REJECTED" };
        }
        return diagnostic;
      }
      const result = executedById.get(diagnostic.actionId);
      const selectedTarget = invocation.targetCharacterId == null ? null : Number(invocation.targetCharacterId);
      const sourceCharacterId = invocation.args?.isPlayerSource === true ? Number(this.gameData?.playerID) : diagnostic.sourceCharacterId;
      if (result?.success === false) return { ...diagnostic, sourceCharacterId, selected: true, selectedTarget, validationResult: "EFFECT_FAILED", missCategory: "EFFECT_FAILED" };
      if (result?.success === true) return { ...diagnostic, sourceCharacterId, selected: true, selectedTarget, validationResult: "EXECUTED", missCategory: null };
      if (pendingIds.has(diagnostic.actionId)) return { ...diagnostic, sourceCharacterId, selected: true, selectedTarget, validationResult: "PENDING_APPROVAL", missCategory: null };
      return { ...diagnostic, sourceCharacterId, selected: true, selectedTarget, validationResult: "SELECTED_VALIDATED", missCategory: null };
    });
  }
}

function classifyWithGroundTruth(diagnostic, groundTruth) {
  if (!groundTruth?.shouldTrigger) return diagnostic?.selected ? "CRITICAL_FALSE_POSITIVE" : null;
  if (groundTruth.unrepresentableByOfficialBinding) return "UNREPRESENTABLE_BY_OFFICIAL_BINDING";
  if (!diagnostic?.wasAvailable) return diagnostic?.availabilityReason || "UNAVAILABLE_PREREQUISITE";
  if (!diagnostic.selected) return "SELECTOR_MISS";
  if (groundTruth.targetCharacterId != null && Number(diagnostic.selectedTarget) !== Number(groundTruth.targetCharacterId)) return "WRONG_TARGET";
  return diagnostic.missCategory || null;
}

module.exports = { CRITICAL_ACTION_IDS, CriticalActionRecallObserver, classifyWithGroundTruth };
