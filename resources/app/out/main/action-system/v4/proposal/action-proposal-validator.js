"use strict";

const availableActionCatalog = require("../catalog/available-action-catalog");
const { isValidTargetPolicy, targetAllowed } = require("../catalog/master-action-dictionary");
const relationshipTransitionGraph = require("../../social/relationship-transition-graph");

const DIRECT_OPINION_VALUES = Object.freeze([-3, -2, -1, 1, 2, 3]);

function resolveCharacterId(value, gameData) {
  if (value === null || value === undefined) return null;
  if (value === "player") return gameData.playerID;
  const text = String(value);
  const normalized = /^char_(-?\d+)$/.exec(text)?.[1] ?? (/^-?\d+$/.test(text) ? text : null);
  if (normalized == null) return null;
  const numeric = Number(normalized);
  return gameData.characters.has(numeric) ? numeric : null;
}

function validateArguments(definitions, provided) {
  const allowed = new Map((definitions || []).map((arg) => [arg.name, arg]));
  for (const key of Object.keys(provided || {})) {
    if (!allowed.has(key)) return { valid: false, reason: "rejected_unknown_argument" };
  }
  for (const arg of definitions || []) {
    const hasValue = Object.prototype.hasOwnProperty.call(provided || {}, arg.name) && provided[arg.name] !== null && provided[arg.name] !== undefined;
    if (arg.required && !hasValue) return { valid: false, reason: "rejected_missing_argument" };
    if (!hasValue) continue;
    const value = provided[arg.name];
    if (arg.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) return { valid: false, reason: "rejected_invalid_argument" };
      if (arg.min !== undefined && value < arg.min) return { valid: false, reason: "rejected_argument_out_of_range" };
      if (arg.max !== undefined && value > arg.max) return { valid: false, reason: "rejected_argument_out_of_range" };
      if (arg.step && !Number.isInteger((value - (arg.min || 0)) / arg.step)) return { valid: false, reason: "rejected_invalid_argument_step" };
    } else if (arg.type === "string") {
      if (typeof value !== "string") return { valid: false, reason: "rejected_invalid_argument" };
      if (arg.minLength !== undefined && value.length < arg.minLength) return { valid: false, reason: "rejected_invalid_argument" };
      if (arg.maxLength !== undefined && value.length > arg.maxLength) return { valid: false, reason: "rejected_invalid_argument" };
      if (arg.pattern && !(new RegExp(typeof arg.pattern === "string" ? arg.pattern : arg.pattern.source)).test(value)) return { valid: false, reason: "rejected_invalid_argument" };
    } else if (arg.type === "enum") {
      if (typeof value !== "string" || !arg.options.includes(value)) return { valid: false, reason: "rejected_invalid_argument" };
    } else if (arg.type === "boolean") {
      if (typeof value !== "boolean") return { valid: false, reason: "rejected_invalid_argument" };
    } else {
      return { valid: false, reason: "rejected_invalid_argument" };
    }
  }
  return { valid: true, arguments: Object.freeze({ ...(provided || {}) }) };
}

function relationshipSafety(actionId, source, target, metadata) {
  if (!metadata.relationshipTransition || !relationshipTransitionGraph.ACTION_RELATION[actionId]) return { valid: true };
  const transition = relationshipTransitionGraph.canTransition({ actionId, sourceCharacter: source, targetCharacter: target });
  return transition.allowed ? { valid: true } : { valid: false, reason: `rejected_${transition.reason}` };
}

async function validate({ proposal, catalog, conversation, registry, consentGranted = false }) {
  const gameData = conversation.gameData;
  if (Object.keys(proposal.arguments || {}).some(availableActionCatalog.isParticipantOverrideArgument)) {
    return { valid: false, reason: "rejected_participant_override" };
  }
  const loaded = registry.getById(proposal.actionId);
  if (!loaded || !loaded.validation?.valid || registry.isActionDisabled?.(proposal.actionId)) return { valid: false, reason: "rejected_unavailable_action" };
  const sourceCharacterId = resolveCharacterId(proposal.sourceCharacterId, gameData);
  if (sourceCharacterId == null) return { valid: false, reason: "rejected_invalid_source" };
  const entry = availableActionCatalog.findEntry(catalog, proposal.actionId, sourceCharacterId);
  if (!entry) return { valid: false, reason: "rejected_unavailable_action" };
  const targetCharacterId = resolveCharacterId(proposal.targetCharacterId, gameData);
  if (proposal.targetCharacterId != null && targetCharacterId == null) return { valid: false, reason: "rejected_invalid_target" };
  if (!isValidTargetPolicy(entry.targetPolicy)) return { valid: false, reason: "rejected_invalid_target_policy" };
  if (!targetAllowed(entry.targetPolicy, sourceCharacterId, targetCharacterId)) return { valid: false, reason: "rejected_invalid_target" };
  if (targetCharacterId != null && !entry.validTargetCharacterIds.includes(Number(targetCharacterId))) return { valid: false, reason: "rejected_invalid_target" };
  const argumentValidation = validateArguments(entry.arguments, proposal.arguments || {});
  if (!argumentValidation.valid) return argumentValidation;
  if (proposal.actionId === "changeOpinionOf" && ["precision_selector", "performance_local", "performance_compact"].includes(proposal.origin) && !DIRECT_OPINION_VALUES.includes(argumentValidation.arguments.value)) {
    return { valid: false, reason: "rejected_direct_opinion_delta" };
  }
  if (entry.metadata.executionMode === "consent_required" && !consentGranted) {
    return { valid: false, pendingRequired: true, reason: "consent_required", entry, sourceCharacterId, targetCharacterId, arguments: argumentValidation.arguments };
  }
  const sourceCharacter = gameData.characters.get(sourceCharacterId);
  const targetCharacter = targetCharacterId == null ? null : gameData.characters.get(targetCharacterId);
  const safety = relationshipSafety(proposal.actionId, sourceCharacter, targetCharacter, entry.metadata);
  if (!safety.valid) return safety;
  let checkResult;
  try {
    checkResult = await loaded.definition.check({ gameData, sourceCharacter });
  } catch (_error) {
    return { valid: false, reason: "rejected_action_check_failure" };
  }
  if (!checkResult?.canExecute) return { valid: false, reason: "rejected_legality_changed" };
  if (targetCharacterId != null && Array.isArray(checkResult.validTargetCharacterIds) && !checkResult.validTargetCharacterIds.map(Number).includes(Number(targetCharacterId))) return { valid: false, reason: "rejected_legality_changed" };
  return {
    valid: true,
    proposal: Object.freeze({ ...proposal, sourceCharacterId, targetCharacterId, arguments: argumentValidation.arguments }),
    loaded,
    entry,
    sourceCharacter,
    targetCharacter
  };
}

module.exports = { DIRECT_OPINION_VALUES, resolveCharacterId, validateArguments, relationshipSafety, validate };
