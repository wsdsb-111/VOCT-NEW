"use strict";

const MAX_SHARED_CANDIDATES = 128;

function safeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const copy = { ...candidate };
  if (["PERSONAL_MEMORY", "SECRET"].includes(copy.knowledgeLevel)) {
    return {
      factId: copy.factId || null,
      contentRef: copy.contentRef || null,
      sourceTier: copy.sourceTier || null,
      knowledgeLevel: copy.knowledgeLevel,
      asOf: copy.asOf || null,
      temporalSafe: copy.temporalSafe === true
    };
  }
  if (copy.hidden === true || ["SELF", "DIRECT_OBSERVATION"].includes(copy.knowledgeLevel)) {
    delete copy.value;
    delete copy.title;
    delete copy.body;
    delete copy.content;
    delete copy.canonicalText;
    delete copy.payload;
    delete copy.participantNames;
  }
  return JSON.parse(JSON.stringify(copy));
}

function cloneResult(result, cacheHit) {
  return { ...JSON.parse(JSON.stringify(result)), cacheHit };
}

function createSharedCandidatePool({ cache, key, build } = {}) {
  if (!(cache instanceof Map) || !key || typeof build !== "function") return { candidates: [], cacheHit: false, truncated: false };
  if (cache.has(key)) return cloneResult(cache.get(key), true);
  const built = build();
  const source = Array.isArray(built) ? built : Array.isArray(built?.candidates) ? built.candidates : [];
  const candidates = source.map(safeCandidate).filter(Boolean).slice(0, MAX_SHARED_CANDIDATES);
  const result = {
    candidates,
    cacheHit: false,
    truncated: source.length > candidates.length,
    subjectId: built && !Array.isArray(built) && built.subjectId !== null && built.subjectId !== undefined ? String(built.subjectId) : null,
    queryFingerprint: built && !Array.isArray(built) && built.queryFingerprint ? String(built.queryFingerprint) : null
  };
  cache.set(key, result);
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  return cloneResult(result, false);
}

module.exports = { MAX_SHARED_CANDIDATES, createSharedCandidatePool };
