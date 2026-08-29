"use strict";

const CATALOG_VERSION = "ae4-c2-v2";
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

function compactText(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function descriptionContract(actionId, definition, declared) {
  if (declared.selectorContract?.shortDescription) return compactText(declared.selectorContract.shortDescription);
  let description = typeof definition.description === "string" ? definition.description : "";
  if (!description && typeof definition.description === "function") {
    try {
      description = definition.description({
        sourceCharacter: { id: "SOURCE", shortName: "Source character", fullName: "Source character", gold: "available", relationsToCharacters: [] },
        gameData: { playerID: "PLAYER", playerName: "Player", characters: new Map() }
      });
    } catch (_error) {}
  }
  return compactText(description || `Execute ${actionId} according to its source and target roles.`);
}

function argumentContract(definition, declared) {
  const staticArguments = Array.isArray(definition.args) ? definition.args : [];
  const requiredArguments = declared.requiredArguments || definition.requiredArguments || staticArguments.filter((argument) => argument.required === true).map((argument) => argument.name);
  const optionalArguments = declared.optionalArguments || definition.optionalArguments || staticArguments.filter((argument) => argument.required !== true).map((argument) => argument.name);
  return { requiredArguments, optionalArguments };
}

function actionMetadata(loadedAction) {
  const definition = loadedAction?.definition || {};
  const declared = definition.actionMetadata || {};
  const targetPolicy = declared.targetPolicy ?? definition.targetPolicy ?? "other_only";
  const argumentsContract = argumentContract(definition, declared);
  const selectorContract = Object.freeze({
    shortDescription: descriptionContract(loadedAction?.id || definition.signature || "unknownAction", definition, declared),
    sourceRole: declared.selectorContract?.sourceRole || definition.semantic?.participantRoles?.source || "actor",
    targetRole: declared.selectorContract?.targetRole || definition.semantic?.participantRoles?.target || (targetPolicy === "none" ? "none" : "target")
  });
  return Object.freeze({
    executionMode: declared.executionMode || definition.executionMode || "immediate",
    idempotent: declared.idempotent === true || definition.idempotent === true,
    dependencies: Object.freeze([...(declared.dependencies || definition.dependencies || [])]),
    pendingTtl: Number.isInteger(declared.pendingTtl ?? definition.pendingTtl) ? Number(declared.pendingTtl ?? definition.pendingTtl) : null,
    requiredArguments: Object.freeze([...argumentsContract.requiredArguments]),
    optionalArguments: Object.freeze([...argumentsContract.optionalArguments]),
    riskLevel: declared.riskLevel || definition.riskLevel || definition.semantic?.riskLevel || "low",
    relationshipTransition: declared.relationshipTransition === true || definition.relationshipTransition === true || definition.semantic?.bilateralPersistentEffect === true,
    availabilityRequirements: Object.freeze({ ...(declared.availabilityRequirements || definition.availabilityRequirements || {}) }),
    dependencyMetadata: Object.freeze({ ...(declared.dependencyMetadata || definition.dependencyMetadata || {}) }),
    socialCategory: declared.socialCategory || definition.socialCategory || null,
    targetPolicy,
    selectorContract,
    selectorVisible: declared.selectorVisible !== false && definition.selectorVisible !== false
  });
}

function compactDictionary(actions) {
  return actions
    .map((action) => {
      const metadata = actionMetadata(action);
      return {
        actionId: action.id,
        shortDescription: metadata.selectorContract.shortDescription,
        sourceRole: metadata.selectorContract.sourceRole,
        targetRole: metadata.selectorContract.targetRole,
        executionMode: metadata.executionMode,
        targetPolicy: metadata.targetPolicy,
        requiredArguments: metadata.requiredArguments,
        optionalArguments: metadata.optionalArguments,
        relationshipTransition: metadata.relationshipTransition,
        riskLevel: metadata.riskLevel
      };
    })
    .sort((left, right) => left.actionId.localeCompare(right.actionId));
}

module.exports = { CATALOG_VERSION, TARGET_POLICIES, isValidTargetPolicy, targetAllowed, compactText, descriptionContract, actionMetadata, compactDictionary };
