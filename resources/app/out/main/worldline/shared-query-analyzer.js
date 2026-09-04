"use strict";

const { findHistoricalAliases } = require("./historical-alias-catalog");
const { resolveHistoricalIdentity } = require("./historical-identity-resolver");

const MAX_QUERY_TERMS = 32;
const MAX_LOCALIZED_TERMS = 12;
const MAX_CHARACTER_RESULTS = 4;
const MAX_TITLE_RESULTS = 3;
const CJK_GENERIC_TERMS = new Set(["现在", "在哪", "哪里", "怎么", "为何", "什么", "是否", "是谁"]);

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
  for (const token of normalized.match(/[a-z0-9][a-z0-9_-]*/g) || []) if (token.length > 1 || /^\d+$/.test(token)) add(token);
  for (const run of normalized.match(/[\u3400-\u9fff\uf900-\ufaff]+/gu) || []) {
    for (let size = 2; size <= 4; size += 1) {
      for (let start = 0; start + size <= run.length; start += 1) add(run.slice(start, start + size));
    }
  }
  return terms;
}

function aliasMatches(alias, normalizedQuery, termSet) {
  const candidate = normalize(alias);
  return candidate.length >= 2 && (termSet.has(candidate) || normalizedQuery.includes(candidate));
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
  if (!text) return false;
  const anchors = Array.isArray(analysis?.entityAnchoredTerms) ? analysis.entityAnchoredTerms : [];
  if (anchors.length) return anchors.some((term) => text.includes(term));
  return (analysis?.terms || []).some((term) => !isCjk(term) && !CJK_GENERIC_TERMS.has(term) && term.length >= 3 && text.includes(term));
}

function emptyResolverTrace() {
  return {
    localization: { status: "NO_MATCH", sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] },
    historical: { status: "NO_MATCH", aliases: [], matchedDefinitionIds: [], matchedRuntimeIds: [], matchSources: [], resolutions: [] },
    runtime: { status: "NO_MATCH" }
  };
}

function normalizeReverseLookup(result) {
  if (Array.isArray(result)) return { status: result.length ? "MATCHED" : "NO_MATCH", matches: result, sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: result.map((item) => item.rawKey).filter(Boolean) };
  if (!result || typeof result !== "object") return { status: "NO_MATCH", matches: [], sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] };
  return { status: result.status || "NO_MATCH", matches: Array.isArray(result.matches) ? result.matches : [], sourceComplete: result.sourceComplete !== false, scannedFiles: Number(result.scannedFiles) || 0, missingDescriptors: Array.isArray(result.missingDescriptors) ? result.missingDescriptors : [], matchedRawKeys: Array.isArray(result.matchedRawKeys) ? result.matchedRawKeys : [] };
}

