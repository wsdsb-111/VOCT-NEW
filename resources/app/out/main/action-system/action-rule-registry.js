"use strict";

const deterministicInvocation = require("./deterministic-invocation");

function validateActionRules(action) {
  if (action.triggerCategories !== undefined && (!Array.isArray(action.triggerCategories) || action.triggerCategories.some((category) => typeof category !== "string" || category.length === 0))) {
    return { valid: false, message: "Action triggerCategories must be an array of non-empty strings." };
  }
  if (action.semantic === undefined) return { valid: true };
  if (!action.semantic || typeof action.semantic !== "object" || Array.isArray(action.semantic)) {
    return { valid: false, message: "Action semantic metadata must be an object." };
  }
  const semantic = action.semantic;
  const isRegExp = (value) => Object.prototype.toString.call(value) === "[object RegExp]";
  for (const field of ["candidatePatterns", "evidencePatterns", "excludePatterns"]) {
    if (semantic[field] !== undefined && (!Array.isArray(semantic[field]) || semantic[field].some((pattern) => !isRegExp(pattern)))) {
      return { valid: false, message: `Action semantic ${field} must be an array of regular expressions.` };
    }
  }
  if (semantic.match !== undefined && typeof semantic.match !== "function") return { valid: false, message: "Action semantic match must be a function." };
  if (semantic.deterministicInvocation !== undefined && typeof semantic.deterministicInvocation !== "boolean") return { valid: false, message: "Action semantic deterministicInvocation must be a boolean." };
  if (semantic.moneyTransfer !== undefined && typeof semantic.moneyTransfer !== "boolean") return { valid: false, message: "Action semantic moneyTransfer must be a boolean." };
  if (semantic.deterministicInvocation === true && !deterministicInvocation.hasResolver(action.signature)) return { valid: false, message: "Deterministic action is missing registered resolver." };
  if (semantic.exclusiveGroup !== undefined && typeof semantic.exclusiveGroup !== "string") return { valid: false, message: "Action semantic exclusiveGroup must be a string." };
  if (semantic.priority !== undefined && !Number.isFinite(semantic.priority)) return { valid: false, message: "Action semantic priority must be a finite number." };
  if (semantic.riskLevel !== undefined && !["low", "medium", "high"].includes(semantic.riskLevel)) return { valid: false, message: "Action semantic riskLevel must be low, medium, or high." };
  if (semantic.participantRoles !== undefined) {
    const roles = semantic.participantRoles;
    const allowedRoles = ["actor", "patient", "speaker"];
    if (!roles || typeof roles !== "object" || Array.isArray(roles) || ["source", "target"].some((slot) => !allowedRoles.includes(roles[slot]))) {
      return { valid: false, message: "Action semantic participantRoles must define source and target as actor, patient, or speaker." };
    }
  }
  if (semantic.bilateralPersistentEffect !== undefined && typeof semantic.bilateralPersistentEffect !== "boolean") return { valid: false, message: "Action semantic bilateralPersistentEffect must be a boolean." };
  if (semantic.poseSubject !== undefined && typeof semantic.poseSubject !== "boolean") return { valid: false, message: "Action semantic poseSubject must be a boolean." };
  if (semantic.bilateralPersistentEffect === true && semantic.participantRoles === undefined) return { valid: false, message: "Bilateral persistent actions must define semantic participantRoles." };
  return { valid: true };
}

function buildCategoryIndex(actions) {
  const index = new Map();
  for (const action of actions || []) {
    if (!action?.validation?.valid) continue;
    for (const category of action.definition?.triggerCategories || []) {
      if (!index.has(category)) index.set(category, []);
      index.get(category).push(action.id);
    }
  }
  for (const [category, actionIds] of index) index.set(category, Object.freeze([...actionIds]));
  return index;
}

function getActionIdsForCategories(index, categories) {
  const actionIds = new Set();
  for (const category of categories || []) {
    for (const actionId of index?.get(category) || []) actionIds.add(actionId);
  }
  return actionIds;
}

module.exports = { validateActionRules, buildCategoryIndex, getActionIdsForCategories };
