"use strict";

const ACCEPTANCE_COMPLETES = new Set([
  "makeAlliance",
  "agreedToTruceWith",
  "becomeLoversWith",
  "becomeFriendsWith",
  "becomeBestFriendsWith",
  "becomeSoulmatesWith",
  "becomeRivalsWith",
  "becomeNemesisWith",
  "becomeBloodBrothersWith"
]);
const EXPLICIT_EXECUTION_REQUIRED = new Set([
  "paysGoldTo",
  "playerPaysGoldTo",
  "isImprisonedBy",
  "characterIsKilled",
  "isInjured",
  "intercourse",
  "isUndressed",
  "changeLocation"
]);

function getInteractionPolicy(actionId) {
  if (ACCEPTANCE_COMPLETES.has(actionId)) return { type: "bilateral_commitment", acceptancePolicy: "acceptance_completes", expiresAfterTurns: 2 };
  if (EXPLICIT_EXECUTION_REQUIRED.has(actionId)) return { type: "requested_execution", acceptancePolicy: "explicit_execution_required", expiresAfterTurns: 2 };
  return { type: "instant", acceptancePolicy: "explicit_execution_required", expiresAfterTurns: 2 };
}

module.exports = { getInteractionPolicy, ACCEPTANCE_COMPLETES, EXPLICIT_EXECUTION_REQUIRED };
