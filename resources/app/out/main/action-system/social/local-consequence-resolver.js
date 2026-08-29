"use strict";

const { createConsequence } = require("./social-consequence-types");
const evidencePolicy = require("./evidence-policy");

const OPINION_BY_SIGNAL = Object.freeze({
  polite_positive: 1,
  praise: 2,
  gratitude: 2,
  comfort: 2,
  help: 3,
  rescue: 5,
  affection: 2,
  rejection: -2,
  insult: -2,
  humiliation: -3,
  threat: -3,
  betrayal: -6,
  severe_harm: -7,
  family_loss: -9,
  hostility: -2
});

const SIGNAL_PRIORITY = Object.freeze([
  "family_loss",
  "severe_harm",
  "betrayal",
  "rescue",
  "humiliation",
  "threat",
  "help",
  "praise",
  "gratitude",
  "comfort",
  "rejection",
  "affection",
  "hostility",
  "insult",
  "polite_positive"
]);

function normalizeSignal(signal) {
  if (signal.type === "affection_rejection") return { ...signal, reasonCluster: "rejection" };
  if (["romantic_affection", "physical_affection", "intimate_contact"].includes(signal.type) && signal.reaction === "accepted") return { ...signal, reasonCluster: "affection" };
  if (signal.type === "betrayal_signal") return { ...signal, reasonCluster: "other" };
  if (signal.type === "hate" || signal.type === "revenge") return { ...signal, reasonCluster: "hostility", direction: "speaker_to_target" };
  return { ...signal, reasonCluster: evidencePolicy.canonicalReasonCluster(signal.type) };
}

function directionFor(signal, participants) {
  const actorId = participants.actorId;
  const targetId = participants.targetId;
  if (signal.direction === "speaker_to_target") return { sourceCharacterId: actorId, targetCharacterId: targetId };
  if (["praise", "insult", "humiliation", "threat", "rejection"].includes(signal.reasonCluster)) {
    return { sourceCharacterId: targetId, targetCharacterId: actorId };
  }
  if (signal.reasonCluster === "severe_harm") {
    return { sourceCharacterId: signal.targetId ?? targetId, targetCharacterId: signal.actorId ?? actorId };
  }
  if (signal.reasonCluster === "family_loss") {
    return { sourceCharacterId: signal.affectedCharacterId ?? targetId, targetCharacterId: signal.targetId ?? actorId };
  }
  if (signal.reasonCluster === "rescue") {
    return { sourceCharacterId: signal.targetId ?? actorId, targetCharacterId: signal.actorId ?? targetId };
  }
  return { sourceCharacterId: actorId, targetCharacterId: targetId };
}

function relationshipFromText(text, signal) {
  if (signal?.type !== "relationship_statement") return null;
  const rules = [
    ["becomeSoulmatesWith", /(?:灵魂伴侣|命定之人)/],
    ["becomeBestFriendsWith", /(?:挚友|至交)/],
    ["becomeLoversWith", /(?:情人|恋人)/],
    ["becomeNemesisWith", /(?:死敌|宿敌)/],
    ["becomeRivalsWith", /(?:仇敌|敌人)/],
    ["becomeBloodBrothersWith", /(?:结拜|义结金兰|义结兄弟|结义兄弟)/],
    ["becomeFriendsWith", /(?:朋友|好友)/]
  ];
  const match = rules.find(([, pattern]) => pattern.test(text));
  return match ? match[0] : null;
}

function hostileRelationship(context, normalized) {
  const major = normalized.find((item) => ["betrayal", "severe_harm", "family_loss"].includes(item.reasonCluster) && evidencePolicy.canSupportWorldConsequence(item.evidence));
  const enduringHostility = normalized.some((item) => ["hate", "revenge"].includes(item.type));
  if (!major || !enduringHostility) return null;
  const actorId = context.message?.actorId;
  const targetId = context.message?.targetId;
  const harmActorId = major.reasonCluster === "family_loss" ? major.targetId : major.actorId;
  if (Number(harmActorId) !== Number(targetId) || Number(major.affectedCharacterId ?? major.targetId) !== Number(actorId)) return null;
  const existing = (context.relationshipStates || []).filter((item) => (
    Number(item.sourceCharacterId) === Number(actorId) && Number(item.targetCharacterId) === Number(targetId)
  ) || (
    Number(item.sourceCharacterId) === Number(targetId) && Number(item.targetCharacterId) === Number(actorId)
  )).flatMap((item) => item.relations || []).map((item) => String(item).toLocaleLowerCase());
  return {
    actionId: existing.some((item) => ["rival", "仇敌", "rivale", "好敵手", "경쟁자", "rywal", "соперник"].includes(item))
      ? "becomeNemesisWith"
      : "becomeRivalsWith",
    major
  };
}

