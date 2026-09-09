"use strict";

const { buildKinshipGraph } = require("./character-kinship-graph");

const graphCache = new WeakMap();
const targetedGraphCache = new WeakMap();

function relationFingerprint(gameData) {
  const characters = gameData?.characters instanceof Map ? [...gameData.characters.values()] : Object.values(gameData?.characters || {});
  return characters.map((character) => [
    character?.id,
    ...["parents", "children", "siblings", "spouse", "spouses", "formerSpouses", "deceasedSpouses"].map((field) => JSON.stringify(character?.[field] ?? null)),
    character?.consort && typeof character.consort === "object" ? character.consort.id ?? character.consort.name : character?.consort || "",
    character?.alive,
    character?.deathDateTotalDays ?? character?.deathDate ?? ""
  ].join(":")).sort().join("|");
}

function revisionKey(gameData) {
  const explicitRevision = gameData?.contentFingerprint ?? gameData?.saveContentHash ?? gameData?.relationFingerprint;
  return [
    gameData?.campaignToken ?? gameData?.campaignId ?? "",
    gameData?.checkpointId ?? gameData?.currentCheckpoint?.id ?? "",
    gameData?.gameDataRevision ?? "",
    gameData?.structuralRevision ?? "",
    gameData?.participantRelationRevision ?? "",
    explicitRevision ?? relationFingerprint(gameData)
  ].join("|");
}

function referenceId(value) {
  const raw = value && typeof value === "object" ? value.id ?? value.runtimeId ?? value.characterId : value;
  return raw === null || raw === undefined || raw === "" ? null : String(raw);
}

function relatedIds(character = {}) {
  const values = [];
  const add = value => {
    for (const item of Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]) {
      const id = referenceId(item);
      if (id) values.push(id);
    }
  };
  if (Array.isArray(character.parents)) add(character.parents);
  else add(Object.values(character.parents || {}));
  for (const field of ["father", "mother", "children", "siblings", "spouse", "spouses", "formerSpouses", "deceasedSpouses", "consort"]) add(character[field]);
  for (const evidence of character?.evidence?.relations || []) add(evidence?.ownerId);
  return [...new Set(values)];
}

function getTargetedKinshipGraph(gameData, seedIds = [], { maxDepth = 3, maxNodes = 4096 } = {}) {
  if (!gameData || typeof gameData !== "object") return buildKinshipGraph({});
  const characters = gameData.characters instanceof Map ? gameData.characters : new Map(Object.entries(gameData.characters || {}));
  const seeds = [...new Set(seedIds.map(referenceId).filter(Boolean))].sort();
  const key = `${revisionKey(gameData)}:${seeds.join(",")}:${maxDepth}:${maxNodes}`;
  let cache = targetedGraphCache.get(gameData);
  if (!cache) { cache = new Map(); targetedGraphCache.set(gameData, cache); }
  if (cache.has(key)) return cache.get(key);
  const selected = new Map();
  const queue = seeds.map(id => ({ id, depth: 0 }));
  const visited = new Set();
  let truncated = false;
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    const character = characters.get(current.id) ?? characters.get(Number(current.id));
    if (!character) continue;
    selected.set(current.id, character);
    if (selected.size >= maxNodes) { truncated = queue.length > 0; break; }
    if (current.depth >= maxDepth) continue;
    for (const relatedId of relatedIds(character)) if (!visited.has(relatedId)) queue.push({ id: relatedId, depth: current.depth + 1 });
  }
  const graph = buildKinshipGraph(selected);
  graph.scopeTruncated = truncated;
  cache.set(key, graph);
  if (cache.size > 16) cache.delete(cache.keys().next().value);
  return graph;
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

module.exports = { getCachedKinshipGraph, getTargetedKinshipGraph, revisionKey };
