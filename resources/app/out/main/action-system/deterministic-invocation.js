"use strict";
const injuryTypeResolver = require("./injury-type-resolver");
const { createValidatedInvocation } = require("./action-types");

const deterministicResolvers = new Map([
  ["isInjured", ({ evidenceText }) => {
    const resolution = injuryTypeResolver.resolve(evidenceText);
    return resolution.resolved ? { resolved: true, args: { injuryType: resolution.injuryType }, details: resolution } : { resolved: false, details: resolution };
  }],
  ["intercourse", () => ({ resolved: true, args: {}, details: { reason: "no_action_arguments" } })]
]);
const ALLOWED_ACTION_IDS = new Set(deterministicResolvers.keys());
function buildDeterministicInvocation({ actionId, binding, args = {} }) {
  if (!ALLOWED_ACTION_IDS.has(actionId)) return { mode: "unsupported", invocation: null, reason: "action_not_deterministic" };
  if (!binding || binding.mode !== "resolved" || binding.sourceCharacterId == null || binding.targetCharacterId == null) {
    return { mode: "unresolved", invocation: null, reason: "missing_invocation_binding" };
  }
  return {
    mode: "local",
    reason: "exact_semantic_binding",
    invocation: createValidatedInvocation({
      actionId,
      sourceCharacterId: binding.sourceCharacterId,
      targetCharacterId: binding.targetCharacterId,
      bindingId: binding.bindingId,
      eventId: binding.eventId,
      traceId: binding.traceId,
      args: Object.freeze({ ...args })
    })
  };
}

function resolve({ availableAction, evidenceText }) {
  if (!availableAction?.deterministicInvocation) return { mode: "unsupported", invocation: null, reason: "metadata_not_deterministic" };
  const resolver = deterministicResolvers.get(availableAction.signature);
  if (!resolver) return { mode: "unsupported", invocation: null, reason: "resolver_not_registered" };
  const resolved = resolver({ evidenceText, availableAction });
  if (!resolved.resolved) return { mode: "unresolved", invocation: null, reason: resolved.details?.reason || "deterministic_args_unresolved", details: resolved.details };
  return {
    ...buildDeterministicInvocation({
      actionId: availableAction.signature,
      binding: availableAction.participantBinding,
      args: resolved.args
    }),
    details: resolved.details
  };
}

module.exports = { resolve, buildDeterministicInvocation, deterministicResolvers, ALLOWED_ACTION_IDS };