function calculateHostileRelationshipConfidence(actionId, major) {
  if (!major || !evidencePolicy.canSupportWorldConsequence(major.evidence)) return 0;
  return actionId === "becomeNemesisWith" ? 0.97 : 0.92;
}

function resolve(context, gateResult) {
  const participants = gateResult?.participants;
  const base = {
    consequenceId: `local:${context.message?.id ?? "message"}`,
    conversationId: context.conversationId,
    turnEpoch: context.turnEpoch,
    sourceEventId: context.dialogueEvidence?.[0]?.sourceMessageId ?? context.message?.id ?? null,
    evidenceText: context.message?.content || "",
    directParticipants: participants || {},
    opinionChanges: [],
    relationshipTransition: null,
    observerEffects: [],
    inferenceMode: "local",
    riskLevel: "low"
  };
  if (!gateResult?.eligible || !participants) return createConsequence(base);

  const normalized = gateResult.signals.map(normalizeSignal);
  const selected = SIGNAL_PRIORITY.map((reason) => normalized.filter((item) => item.reasonCluster === reason && OPINION_BY_SIGNAL[reason] != null).sort((left, right) => Number(evidencePolicy.canSupportWorldConsequence(right.evidence)) - Number(evidencePolicy.canSupportWorldConsequence(left.evidence)))[0]).find(Boolean);
  if (selected) {
    const direction = directionFor(selected, participants);
    const evidence = selected.evidence?.evidenceId ? selected.evidence : context.dialogueEvidence?.[0] || null;
    const opinionChange = {
      ...direction,
      delta: OPINION_BY_SIGNAL[selected.reasonCluster],
      reason: selected.type,
      reasonCluster: selected.reasonCluster,
      confidence: selected.confidence,
      evidenceId: evidence?.evidenceId || null,
      sourceEventId: evidence?.sourceEventId || selected.eventId || base.sourceEventId
    };
    opinionChange.normalizedTopic = evidencePolicy.cooldownTopic({ item: opinionChange, evidence, messageText: context.message?.content });
    base.opinionChanges.push(opinionChange);
    if (Math.abs(OPINION_BY_SIGNAL[selected.reasonCluster]) >= 6) base.riskLevel = "high";
    else if (Math.abs(OPINION_BY_SIGNAL[selected.reasonCluster]) >= 3) base.riskLevel = "medium";
  }

  const relationshipSignal = normalized.find((item) => item.type === "relationship_statement");
  const hostile = hostileRelationship(context, normalized);
  const explicitRelationshipActionId = relationshipFromText(context.message?.content || "", relationshipSignal);
  const actionId = hostile?.actionId || explicitRelationshipActionId;
  if (actionId) {
    const relationshipEvidence = hostile?.major?.evidence || context.dialogueEvidence?.[0] || null;
    base.relationshipTransition = {
      actionId,
      sourceCharacterId: participants.actorId,
      targetCharacterId: participants.targetId,
      confidence: hostile ? calculateHostileRelationshipConfidence(actionId, hostile.major) : Number(relationshipSignal?.confidence || 0),
      reason: hostile ? "confirmed_harm_and_enduring_hostility" : "explicit_relationship_statement",
      reasonCluster: evidencePolicy.canonicalReasonCluster(actionId),
      evidenceId: relationshipEvidence?.evidenceId || null,
      sourceEventId: relationshipEvidence?.sourceEventId || base.sourceEventId
    };
    base.riskLevel = "medium";
  }
  return createConsequence(base);
}

module.exports = { OPINION_BY_SIGNAL, calculateHostileRelationshipConfidence, resolve };
