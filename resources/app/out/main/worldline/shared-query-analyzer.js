"use strict";

const { findHistoricalAliases } = require("./historical-alias-catalog");

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

function needsLocalizationLookup(rawKey) {
  return /^[a-z0-9_.:-]+$/i.test(String(rawKey || ""));
}

function analysisTextMatches(analysis, value) {
  const text = normalize(value);
  if (!text || !analysis?.terms?.length) return false;
  return analysis.terms.some((term) => text.includes(term)) || (analysis.matchedAliases || []).some((alias) => text.includes(alias));
}

function emptyResolverTrace() {
  return {
    localization: { status: "NO_MATCH", sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] },
    historical: { status: "NO_MATCH", aliases: [], matchedDefinitionIds: [], matchedRuntimeIds: [], matchSources: [] },
    runtime: { status: "NO_MATCH" }
  };
}

function normalizeReverseLookup(result) {
  if (Array.isArray(result)) return { status: result.length ? "MATCHED" : "NO_MATCH", matches: result, sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: result.map((item) => item.rawKey).filter(Boolean) };
  if (!result || typeof result !== "object") return { status: "NO_MATCH", matches: [], sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] };
  return { status: result.status || "NO_MATCH", matches: Array.isArray(result.matches) ? result.matches : [], sourceComplete: result.sourceComplete !== false, scannedFiles: Number(result.scannedFiles) || 0, missingDescriptors: Array.isArray(result.missingDescriptors) ? result.missingDescriptors : [], matchedRawKeys: Array.isArray(result.matchedRawKeys) ? result.matchedRawKeys : [] };
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
  const resolverTrace = emptyResolverTrace();
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
    if (characters[term]) {
      addCharacter(term, "runtime_id", term);
      resolverTrace.runtime.status = "MATCHED";
    }
    if (/^\d+$/.test(term) && characters[term]) {
      addCharacter(term, "runtime_id", term);
      resolverTrace.runtime.status = "MATCHED";
    }
    for (const id of snapshot?.nameToCharacterIds?.[term] || []) addCharacter(id, "character_alias", term);
    const runtimeId = snapshot?.definitionToRuntime?.[term] || null;
    if (runtimeId) {
      addCharacter(runtimeId, "historical_definition_id", term);
      resolverTrace.runtime.status = "MATCHED";
    }
  }
  for (const id of mentionedEntityIds) addCharacter(id, "shared_memory_entity");

  for (const title of Object.values(titles)) {
    if (aliasMatches(title.key, normalizedQuery, termSet)) addTitle(title.id, "title_alias", title.key);
  }

  const historicalAliases = findHistoricalAliases(normalizedQuery, terms);
  for (const entry of historicalAliases) {
    resolverTrace.historical.aliases.push(entry.alias);
    resolverTrace.historical.matchedDefinitionIds.push(...entry.definitionIds);
    for (const definitionId of entry.definitionIds) {
      const runtimeId = snapshot?.definitionToRuntime?.[definitionId] || null;
      if (runtimeId) {
        addCharacter(runtimeId, "historical_alias", entry.alias);
        resolverTrace.historical.matchedRuntimeIds.push(String(runtimeId));
        resolverTrace.historical.matchSources.push({ alias: entry.alias, definitionId, runtimeId: String(runtimeId), source: "historical_alias_catalog" });
        resolverTrace.runtime.status = "MATCHED";
      }
    }
  }
  if (resolverTrace.historical.aliases.length) resolverTrace.historical.status = resolverTrace.historical.matchedDefinitionIds.length > 1 ? "AMBIGUOUS" : resolverTrace.historical.matchedRuntimeIds.length ? "MATCHED" : "NO_RUNTIME_MATCH";

  const localizedTerms = terms.filter(isCjk).slice(0, MAX_LOCALIZED_TERMS);
  if (resolverTrace.historical.matchedRuntimeIds.length) {
    resolverTrace.localization.status = "NOT_REQUIRED_HISTORICAL_MATCH";
  } else if (typeof findLocalizedKeys === "function") {
    let characterLookupAvailable = true;
    let titleLookupAvailable = true;
    let localizedIdentityMatched = false;
    const recordLookup = (type, lookup, term) => {
      resolverTrace.localization.status = resolverTrace.localization.status === "INCOMPLETE_SOURCE_SCAN" || lookup.status === "INCOMPLETE_SOURCE_SCAN" ? "INCOMPLETE_SOURCE_SCAN" : lookup.status === "CONFLICT" ? "CONFLICT" : resolverTrace.localization.status === "MATCHED" || lookup.status === "MATCHED" ? "MATCHED" : resolverTrace.localization.status;
      resolverTrace.localization.sourceComplete &&= lookup.sourceComplete;
      resolverTrace.localization.scannedFiles += lookup.scannedFiles;
      resolverTrace.localization.missingDescriptors.push(...lookup.missingDescriptors);
      resolverTrace.localization.matchedRawKeys.push(...lookup.matchedRawKeys);
      const before = type === "character" ? candidateCharacterIds.size : candidateTitleIds.size;
      if (type === "character") {
        for (const match of lookup.status === "MATCHED" ? lookup.matches : []) {
          for (const id of snapshot?.nameToCharacterIds?.[normalize(match.rawKey)] || []) addCharacter(id, "localized_character_name", term);
        }
      } else {
        const matchingTitles = [];
        for (const match of lookup.status === "MATCHED" || lookup.status === "PREFIX_MATCHES" ? lookup.matches : []) {
          for (const title of Object.values(titles)) {
            if (normalize(title.key) === normalize(match.rawKey)) matchingTitles.push(title);
          }
        }
        const uniqueMatchingTitles = [...new Map(matchingTitles.map((title) => [String(title.id), title])).values()];
        if (lookup.status === "PREFIX_MATCHES" && uniqueMatchingTitles.length > 1) resolverTrace.localization.status = "CONFLICT";
        else {
          if (lookup.status === "PREFIX_MATCHES" && uniqueMatchingTitles.length === 1) resolverTrace.localization.status = "MATCHED";
          for (const title of uniqueMatchingTitles) addTitle(title.id, lookup.status === "PREFIX_MATCHES" ? "localized_title_prefix" : "localized_title_name", term);
        }
      }
      const after = type === "character" ? candidateCharacterIds.size : candidateTitleIds.size;
      return after > before;
    };
    for (const term of localizedTerms) {
      let characterLookup = null;
      let titleLookup = null;
      if (characterLookupAvailable) {
        characterLookup = normalizeReverseLookup(findLocalizedKeys("character", term, { typedOnly: true }));
        localizedIdentityMatched = recordLookup("character", characterLookup, term) || localizedIdentityMatched;
        if (characterLookup.status === "INCOMPLETE_SOURCE_SCAN" || characterLookup.status === "MATCHED" || characterLookup.status === "CONFLICT") characterLookupAvailable = false;
      }
      if (titleLookupAvailable) {
        titleLookup = normalizeReverseLookup(findLocalizedKeys("title", term, { typedOnly: true }));
        localizedIdentityMatched = recordLookup("title", titleLookup, term) || localizedIdentityMatched;
        if (titleLookup.status === "INCOMPLETE_SOURCE_SCAN" || titleLookup.status === "MATCHED" || titleLookup.status === "CONFLICT") titleLookupAvailable = false;
      }
      if (!localizedIdentityMatched && term.length >= 2 && titleLookup?.status !== "INCOMPLETE_SOURCE_SCAN" && titleLookup?.status !== "CONFLICT") {
        const prefixTitleLookup = normalizeReverseLookup(findLocalizedKeys("title", term, { typedOnly: true, matchMode: "prefix" }));
        localizedIdentityMatched = recordLookup("title", prefixTitleLookup, term) || localizedIdentityMatched;
        if (localizedIdentityMatched || prefixTitleLookup.status === "CONFLICT") titleLookupAvailable = false;
      }
      if (!localizedIdentityMatched && characterLookup?.status === "NO_MATCH_TYPED" && titleLookup?.status === "NO_MATCH_TYPED") {
        const fallbackCharacterLookup = normalizeReverseLookup(findLocalizedKeys("character", term));
        const characterMatched = recordLookup("character", fallbackCharacterLookup, term);
        localizedIdentityMatched = characterMatched || localizedIdentityMatched;
        if (fallbackCharacterLookup.status === "INCOMPLETE_SOURCE_SCAN" || fallbackCharacterLookup.status === "MATCHED" || fallbackCharacterLookup.status === "CONFLICT") characterLookupAvailable = false;
        if (!characterMatched) {
          const fallbackTitleLookup = normalizeReverseLookup(findLocalizedKeys("title", term));
          localizedIdentityMatched = recordLookup("title", fallbackTitleLookup, term) || localizedIdentityMatched;
          if (fallbackTitleLookup.status === "INCOMPLETE_SOURCE_SCAN" || fallbackTitleLookup.status === "MATCHED" || fallbackTitleLookup.status === "CONFLICT") titleLookupAvailable = false;
        }
      }
    }
  }

  resolverTrace.localization.missingDescriptors = [...new Set(resolverTrace.localization.missingDescriptors)];
  resolverTrace.localization.matchedRawKeys = [...new Set(resolverTrace.localization.matchedRawKeys)];
  resolverTrace.historical.aliases = [...new Set(resolverTrace.historical.aliases)];
  resolverTrace.historical.matchedDefinitionIds = [...new Set(resolverTrace.historical.matchedDefinitionIds)];
  resolverTrace.historical.matchedRuntimeIds = [...new Set(resolverTrace.historical.matchedRuntimeIds)];

  const characterMatches = [...characterIds.entries()].map(([id, sources]) => {
    const character = characters[id];
    const definitions = snapshot?.runtimeToDefinitions?.[id] || [];
    const rawKey = character.firstName || `#${id}`;
    const localization = needsLocalizationLookup(rawKey) ? localizedReference("character", rawKey, localize) : null;
    const historicalDisplayName = sources.has("historical_alias") ? resolverTrace.historical.aliases[0] : null;
    return {
      id,
      rawKey,
      displayName: historicalDisplayName || localization?.localizedValue || character.fullName || rawKey,
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
    resolverTrace,
    limits: {
      maxCharacters: MAX_CHARACTER_RESULTS,
      maxTitles: MAX_TITLE_RESULTS
    }
  };
}

module.exports = { analysisTextMatches, analyzeSharedQuery, collectTerms };
