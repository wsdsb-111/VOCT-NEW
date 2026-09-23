"use strict";

const { normalizeGameDate } = require("./character-temporal-facts");

const HISTORICAL_KNOWLEDGE_POLICY_VERSION = "v8.12-part3-historical-scope-3";
const PUBLIC_WORLD_FIELDS = new Set(["NAME", "IDENTITY", "LIFE_STATUS", "PRIMARY_TITLE", "TITLE_IDS", "TITLE_HOLDER", "TITLE_CHANGE", "WAR", "WAR_PARTICIPATION"]);
const PUBLIC_REALM_FIELDS = new Set(["LIEGE", "SPOUSE", "FRIEND", "RIVAL", "COURT", "REALM_ROOT"]);
const PRIVATE_FIELDS = new Set(["LOCATION", "COURT_EMPLOYER"]);

function id(value) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function ancestors(projection, characterId, maxDepth = 3) {
  const found = new Map();
  let frontier = [{ id: id(characterId), depth: 0 }];
  while (frontier.length) {
    const current = frontier.shift();
    if (!current.id || current.depth >= maxDepth) continue;
    const character = projection?.characters?.[current.id];
    if (!character) continue;
    for (const parentId of [character.fatherId, character.motherId].map(id).filter(Boolean)) {
      const depth = current.depth + 1;
      if (!found.has(parentId) || found.get(parentId) > depth) {
        found.set(parentId, depth);
        frontier.push({ id: parentId, depth });
      }
    }
  }
  return found;
}

function historicalBloodKinship(projection, leftId, rightId) {
  const left = id(leftId);
  const right = id(rightId);
  if (!left || !right || !projection?.characters?.[left] || !projection.characters[right]) return false;
  if (left === right) return true;
  const leftAncestors = ancestors(projection, left);
  const rightAncestors = ancestors(projection, right);
  if (leftAncestors.has(right) || rightAncestors.has(left)) return true;
  return [...leftAncestors].some(([ancestorId, leftDepth]) => rightAncestors.has(ancestorId) && leftDepth + rightAncestors.get(ancestorId) <= 4);
}

function personalMemoryAllows(memoryFacts, responderId, subjectId, asOf, field, value) {
  const responder = id(responderId);
  const subject = id(subjectId);
  const requested = normalizeGameDate(asOf);
  return (Array.isArray(memoryFacts) ? memoryFacts : []).some((fact) => {
    const factField = String(fact.structuredField || fact.field || "").toLocaleUpperCase();
    const targetId = id(fact.targetEntityId ?? fact.entityId);
    const event = normalizeGameDate(fact.asOf || fact.eventDate);
    const directObservation = fact.knowledgeLevel === "DIRECT_OBSERVATION" || fact.evidenceType === "DIRECT_OBSERVATION" || fact.sourceTier === "DIRECT_OBSERVATION";
    const authorized = id(fact.ownerId) === responder || (fact.knownBy || []).map(id).includes(responder) || directObservation && (fact.directObserverIds || []).map(id).includes(responder);
    if (!authorized || !targetId || targetId !== subject || !event || requested && event.serial > requested.serial) return false;
    if (field === "LOCATION") {
      const observedLocation = fact.structuredValue ?? fact.value ?? fact.location;
      return factField === "LOCATION" && observedLocation !== undefined && observedLocation !== null && String(observedLocation) === String(value)
        && (directObservation ? (fact.directObserverIds || []).map(id).includes(responder) : fact.sourceTier === "PERSONAL_MEMORY" && fact.structured === true);
    }
    return factField === "COURT_EMPLOYER" && fact.sourceTier === "PERSONAL_MEMORY";
  });
}

function resolveHistoricalKnowledge({ projection, responderId, subjectId, field, value = null, memoryFacts = [] } = {}) {
  const responder = id(responderId);
  const subject = id(subjectId);
  const responderState = projection?.characters?.[responder] || null;
  const subjectState = projection?.characters?.[subject] || null;
  const base = { policyVersion: HISTORICAL_KNOWLEDGE_POLICY_VERSION, responderId: responder, subjectId: subject, field, asOf: projection?.gameDate || null };
  if (!responder || !responderState) return { ...base, decision: "DENY", reason: "HISTORY_SCOPE_DENIED", knowledgeLevel: "UNKNOWN" };
  if (!subject || !subjectState) return { ...base, decision: "DENY", reason: "HISTORY_ENTITY_NOT_PRESENT", knowledgeLevel: "UNKNOWN" };
  if (responder === subject) return { ...base, decision: "ALLOW", reason: "HISTORICAL_SELF", knowledgeLevel: "SELF" };
  if (PUBLIC_WORLD_FIELDS.has(field)) return { ...base, decision: "ALLOW", reason: "HISTORICAL_PUBLIC_WORLD", knowledgeLevel: "PUBLIC_WORLD" };
  const sameRealm = !!responderState.realmRootId && responderState.realmRootId === subjectState.realmRootId;
  const sameCourt = !!responderState.courtEmployerId && responderState.courtEmployerId === subjectState.courtEmployerId;
  if (PUBLIC_REALM_FIELDS.has(field)) {
    if (historicalBloodKinship(projection, responder, subject)) return { ...base, decision: "ALLOW", reason: "HISTORICAL_BLOOD_KINSHIP", knowledgeLevel: "PERSONAL_MEMORY" };
    return sameRealm
      ? { ...base, decision: "ALLOW", reason: "HISTORICAL_PUBLIC_REALM", knowledgeLevel: "REALM_PUBLIC" }
      : { ...base, decision: "DENY", reason: "HISTORY_SCOPE_DENIED", knowledgeLevel: "REALM_PUBLIC" };
  }
  if (PRIVATE_FIELDS.has(field)) {
    if (personalMemoryAllows(memoryFacts, responder, subject, projection.gameDate, field, value)) return { ...base, decision: "ALLOW", reason: "HISTORICAL_PERSONAL_MEMORY", knowledgeLevel: "PERSONAL_MEMORY" };
    if (historicalBloodKinship(projection, responder, subject)) return { ...base, decision: "ALLOW", reason: "HISTORICAL_BLOOD_KINSHIP", knowledgeLevel: "PERSONAL_MEMORY" };
    if (sameCourt && field === "COURT_EMPLOYER") return { ...base, decision: "ALLOW", reason: "HISTORICAL_COURT", knowledgeLevel: "COURT_PUBLIC" };
    return { ...base, decision: "DENY", reason: "HISTORY_SCOPE_DENIED", knowledgeLevel: "UNKNOWN" };
  }
  return { ...base, decision: "DENY", reason: "HISTORY_SCOPE_DENIED", knowledgeLevel: "UNKNOWN" };
}

module.exports = { HISTORICAL_KNOWLEDGE_POLICY_VERSION, historicalBloodKinship, resolveHistoricalKnowledge };
