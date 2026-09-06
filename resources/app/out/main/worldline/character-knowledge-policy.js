"use strict";

const KNOWLEDGE_LEVELS = Object.freeze(["SELF", "DIRECT_OBSERVATION", "PERSONAL_MEMORY", "COURT_PUBLIC", "REALM_PUBLIC", "PUBLIC_WORLD", "SECRET", "UNKNOWN"]);
const KNOWLEDGE_POLICY_VERSION = "v8.6-character-knowledge-1";
const LEVEL_SET = new Set(KNOWLEDGE_LEVELS);
const SELF_FIELDS = new Set(["NAME", "IDENTITY", "PRIMARY_TITLE", "SPOUSE", "CHILDREN", "COURT_POSITION", "LOCATION", "CULTURE", "FAITH", "KNOWN_ACTION"]);
const PRIORITY = Object.freeze({ SELF: 700, DIRECT_OBSERVATION: 700, PERSONAL_MEMORY: 600, COURT_PUBLIC: 500, REALM_PUBLIC: 500, PUBLIC_WORLD: 500, SECRET: 650, UNKNOWN: 0 });

function idOf(value) {
  const id = value && typeof value === "object" ? value.id ?? value.characterId : value;
  return id === null || id === undefined ? null : String(id);
}

function includesId(values, id) {
  return id !== null && Array.isArray(values) && values.some((value) => idOf(value) === id);
}

function safeFact(fact, value) {
  if (value === "ALLOW") return fact;
  return {
    factId: fact.factId || null,
    entityId: idOf(fact.entityId),
    entityRef: fact.entityRef || null,
    field: fact.field || null,
    sourceTier: fact.sourceTier || null,
    knowledgeLevel: fact.knowledgeLevel || "UNKNOWN"
  };
}

function decision(fact, knowledgeLevel, value, reason, context = {}) {
  return {
    fact: safeFact(fact, value),
    knowledgeLevel,
    decision: value,
    reason,
    evidenceRefs: Array.isArray(fact.evidenceRefs) ? fact.evidenceRefs.slice() : [],
    asOf: fact.asOf || context.asOf || null,
    verificationMode: fact.verificationMode || context.verificationMode || "UNVERIFIED"
  };
}

