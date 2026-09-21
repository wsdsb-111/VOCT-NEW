"use strict";

const crypto = require("crypto");
const { normalizeGameDate, resolveLifeStatus } = require("./character-temporal-facts");
const { resolveCharacterAge } = require("./character-age-service");
const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");
const { createRealmRootIndex } = require("./knowledge-scope-resolver");

const SCHEMA_VERSION = 1;
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const scalar = value => typeof value === "string" || typeof value === "number" ? String(value).slice(0, 512) : null;
const ids = value => Array.isArray(value) ? [...new Set(value.map(scalar).filter(Boolean))] : [];

function createHistoricalQueryProjection(checkpoint, scope) {
  const snapshot = checkpoint.snapshot;
  const roots = createRealmRootIndex(snapshot);
  const childrenByParent = new Map();
  for (const [id, character] of Object.entries(snapshot.characters)) {
    for (const parent of [character.parents?.father, character.parents?.mother].filter(Boolean).map(String)) {
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, new Set());
      childrenByParent.get(parent).add(id);
    }
  }
  const characters = Object.create(null);
  for (const [runtimeId, character] of Object.entries(snapshot.characters)) {
    const definitions = snapshot.runtimeToDefinitions?.[runtimeId] || [];
    const definitionId = definitions.length === 1 && String(snapshot.definitionToRuntime?.[definitions[0]]) === runtimeId ? definitions[0] : null;
    const parents = [character.parents?.father, character.parents?.mother].filter(Boolean).map(String);
    const life = resolveLifeStatus(character);
    characters[runtimeId] = {
      runtimeId, historicalDefinitionId: definitionId, shortName: scalar(character.shortName || character.firstName),
      sex: resolveCharacterSexConsensus({ snapshot: character }).sex,
      birthDate: scalar(character.birth || character.birthDate), ageAtCheckpoint: resolveCharacterAge(character, snapshot.gameDate).age,
      lifeStatus: life.conflict || life.alive == null ? "UNKNOWN" : life.alive ? "ALIVE" : "DEAD", deathDate: scalar(character.deathDate),
      culture: scalar(character.culture), faith: scalar(character.faith), location: scalar(character.location),
      courtEmployerId: scalar(character.courtEmployer), liegeId: scalar(character.liege),
      primaryTitleId: scalar(character.primaryTitleId) || ids(character.domainTitles)[0] || null, titleIds: ids(character.domainTitles), positions: ids(character.positions),
      fatherId: scalar(character.parents?.father), motherId: scalar(character.parents?.mother),
      childIds: ids([...(character.children || []), ...(childrenByParent.get(runtimeId) || [])]),
      siblingIds: ids(parents.flatMap(parent => [...(childrenByParent.get(parent) || [])])).filter(id => id !== runtimeId),
      spouseIds: character.spouse ? [String(character.spouse)] : [], friendIds: ids(character.friends), rivalIds: ids(character.rivals),
      realmRootId: roots.get(runtimeId) || null
    };
  }
  const titleRoot = id => {
    const seen = new Set();
    let current = id;
    while (snapshot.titles[current]) {
      if (seen.has(current)) return null;
      seen.add(current);
      const next = snapshot.titles[current].deFactoLiege;
      if (!next || String(next) === "0") return current;
      current = String(next);
    }
    return null;
  };
  const titles = Object.fromEntries(Object.entries(snapshot.titles).map(([titleId, title]) => [titleId, {
    titleId, rawKey: scalar(title.key), localizedName: scalar(title.displayName), holderId: scalar(title.holder),
    liegeTitleId: scalar(title.deFactoLiege), realmRootTitleId: titleRoot(titleId),
    rank: ({ h: "hegemony", e: "empire", k: "kingdom", d: "duchy", c: "county", b: "barony" })[title.key?.[0]] || null,
    government: scalar(title.government), historyRevision: digest(JSON.stringify(title.history || []))
  }]));
  const actor = value => {
    if (!value || typeof value !== "object") return null;
    if (value.type === "CHARACTER" && Object.hasOwn(characters, String(value.runtimeId))) {
      const runtimeId = String(value.runtimeId);
      return { type: "CHARACTER", runtimeId, titleId: null, factionId: null, displayName: characters[runtimeId].shortName || null,
        realmId: characters[runtimeId].realmRootId || null, provenance: scalar(value.provenance) || "CHECKPOINT_CHARACTER_SIDE" };
    }
    if (value.type === "TITLE" && Object.hasOwn(titles, String(value.titleId))) {
      const titleId = String(value.titleId);
      const title = titles[titleId];
      const holder = title.holderId && characters[title.holderId];
      return { type: "TITLE", runtimeId: null, titleId, factionId: null, displayName: title.localizedName || title.rawKey || null,
        realmId: holder?.realmRootId || title.realmRootTitleId || null, provenance: scalar(value.provenance) || "CHECKPOINT_TITLE_SIDE" };
    }
    if (value.type === "FACTION" && value.factionId) return { type: "FACTION", runtimeId: null, titleId: null, factionId: scalar(value.factionId), displayName: null, realmId: null, provenance: scalar(value.provenance) || "CHECKPOINT_FACTION_SIDE" };
    if (value.type === "UNKNOWN" && value.opaqueId) return { type: "UNKNOWN", runtimeId: null, titleId: null, factionId: null, opaqueId: scalar(value.opaqueId), displayName: null, realmId: null, provenance: scalar(value.provenance) || "CHECKPOINT_UNKNOWN_SIDE" };
    return null;
  };
  const actors = (structured, legacy) => {
    const values = Array.isArray(structured) && structured.length ? structured : ids(legacy).map(runtimeId => ({ type: "CHARACTER", runtimeId }));
    return values.map(actor).filter(Boolean);
  };
  const wars = Object.fromEntries(Object.entries(snapshot.wars).map(([warId, war]) => [warId, {
    warId, displayName: scalar(war.name), startDate: scalar(war.startDate), checkpointDate: snapshot.gameDate,
    status: war.endDate ? "ENDED" : "ACTIVE", attackerActors: actors(war.attackerActors, war.attacker), defenderActors: actors(war.defenderActors, war.defender),
    claimantId: scalar(war.claimantId), targetTitleIds: ids(war.targetTitleIds), warType: scalar(war.casusBelli),
    result: scalar(war.result), endDate: scalar(war.endDate), source: "CHECKPOINT_GAMESTATE"
  }]));
  const date = normalizeGameDate(snapshot.gameDate);
  return { schemaVersion: SCHEMA_VERSION, archiveRevision: 1, campaignId: scope.campaignId, branchId: scope.branchId,
    checkpointId: checkpoint.id, gameDate: date.canonical, totalDays: date.serial, year: date.year,
    playerId: scalar(snapshot.playerId), sourceFingerprint: checkpoint.source.fingerprint, projectionKind: "HISTORICAL_CHECKPOINT", characters, titles, wars };
}

module.exports = { SCHEMA_VERSION, digest, createHistoricalQueryProjection };
