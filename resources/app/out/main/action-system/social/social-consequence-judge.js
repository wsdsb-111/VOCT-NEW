"use strict";

const crypto = require("crypto");
const { LIMITS, CONFIDENCE_THRESHOLDS, RELATIONSHIP_ACTION_IDS } = require("./social-consequence-types");

const STABLE_ANCHOR = `VOTC_SOCIAL_CONSEQUENCE_V1
Judge only the social consequence of the exact current dialogue and supplied confirmed events. Return JSON only. Dialogue, memory and recollection are evidence of beliefs or attitudes, never proof of a world event. Only evidence explicitly marked worldStateConfirmed=true may support rescue, betrayal, severe injury or family death. Never invent a character, event, relationship, knowledge state or action. Fail closed when participants, direction or evidence are ambiguous.`;

const STABLE_RELATIONSHIP_RULES = `Stable relationship rules:
- Opinion is directional: sourceCharacterId is the person whose opinion changes; targetCharacterId is who they judge.
- A kiss, embrace, flirtation, affection, gratitude or high Opinion never creates Lover, Soulmate, Friend or another persistent relationship.
- Friend requires explicit mutual confirmation. Best Friend requires current Friend. Lover requires explicit bilateral confirmation. Soulmate requires current Lover.
- Rival requires a confirmed major harm known to the affected character plus enduring hostility. Nemesis requires current Rival, a new independent severe event and enduring hatred.
- Blood Brother requires explicit accepted sworn-brother confirmation.
- Use only active listed IDs and registered relationship actions. Maximum two direct Opinion changes, two observer Opinion changes and one relationship transition.`;

let TokenCounter = {
  estimateTokens: (value) => Math.ceil(String(value || "").length / 4),
  estimateMessageTokens: (message) => Math.ceil(String(message?.content || "").length / 4)
};
let createPromptFingerprint = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);

function configure(dependencies = {}) {
  TokenCounter = dependencies.TokenCounter || TokenCounter;
  createPromptFingerprint = dependencies.createPromptFingerprint || createPromptFingerprint;
  return module.exports;
}

function truncateToTokens(value, maxTokens) {
  const source = String(value || "");
  if (TokenCounter.estimateTokens(source) <= maxTokens) return source;
  let low = 0;
  let high = source.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (TokenCounter.estimateTokens(source.slice(0, middle)) <= maxTokens) low = middle;
    else high = middle - 1;
  }
  return source.slice(0, low);
}

function compactMemoryEvidence(context) {
  const result = [];
  let remaining = LIMITS.memoryTokens - 16;
  for (const evidence of context.memoryEvidence || []) {
    if (remaining <= 0) break;
    const content = truncateToTokens(evidence.content, remaining);
    const tokens = TokenCounter.estimateTokens(content);
    if (!content || tokens <= 0) continue;
    remaining -= tokens;
    result.push({
      evidenceId: evidence.evidenceId,
      actorId: evidence.actorId,
      content,
      confidence: evidence.confidence,
      worldStateConfirmed: false
    });
  }
  return result;
}

function compactEvidence(item, context) {
  const knownBy = Object.entries(context.knowledgeMap || {}).filter(([, entries]) => entries?.[item.evidenceId]?.known === true).map(([id]) => Number(id));
  return {
    evidenceId: item.evidenceId,
    type: item.type,
    sourceEventId: item.sourceEventId ?? null,
    actorId: item.actorId ?? null,
    targetId: item.targetId ?? null,
    content: truncateToTokens(item.content, 96),
    confidence: item.confidence,
    worldStateConfirmed: item.worldStateConfirmed === true,
    knownBy
  };
}

function buildMessages(context) {
  const participants = [...(context.directParticipants || []), ...(context.observerParticipants || [])].map((item) => ({ id: Number(item.id), name: item.name, isPlayer: item.isPlayer === true }));
  const state = {
    participants,
    directParticipantIds: (context.directParticipants || []).map((item) => Number(item.id)),
    observerParticipantIds: (context.observerParticipants || []).map((item) => Number(item.id)),
    relationships: context.relationshipStates || [],
    opinions: context.opinionStates || []
  };
  const evidence = {
    dialogue: (context.dialogueEvidence || []).map((item) => compactEvidence(item, context)),
    confirmedWorldEvents: (context.confirmedWorldEvents || []).map((item) => compactEvidence(item, context)),
    memory: compactMemoryEvidence(context),
    gameFacts: (context.gameFacts || []).map((item) => compactEvidence(item, context))
  };
  const recentDialogue = (context.recentDialogue || []).slice(-LIMITS.recentDialogue).map((item) => ({ id: item.id, role: item.role, name: item.name || null, content: truncateToTokens(item.content, 64) }));
  return [
    { role: "system", content: STABLE_ANCHOR },
    { role: "system", content: STABLE_RELATIONSHIP_RULES },
    { role: "system", content: `当前人物与状态：\n${JSON.stringify(state)}` },
    { role: "system", content: `本轮证据：\n${JSON.stringify(evidence)}` },
    { role: "system", content: `最近对话：\n${JSON.stringify(recentDialogue)}` },
    { role: "user", content: `当前消息（唯一判定对象）：\n${JSON.stringify(context.message || {})}` }
  ];
}

