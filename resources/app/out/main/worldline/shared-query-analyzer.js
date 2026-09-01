"use strict";

const MAX_QUERY_TERMS = 32;
const MAX_LOCALIZED_TERMS = 12;
const MAX_CHARACTER_RESULTS = 4;
const MAX_TITLE_RESULTS = 3;

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function isCjk(value) {
  return /^[\u3400-\u9fff\uf900-\ufaff]+$/u.test(value);
}

function collectTerms(text) {
  const normalized = normalize(text);
  const terms = [];
  const seen = new Set();
  const add = (value) => {
    const term = normalize(value);
    if (!term || seen.has(term) || terms.length >= MAX_QUERY_TERMS) return;
    seen.add(term);
    terms.push(term);
  };
  for (const token of normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) || []) add(token);
  for (const run of normalized.match(/[\u3400-\u9fff\uf900-\ufaff]+/gu) || []) {
    for (let size = 2; size <= 4; size += 1) {
      for (let start = 0; start + size <= run.length; start += 1) add(run.slice(start, start + size));
    }
  }
  return terms;
}

function aliasMatches(alias, normalizedQuery, termSet) {
  const candidate = normalize(alias);
  if (!candidate || candidate.length < 2) return false;
  return termSet.has(candidate) || normalizedQuery.includes(candidate);
}

function localizedReference(type, rawKey, localize) {
  if (!rawKey || typeof localize !== "function") return null;
  try {
    const result = localize(type, rawKey);
    return result && typeof result === "object" ? result : null;
  } catch (_error) {
    return null;
  }
}

function analysisTextMatches(analysis, value) {
  const text = normalize(value);
  if (!text || !analysis?.terms?.length) return false;
  return analysis.terms.some((term) => text.includes(term)) || (analysis.matchedAliases || []).some((alias) => text.includes(alias));
}

function analyzeSharedQuery({ snapshot, query = "", assistContext = "", mentionedEntityIds = [], localize = null, findLocalizedKeys = null } = {}) {
  const normalizedQuery = normalize(`${query}\n${assistContext}`);
  const terms = collectTerms(normalizedQuery);
  const termSet = new Set(terms);
  const characters = snapshot?.characters || {};
  const titles = snapshot?.titles || {};
  const characterIds = new Map();
  const titleIds = new Map();
  const candidateCharacterIds = new Set();
  const candidateTitleIds = new Set();
  const matchedAliases = new Set();
  const addCharacter = (id, source, alias = null) => {
    const key = String(id);
    if (!characters[key]) return;
    candidateCharacterIds.add(key);
    if (characterIds.size >= MAX_CHARACTER_RESULTS && !characterIds.has(key)) return;
    const sources = characterIds.get(key) || new Set();
    sources.add(source);
    characterIds.set(key, sources);
    if (alias) matchedAliases.add(normalize(alias));
  };
  const addTitle = (id, source, alias = null) => {
    const key = String(id);
    if (!titles[key]) return;
    candidateTitleIds.add(key);
    if (titleIds.size >= MAX_TITLE_RESULTS && !titleIds.has(key)) return;
    const sources = titleIds.get(key) || new Set();
    sources.add(source);
    titleIds.set(key, sources);
    if (alias) matchedAliases.add(normalize(alias));
  };

  for (const term of terms) {
    if (characters[term]) addCharacter(term, "runtime_id", term);
    if (/^\d+$/.test(term) && characters[term]) addCharacter(term, "runtime_id", term);
    for (const id of snapshot?.nameToCharacterIds?.[term] || []) addCharacter(id, "character_alias", term);
    const runtimeId = snapshot?.definitionToRuntime?.[term] || null;
    if (runtimeId) addCharacter(runtimeId, "historical_definition_id", term);
  }
  for (const id of mentionedEntityIds) addCharacter(id, "shared_memory_entity");

  for (const title of Object.values(titles)) {
    if (aliasMatches(title.key, normalizedQuery, termSet)) addTitle(title.id, "title_alias", title.key);
  }

  const localizedTerms = terms.filter(isCjk).slice(0, MAX_LOCALIZED_TERMS);
  if (typeof findLocalizedKeys === "function") {
    for (const term of localizedTerms) {
      for (const match of findLocalizedKeys("character", term) || []) {
        for (const id of snapshot?.nameToCharacterIds?.[normalize(match.rawKey)] || []) addCharacter(id, "localized_character_name", term);
      }
      for (const match of findLocalizedKeys("title", term) || []) {
        for (const title of Object.values(titles)) {
          if (normalize(title.key) === normalize(match.rawKey)) addTitle(title.id, "localized_title_name", term);
        }
      }
    }
  }

  const characterMatches = [...characterIds.entries()].map(([id, sources]) => {
    const character = characters[id];
    const definitions = snapshot?.runtimeToDefinitions?.[id] || [];
    const localization = localizedReference("character", character.firstName, localize);
    return {
      id,
      rawKey: character.firstName || `#${id}`,
      displayName: localization?.localizedValue || character.firstName || `#${id}`,
      aliases: [character.firstName, id, `#${id}`, ...definitions].filter(Boolean),
      matchSources: [...sources]
    };
  });
  const titleMatches = [...titleIds.entries()].map(([id, sources]) => {
    const title = titles[id];
    const localization = localizedReference("title", title.key, localize);
    return {
      id,
      rawKey: title.key || `#${id}`,
      displayName: localization?.localizedValue || title.key || `#${id}`,
      holderId: title.holder || null,
      matchSources: [...sources]
    };
  });
  return {
    normalizedQuery,
    terms,
    characters: characterMatches,
    titles: titleMatches,
    matchedAliases: [...matchedAliases].filter(Boolean),
    candidateCharacterIds: [...candidateCharacterIds],
    candidateTitleIds: [...candidateTitleIds],
    limits: {
      maxCharacters: MAX_CHARACTER_RESULTS,
      maxTitles: MAX_TITLE_RESULTS
    }
  };
}

module.exports = { analysisTextMatches, analyzeSharedQuery, collectTerms };
