"use strict";
const injuryTypeResolver = require("./injury-type-resolver");
const emotionTypeResolver = require("./emotion-type-resolver");
const moneyAmountResolver = require("./money-amount-resolver");
const { createValidatedInvocation } = require("./action-types");

const deterministicResolvers = new Map([
  ["isInjured", ({ evidenceText }) => {
    const resolution = injuryTypeResolver.resolve(evidenceText);
    return resolution.resolved ? { resolved: true, args: { injuryType: resolution.injuryType }, details: resolution } : { resolved: false, details: resolution };
  }],
  ["setEmotion", ({ evidenceText }) => {
    const resolution = emotionTypeResolver.resolve(evidenceText);
    return resolution.resolved ? { resolved: true, args: { emotion: resolution.emotion }, details: resolution } : { resolved: false, details: resolution };
  }],
  ["playerPaysGoldTo", ({ evidenceText }) => {
    const resolution = moneyAmountResolver.resolve(evidenceText);
    return resolution.resolved ? { resolved: true, args: { amount: resolution.normalizedAmount }, details: resolution } : { resolved: false, details: resolution };
  }],
  ["paysGoldTo", ({ evidenceText }) => {
    const resolution = moneyAmountResolver.resolve(evidenceText);
    return resolution.resolved ? { resolved: true, args: { amount: resolution.normalizedAmount }, details: resolution } : { resolved: false, details: resolution };
  }],
  ["intercourse", () => ({ resolved: true, args: {}, details: { reason: "no_action_arguments" } })]
]);
const SOCIAL_ACTION_IDS = new Set([
  "changeOpinionOf",
  "becomeFriendsWith",
  "becomeBestFriendsWith",
  "becomeLoversWith",
  "becomeSoulmatesWith",
  "becomeRivalsWith",
  "becomeNemesisWith",
  "becomeBloodBrothersWith"
]);
const ALLOWED_ACTION_IDS = new Set(deterministicResolvers.keys());
function hasResolver(actionId) {
  return deterministicResolvers.has(actionId);
}
function buildDeterministicInvocation({ actionId, binding, args = {}, allowedActionIds = ALLOWED_ACTION_IDS }) {
  if (!allowedActionIds.has(actionId)) return { mode: "unsupported", invocation: null, reason: "action_not_deterministic" };
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
      origin: String(binding.eventId || "").startsWith("social:") ? "social" : "action",
      sourceMessageId: binding.messageId ?? null,
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

function resolveSocial({ actionId, binding, args = {} }) {
  if (!SOCIAL_ACTION_IDS.has(actionId)) return { mode: "unsupported", invocation: null, reason: "social_action_not_allowed" };
  if (actionId === "changeOpinionOf") {
    const value = Number(args.value);
    if (!Number.isInteger(value) || value === 0 || value < -10 || value > 10) return { mode: "unresolved", invocation: null, reason: "invalid_social_opinion_value" };
  } else if (args.reason != null && typeof args.reason !== "string") {
    return { mode: "unresolved", invocation: null, reason: "invalid_social_relationship_reason" };
  }
  return buildDeterministicInvocation({ actionId, binding, args, allowedActionIds: SOCIAL_ACTION_IDS });
}

module.exports = { resolve, resolveSocial, buildDeterministicInvocation, hasResolver, deterministicResolvers, SOCIAL_ACTION_IDS, ALLOWED_ACTION_IDS };
