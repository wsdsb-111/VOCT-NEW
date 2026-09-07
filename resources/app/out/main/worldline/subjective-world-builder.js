"use strict";

const { KNOWLEDGE_POLICY_VERSION, classifyKnowledge, resolveKnowledgeConflict } = require("./character-knowledge-policy");

const MAX_CANDIDATES = 128;
const MAX_SELECTED = 24;
const MAX_DIAGNOSTICS = 50;
const MAX_VALUE_CHARS = 512;
const PROMPT_SOURCE_TIERS = new Set(["GAME_TRUTH", "GAMESTATE", "ANNUAL_DELTA", "PLAYER_SUPPLEMENTAL"]);
const LANE_PRIORITY = Object.freeze({
  SELF: 0,
  DIRECT_OBSERVATION: 1,
  GAME_TRUTH: 2,
  GAMESTATE: 3,
  PERSONAL_MEMORY: 4,
  PLAYER_SUPPLEMENTAL: 5,
  ANNUAL_DELTA: 6
});

function candidateLanePriority(fact) {
  if (fact?.knowledgeLevel === "SELF") return LANE_PRIORITY.SELF;
  if (fact?.knowledgeLevel === "DIRECT_OBSERVATION") return LANE_PRIORITY.DIRECT_OBSERVATION;
  return LANE_PRIORITY[fact?.sourceTier] ?? 7;
}

function boundedText(value, max = MAX_VALUE_CHARS) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeValue(value) {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => boundedText(item, 256));
  if (typeof value === "string") return boundedText(value);
  return null;
}

function safeEntityRef(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return boundedText(value, 128);
  return { namespace: boundedText(value.namespace || "", 64), id: boundedText(value.id || "", 128) };
}

function conflictKey(fact = {}) {
  if (fact.conflictKey) return `explicit:${boundedText(fact.conflictKey, 256)}`;
  if (["MEMORY", "WORLD_EVENT", "SUPPLEMENTAL"].includes(fact.field)) return `fact:${fact.factId || "unknown"}`;
  return `field:${fact.entityId || "-"}:${fact.field || "-"}`;
}

function admitCandidates(input) {
  const seen = new Set();
  return input.map((fact, index) => ({ fact, index })).filter(({ fact }) => {
    const signature = fact?.factId || `${fact?.entityId ?? "-"}:${fact?.field ?? "-"}:${JSON.stringify(safeValue(fact?.value))}:${fact?.sourceTier ?? "-"}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  }).sort((left, right) => {
    const leftPriority = candidateLanePriority(left.fact);
    const rightPriority = candidateLanePriority(right.fact);
    return leftPriority - rightPriority || left.index - right.index;
  }).slice(0, MAX_CANDIDATES).map((entry) => entry.fact);
}

function safeAllowedFact(item) {
  const fact = item.fact || {};
  return {
    factId: boundedText(fact.factId || "", 256) || null,
    entityId: fact.entityId === null || fact.entityId === undefined ? null : boundedText(fact.entityId, 128),
    entityRef: safeEntityRef(fact.entityRef),
    field: boundedText(fact.field || "", 64) || null,
    value: safeValue(fact.value),
    contentRef: fact.contentRef === null || fact.contentRef === undefined ? null : boundedText(fact.contentRef, 256),
    sourceTier: boundedText(fact.sourceTier || "", 64) || null,
    knowledgeLevel: item.knowledgeLevel,
    reason: item.reason,
    conflictReason: item.conflictReason || null,
    asOf: item.asOf || fact.asOf || null,
    verificationMode: item.verificationMode || fact.verificationMode || "UNVERIFIED",
    confidence: Number.isFinite(Number(fact.confidence)) ? Number(fact.confidence) : null
  };
}

function buildSubjectiveWorldView({ responder, candidates = [], scope = {}, scopeResolver = null, checkpointId = null, directObservationFactIds = [] } = {}) {
  const input = Array.isArray(candidates) ? candidates : [];
  const bounded = admitCandidates(input);
  const decisions = bounded.map((fact) => classifyKnowledge(fact, responder, { ...scope, ...(typeof scopeResolver === "function" ? scopeResolver(fact) : {}), directObservationFactIds }));
  const grouped = new Map();
  for (const item of decisions) {
    const key = conflictKey(item.fact);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  const resolutions = [...grouped.values()].map(resolveKnowledgeConflict);
  const resolved = resolutions.filter((item) => item.decision === "ALLOW");
  const conflicts = resolutions.filter((item) => ["EQUAL_AUTHORITY_CONFLICT", "SECRET_UNAVAILABLE"].includes(item.reason));
  const policyFacts = resolved.slice(0, MAX_SELECTED).map(safeAllowedFact);
  const promptResolved = resolved.filter((item) => PROMPT_SOURCE_TIERS.has(item.fact?.sourceTier) && safeValue(item.fact?.value) !== null && boundedText(item.fact?.value).trim());
  const promptFacts = promptResolved.slice(0, MAX_SELECTED).map(safeAllowedFact);
  const filtered = decisions.filter((item) => item.decision !== "ALLOW");
  const truncated = input.length > bounded.length || resolved.length > MAX_SELECTED || promptResolved.length > MAX_SELECTED;
  const diagnostics = [
    ...filtered.map((item) => ({ factId: item.fact?.factId || null, decision: item.decision, reason: item.reason })),
    ...conflicts.map((item) => ({ factId: null, decision: item.decision, reason: item.reason }))
  ].slice(0, MAX_DIAGNOSTICS);
  const view = {
    responderId: responder?.id === undefined ? null : String(responder.id),
    checkpointId,
    knowledgePolicyVersion: KNOWLEDGE_POLICY_VERSION,
    asOf: scope.asOf || null,
    verificationMode: scope.verificationMode || "UNVERIFIED",
    completeness: scope.completeness || "INCOMPLETE",
    candidateCount: bounded.length,
    allowedFacts: policyFacts,
    promptFacts,
    unknownCount: filtered.filter((item) => item.decision === "UNKNOWN").length,
    filteredCount: filtered.length,
    secretBlockedCount: filtered.filter((item) => item.knowledgeLevel === "SECRET").length,
    conflictSummary: { count: conflicts.length, reasons: [...new Set(conflicts.map((item) => item.reason))] },
    candidateSetComplete: !truncated,
    truncated,
    diagnostics
  };
  Object.defineProperties(view, {
    policyFacts: { value: policyFacts, enumerable: false },
    diagnosticFacts: { value: diagnostics, enumerable: false }
  });
  return view;
}

module.exports = { LANE_PRIORITY, MAX_CANDIDATES, MAX_SELECTED, admitCandidates, buildSubjectiveWorldView };
