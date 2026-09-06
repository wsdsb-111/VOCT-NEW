"use strict";

function id(value) {
  return value === null || value === undefined ? null : String(value);
}

const realmRootIndexes = new WeakMap();

function createRealmRootIndex(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.characters || typeof snapshot.characters !== "object") return new Map();
  if (realmRootIndexes.has(snapshot)) return realmRootIndexes.get(snapshot);
  const characters = snapshot.characters;
  const roots = new Map();
  const resolve = (characterId, trail = new Set()) => {
    const key = id(characterId);
    if (!key) return null;
    if (roots.has(key)) return roots.get(key);
    if (trail.has(key)) return null;
    const character = characters[key];
    if (!character) return key;
    const liegeId = id(character.liege) || id(character.topLiege) || id(character.realm);
    if (!liegeId || liegeId === key) {
      roots.set(key, key);
      return key;
    }
    const nextTrail = new Set(trail);
    nextTrail.add(key);
    const root = resolve(liegeId, nextTrail);
    if (root) roots.set(key, root);
    return root;
  };
  for (const characterId of Object.keys(characters)) resolve(characterId);
  realmRootIndexes.set(snapshot, roots);
  return roots;
}

function resolveKnowledgeScope({ snapshot, responderId, subjectId = null, live = null, realmRootByCharacter = null } = {}) {
  const responder = snapshot?.characters?.[id(responderId)] || null;
  const subject = subjectId === null ? null : snapshot?.characters?.[id(subjectId)] || null;
  const sameCharacter = !!responder && !!subject && id(responderId) === id(subjectId);
  const sameCourt = sameCharacter ? true : responder?.courtEmployer && subject?.courtEmployer ? id(responder.courtEmployer) === id(subject.courtEmployer) : null;
  const roots = realmRootByCharacter instanceof Map ? realmRootByCharacter : createRealmRootIndex(snapshot);
  const responderRealm = responder ? roots.get(id(responderId)) || null : null;
  const subjectRealm = subject ? roots.get(id(subjectId)) || null : null;
  const sameRealm = sameCharacter ? true : responderRealm && subjectRealm ? responderRealm === subjectRealm : null;
  const complete = !!responder && !!subject && sameCourt !== null && sameRealm !== null;
  return {
    responderId: id(responderId),
    subjectId: id(subjectId),
    sameCourt,
    sameRealm,
    publicWorld: true,
    asOf: snapshot?.gameDate || null,
    verificationMode: "CHECKPOINT",
    completeness: complete ? "COMPLETE" : "INCOMPLETE"
  };
}

module.exports = { createRealmRootIndex, resolveKnowledgeScope };
