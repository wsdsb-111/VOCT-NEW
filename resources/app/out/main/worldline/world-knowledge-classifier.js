"use strict";

const { dateValue } = require("./game-state-adapter");
const { formatStructuredCharacter } = require("./character-family-facts");

function text(value) {
  return String(value ?? "").trim();
}

function checkpointSafe(candidate, checkpointDate) {
  const candidateDate = dateValue(candidate?.gameDate);
  const checkpoint = dateValue(checkpointDate);
  return candidateDate !== null && checkpoint !== null && candidateDate <= checkpoint;
}

function fact(candidate, values) {
  return {
    factId: `world:${candidate.id}:${values.field}`,
    entityId: values.entityId || candidate.id,
    field: values.field,
    value: values.value,
    sourceTier: candidate.sourceTier,
    knowledgeLevel: values.knowledgeLevel,
    public: values.public === true,
    temporalSafe: values.temporalSafe,
    asOf: candidate.gameDate || null,
    sourceComplete: true,
    candidateSetComplete: true,
    evidenceRefs: ["CHECKPOINT", `CANDIDATE:${candidate.id}`, values.evidence],
    contentRef: values.contentRef || null,
    knownBy: Array.isArray(values.knownBy) ? values.knownBy.slice() : undefined,
    ownerId: values.ownerId || null,
    authorizationComplete: values.authorizationComplete === true,
    directObserverIds: Array.isArray(values.directObserverIds) ? values.directObserverIds.slice() : undefined,
    observationEvidenceComplete: values.observationEvidenceComplete === true
  };
}

function characterFacts(candidate, checkpointDate, snapshot) {
  const character = candidate?.payload?.character;
  const id = text(candidate?.payload?.id || character?.id);
  const name = text(candidate?.payload?.match?.displayName || character?.fullName || character?.firstName || candidate?.title);
  const temporalSafe = checkpointSafe(candidate, checkpointDate);
  const facts = [];
  if (id && name) {
    facts.push(fact(candidate, {
      entityId: id,
      field: "NAME",
      value: name,
      knowledgeLevel: "COURT_PUBLIC",
      public: true,
      temporalSafe,
      evidence: "CHARACTER_NAME"
    }));
    const structured = formatStructuredCharacter(character, checkpointDate, snapshot?.characters || null);
    facts.push(fact(candidate, {
      entityId: id,
      field: "IDENTITY",
      value: structured.text,
      knowledgeLevel: "COURT_PUBLIC",
      public: true,
      temporalSafe,
      evidence: "CHARACTER_STRUCTURED_FACTS"
    }));
  }
  if (id && text(character?.location)) {
    facts.push(fact(candidate, {
      entityId: id,
      field: "LOCATION",
      value: `${name || "该角色"}当前位于 ${text(character.location)}（截至 ${candidate.gameDate}）`,
      knowledgeLevel: "COURT_PUBLIC",
      public: true,
      temporalSafe,
      evidence: "CHARACTER_LOCATION"
    }));
  }
  const characterName = (characterId) => {
    const related = snapshot?.characters?.[String(characterId)];
    return text(related?.fullName || related?.firstName) || `#${characterId}`;
  };
  const parentIds = [character?.parents?.father, character?.parents?.mother].map(text).filter(Boolean);
  if (id && parentIds.length) facts.push(fact(candidate, { entityId: id, field: "PARENTS", value: `${name}的父母：${parentIds.map(characterName).join("、")}`, knowledgeLevel: "COURT_PUBLIC", public: true, temporalSafe, evidence: "CHARACTER_PARENTS" }));
  const spouseId = text(character?.spouse);
  if (id && spouseId) facts.push(fact(candidate, { entityId: id, field: "SPOUSE", value: `${name}的配偶：${characterName(spouseId)}`, knowledgeLevel: "COURT_PUBLIC", public: true, temporalSafe, evidence: "CHARACTER_SPOUSE" }));
  const childIds = (character?.children || []).map(text).filter(Boolean);
  if (id && childIds.length) facts.push(fact(candidate, { entityId: id, field: "CHILDREN", value: `${name}的子女：${childIds.map(characterName).join("、")}`, knowledgeLevel: "COURT_PUBLIC", public: true, temporalSafe, evidence: "CHARACTER_CHILDREN" }));
  return facts;
}

