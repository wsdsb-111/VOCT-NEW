"use strict";

const { dateValue } = require("./game-state-adapter");

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
    contentRef: values.contentRef || null
  };
}

function characterFacts(candidate, checkpointDate) {
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
  if (candidate?.visibility !== "PUBLIC_WORLD" || candidate?.hidden === true) return [];
  return [fact(candidate, {
    entityId: candidate.id,
    field: "SUPPLEMENTAL",
    value: title && body ? `${title}：${body}` : "",
    knowledgeLevel: "PUBLIC_WORLD",
    public: true,
    temporalSafe: checkpointSafe(candidate, checkpointDate),
    evidence: "PLAYER_PUBLIC_SUPPLEMENTAL",
    contentRef: text(entry.id) || null
  })];
}

function classifySelectedWorldFacts(selected = {}, checkpointDate = null) {
  const facts = [];
  for (const candidate of selected.gameTruth || []) {
    if (candidate?.kind === "CHARACTER") facts.push(...characterFacts(candidate, checkpointDate));
    else if (candidate?.kind === "TITLE") facts.push(...titleFacts(candidate, checkpointDate));
  }
  for (const candidate of selected.delta || []) facts.push(...deltaFacts(candidate, checkpointDate));
  for (const candidate of selected.supplemental || []) facts.push(...supplementalFact(candidate, checkpointDate));
  return facts;
}

module.exports = { classifySelectedWorldFacts };
