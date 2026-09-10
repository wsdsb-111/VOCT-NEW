"use strict";

const { parseRelationIntent } = require("./relation-intent-parser");
const { resolveRelationAnchor } = require("./relation-anchor-resolver");
const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");

const MAX_RELATION_CANDIDATES = 50;

function characterName(character = {}, runtimeId = "") {
  return character.fullName || character.shortName || character.firstName || `#${runtimeId}`;
}

function birthOrderValue(character = {}) {
  const totalDays = Number(character.birthDateTotalDays ?? character.birthTotalDays);
  return Number.isFinite(totalDays) ? totalDays : null;
}

function summarize(candidates) {
  return candidates.slice(0, MAX_RELATION_CANDIDATES).map((candidate) => ({ runtimeId: candidate.runtimeId, name: candidate.name }));
}

function resultBase({ responderId, intent, anchor }) {
  return {
    responderRuntimeId: responderId === null || responderId === undefined ? null : String(responderId),
    relationAnchorRuntimeId: anchor?.runtimeId || null,
    targetRuntimeId: null,
    intent: {
      relationTypes: intent.relationTypes || [],
      sexConstraint: intent.sexConstraint || null,
      birthOrder: intent.birthOrder || null,
      recency: intent.recency || null,
      sourcePhrase: intent.sourcePhrase || null
    },
    anchor: { mention: anchor?.mention || null, source: anchor?.source || null, confidence: anchor?.confidence || "NONE" }
  };
}

function resolveAnchoredRelationMention({ query = "", responderId = null, graph = null, recentTargetId = null } = {}) {
  const intent = parseRelationIntent(query);
  if (!intent.detected) return { ...resultBase({ responderId, intent, anchor: null }), status: "NO_RELATION_INTENT", mention: null, candidates: [], candidateTotal: 0 };
  const anchor = resolveRelationAnchor({ query, intent, responderId, graph });
  const base = resultBase({ responderId, intent, anchor });
  if (anchor.status !== "ANCHOR_RESOLVED") return { ...base, status: anchor.status, mention: intent.sourcePhrase, candidates: anchor.candidates || [], candidateTotal: anchor.candidates?.length || 0 };
  const allCandidates = (graph?.relationsTo(anchor.runtimeId) || []).filter((edge) => intent.relationTypes.includes(edge.type)).map((edge) => {
    const target = graph.nodes.get(String(edge.from)) || { id: edge.from };
    const sex = resolveCharacterSexConsensus({ snapshot: target });
    return { runtimeId: String(edge.from), name: characterName(target, edge.from), sex, birthOrder: birthOrderValue(target), relation: graph.relationBetween(edge.from, anchor.runtimeId).relation };
  });
  if (graph?.scopeTruncated) return { ...base, status: "RELATION_SOURCE_INCOMPLETE", mention: intent.sourcePhrase, candidates: summarize(allCandidates), candidateTotal: allCandidates.length, truncated: true };
  if (allCandidates.some((candidate) => candidate.sex.conflict)) return { ...base, status: "RELATION_GENDER_CONFLICT", mention: intent.sourcePhrase, candidates: summarize(allCandidates), candidateTotal: allCandidates.length };
  let candidates = allCandidates.filter((candidate) => !intent.sexConstraint || candidate.sex.sex === intent.sexConstraint);
  if (!candidates.length) return { ...base, status: "RELATION_UNKNOWN", mention: intent.sourcePhrase, candidates: [], candidateTotal: 0 };
  if (intent.recency || intent.birthOrder) {
    if (candidates.some((candidate) => candidate.birthOrder === null)) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(candidates), candidateTotal: candidates.length, reason: "BIRTH_ORDER_UNAVAILABLE" };
    candidates = [...candidates].sort((left, right) => left.birthOrder - right.birthOrder || left.runtimeId.localeCompare(right.runtimeId));
    const position = intent.recency === "latest" || intent.birthOrder === "last" ? candidates.length - 1 : intent.birthOrder === "second" ? 1 : intent.birthOrder === "third" ? 2 : 0;
    if (!candidates[position]) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(candidates), candidateTotal: candidates.length, reason: "BIRTH_ORDER_UNAVAILABLE" };
    candidates = [candidates[position]];
  }
  if (candidates.length > 1) {
    const recent = candidates.find((candidate) => String(candidate.runtimeId) === String(recentTargetId));
    if (recent) candidates = [recent];
  }
  if (candidates.length !== 1) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(candidates), candidateTotal: candidates.length };
  const target = candidates[0];
  return {
    ...base,
    status: "RELATION_RESOLVED",
    mention: intent.sourcePhrase,
    targetRuntimeId: target.runtimeId,
    target: { runtimeId: target.runtimeId, name: target.name, sex: target.sex.sex, sexSource: target.sex.source, sexConflict: target.sex.conflict },
    relation: target.relation,
    candidates: summarize(candidates),
    candidateTotal: 1,
    resolution: { status: "RELATION_RESOLVED", source: anchor.source, candidateTotal: allCandidates.length }
  };
}

module.exports = { resolveAnchoredRelationMention };
