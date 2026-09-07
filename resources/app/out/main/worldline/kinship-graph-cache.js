"use strict";

const { buildKinshipGraph } = require("./character-kinship-graph");

const graphCache = new WeakMap();

function relationFingerprint(gameData) {
  const characters = gameData?.characters instanceof Map ? [...gameData.characters.values()] : Object.values(gameData?.characters || {});
  return characters.map((character) => [
    character?.id,
    ...["parents", "children", "siblings"].map((field) => (character?.[field] || []).map((entry) => entry?.id ?? entry).join(",")),
    character?.consort && typeof character.consort === "object" ? character.consort.id ?? character.consort.name : character?.consort || "",
    character?.alive,
    character?.deathDateTotalDays ?? character?.deathDate ?? ""
  ].join(":")).sort().join("|");
}

function revisionKey(gameData) {
  return [
    gameData?.campaignToken ?? gameData?.campaignId ?? "",
    gameData?.checkpointId ?? gameData?.currentCheckpoint?.id ?? "",
    gameData?.gameDataRevision ?? "",
    gameData?.totalDays ?? "",
    gameData?.participantRelationRevision ?? relationFingerprint(gameData)
  ].join("|");
}

function getCachedKinshipGraph(gameData) {
  if (!gameData || typeof gameData !== "object") return buildKinshipGraph({});
  const key = revisionKey(gameData);
  const cached = graphCache.get(gameData);
  if (cached?.key === key) return cached.graph;
  const profiles = typeof gameData.getMentionableCharacterProfiles === "function" ? gameData.getMentionableCharacterProfiles() : gameData.characters;
  const graph = buildKinshipGraph(profiles);
  graphCache.set(gameData, { key, graph });
  return graph;
}

module.exports = { getCachedKinshipGraph, revisionKey };
