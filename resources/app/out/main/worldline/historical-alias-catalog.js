"use strict";

// Only definition IDs confirmed by the V8.4 save exploration may enter this
// catalog. Names and localization display values never manufacture identity.
const HISTORICAL_ALIAS_CATALOG = Object.freeze([
  Object.freeze({ alias: "岳飞", definitionIds: Object.freeze(["nansong_yue_085", "tangyin_yue_014"]) }),
  Object.freeze({ alias: "岳武穆", definitionIds: Object.freeze(["nansong_yue_085", "tangyin_yue_014"]) }),
  Object.freeze({ alias: "辛弃疾", definitionIds: Object.freeze(["han_12371", "licheng_xin_006"]) })
]);

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function findHistoricalAliases(normalizedQuery, terms = []) {
  const termSet = new Set((Array.isArray(terms) ? terms : []).map(normalize));
  return HISTORICAL_ALIAS_CATALOG.filter((entry) => {
    const alias = normalize(entry.alias);
    return termSet.has(alias) || String(normalizedQuery || "").includes(alias);
  }).map((entry) => ({ alias: entry.alias, definitionIds: [...entry.definitionIds] }));
}

module.exports = { HISTORICAL_ALIAS_CATALOG, findHistoricalAliases };
