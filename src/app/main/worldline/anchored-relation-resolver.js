"use strict";

const { parseRelationIntent } = require("./relation-intent-parser");
const { resolveRelationAnchor } = require("./relation-anchor-resolver");
const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");
const { nonnegativeNumber } = require("./character-age-service");

const MAX_RELATION_CANDIDATES = 50;

function characterName(character = {}, runtimeId = "") {
  return character.fullName || character.shortName || character.firstName || character.name || `#${runtimeId}`;
}

function birthOrderValue(character = {}) {
  return nonnegativeNumber(character.birthDateTotalDays ?? character.birthTotalDays);
}

function resolveAnchorBirthDay(graph, anchorRuntimeId) {
  const anchor = graph?.nodes?.get(String(anchorRuntimeId));
  return birthOrderValue(anchor);
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
      anchorRelationTypes: intent.anchorRelationTypes || [],
      spouseStatus: intent.spouseStatus || null,
      sexConstraint: intent.sexConstraint || null,
      anchorSexConstraint: intent.anchorSexConstraint || null,
      label: intent.label || null,
      birthOrder: intent.birthOrder || null,
      recency: intent.recency || null,
      sourcePhrase: intent.sourcePhrase || null
    },
    anchor: { mention: anchor?.mention || null, source: anchor?.source || null, confidence: anchor?.confidence || "NONE" }
  };
}

function relationBetween(graph, from, to, relationTypes) {
  return typeof graph?.relationBetweenOfTypes === "function"
    ? graph.relationBetweenOfTypes(from, to, relationTypes)
    : graph?.relationBetween?.(from, to) || { relation: null, diagnostic: null };
}

