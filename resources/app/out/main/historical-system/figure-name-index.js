"use strict";

function normalizeHistoricalName(value) {
  if (typeof value !== "string") return "";
  return value
    .split("\u0015")[0]
    .replace(/<[^>]*>/g, "")
    .replace(/\u3000/g, " ")
    .replace(/[\s·•・，,。.!！?？;；:：'"“”‘’()（）\[\]【】]/g, "")
    .toLocaleLowerCase("zh-CN");
}

function buildFigureNameIndex(characters) {
  const index = new Map();
  for (const character of characters || []) {
    const names = [character?.names?.shortName, character?.names?.fullName, character?.names?.firstName, ...(character?.names?.canonicalNames || [])];
    for (const name of names) {
      const normalized = normalizeHistoricalName(name);
      if (!normalized) continue;
      if (!index.has(normalized)) index.set(normalized, new Map());
      index.get(normalized).set(character.id, character);
    }
  }
  return index;
}

function findFigureCandidates(figure, index) {
  const candidates = new Map();
  const collect = (name, nameCode, weight) => {
    const normalized = normalizeHistoricalName(name);
    for (const character of index.get(normalized)?.values() || []) {
      const existing = candidates.get(character.id);
      if (!existing || weight > existing.nameEvidence.weight) candidates.set(character.id, { character, nameEvidence: { code: nameCode, weight } });
    }
  };
  collect(figure?.identity?.name, "NAME_EXACT", 0.55);
  for (const alias of figure?.identity?.aliases || []) collect(alias, "NAME_ALIAS", 0.45);
  return [...candidates.values()];
}

module.exports = { normalizeHistoricalName, buildFigureNameIndex, findFigureCandidates };
