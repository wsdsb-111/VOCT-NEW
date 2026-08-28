"use strict";

const { createConsequence } = require("./social-consequence-types");

const OPINION_BY_SIGNAL = Object.freeze({
  polite_positive: 1,
  praise: 2,
  gratitude: 2,
  comfort: 2,
  help: 3,
  rescue: 5,
  affection_accepted: 2,
  affection_rejected: -2,
  insult: -2,
  humiliation: -4,
  threat: -3,
  betrayal: -6,
  severe_injury: -7,
  family_death: -9
});

const SIGNAL_PRIORITY = Object.freeze([
  "family_death",
  "severe_injury",
  "betrayal",
  "rescue",
  "humiliation",
  "threat",
  "help",
  "praise",
  "gratitude",
  "comfort",
  "affection_rejected",
  "affection_accepted",
  "insult",
  "polite_positive"
]);

function normalizeSignal(signal) {
  if (signal.type === "affection_rejection") return { ...signal, reasonCluster: "affection_rejected" };
  if (["romantic_affection", "physical_affection", "intimate_contact"].includes(signal.type) && signal.reaction === "accepted") return { ...signal, reasonCluster: "affection_accepted" };
  if (signal.type === "betrayal_signal") return { ...signal, reasonCluster: "betrayal_claim" };
  if (signal.type === "hate" || signal.type === "revenge") return { ...signal, reasonCluster: "insult" };
  return { ...signal, reasonCluster: signal.type };
}

function directionFor(signal, participants) {
  const actorId = participants.actorId;
  const targetId = participants.targetId;
  if (["praise", "insult", "humiliation", "threat", "affection_rejected"].includes(signal.reasonCluster)) {
    return { sourceCharacterId: targetId, targetCharacterId: actorId };
  }
  if (signal.reasonCluster === "severe_injury") {
    return { sourceCharacterId: signal.targetId ?? targetId, targetCharacterId: signal.actorId ?? actorId };
  }
  if (signal.reasonCluster === "family_death") {
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
    ["becomeRivalsWith", /(?:仇敌)/],
    ["becomeBloodBrothersWith", /(?:结拜|义结金兰|义结兄弟|结义兄弟)/],
    ["becomeFriendsWith", /(?:朋友|好友)/]
  ];
  const match = rules.find(([, pattern]) => pattern.test(text));
  return match ? match[0] : null;
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
  const selected = SIGNAL_PRIORITY.map((reason) => normalized.find((item) => item.reasonCluster === reason && OPINION_BY_SIGNAL[reason] != null)).find(Boolean);
  if (selected) {
    const direction = directionFor(selected, participants);
    base.opinionChanges.push({
      ...direction,
      delta: OPINION_BY_SIGNAL[selected.reasonCluster],
      reason: selected.type,
      reasonCluster: selected.reasonCluster,
      confidence: selected.confidence,
      evidenceId: selected.evidence?.evidenceId || context.dialogueEvidence?.[0]?.evidenceId || null,
      sourceEventId: selected.evidence?.sourceEventId || selected.eventId || base.sourceEventId
    });
    if (Math.abs(OPINION_BY_SIGNAL[selected.reasonCluster]) >= 6) base.riskLevel = "high";
    else if (Math.abs(OPINION_BY_SIGNAL[selected.reasonCluster]) >= 3) base.riskLevel = "medium";
  }

  const relationshipSignal = normalized.find((item) => item.type === "relationship_statement");
  const actionId = relationshipFromText(context.message?.content || "", relationshipSignal);
  if (actionId) {
    base.relationshipTransition = {
      actionId,
      sourceCharacterId: participants.actorId,
      targetCharacterId: participants.targetId,
      confidence: relationshipSignal.confidence,
      reason: "explicit_relationship_statement",
      reasonCluster: actionId,
      evidenceId: context.dialogueEvidence?.[0]?.evidenceId || null,
      sourceEventId: base.sourceEventId
    };
    base.riskLevel = "medium";
  }
  return createConsequence(base);
}

module.exports = { OPINION_BY_SIGNAL, resolve };