function classifyKnowledge(fact = {}, responder = {}, context = {}) {
  const responderId = idOf(responder);
  const level = LEVEL_SET.has(fact.knowledgeLevel) ? fact.knowledgeLevel : "UNKNOWN";
  const result = (value, reason, resultLevel = level) => decision(fact, resultLevel, value, reason, context);
  if (fact.hidden === true) return result("DENY", "HIDDEN");
  if (fact.sourceComplete === false || fact.candidateSetComplete === false) return result("UNKNOWN", "SOURCE_INCOMPLETE");
  if (fact.temporalSafe === false) return result("UNKNOWN", "TEMPORAL_UNSAFE");
  if (level === "UNKNOWN" || responderId === null) return result("UNKNOWN", "KNOWLEDGE_EVIDENCE_MISSING", "UNKNOWN");

  if (level === "SELF") {
    if (idOf(fact.entityId) !== responderId) return result("DENY", "NOT_SELF");
    if (["BIOLOGICAL_FATHER", "BIOLOGICAL_MOTHER"].includes(fact.field) && !includesId(fact.knownBy, responderId) && fact.selfKnowledgeVerified !== true) return result("UNKNOWN", "PRIVATE_SELF_FACT_UNPROVEN");
    return SELF_FIELDS.has(fact.field) || fact.selfKnowledgeVerified === true ? result("ALLOW", "SELF_FIELD") : result("UNKNOWN", "SELF_FIELD_NOT_CLASSIFIED");
  }

  if (level === "DIRECT_OBSERVATION") {
    const observed = includesId(fact.directObserverIds, responderId) || includesId(context.directObservationFactIds, fact.factId);
    if (observed) return result("ALLOW", "DIRECTLY_OBSERVED");
    return fact.observationEvidenceComplete === true ? result("DENY", "NOT_AN_OBSERVER") : result("UNKNOWN", "OBSERVATION_UNPROVEN");
  }

  if (level === "PERSONAL_MEMORY") {
    const owned = idOf(fact.ownerId) === responderId || idOf(fact.projectionOwnerId) === responderId || includesId(fact.knownBy, responderId) || fact.participationVerified === true && includesId(fact.participantIds, responderId);
    if (owned) return result("ALLOW", "PERSONAL_MEMORY_OWNED");
    return fact.authorizationComplete === true ? result("DENY", "PERSONAL_MEMORY_NOT_AUTHORIZED") : result("UNKNOWN", "PERSONAL_MEMORY_OWNERSHIP_UNPROVEN");
  }

  if (level === "SECRET") {
    const allowed = includesId(fact.knownBy, responderId) || includesId(fact.directObserverIds, responderId) || includesId(fact.privateLetterRecipientIds, responderId) || idOf(fact.projectionOwnerId) === responderId || fact.participationVerified === true && includesId(fact.participantIds, responderId);
    if (allowed) return result("ALLOW", "SECRET_KNOWN");
    return fact.authorizationComplete === true ? result("DENY", "SECRET_NOT_AUTHORIZED") : result("UNKNOWN", "SECRET_KNOWLEDGE_UNPROVEN");
  }

  if (fact.public === false) return result("DENY", "NOT_PUBLIC");
  if (fact.public !== true) return result("UNKNOWN", "PUBLICITY_UNPROVEN");
  if (level === "COURT_PUBLIC") return context.sameCourt === true ? result("ALLOW", "SAME_COURT_PUBLIC") : context.sameCourt === false ? result("DENY", "DIFFERENT_COURT") : result("UNKNOWN", "COURT_SCOPE_UNPROVEN");
  if (level === "REALM_PUBLIC") return context.sameRealm === true ? result("ALLOW", "SAME_REALM_PUBLIC") : context.sameRealm === false ? result("DENY", "DIFFERENT_REALM") : result("UNKNOWN", "REALM_SCOPE_UNPROVEN");
  if (level === "PUBLIC_WORLD") return fact.temporalSafe === true ? result("ALLOW", "PUBLIC_WORLD_SAFE") : result("UNKNOWN", "TEMPORAL_SAFETY_UNPROVEN");
  return result("UNKNOWN", "KNOWLEDGE_EVIDENCE_MISSING", "UNKNOWN");
}

function canKnow(responder, fact, context = {}) {
  return classifyKnowledge(fact, responder, context).decision === "ALLOW";
}

function resolveKnowledgeConflict(candidates = []) {
  const allowed = candidates.filter((item) => item.decision === "ALLOW").sort((left, right) => (PRIORITY[right.knowledgeLevel] || 0) - (PRIORITY[left.knowledgeLevel] || 0));
  const secretUnavailable = candidates.some((item) => item.knowledgeLevel === "SECRET" && item.decision !== "ALLOW");
  if (!allowed.length) return { fact: null, knowledgeLevel: "UNKNOWN", decision: "UNKNOWN", reason: secretUnavailable ? "SECRET_UNAVAILABLE" : "NO_ALLOWED_FACT" };
  const topPriority = PRIORITY[allowed[0].knowledgeLevel] || 0;
  if (secretUnavailable && topPriority <= PRIORITY.SECRET) return { fact: null, knowledgeLevel: "UNKNOWN", decision: "UNKNOWN", reason: "SECRET_UNAVAILABLE" };
  const top = allowed.filter((item) => (PRIORITY[item.knowledgeLevel] || 0) === topPriority);
  const values = new Set(top.map((item) => JSON.stringify(item.fact?.value)));
  if (values.size > 1) return { fact: null, knowledgeLevel: "UNKNOWN", decision: "UNKNOWN", reason: "EQUAL_AUTHORITY_CONFLICT" };
  return { ...allowed[0], conflictReason: "HIGHER_AUTHORITY_FACT" };
}

module.exports = { KNOWLEDGE_LEVELS, KNOWLEDGE_POLICY_VERSION, SELF_FIELDS, canKnow, classifyKnowledge, resolveKnowledgeConflict };
