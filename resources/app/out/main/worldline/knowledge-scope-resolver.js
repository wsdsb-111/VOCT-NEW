"use strict";

function id(value) {
  return value === null || value === undefined ? null : String(value);
}

function scopeAnchor(character) {
  return id(character?.topLiege) || id(character?.realm) || id(character?.liege);
}

function resolveKnowledgeScope({ snapshot, responderId, subjectId = null, live = null } = {}) {
  const responder = snapshot?.characters?.[id(responderId)] || null;
  const subject = subjectId === null ? null : snapshot?.characters?.[id(subjectId)] || null;
  const sameCharacter = !!responder && !!subject && id(responderId) === id(subjectId);
  const sameCourt = sameCharacter ? true : responder?.courtEmployer && subject?.courtEmployer ? id(responder.courtEmployer) === id(subject.courtEmployer) : null;
  const responderRealm = scopeAnchor(responder);
  const subjectRealm = scopeAnchor(subject);
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

module.exports = { resolveKnowledgeScope };
