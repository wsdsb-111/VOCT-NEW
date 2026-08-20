"use strict";

function matchesPatterns(patterns, evidenceText) {
  return Array.isArray(patterns) && patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(evidenceText);
  });
}

function resolveMetadataCandidates(event, registry) {
  const evidenceText = event?.evidence?.text || "";
  if (!evidenceText || !registry) return [];
  const candidates = [];
  for (const action of registry.getAllActions(false)) {
    const definition = action.definition;
    const semantic = definition?.semantic;
    const categories = Array.isArray(definition?.triggerCategories) ? definition.triggerCategories : [];
    if (!semantic || semantic.requiresLegacyResolution || !categories.includes(event.category)) continue;
    const excluded = matchesPatterns(semantic.excludePatterns, evidenceText);
    const matched = matchesPatterns(semantic.evidencePatterns, evidenceText);
    const customMatched = typeof semantic.match === "function" && semantic.match({ event, evidence: event.evidence });
    if (!excluded && (matched || customMatched)) candidates.push({ action, semantic });
  }
  const winners = [];
  const groups = new Map();
  for (const candidate of candidates) {
    const group = candidate.semantic.exclusiveGroup;
    if (!group) winners.push(candidate);
    else if (!groups.has(group) || Number(candidate.semantic.priority) > Number(groups.get(group).semantic.priority)) groups.set(group, candidate);
  }
  winners.push(...groups.values());
  return winners.map((candidate) => candidate.action.id);
}

function resolve(event, { registry, legacyResolver } = {}) {
  const reasons = Array.isArray(event?.categories) ? event.categories : [event?.category].filter(Boolean);
  const metadataAllowedActionIds = resolveMetadataCandidates(event, registry);
  if (metadataAllowedActionIds.length > 0) return { mode: "resolved", reasons, allowedActionIds: metadataAllowedActionIds, evidence: ["metadata_positive_evidence"] };
  const legacyActionIds = registry ? registry.getAllActions(false).filter((action) => {
    const categories = Array.isArray(action.definition?.triggerCategories) ? action.definition.triggerCategories : [];
    return action.definition?.semantic?.requiresLegacyResolution && categories.some((category) => reasons.includes(category));
  }).map((action) => action.id) : [];
  if (legacyActionIds.length > 0 && typeof legacyResolver === "function") {
    const legacyProfile = legacyResolver(event?.evidence?.text || "", reasons);
    const allowedActionIds = legacyProfile.allowedActionIds.filter((actionId) => legacyActionIds.includes(actionId));
    if (allowedActionIds.length > 0) return { mode: "legacy", reasons: legacyProfile.reasons, allowedActionIds, evidence: legacyProfile.evidence };
  }
  return { mode: "unresolved", reasons, allowedActionIds: [], evidence: [] };
}

module.exports = { resolveMetadataCandidates, resolve };