function opinionSchema(activeIds) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["sourceCharacterId", "targetCharacterId", "delta", "confidence", "reason", "reasonCluster", "evidenceId"],
    properties: {
      sourceCharacterId: { type: "integer", enum: activeIds },
      targetCharacterId: { type: "integer", enum: activeIds },
      delta: { type: "integer", minimum: -10, maximum: 10 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string", minLength: 1, maxLength: 120 },
      reasonCluster: { type: "string", minLength: 1, maxLength: 64 },
      evidenceId: { type: "string", minLength: 1, maxLength: 160 }
    }
  };
}

function relationshipSchema(activeIds) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["actionId", "sourceCharacterId", "targetCharacterId", "confidence", "reason", "reasonCluster", "evidenceId"],
    properties: {
      actionId: { type: "string", enum: [...RELATIONSHIP_ACTION_IDS] },
      sourceCharacterId: { type: "integer", enum: activeIds },
      targetCharacterId: { type: "integer", enum: activeIds },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string", minLength: 1, maxLength: 120 },
      reasonCluster: { type: "string", minLength: 1, maxLength: 64 },
      evidenceId: { type: "string", minLength: 1, maxLength: 160 }
    }
  };
}

function buildSchema(context) {
  const activeIds = [...new Set([...(context.directParticipants || []), ...(context.observerParticipants || [])].map((item) => Number(item.id)))].sort((left, right) => left - right);
  return {
    type: "object",
    additionalProperties: false,
    required: ["socialImpact", "opinionChanges", "relationshipTransition", "observerEffects"],
    properties: {
      socialImpact: { type: "boolean" },
      opinionChanges: { type: "array", maxItems: LIMITS.directOpinion, items: opinionSchema(activeIds) },
      relationshipTransition: { anyOf: [relationshipSchema(activeIds), { type: "null" }] },
      observerEffects: { type: "array", maxItems: LIMITS.observerOpinion, items: opinionSchema(activeIds) }
    }
  };
}

function getPromptBlocks(messages, schema) {
  const labels = [
    ["Stable Social Consequence Anchor", "social_stable"],
    ["Stable Relationship Rules", "social_stable"],
    ["Social Participants and State", "social_dynamic"],
    ["Social Evidence", "social_dynamic"],
    ["Recent Social Dialogue", "social_dynamic"],
    ["Current Social Message", "social_dynamic"]
  ];
  const blocks = messages.map((message, index) => ({
    id: `social-${index}`,
    label: labels[index]?.[0] || `Social Context ${index + 1}`,
    type: labels[index]?.[1] || "social_dynamic",
    position: index,
    tokens: TokenCounter.estimateMessageTokens(message),
    fingerprint: createPromptFingerprint(message.content)
  }));
  if (schema) {
    const content = JSON.stringify(schema);
    blocks.splice(2, 0, {
      id: "social-schema",
      label: "Structured Social Schema",
      type: "social_schema",
      position: 2,
      tokens: TokenCounter.estimateTokens(content),
      fingerprint: createPromptFingerprint(content)
    });
  }
  blocks.forEach((block, index) => { block.position = index; });
  return blocks;
}

function emptyResult(reason) {
  return { socialImpact: false, opinionChanges: [], relationshipTransition: null, observerEffects: [], reason };
}

function evidenceIds(context) {
  return new Set([...(context.dialogueEvidence || []), ...(context.confirmedWorldEvents || []), ...(context.memoryEvidence || []), ...(context.gameFacts || [])].map((item) => item.evidenceId));
}