function resolveBetrothalChildPath({ query, responderId, graph, intent, recentTargetId }) {
  const initial = resultBase({ responderId, intent, anchor: null });
  const relationTypes = intent.anchorRelationTypes || ["CHILD_OF"];
  let childCandidates = [];
  if (intent.anchorMode === "RESPONDER_CHILD") {
    if (responderId === null || responderId === undefined) return { ...initial, status: "ANCHOR_UNKNOWN", mention: intent.sourcePhrase, candidates: [], candidateTotal: 0 };
    const candidateIds = [...new Set((graph?.relationsTo(String(responderId)) || []).filter(edge => relationTypes.includes(edge.type)).map(edge => String(edge.from)))];
    childCandidates = candidateIds.map(runtimeId => {
      const node = graph.nodes.get(runtimeId) || { id: runtimeId };
      const result = relationBetween(graph, runtimeId, responderId, relationTypes);
      return { runtimeId, node, sex: resolveCharacterSexConsensus({ snapshot: node }), relationResult: result };
    });
  } else {
    const explicitAnchor = resolveRelationAnchor({ query, intent: { ...intent, anchorMode: "EXPLICIT" }, responderId, graph });
    if (explicitAnchor.status !== "ANCHOR_RESOLVED") {
      return { ...initial, status: explicitAnchor.status, mention: intent.sourcePhrase, candidates: explicitAnchor.candidates || [], candidateTotal: explicitAnchor.candidates?.length || 0 };
    }
    const node = graph.nodes.get(String(explicitAnchor.runtimeId)) || { id: explicitAnchor.runtimeId };
    const result = relationBetween(graph, explicitAnchor.runtimeId, responderId, relationTypes);
    childCandidates = [{ runtimeId: String(explicitAnchor.runtimeId), node, sex: resolveCharacterSexConsensus({ snapshot: node }), relationResult: result }];
  }
  if (graph?.scopeTruncated) return { ...initial, status: "RELATION_SOURCE_INCOMPLETE", mention: intent.sourcePhrase, candidates: summarize(childCandidates.map(item => ({ runtimeId: item.runtimeId, name: characterName(item.node, item.runtimeId) }))), candidateTotal: childCandidates.length, truncated: true };
  if (childCandidates.some(candidate => candidate.relationResult?.diagnostic)) {
    return { ...initial, status: "RELATION_CONFLICT_TYPE", mention: intent.sourcePhrase, candidates: summarize(childCandidates.map(item => ({ runtimeId: item.runtimeId, name: characterName(item.node, item.runtimeId) }))), candidateTotal: childCandidates.length };
  }
  childCandidates = childCandidates.filter(candidate => candidate.relationResult?.relation);
  if (intent.anchorSexConstraint && childCandidates.some(candidate => candidate.sex.conflict)) {
    return { ...initial, status: "RELATION_GENDER_CONFLICT", mention: intent.sourcePhrase, candidates: summarize(childCandidates.map(item => ({ runtimeId: item.runtimeId, name: characterName(item.node, item.runtimeId) }))), candidateTotal: childCandidates.length };
  }
  if (intent.anchorSexConstraint && childCandidates.some(candidate => candidate.sex.sex !== intent.anchorSexConstraint && !candidate.sex.conflict && candidate.sex.sex !== "male" && candidate.sex.sex !== "female")) {
    return { ...initial, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(childCandidates.map(item => ({ runtimeId: item.runtimeId, name: characterName(item.node, item.runtimeId) }))), candidateTotal: childCandidates.length, reason: "CHILD_GENDER_UNAVAILABLE" };
  }
  childCandidates = childCandidates.filter(candidate => !intent.anchorSexConstraint || candidate.sex.sex === intent.anchorSexConstraint);
  if (!childCandidates.length) return { ...initial, status: "RELATION_UNKNOWN", mention: intent.sourcePhrase, candidates: [], candidateTotal: 0 };
  if (childCandidates.length !== 1) return { ...initial, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(childCandidates.map(item => ({ runtimeId: item.runtimeId, name: characterName(item.node, item.runtimeId) }))), candidateTotal: childCandidates.length, reason: "MULTIPLE_CHILD_CANDIDATES" };

  const child = childCandidates[0];
  const anchor = { status: "ANCHOR_RESOLVED", mention: characterName(child.node, child.runtimeId), runtimeId: child.runtimeId, source: intent.anchorMode === "RESPONDER_CHILD" ? "RESPONDER_CHILD_RELATION" : "EXPLICIT_CHILD_NAME", confidence: "HIGH" };
  const base = resultBase({ responderId, intent, anchor });
  const candidateIds = [...new Set((graph?.relationsTo(child.runtimeId) || []).filter(edge => edge.type === "BETROTHED_TO").map(edge => String(edge.from)))];
  const allCandidates = candidateIds.map(runtimeId => {
    const target = graph.nodes.get(runtimeId) || { id: runtimeId };
    const result = relationBetween(graph, runtimeId, child.runtimeId, ["BETROTHED_TO"]);
    const sex = result.relation?.sexConflict
      ? { sex: "unknown", source: "CONFLICT", conflict: true, status: "RELATION_GENDER_CONFLICT" }
      : resolveCharacterSexConsensus({ snapshot: target, relation: result.relation?.sex ? { gender: result.relation.sex } : null });
    const sourceOwnerIds = (result.relation?.betrothalSources || []).filter(item => item.sourceRelation === "kids.betrothed").map(item => String(item.sourceOwnerId));
    return { runtimeId, name: characterName(target, runtimeId), sex, relation: result.relation, relationDiagnostic: result.diagnostic,
      sourceOwnerIds };
  }).filter(candidate => candidate.sourceOwnerIds.includes(String(responderId)));
  if (allCandidates.some(candidate => candidate.relationDiagnostic || !candidate.relation)) {
    return { ...base, status: "RELATION_CONFLICT_EVIDENCE", mention: intent.sourcePhrase, candidates: summarize(allCandidates), candidateTotal: allCandidates.length };
  }
  if (intent.sexConstraint && allCandidates.some(candidate => candidate.sex.conflict)) {
    return { ...base, status: "RELATION_GENDER_CONFLICT", mention: intent.sourcePhrase, candidates: summarize(allCandidates), candidateTotal: allCandidates.length };
  }
  let candidates = allCandidates;
  if (intent.sexConstraint && candidates.some(candidate => candidate.sex.sex !== intent.sexConstraint && candidate.sex.sex !== "male" && candidate.sex.sex !== "female")) {
    return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(candidates), candidateTotal: candidates.length, reason: "BETROTHED_GENDER_UNAVAILABLE" };
  }
  candidates = candidates.filter(candidate => !intent.sexConstraint || candidate.sex.sex === intent.sexConstraint);
  if (!candidates.length) return { ...base, status: "RELATION_UNKNOWN", mention: intent.sourcePhrase, candidates: [], candidateTotal: 0 };
  if (candidates.length > 1) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(candidates), candidateTotal: candidates.length, reason: "MULTIPLE_BETROTHED_CANDIDATES" };
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

