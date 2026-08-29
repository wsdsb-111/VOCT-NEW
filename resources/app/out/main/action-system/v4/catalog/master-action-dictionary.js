"use strict";

const CATALOG_VERSION = "ae4-c2-v1";
const TARGET_POLICIES = Object.freeze(["other_only", "self_only", "self_or_other", "none"]);

function isValidTargetPolicy(policy) {
  return TARGET_POLICIES.includes(policy);
}

function targetAllowed(policy, sourceId, targetId) {
  if (!isValidTargetPolicy(policy)) return false;
  if (policy === "none") return targetId == null;
  if (sourceId == null || targetId == null) return false;
  if (policy === "other_only") return Number(sourceId) !== Number(targetId);
  if (policy === "self_only") return Number(sourceId) === Number(targetId);
  return true;
}

function actionMetadata(loadedAction) {
  const definition = loadedAction?.definition || {};
  const declared = definition.actionMetadata || {};
  return Object.freeze({
    executionMode: declared.executionMode || definition.executionMode || "immediate",
    idempotent: declared.idempotent === true || definition.idempotent === true,
    dependencies: Object.freeze([...(declared.dependencies || definition.dependencies || [])]),
    pendingTtl: Number.isInteger(declared.pendingTtl ?? definition.pendingTtl) ? Number(declared.pendingTtl ?? definition.pendingTtl) : null,
    requiredArguments: Object.freeze([...(declared.requiredArguments || definition.requiredArguments || [])]),
    optionalArguments: Object.freeze([...(declared.optionalArguments || definition.optionalArguments || [])]),
    riskLevel: declared.riskLevel || definition.riskLevel || definition.semantic?.riskLevel || "low",
    relationshipTransition: declared.relationshipTransition === true || definition.relationshipTransition === true || definition.semantic?.bilateralPersistentEffect === true,
    availabilityRequirements: Object.freeze({ ...(declared.availabilityRequirements || definition.availabilityRequirements || {}) }),
    dependencyMetadata: Object.freeze({ ...(declared.dependencyMetadata || definition.dependencyMetadata || {}) }),
    socialCategory: declared.socialCategory || definition.socialCategory || null,
    targetPolicy: declared.targetPolicy ?? definition.targetPolicy ?? "other_only",
    selectorVisible: declared.selectorVisible !== false && definition.selectorVisible !== false
  });
}

function compactDictionary(actions) {
  return actions
    .map((action) => ({
      actionId: action.id,
      executionMode: actionMetadata(action).executionMode,
      idempotent: actionMetadata(action).idempotent,
      dependencies: actionMetadata(action).dependencies,
      targetPolicy: actionMetadata(action).targetPolicy,
      relationshipTransition: actionMetadata(action).relationshipTransition
    }))
    .sort((left, right) => left.actionId.localeCompare(right.actionId));
}

module.exports = { CATALOG_VERSION, TARGET_POLICIES, isValidTargetPolicy, targetAllowed, actionMetadata, compactDictionary };
