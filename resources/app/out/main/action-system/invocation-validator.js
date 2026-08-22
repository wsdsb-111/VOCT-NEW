"use strict";
const { createValidatedInvocation } = require("./action-types");

function buildCanonicalInvocation({ modelInvocation, availableAction, binding = null, registry, gameData, eventId = null, traceId = null }) {
  if (!modelInvocation || !availableAction) return { valid: false, reason: "missing_invocation_context" };
  if (binding && binding.mode !== "resolved") return { valid: false, reason: "missing_invocation_binding" };
  if (modelInvocation.actionId !== availableAction.signature) return { valid: false, reason: "action_not_available" };
  const loaded = registry?.getById?.(modelInvocation.actionId);
  if (!loaded || !loaded.validation?.valid) return { valid: false, reason: "action_invalid_or_disabled" };
  const sourceCharacterId = binding?.sourceCharacterId ?? availableAction.sourceCharacterId ?? null;
  const targetCharacterId = binding?.targetCharacterId ?? availableAction.resolvedTargetCharacterId ?? modelInvocation.targetCharacterId ?? null;
  // The model can select an action and provide arguments only. Its source is
  // never authoritative, including actions that do not need a target binding.
  if (modelInvocation.sourceCharacterId != null && modelInvocation.sourceCharacterId !== sourceCharacterId) return { valid: false, reason: "binding_source_mismatch" };
  if (sourceCharacterId == null) return { valid: false, reason: "missing_resolved_source" };
  if (availableAction.sourceLocked && modelInvocation.sourceCharacterId != null && modelInvocation.sourceCharacterId !== binding?.sourceCharacterId) return { valid: false, reason: "binding_source_mismatch" };
  if (availableAction.sourceLocked && sourceCharacterId !== availableAction.sourceCharacterId) return { valid: false, reason: "binding_source_mismatch" };
  if (sourceCharacterId != null && !gameData?.characters?.has?.(sourceCharacterId)) return { valid: false, reason: "source_not_in_game_data" };
  if (availableAction.targetLocked && modelInvocation.targetCharacterId != null && modelInvocation.targetCharacterId !== binding.targetCharacterId) return { valid: false, reason: "binding_target_mismatch" };
  if (availableAction.targetLocked && availableAction.resolvedTargetCharacterId !== binding.targetCharacterId) return { valid: false, reason: "binding_target_mismatch" };
  if (availableAction.targetLocked && targetCharacterId !== binding.targetCharacterId) return { valid: false, reason: "binding_target_mismatch" };
  if (targetCharacterId != null && !gameData?.characters?.has?.(targetCharacterId)) return { valid: false, reason: "target_not_in_game_data" };
  if (availableAction.validTargetCharacterIds && targetCharacterId != null && !availableAction.validTargetCharacterIds.includes(targetCharacterId)) return { valid: false, reason: "target_not_authorized" };
  return {
    valid: true,
    invocation: createValidatedInvocation({
      actionId: modelInvocation.actionId,
      args: modelInvocation.args || {},
      targetCharacterId,
      sourceCharacterId,
      bindingId: binding?.bindingId || availableAction.bindingId || `available:${availableAction.signature}:${sourceCharacterId}:${targetCharacterId ?? "none"}`,
      eventId: binding?.eventId ?? eventId,
      traceId: binding?.traceId ?? traceId
    })
  };
}

const validateInvocation = buildCanonicalInvocation;

module.exports = { validateInvocation, buildCanonicalInvocation };