function resolveAnchoredRelationMention({ query = "", responderId = null, graph = null, recentTargetId = null } = {}) {
  const intent = parseRelationIntent(query);
  if (!intent.detected) return { ...resultBase({ responderId, intent, anchor: null }), status: "NO_RELATION_INTENT", mention: null, candidates: [], candidateTotal: 0 };
  if (intent.relationTypes.includes("BETROTHED_TO") && ["RESPONDER_CHILD", "EXPLICIT_CHILD"].includes(intent.anchorMode)) {
    return resolveBetrothalChildPath({ query, responderId, graph, intent, recentTargetId });
  }
  const anchor = resolveRelationAnchor({ query, intent, responderId, graph });
  const base = resultBase({ responderId, intent, anchor });
  if (anchor.status !== "ANCHOR_RESOLVED") return { ...base, status: anchor.status, mention: intent.sourcePhrase, candidates: anchor.candidates || [], candidateTotal: anchor.candidates?.length || 0 };
  const candidateEdges = (graph?.relationsTo(anchor.runtimeId) || []).filter((edge) => intent.relationTypes.includes(edge.type)
    && (!intent.relationTypes.includes("BETROTHED_TO") || (edge.betrothalSources || []).some(source => String(source.sourceOwnerId) === String(responderId))));
  const candidateIds = [...new Set(candidateEdges.map((edge) => String(edge.from)))];
  const allCandidates = candidateIds.map((runtimeId) => {
    const target = graph.nodes.get(runtimeId) || { id: runtimeId };
    const sex = resolveCharacterSexConsensus({ snapshot: target });
    const relationResult = typeof graph.relationBetweenOfTypes === "function"
      ? graph.relationBetweenOfTypes(runtimeId, anchor.runtimeId, intent.relationTypes)
      : graph.relationBetween(runtimeId, anchor.runtimeId);
    return { runtimeId, name: characterName(target, runtimeId), sex, birthOrder: birthOrderValue(target), relation: relationResult.relation, relationDiagnostic: relationResult.diagnostic };
  });
  if (graph?.scopeTruncated) return { ...base, status: "RELATION_SOURCE_INCOMPLETE", mention: intent.sourcePhrase, candidates: summarize(allCandidates), candidateTotal: allCandidates.length, truncated: true };
  if (allCandidates.some((candidate) => candidate.relationDiagnostic || !candidate.relation)) return { ...base, status: "RELATION_CONFLICT_TYPE", mention: intent.sourcePhrase, candidates: summarize(allCandidates), candidateTotal: allCandidates.length };
  if (intent.sexConstraint && allCandidates.some((candidate) => candidate.sex.conflict)) return { ...base, status: "RELATION_GENDER_CONFLICT", mention: intent.sourcePhrase, candidates: summarize(allCandidates), candidateTotal: allCandidates.length };
  if (intent.sexConstraint && allCandidates.some(candidate => !["male", "female"].includes(candidate.sex.sex))) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(allCandidates), candidateTotal: allCandidates.length, reason: "RELATION_GENDER_UNAVAILABLE" };
  let candidates = allCandidates.filter((candidate) => !intent.sexConstraint || candidate.sex.sex === intent.sexConstraint);
  if (intent.branches) {
    if (candidates.some(candidate => !candidate.relation?.branch)) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(candidates), candidateTotal: candidates.length, reason: "KINSHIP_BRANCH_UNAVAILABLE" };
    candidates = candidates.filter(candidate => intent.branches.includes(candidate.relation.branch));
  }
  if (!candidates.length) return { ...base, status: "RELATION_UNKNOWN", mention: intent.sourcePhrase, candidates: [], candidateTotal: 0 };
  if (intent.branches && (intent.birthOrder === "older" || intent.birthOrder === "younger")) {
    if (candidates.some(candidate => candidate.relation.seniority === null)) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(candidates), candidateTotal: candidates.length, reason: "BIRTH_ORDER_UNAVAILABLE" };
    candidates = candidates.filter(candidate => intent.birthOrder === "older" ? candidate.relation.seniority > 0 : candidate.relation.seniority < 0);
    if (!candidates.length) return { ...base, status: "RELATION_UNKNOWN", mention: intent.sourcePhrase, candidates: [], candidateTotal: 0 };
  } else if (intent.birthOrder === "older" || intent.birthOrder === "younger") {
    const anchorBirth = resolveAnchorBirthDay(graph, anchor.runtimeId);
    if (anchorBirth === null) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(candidates), candidateTotal: candidates.length, reason: "ANCHOR_BIRTH_ORDER_UNAVAILABLE" };
    if (candidates.some((candidate) => candidate.birthOrder === null)) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(candidates), candidateTotal: candidates.length, reason: "CANDIDATE_BIRTH_ORDER_UNAVAILABLE" };
    candidates = candidates.filter((candidate) => intent.birthOrder === "older" ? candidate.birthOrder < anchorBirth : candidate.birthOrder > anchorBirth);
    if (!candidates.length) return { ...base, status: "RELATION_UNKNOWN", mention: intent.sourcePhrase, candidates: [], candidateTotal: 0 };
    if (candidates.length > 1) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(candidates), candidateTotal: candidates.length, reason: "MULTIPLE_RELATION_CANDIDATES" };
  } else if (intent.recency || intent.birthOrder) {
    if (candidates.some((candidate) => candidate.birthOrder === null)) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(candidates), candidateTotal: candidates.length, reason: "BIRTH_ORDER_UNAVAILABLE" };
    candidates = [...candidates].sort((left, right) => left.birthOrder - right.birthOrder);
    const position = intent.recency === "latest" || intent.birthOrder === "last" ? candidates.length - 1 : intent.birthOrder === "second" ? 1 : intent.birthOrder === "third" ? 2 : 0;
    if (!candidates[position]) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(candidates), candidateTotal: candidates.length, reason: "BIRTH_ORDER_UNAVAILABLE" };
    const selected = candidates[position];
    const sameBirth = candidates.filter((candidate) => candidate.birthOrder === selected.birthOrder);
    if (sameBirth.length > 1) return { ...base, status: "RELATION_AMBIGUOUS", mention: intent.sourcePhrase, candidates: summarize(sameBirth), candidateTotal: sameBirth.length, reason: "BIRTH_ORDER_TIE" };
    candidates = [selected];
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

module.exports = { resolveAnchoredRelationMention, resolveAnchorBirthDay };