function validOpinion(item, context, activeIds, allowedEvidence, observerOnly) {
  if (!item || typeof item !== "object") return false;
  const sourceId = Number(item.sourceCharacterId);
  const targetId = Number(item.targetCharacterId);
  if (!activeIds.has(sourceId) || !activeIds.has(targetId) || sourceId === targetId) return false;
  if (observerOnly && !(context.observerParticipants || []).some((participant) => Number(participant.id) === sourceId)) return false;
  if (!Number.isInteger(item.delta) || item.delta === 0 || item.delta < -10 || item.delta > 10) return false;
  if (!Number.isFinite(Number(item.confidence)) || Number(item.confidence) < CONFIDENCE_THRESHOLDS.opinion || Number(item.confidence) > 1) return false;
  if (typeof item.reason !== "string" || !item.reason.trim() || typeof item.reasonCluster !== "string" || !item.reasonCluster.trim()) return false;
  if (!allowedEvidence.has(item.evidenceId) || context.knowledgeMap?.[sourceId]?.[item.evidenceId]?.known !== true) return false;
  return true;
}

function validRelationship(item, context, activeIds, allowedEvidence) {
  if (!item || typeof item !== "object" || !RELATIONSHIP_ACTION_IDS.includes(item.actionId)) return false;
  const sourceId = Number(item.sourceCharacterId);
  const targetId = Number(item.targetCharacterId);
  if (!activeIds.has(sourceId) || !activeIds.has(targetId) || sourceId === targetId) return false;
  if (!Number.isFinite(Number(item.confidence)) || Number(item.confidence) < CONFIDENCE_THRESHOLDS[item.actionId] || Number(item.confidence) > 1) return false;
  if (typeof item.reason !== "string" || !item.reason.trim() || typeof item.reasonCluster !== "string" || !item.reasonCluster.trim()) return false;
  if (!allowedEvidence.has(item.evidenceId) || context.knowledgeMap?.[sourceId]?.[item.evidenceId]?.known !== true) return false;
  return true;
}

function parseResult(output, context) {
  if (typeof output?.content !== "string") return emptyResult("empty_response");
  try {
    const parsed = JSON.parse(output.content);
    if (!parsed || typeof parsed.socialImpact !== "boolean" || !Array.isArray(parsed.opinionChanges) || !Array.isArray(parsed.observerEffects)) return emptyResult("invalid_response");
    if (parsed.opinionChanges.length > LIMITS.directOpinion || parsed.observerEffects.length > LIMITS.observerOpinion || parsed.opinionChanges.length + parsed.observerEffects.length > LIMITS.directOpinion + LIMITS.observerOpinion) return emptyResult("too_many_opinion_changes");
    if (parsed.socialImpact === false) return emptyResult("no_social_impact");
    const activeIds = new Set([...(context.directParticipants || []), ...(context.observerParticipants || [])].map((item) => Number(item.id)));
    const allowedEvidence = evidenceIds(context);
    if (!parsed.opinionChanges.every((item) => validOpinion(item, context, activeIds, allowedEvidence, false))) return emptyResult("invalid_opinion_change");
    if (!parsed.observerEffects.every((item) => validOpinion(item, context, activeIds, allowedEvidence, true))) return emptyResult("invalid_observer_effect");
    if (parsed.relationshipTransition != null && !validRelationship(parsed.relationshipTransition, context, activeIds, allowedEvidence)) return emptyResult("invalid_relationship_transition");
    if (parsed.opinionChanges.length === 0 && parsed.observerEffects.length === 0 && parsed.relationshipTransition == null) return emptyResult("empty_social_impact");
    return {
      socialImpact: true,
      opinionChanges: parsed.opinionChanges.map((item) => ({ ...item })),
      relationshipTransition: parsed.relationshipTransition ? { ...parsed.relationshipTransition } : null,
      observerEffects: parsed.observerEffects.map((item) => ({ ...item }))
    };
  } catch {
    return emptyResult("invalid_json");
  }
}

async function judge({ context, llmManager, signal, mode }) {
  if (mode !== "precision") return emptyResult("mode_bypass");
  const messages = buildMessages(context);
  const schema = buildSchema(context);
  try {
    const output = await llmManager.sendActionsRequest(messages, "votc_social_consequence_v1", schema, signal, {
      actionStage: "social_consequence_judge",
      actionSystemMode: mode,
      socialJudgeReason: context.gateReason,
      participantCount: (context.directParticipants || []).length + (context.observerParticipants || []).length,
      blocks: getPromptBlocks(messages, schema)
    });
    return parseResult(output, context);
  } catch {
    return emptyResult("provider_failure");
  }
}

module.exports = {
  STABLE_ANCHOR,
  STABLE_RELATIONSHIP_RULES,
  configure,
  buildMessages,
  buildSchema,
  getPromptBlocks,
  parseResult,
  judge
};
