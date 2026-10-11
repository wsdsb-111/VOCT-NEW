"use strict";

const { getTargetedKinshipGraph } = require("./kinship-graph-cache");
const { normalizeSpouseRecords } = require("./canonical-spouse-record");
const CLOSE_KINSHIP = ["PARENT_OF", "CHILD_OF", "SIBLING_OF", "GRANDPARENT_OF", "AUNT_UNCLE_OF", "NIECE_NEPHEW_OF", "COUSIN_OF"];
const FRIEND_LABELS = new Set(["friend", "friends", "best_friend", "best friend", "朋友", "好友", "挚友", "至交"]);
const SPOUSE_LABELS = new Set(["spouse", "wife", "husband", "配偶", "妻子", "丈夫"]);

function closeKnowledge(snapshot, responderId, subjectId, runtimeGameData) {
  if (!snapshot?.characters?.[responderId] || !snapshot.characters[subjectId]) return null;
  if (responderId === subjectId) return "SELF";
  const graph = getTargetedKinshipGraph(snapshot, [responderId, subjectId]);
  const relation = graph.relationBetweenOfTypes(subjectId, responderId, CLOSE_KINSHIP);
  if (!graph.scopeTruncated && relation.relation && !relation.diagnostic) return "KINSHIP";
  const runtimeCharacters = runtimeGameData?.characters;
  const runtimeCharacter = key => runtimeCharacters instanceof Map ? runtimeCharacters.get(Number(key)) || runtimeCharacters.get(key) : runtimeCharacters?.[key];
  let currentSpouse = false;
  let formerSpouse = false;
  for (const [leftId, rightId] of [[responderId, subjectId], [subjectId, responderId]]) {
    const left = runtimeCharacter(leftId);
    if (!left) continue;
    const labels = [...(left?.relationsToCharacters?.find(item => String(item.id) === rightId)?.relations || []),
      ...(String(runtimeGameData?.playerID) === rightId ? left?.relationsToPlayer || [] : [])].map(label => String(label).trim().toLowerCase());
    if (labels.some(label => FRIEND_LABELS.has(label))) return "FRIEND";
    const spouses = normalizeSpouseRecords(left).filter(record => String(record.runtimeId) === rightId);
    currentSpouse ||= spouses.some(record => record.relationType === "CURRENT_SPOUSE") || labels.some(label => SPOUSE_LABELS.has(label));
    formerSpouse ||= spouses.some(record => ["FORMER_SPOUSE", "DECEASED_SPOUSE"].includes(record.relationType)) || labels.some(label => /^(ex[- ]?(wife|husband|spouse)|former spouse|前妻|前夫|前配偶|亡妻|亡夫)$/.test(label));
  }
  return currentSpouse && !formerSpouse ? "SPOUSE" : null;
}

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
    if (!character) return null;
    const liegeId = id(character.liege) || id(character.topLiege) || id(character.realm) || id(character.courtEmployer);
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

function resolveKnowledgeScope({ snapshot, responderId, subjectId = null, live = null, realmRootByCharacter = null, runtimeGameData = null, includeCloseKnowledge = false } = {}) {
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
    completeness: complete ? "COMPLETE" : "INCOMPLETE",
    ...(includeCloseKnowledge ? { closeKnowledge: closeKnowledge(snapshot, id(responderId), id(subjectId), runtimeGameData) } : {})
  };
}

module.exports = { createRealmRootIndex, resolveKnowledgeScope, closeKnowledge };