function titleFacts(candidate, checkpointDate) {
  const holderId = text(candidate?.payload?.holderId);
  const holderName = text(candidate?.payload?.holder?.fullName || candidate?.payload?.holder?.firstName);
  const title = text(candidate?.title || candidate?.payload?.title?.key);
  if (!holderId || !holderName || !title) return [];
  return [fact(candidate, {
    entityId: holderId,
    field: "PRIMARY_TITLE",
    value: `${holderName}持有${title}（截至 ${candidate.gameDate}）`,
    knowledgeLevel: "REALM_PUBLIC",
    public: true,
    temporalSafe: checkpointSafe(candidate, checkpointDate),
    evidence: "TITLE_HOLDER"
  })];
}

function deltaFacts(candidate, checkpointDate) {
  const eventType = text(candidate?.eventType);
  const realmPublic = new Set(["WAR_STARTED", "WAR_NO_LONGER_ACTIVE", "IMPORTANT_CHARACTER_DIED", "TITLE_HOLDER_CHANGED"]);
  if (!realmPublic.has(eventType)) return [];
  const actorId = text(candidate?.entityRefs?.characters?.[0]);
  if (!actorId) return [];
  const descriptions = {
    WAR_STARTED: "记录到一场新战争。",
    WAR_NO_LONGER_ACTIVE: "一场战争已不再出现在活跃战争记录中；结果仍待核实。",
    IMPORTANT_CHARACTER_DIED: "记录到重要人物去世。",
    TITLE_HOLDER_CHANGED: "记录到头衔持有人变更。"
  };
  return [fact(candidate, {
    entityId: actorId || candidate.id,
    field: "WORLD_EVENT",
    value: `${candidate.gameDate || "日期未知"}：${descriptions[eventType]}`,
    knowledgeLevel: "REALM_PUBLIC",
    public: true,
    temporalSafe: checkpointSafe(candidate, checkpointDate),
    evidence: `ANNUAL_DELTA_${eventType}`
  })];
}

function supplementalFact(candidate, checkpointDate) {
  const entry = candidate?.payload || {};
  const title = text(entry.title || candidate?.title);
  const body = text(entry.body);
  if (candidate?.hidden === true || !title || !body) return [];
  const visibility = candidate?.visibility || "PUBLIC_WORLD";
  const audienceIds = [...new Set((candidate?.entityRefs?.characters || []).map((id) => text(id)).filter(Boolean))];
  const base = {
    entityId: audienceIds[0] || candidate.id,
    field: "SUPPLEMENTAL",
    value: `${title}：${body}`,
    temporalSafe: checkpointSafe(candidate, checkpointDate),
    contentRef: text(entry.id) || null
  };
  if (visibility === "PUBLIC_WORLD") return [fact(candidate, {
    ...base,
    knowledgeLevel: "PUBLIC_WORLD",
    public: true,
    evidence: "PLAYER_PUBLIC_SUPPLEMENTAL"
  })];
  if (visibility === "COURT_PUBLIC") {
    if (!audienceIds.length) return [];
    return [fact(candidate, {
      ...base,
      knowledgeLevel: "COURT_PUBLIC",
      public: true,
      evidence: "PLAYER_COURT_SUPPLEMENTAL"
    })];
  }
  if (!audienceIds.length) return [];
  return [fact(candidate, {
    ...base,
    knowledgeLevel: visibility === "SECRET" ? "SECRET" : "PERSONAL_MEMORY",
    public: false,
    knownBy: audienceIds,
    ownerId: visibility === "PERSONAL" && audienceIds.length === 1 ? audienceIds[0] : null,
    authorizationComplete: true,
    evidence: visibility === "SECRET" ? "PLAYER_SECRET_SUPPLEMENTAL" : "PLAYER_PERSONAL_SUPPLEMENTAL"
  })];
}

function classifySelectedWorldFacts(selected = {}, checkpointDate = null, snapshot = null) {
  const facts = [];
  for (const candidate of selected.gameTruth || []) {
    if (candidate?.kind === "CHARACTER") facts.push(...characterFacts(candidate, checkpointDate, snapshot));
    else if (candidate?.kind === "TITLE") facts.push(...titleFacts(candidate, checkpointDate));
  }
  for (const candidate of selected.delta || []) facts.push(...deltaFacts(candidate, checkpointDate));
  for (const candidate of selected.supplemental || []) facts.push(...supplementalFact(candidate, checkpointDate));
  return facts;
}

module.exports = { classifySelectedWorldFacts };
