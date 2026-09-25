"use strict";

const INTENT_FIELDS = Object.freeze({
  CHARACTER_LOCATION: "LOCATION",
  CHARACTER_STATE: "ALIVE",
  CHARACTER_IDENTITY: "IDENTITY",
  TITLE_HOLDER: "PRIMARY_TITLE",
  REALM_STATUS: "PRIMARY_TITLE",
  WAR_STATUS: "WAR",
  WORLD_RECENT: "WORLD_EVENT"
});

function sorted(values) {
  return [...new Set(Array.from(values || [], String).filter(Boolean))].sort();
}

function buildFrozenCoverageManifest(view, selectedFacts = []) {
  const entityFields = {};
  const titleIds = new Set();
  const factIds = new Set();
  const fields = new Set();
  const warScopes = [];
  for (const fact of selectedFacts) {
    if (!fact?.field || !fact?.value) continue;
    const entityId = String(fact.entityId || "");
    if (entityId) (entityFields[entityId] ||= new Set()).add(fact.field);
    if (fact.factId) factIds.add(String(fact.factId));
    fields.add(fact.field);
    if (fact.field === "WAR") warScopes.push({ warId: entityId, characters: sorted(fact.scopeEntityIds), titles: sorted(fact.scopeTitleIds) });
    const titleId = String(fact.factId || "").match(/^world:title:(.+):PRIMARY_TITLE$/)?.[1];
    if (titleId) titleIds.add(titleId);
  }
  return {
    responderId: String(view?.responderId || ""),
    checkpointId: view?.checkpointId || null,
    entityFields: Object.fromEntries(Object.entries(entityFields).map(([id, value]) => [id, sorted(value)])),
    titleIds: sorted(titleIds),
    factIds: sorted(factIds),
    fields: sorted(fields),
    warScopes,
    factCount: factIds.size,
    candidateSetComplete: view?.candidateSetComplete === true,
    truncated: view?.truncated === true || view?.candidateSetComplete !== true
  };
}

function hasFrozenCoverage({ queryPlan, manifest } = {}) {
  const intent = queryPlan?.intent || "GENERAL_WORLD";
  const timeMode = queryPlan?.time?.mode || "UNSPECIFIED";
  if (!["CURRENT", "UNSPECIFIED"].includes(timeMode)) return { eligible: false, hit: false, missingFields: [] };
  const entities = queryPlan?.entities || {};
  const characters = sorted(entities.characters);
  const titles = sorted(entities.titles);
  const wars = sorted(entities.wars);
  if (!characters.length && !titles.length && !wars.length && intent === "GENERAL_WORLD") return { eligible: true, hit: true, missingFields: [] };
  if (!characters.length && ["CHARACTER_LOCATION", "CHARACTER_STATE", "CHARACTER_IDENTITY"].includes(intent)) return { eligible: true, hit: false, missingFields: [{ field: INTENT_FIELDS[intent] }] };
  if (!manifest) return { eligible: true, hit: false, missingFields: [{ field: INTENT_FIELDS[intent] || "UNKNOWN" }] };
  const field = INTENT_FIELDS[intent] || (characters.length ? "ALIVE" : titles.length ? "PRIMARY_TITLE" : wars.length ? "WAR" : null);
  if (!field) return { eligible: true, hit: true, missingFields: [] };
  const missingFields = [];
  if (field === "WAR") {
    const covered = manifest.warScopes.some((scope) => characters.every(id => scope.characters.includes(id)) && titles.every(id => scope.titles.includes(id)) && wars.every(id => scope.warId === id || scope.warId === `war:${id}`));
    if (!covered) missingFields.push({ field: "WAR", entityIds: [...characters, ...titles, ...wars] });
  } else if (field === "PRIMARY_TITLE") {
    for (const titleId of titles) if (!manifest.titleIds.includes(titleId)) missingFields.push({ entityId: titleId, field });
    for (const characterId of characters) if (!manifest.entityFields[characterId]?.includes(field)) missingFields.push({ entityId: characterId, field });
    if (!titles.length && !characters.length && !manifest.fields.includes(field)) missingFields.push({ field });
  } else if (characters.length) {
    for (const characterId of characters) if (!manifest.entityFields[characterId]?.includes(field)) missingFields.push({ entityId: characterId, field });
  } else if (!manifest.fields.includes(field)) missingFields.push({ field });
  return { eligible: true, hit: missingFields.length === 0, missingFields };
}

function buildCoveragePatchKey({ responderId, checkpointId, queryPlan } = {}) {
  const entities = queryPlan?.entities || {};
  return JSON.stringify({
    responderId: String(responderId || ""), checkpointId: String(checkpointId || ""),
    intent: queryPlan?.intent || "GENERAL_WORLD",
    characters: sorted(entities.characters), titles: sorted(entities.titles),
    realms: sorted(entities.realms), wars: sorted(entities.wars), eventTypes: sorted(queryPlan?.eventTypes)
  });
}

module.exports = { buildFrozenCoverageManifest, hasFrozenCoverage, buildCoveragePatchKey };