function analyzeSharedQuery({ snapshot, query = "", assistContext = "", mentionedEntityIds = [], localize = null, findLocalizedKeys = null, historicalDefinitionLookup = null } = {}) {
  const normalizedQuery = normalize(`${query}\n${assistContext}`);
  const terms = collectTerms(normalizedQuery);
  const termSet = new Set(terms);
  const characters = snapshot?.characters || {};
  const titles = snapshot?.titles || {};
  const resolvedCharacterIds = new Map();
  const resolvedTitleIds = new Map();
  const candidateCharacters = new Map();
  const candidateTitles = new Map();
  const candidateCharacterIds = new Set();
  const candidateTitleIds = new Set();
  const matchedAliases = new Set();
  const entityAnchoredTerms = new Set(terms.filter((term) => !isCjk(term) && !CJK_GENERIC_TERMS.has(term) && term.length >= 3));
  const resolverTrace = emptyResolverTrace();
  let exactEntityResolved = false;
  const manualHistoricalAliases = findHistoricalAliases(normalizedQuery, terms);
  const indexResults = typeof historicalDefinitionLookup === "function" ? terms.map((term) => [term, historicalDefinitionLookup(term) || {}]) : [];
  const indexedHistoricalAliases = indexResults.flatMap(([term, result]) => {
    if (result.status !== "FOUND") return [];
    return [{ alias: term, figureKey: null, definitionIds: result.candidates.map((candidate) => candidate.definitionId), candidateDefinitionIds: result.candidates.map((candidate) => candidate.definitionId), definitionRecords: result.candidates, indexStatus: result.status, sourceComplete: result.sourceComplete !== false && result.candidateSetComplete !== false }];
  });
  const cjkRuns = normalizedQuery.match(/[\u3400-\u9fff\uf900-\ufaff]+/gu) || [];
  const shortCjkQuery = cjkRuns.every((run) => run.length <= 4) && terms.filter((term) => isCjk(term) && term.length >= 2 && !CJK_GENERIC_TERMS.has(term)).sort((left, right) => right.length - left.length)[0] || null;
  const indexedTermSet = new Set(indexedHistoricalAliases.map((entry) => normalize(entry.alias)));
  const indexCoverage = shortCjkQuery && !indexedTermSet.has(normalize(shortCjkQuery)) ? indexResults.find(([term]) => term === shortCjkQuery)?.[1] : null;
  const historicalAliases = [...manualHistoricalAliases.map((entry) => ({ ...entry, sourceComplete: !historicalDefinitionLookup || indexResults.find(([term]) => term === normalize(entry.alias))?.[1]?.sourceComplete === true, definitionRecords: [] })), ...indexedHistoricalAliases].reduce((items, entry) => {
    const key = normalize(entry.alias);
    const existing = items.get(key);
    if (existing) {
      existing.figureKey ||= entry.figureKey;
      existing.definitionIds = [...new Set([...existing.definitionIds, ...entry.definitionIds])];
      existing.candidateDefinitionIds = [...new Set([...existing.candidateDefinitionIds, ...entry.candidateDefinitionIds])];
      existing.definitionRecords = [...new Map([...existing.definitionRecords, ...entry.definitionRecords].map((record) => [record.definitionId, record])).values()];
      existing.indexStatus = entry.indexStatus || existing.indexStatus;
      existing.sourceComplete &&= entry.sourceComplete !== false;
    } else items.set(key, { ...entry });
    return items;
  }, new Map()).values();
  const allHistoricalAliases = [...historicalAliases];
  const standaloneName = shortCjkQuery === normalizedQuery.trim() && ![...CJK_GENERIC_TERMS].some(term => shortCjkQuery?.includes(term));
  const historicalAliasList = allHistoricalAliases.filter(entry => (!standaloneName || normalize(entry.alias) === shortCjkQuery) && !allHistoricalAliases.some(other => other.alias.length > entry.alias.length && normalize(other.alias).includes(normalize(entry.alias))));
  const historicalAliasTerms = new Set(historicalAliasList.filter((entry) => entry.candidateDefinitionIds.length).map((entry) => normalize(entry.alias)));
  const isHistoricalTerm = term => [...historicalAliasTerms].some(alias => alias.includes(term));
  const resolvedHistoricalAliases = new Map();
  const addResolvedCharacter = (id, source, alias = null) => {
    const key = String(id);
    if (!characters[key]) return;
    candidateCharacterIds.add(key);
    if (resolvedCharacterIds.size >= MAX_CHARACTER_RESULTS && !resolvedCharacterIds.has(key)) return;
    const sources = resolvedCharacterIds.get(key) || new Set();
    sources.add(source);
    resolvedCharacterIds.set(key, sources);
    exactEntityResolved = true;
    if (alias) matchedAliases.add(normalize(alias));
  };
  const addCandidateCharacter = (candidate, source) => {
    const runtimeId = String(candidate?.runtimeId || candidate?.id || "");
    if (!runtimeId || !characters[runtimeId]) return;
    candidateCharacterIds.add(runtimeId);
    const key = `${runtimeId}:${candidate?.definitionId || source}`;
    if (candidateCharacters.has(key)) return;
    candidateCharacters.set(key, {
      runtimeId,
      definitionId: candidate?.definitionId || null,
      rawName: candidate?.rawName || characters[runtimeId].firstName || null,
      aliasCandidate: candidate?.aliasCandidate || null,
      score: candidate?.score !== null && candidate?.score !== undefined && Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
      evidence: Array.isArray(candidate?.evidence) ? candidate.evidence : [{ code: source }],
      conflicts: Array.isArray(candidate?.conflicts) ? candidate.conflicts : [],
      matchSources: [source]
    });
  };
  const addResolvedTitle = (id, source, alias = null) => {
    const key = String(id);
    if (!titles[key]) return;
    candidateTitleIds.add(key);
    if (resolvedTitleIds.size >= MAX_TITLE_RESULTS && !resolvedTitleIds.has(key)) return;
    const sources = resolvedTitleIds.get(key) || new Set();
    sources.add(source);
    resolvedTitleIds.set(key, sources);
    exactEntityResolved = true;
    if (alias) matchedAliases.add(normalize(alias));
  };
  const addCandidateTitle = (id, source, alias = null) => {
    const key = String(id);
    if (!titles[key]) return;
    candidateTitleIds.add(key);
    if (!candidateTitles.has(key)) candidateTitles.set(key, { id: key, rawKey: titles[key].key || `#${key}`, aliasCandidate: alias, matchSources: [source] });
  };

  for (const term of terms) {
    if (characters[term]) {
      addResolvedCharacter(term, "runtime_id", term);
      entityAnchoredTerms.add(term);
      resolverTrace.runtime.status = "MATCHED";
      continue;
    }
    const runtimeId = snapshot?.definitionToRuntime?.[term] || null;
    if (runtimeId) {
      addResolvedCharacter(runtimeId, "historical_definition_id", term);
      entityAnchoredTerms.add(term);
      resolverTrace.runtime.status = "MATCHED";
    }
    if (!isHistoricalTerm(term)) {
      const namedIds = snapshot?.nameToCharacterIds?.[term] || [];
      if (namedIds.length === 1) {
        addResolvedCharacter(namedIds[0], "character_alias", term);
        entityAnchoredTerms.add(term);
      } else for (const id of namedIds) addCandidateCharacter({ runtimeId: id, rawName: characters[id]?.firstName, aliasCandidate: term }, "character_alias_ambiguous");
    }
  }
  for (const title of Object.values(titles)) {
    if (aliasMatches(title.key, normalizedQuery, termSet)) {
      addResolvedTitle(title.id, "title_alias", title.key);
      entityAnchoredTerms.add(normalize(title.key));
    }
  }

  const historicalResolutions = historicalAliasList.map((entry) => {
    resolverTrace.historical.aliases.push(entry.alias);
    resolverTrace.historical.matchedDefinitionIds.push(...entry.definitionIds);
    for (const definitionId of entry.definitionIds) {
      const runtimeId = snapshot?.definitionToRuntime?.[definitionId] || null;
      if (!runtimeId) continue;
      resolverTrace.historical.matchedRuntimeIds.push(String(runtimeId));
      resolverTrace.historical.matchSources.push({ alias: entry.alias, definitionId, runtimeId: String(runtimeId), source: entry.indexStatus === "FOUND" ? "historical_definition_index" : "historical_alias_override" });
    }
    const resolution = resolveHistoricalIdentity({ alias: entry.alias, figureKey: entry.figureKey, candidateDefinitionIds: entry.candidateDefinitionIds, definitionRecords: entry.definitionRecords, snapshot });
    if (entry.sourceComplete === false) Object.assign(resolution, { status: "REJECTED", resolvedRuntimeId: null, reason: "SOURCE_INCOMPLETE" });
    resolverTrace.historical.resolutions.push({ alias: entry.alias, figureKey: entry.figureKey, status: resolution.status, reason: resolution.reason, resolvedRuntimeId: resolution.resolvedRuntimeId || null });
    matchedAliases.add(normalize(entry.alias));
    entityAnchoredTerms.add(normalize(entry.alias));
    if (resolution.status === "RESOLVED" && resolution.resolvedRuntimeId) {
      addResolvedCharacter(resolution.resolvedRuntimeId, "historical_identity_resolved", entry.alias);
      resolvedHistoricalAliases.set(String(resolution.resolvedRuntimeId), entry.alias);
      resolverTrace.runtime.status = "MATCHED";
    } else for (const candidate of resolution.candidates) addCandidateCharacter(candidate, "historical_alias_candidate");
    const coverageStatus = entry.sourceComplete === false ? "SOURCE_INCOMPLETE" : entry.definitionRecords?.length && !resolution.candidates.length ? "DEFINITION_FOUND_RUNTIME_MISSING" : resolution.status === "REJECTED" ? "REJECTED_BY_EVIDENCE" : resolution.status;
    return { alias: entry.alias, figureKey: entry.figureKey, coverageStatus, definitionIds: entry.candidateDefinitionIds, ...resolution };
  });
  const primaryHistoricalResolution = historicalResolutions[0];
  const historicalRuntimeIds = new Set(historicalResolutions.flatMap(resolution => (resolution.candidates || []).map(candidate => String(candidate.runtimeId))));
  for (const id of mentionedEntityIds) if (!historicalRuntimeIds.has(String(id)) && !historicalResolutions.some(resolution => resolution.coverageStatus === "SOURCE_INCOMPLETE")) addResolvedCharacter(id, "shared_memory_entity");
  const identityResolution = historicalResolutions.length === 0 ? { status: "NO_MATCH", reason: "NO_HISTORICAL_ALIAS", evidence: [], candidates: [] } : historicalResolutions.some((resolution) => resolution.status === "AMBIGUOUS") ? { status: "AMBIGUOUS", reason: "MULTIPLE_CANDIDATES", evidence: historicalResolutions.flatMap((resolution) => resolution.evidence || []), candidates: historicalResolutions.flatMap((resolution) => resolution.candidates || []) } : primaryHistoricalResolution.status === "RESOLVED" ? primaryHistoricalResolution : { status: "NO_MATCH", reason: primaryHistoricalResolution.reason, evidence: primaryHistoricalResolution.evidence || [], candidates: primaryHistoricalResolution.candidates || [] };
  const historicalCoverage = historicalResolutions.map((resolution) => ({ alias: resolution.alias, status: resolution.coverageStatus, definitionIds: resolution.definitionIds, reason: resolution.reason }));
  if (indexCoverage && ["SOURCE_INCOMPLETE", "NAME_INDEX_MISS"].includes(indexCoverage.status)) historicalCoverage.push({ alias: shortCjkQuery, status: indexCoverage.status, definitionIds: [], reason: indexCoverage.status });
  if (historicalResolutions.length) resolverTrace.historical.status = identityResolution.status;
  else if (historicalCoverage.length) resolverTrace.historical.status = historicalCoverage[0].status;

  const localizedTerms = exactEntityResolved ? [] : terms.filter(term => isCjk(term) && !isHistoricalTerm(term)).slice(0, MAX_LOCALIZED_TERMS);
  if (resolverTrace.historical.matchedRuntimeIds.length) resolverTrace.localization.status = "NOT_REQUIRED_HISTORICAL_MATCH";
  else if (exactEntityResolved) resolverTrace.localization.status = "NOT_REQUIRED_ENTITY_MATCH";
  else if (typeof findLocalizedKeys === "function") {
    let characterLookupAvailable = true;
    let titleLookupAvailable = true;
    let localizedIdentityMatched = false;
    const recordLookup = (type, lookup, term) => {
      resolverTrace.localization.status = resolverTrace.localization.status === "INCOMPLETE_SOURCE_SCAN" || lookup.status === "INCOMPLETE_SOURCE_SCAN" ? "INCOMPLETE_SOURCE_SCAN" : lookup.status === "CONFLICT" ? "CONFLICT" : resolverTrace.localization.status === "MATCHED" || lookup.status === "MATCHED" ? "MATCHED" : resolverTrace.localization.status;
      resolverTrace.localization.sourceComplete &&= lookup.sourceComplete;
      resolverTrace.localization.scannedFiles += lookup.scannedFiles;
      resolverTrace.localization.missingDescriptors.push(...lookup.missingDescriptors);
      resolverTrace.localization.matchedRawKeys.push(...lookup.matchedRawKeys);
      let matched = false;
      if (type === "character") {
        for (const match of lookup.status === "MATCHED" ? lookup.matches : []) {
          const ids = snapshot?.nameToCharacterIds?.[normalize(match.rawKey)] || [];
          if (ids.length === 1) {
            addResolvedCharacter(ids[0], "localized_character_name", term);
            entityAnchoredTerms.add(term);
            matched = true;
          } else for (const id of ids) addCandidateCharacter({ runtimeId: id, rawName: characters[id]?.firstName, aliasCandidate: term }, "localized_character_ambiguous");
        }
      } else {
        const matches = [];
        for (const match of lookup.status === "MATCHED" || lookup.status === "PREFIX_MATCHES" ? lookup.matches : []) {
          for (const title of Object.values(titles)) if (normalize(title.key) === normalize(match.rawKey)) matches.push(title);
        }
        const uniqueTitles = [...new Map(matches.map((title) => [String(title.id), title])).values()];
        if (lookup.status === "PREFIX_MATCHES" && uniqueTitles.length > 1) {
          resolverTrace.localization.status = "CONFLICT";
          for (const title of uniqueTitles) addCandidateTitle(title.id, "localized_title_prefix_ambiguous", term);
        } else {
          if (lookup.status === "PREFIX_MATCHES" && uniqueTitles.length === 1) resolverTrace.localization.status = "MATCHED";
          for (const title of uniqueTitles) {
            addResolvedTitle(title.id, lookup.status === "PREFIX_MATCHES" ? "localized_title_prefix" : "localized_title_name", term);
            entityAnchoredTerms.add(term);
            matched = true;
          }
        }
      }
      return matched;
    };
    for (const term of localizedTerms) {
      let characterLookup = null;
      let titleLookup = null;
      if (characterLookupAvailable) {
        characterLookup = normalizeReverseLookup(findLocalizedKeys("character", term, { typedOnly: true }));
        localizedIdentityMatched = recordLookup("character", characterLookup, term) || localizedIdentityMatched;
        if (["INCOMPLETE_SOURCE_SCAN", "MATCHED", "CONFLICT"].includes(characterLookup.status)) characterLookupAvailable = false;
      }
      if (titleLookupAvailable) {
        titleLookup = normalizeReverseLookup(findLocalizedKeys("title", term, { typedOnly: true }));
        localizedIdentityMatched = recordLookup("title", titleLookup, term) || localizedIdentityMatched;
        if (["INCOMPLETE_SOURCE_SCAN", "MATCHED", "CONFLICT"].includes(titleLookup.status)) titleLookupAvailable = false;
      }
      if (!localizedIdentityMatched && term.length >= 2 && titleLookup?.status !== "INCOMPLETE_SOURCE_SCAN" && titleLookup?.status !== "CONFLICT") {
        const prefixLookup = normalizeReverseLookup(findLocalizedKeys("title", term, { typedOnly: true, matchMode: "prefix" }));
        localizedIdentityMatched = recordLookup("title", prefixLookup, term) || localizedIdentityMatched;
        if (localizedIdentityMatched || prefixLookup.status === "CONFLICT") titleLookupAvailable = false;
      }
      if (!localizedIdentityMatched && characterLookup?.status === "NO_MATCH_TYPED" && titleLookup?.status === "NO_MATCH_TYPED") {
        const fallbackCharacterLookup = normalizeReverseLookup(findLocalizedKeys("character", term));
        const characterMatched = recordLookup("character", fallbackCharacterLookup, term);
        localizedIdentityMatched = characterMatched || localizedIdentityMatched;
        if (["INCOMPLETE_SOURCE_SCAN", "MATCHED", "CONFLICT"].includes(fallbackCharacterLookup.status)) characterLookupAvailable = false;
        if (!characterMatched) {
          const fallbackTitleLookup = normalizeReverseLookup(findLocalizedKeys("title", term));
          localizedIdentityMatched = recordLookup("title", fallbackTitleLookup, term) || localizedIdentityMatched;
          if (["INCOMPLETE_SOURCE_SCAN", "MATCHED", "CONFLICT"].includes(fallbackTitleLookup.status)) titleLookupAvailable = false;
        }
      }
    }
  }

  resolverTrace.localization.missingDescriptors = [...new Set(resolverTrace.localization.missingDescriptors)];
  resolverTrace.localization.matchedRawKeys = [...new Set(resolverTrace.localization.matchedRawKeys)];
  resolverTrace.historical.aliases = [...new Set(resolverTrace.historical.aliases)];
  resolverTrace.historical.matchedDefinitionIds = [...new Set(resolverTrace.historical.matchedDefinitionIds)];
  resolverTrace.historical.matchedRuntimeIds = [...new Set(resolverTrace.historical.matchedRuntimeIds)];
  const resolvedCharacters = [...resolvedCharacterIds.entries()].map(([id, sources]) => {
    const character = characters[id];
    const rawKey = character.firstName || `#${id}`;
    const localization = needsLocalizationLookup(rawKey) ? localizedReference("character", rawKey, localize) : null;
    return { id, rawKey, displayName: resolvedHistoricalAliases.get(id) || localization?.localizedValue || character.fullName || rawKey, aliases: [character.firstName, id, `#${id}`, ...(snapshot?.runtimeToDefinitions?.[id] || [])].filter(Boolean), matchSources: [...sources] };
  });
  const resolvedTitles = [...resolvedTitleIds.entries()].map(([id, sources]) => {
    const title = titles[id];
    const localization = localizedReference("title", title.key, localize);
    return { id, rawKey: title.key || `#${id}`, displayName: localization?.localizedValue || title.key || `#${id}`, holderId: title.holder || null, matchSources: [...sources] };
  });
  return {
    normalizedQuery,
    terms,
    entityAnchoredTerms: [...entityAnchoredTerms],
    genericTerms: terms.filter((term) => CJK_GENERIC_TERMS.has(term)),
    characters: resolvedCharacters,
    titles: resolvedTitles,
    resolvedCharacters,
    candidateCharacters: [...candidateCharacters.values()],
    resolvedTitles,
    candidateTitles: [...candidateTitles.values()],
    identityResolution,
    historicalCoverage,
    historicalPending: indexResults.some(([, result]) => result.pending === true),
    matchedAliases: [...matchedAliases].filter(Boolean),
    candidateCharacterIds: [...candidateCharacterIds],
    candidateTitleIds: [...candidateTitleIds],
    resolverTrace,
    limits: { maxCharacters: MAX_CHARACTER_RESULTS, maxTitles: MAX_TITLE_RESULTS }
  };
}

module.exports = { analysisTextMatches, analyzeSharedQuery, collectTerms };
