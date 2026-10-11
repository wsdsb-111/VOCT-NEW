"use strict";

const { figures } = require("../historical-system/historical-data/figures");

// Only definition IDs confirmed by the V8.4 save exploration may enter this
// catalog. Names and localization display values never manufacture identity.
const canonicalNames = new Map(figures.map((figure) => [figure.figureKey, figure.identity.name]));
const candidateDefinitions = [
  { figureKey: "yue_fei", additionalAliases: ["岳武穆"], candidateDefinitionIds: ["nansong_yue_085", "tangyin_yue_014"] },
  { figureKey: "xin_qiji", additionalAliases: [], candidateDefinitionIds: ["han_12371", "licheng_xin_006"] }
];
const HISTORICAL_ALIAS_CATALOG = Object.freeze(candidateDefinitions.map((entry) => Object.freeze({
  figureKey: entry.figureKey,
  aliases: Object.freeze([canonicalNames.get(entry.figureKey), ...entry.additionalAliases].filter(Boolean)),
  candidateDefinitionIds: Object.freeze(entry.candidateDefinitionIds)
})));

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function findHistoricalAliases(normalizedQuery, terms = []) {
  const termSet = new Set((Array.isArray(terms) ? terms : []).map(normalize));
  return HISTORICAL_ALIAS_CATALOG.flatMap((entry) => entry.aliases.filter((alias) => {
    const normalizedAlias = normalize(alias);
    return termSet.has(normalizedAlias) || String(normalizedQuery || "").includes(normalizedAlias);
  }).map((alias) => ({ alias, figureKey: entry.figureKey, definitionIds: [...entry.candidateDefinitionIds], candidateDefinitionIds: [...entry.candidateDefinitionIds] })));
}

module.exports = { HISTORICAL_ALIAS_CATALOG, findHistoricalAliases };
