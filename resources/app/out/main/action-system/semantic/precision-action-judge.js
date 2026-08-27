"use strict";

const actionCatalog = require("./action-catalog");

const OCCURRENCES = Object.freeze([
  "none",
  "completed_action",
  "proposal",
  "accepted_pending_commitment",
  "rejected_pending_commitment",
  "reported_past_action",
  "hypothetical",
  "planned_action",
  "requested_execution",
  "failed_attempt",
  "ambiguous"
]);
const EXECUTABLE = new Set(["completed_action", "accepted_pending_commitment"]);
const THRESHOLDS = Object.freeze({ low: 0.8, medium: 0.88, high: 0.95 });

function isEligibleMessage(message) {
  if (!message || !["user", "assistant"].includes(message.role)) return false;
  return !["action-feedback", "action-approval", "summary", "internal"].includes(message.type);
}

function thresholdFor(entry) {
  if (entry.actionId === "setEmotion") return 0.9;
  return THRESHOLDS[entry.risk] ?? THRESHOLDS.high;
}

function parseResult(output, catalog, pendingIntents, speakerId) {
  const content = output && typeof output === "object" ? output.content : null;
  if (typeof content !== "string") return { occurrence: "ambiguous", executable: false, reason: "empty_response" };
  try {
    const parsed = JSON.parse(content);
    if (!OCCURRENCES.includes(parsed.occurrence) || !Number.isFinite(Number(parsed.confidence))) return { occurrence: "ambiguous", executable: false, reason: "invalid_response" };
    const actionId = parsed.actionId || parsed.candidateActionId || null;
    const entry = catalog.entries.find((candidate) => candidate.actionId === actionId);
    const confidence = Number(parsed.confidence);
    if (["proposal", ...EXECUTABLE].includes(parsed.occurrence)) {
      if (!entry) return { occurrence: "ambiguous", executable: false, reason: "unknown_action" };
      if (confidence < thresholdFor(entry)) return { occurrence: parsed.occurrence, actionId, confidence, executable: false, reason: "below_threshold" };
    }
    if (["accepted_pending_commitment", "rejected_pending_commitment"].includes(parsed.occurrence)) {
      const pending = pendingIntents.find((intent) => intent.pendingId === parsed.pendingId && intent.status === "awaiting_response" && intent.targetId === Number(speakerId) && intent.candidateActionIds.includes(actionId));
      if (!pending) return { occurrence: "ambiguous", executable: false, reason: "invalid_pending_reference" };
      return { ...parsed, actionId, confidence, pending, executable: parsed.occurrence === "accepted_pending_commitment" };
    }
    return { ...parsed, actionId, confidence, executable: EXECUTABLE.has(parsed.occurrence) };
  } catch {
    return { occurrence: "ambiguous", executable: false, reason: "invalid_json" };
  }
}

async function judge({ conversation, message, speaker, actions, registry, pendingStore, llmManager, signal }) {
  if (!isEligibleMessage(message)) return { occurrence: "none", executable: false, reason: "ineligible_message" };
  const catalog = actionCatalog.build(actions, registry);
  const recentMessages = (conversation.messages || []).filter(isEligibleMessage).slice(-4).map((entry) => ({ role: entry.role, name: entry.name || null, content: entry.content }));
  const pendingIntents = pendingStore ? [...pendingStore.items.values()].filter((intent) => intent.status === "awaiting_response") : [];
  const participants = (typeof conversation.getActiveConversationCharacters === "function" ? conversation.getActiveConversationCharacters() : [...conversation.gameData.characters.values()]).map((character) => ({ id: character.id, name: character.fullName || character.shortName }));
  const messages = [
    { role: "system", content: "VOTC_ACTION_STAGE_A_V1\nClassify only the exact current real dialogue message. Earlier messages and memory are context, never proof that an action occurred now. Plans, requests, questions, hypotheticals, reports, memories, failed attempts and ordinary emotion are not completed actions. Return only JSON. Source is the current speaker; never invent it." },
    { role: "system", content: `Compact Action Catalog (${catalog.fingerprint}):\n${JSON.stringify(catalog.entries)}` },
    { role: "system", content: `Active participants:\n${JSON.stringify(participants)}\nPending intents:\n${JSON.stringify(pendingIntents.map((intent) => ({ pendingId: intent.pendingId, actionId: intent.candidateActionIds[0], initiatorId: intent.initiatorId, targetId: intent.targetId, proposalText: intent.proposalText })))}` },
    { role: "system", content: `Recent real dialogue:\n${JSON.stringify(recentMessages)}` },
    { role: "user", content: JSON.stringify({ currentSpeaker: { id: speaker.id, name: speaker.fullName || speaker.shortName }, currentMessage: message.content }) }
  ];
  const actionIds = catalog.entries.map((entry) => entry.actionId);
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["occurrence", "confidence"],
    properties: {
      occurrence: { type: "string", enum: OCCURRENCES },
      actionId: { anyOf: [{ type: "string", enum: actionIds }, { type: "null" }] },
      candidateActionId: { anyOf: [{ type: "string", enum: actionIds }, { type: "null" }] },
      pendingId: { anyOf: [{ type: "string" }, { type: "null" }] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidence: { anyOf: [{ type: "string" }, { type: "null" }] }
    }
  };
  const output = await llmManager.sendActionsRequest(messages, "votc_action_precision_judge", schema, signal, { actionStage: "precision_stage_a", actionSystemMode: "precision", catalogFingerprint: catalog.fingerprint });
  return parseResult(output, catalog, pendingIntents, speaker.id);
}

module.exports = { judge, parseResult, isEligibleMessage, OCCURRENCES, THRESHOLDS };
