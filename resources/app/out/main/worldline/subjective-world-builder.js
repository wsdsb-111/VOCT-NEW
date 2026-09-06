"use strict";

const { KNOWLEDGE_POLICY_VERSION, classifyKnowledge, resolveKnowledgeConflict } = require("./character-knowledge-policy");

const MAX_CANDIDATES = 128;
const MAX_SELECTED = 24;
const MAX_DIAGNOSTICS = 50;
const MAX_VALUE_CHARS = 1024;

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
  const bounded = input.slice(0, MAX_CANDIDATES);
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
  const allowedFacts = resolved.slice(0, MAX_SELECTED).map(safeAllowedFact);
  const filtered = decisions.filter((item) => item.decision !== "ALLOW");
  const truncated = input.length > bounded.length || resolved.length > MAX_SELECTED;
  const diagnostics = [
    ...filtered.map((item) => ({ factId: item.fact?.factId || null, decision: item.decision, reason: item.reason })),
    ...conflicts.map((item) => ({ factId: null, decision: item.decision, reason: item.reason }))
  ].slice(0, MAX_DIAGNOSTICS);
  return {
    responderId: responder?.id === undefined ? null : String(responder.id),
    checkpointId,
    knowledgePolicyVersion: KNOWLEDGE_POLICY_VERSION,
    asOf: scope.asOf || null,
    verificationMode: scope.verificationMode || "UNVERIFIED",
    completeness: scope.completeness || "INCOMPLETE",
    candidateCount: bounded.length,
    allowedFacts,
    unknownCount: filtered.filter((item) => item.decision === "UNKNOWN").length,
    filteredCount: filtered.length,
    secretBlockedCount: filtered.filter((item) => item.knowledgeLevel === "SECRET").length,
    conflictSummary: { count: conflicts.length, reasons: [...new Set(conflicts.map((item) => item.reason))] },
    candidateSetComplete: !truncated,
    truncated,
    diagnostics
  };
}

module.exports = { MAX_CANDIDATES, MAX_SELECTED, buildSubjectiveWorldView };
