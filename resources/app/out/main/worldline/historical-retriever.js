"use strict";

const crypto = require("crypto");
const { HistoricalCheckpointIndex } = require("./historical-checkpoint-index");
const { normalizeGameDate } = require("./character-temporal-facts");
const { HISTORICAL_KNOWLEDGE_POLICY_VERSION, resolveHistoricalKnowledge } = require("./historical-scope-resolver");

const HISTORICAL_RETRIEVAL_VERSION = "v8.12-part2-historical-retrieval-1";
const MAX_RANGE_NODES = 256;
const MAX_SELECTED = 24;
const CHARACTER_FIELDS = ["LOCATION", "PRIMARY_TITLE", "TITLE_IDS", "LIEGE", "COURT_EMPLOYER", "LIFE_STATUS", "SPOUSE", "FRIEND", "RIVAL", "WAR_PARTICIPATION"];

function hash(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 24);
}

function sorted(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String))].sort();
}

function same(left, right) {
  return JSON.stringify(Array.isArray(left) ? sorted(left) : left ?? null) === JSON.stringify(Array.isArray(right) ? sorted(right) : right ?? null);
}

function actorKey(actor = {}) {
  return `${actor.type || "UNKNOWN"}:${actor.runtimeId || actor.titleId || actor.factionId || actor.opaqueId || "UNKNOWN"}`;
}

function warActorIds(war = {}) {
  const actors = [...(war.attackerActors || []), ...(war.defenderActors || [])];
  return {
    characters: sorted(actors.map(actor => actor.runtimeId).filter(Boolean)),
    titles: sorted(actors.map(actor => actor.titleId).filter(Boolean)),
    factions: sorted(actors.map(actor => actor.factionId).filter(Boolean))
  };
}

function warParticipation(projection, characterId) {
  return sorted(Object.entries(projection?.wars || {}).filter(([, war]) => [...(war.attackerActors || []), ...(war.defenderActors || [])].some(actor =>
    actor.type === "CHARACTER" && String(actor.runtimeId) === String(characterId)
    || actor.type === "TITLE" && String(projection?.titles?.[String(actor.titleId)]?.holderId || "") === String(characterId)
  )).map(([warId]) => warId));
}

function characterValue(projection, characterId, field) {
  const character = projection?.characters?.[String(characterId)];
  if (!character) return undefined;
  if (field === "LOCATION") return character.location;
  if (field === "PRIMARY_TITLE") return character.primaryTitleId;
  if (field === "TITLE_IDS") return sorted(character.titleIds);
  if (field === "LIEGE") return character.liegeId;
  if (field === "COURT_EMPLOYER") return character.courtEmployerId;
  if (field === "LIFE_STATUS") return character.lifeStatus;
  if (field === "SPOUSE") return sorted(character.spouseIds);
  if (field === "FRIEND") return sorted(character.friendIds);
  if (field === "RIVAL") return sorted(character.rivalIds);
  if (field === "WAR_PARTICIPATION") return warParticipation(projection, characterId);
  return undefined;
}

function fieldFilter(query) {
  const text = String(query || "").toLocaleLowerCase();
  if (/(哪里|何处|位置|所在地|行踪|下落|where)/u.test(text)) return new Set(["LOCATION"]);
  if (/(头衔|爵位|领地|title)/u.test(text)) return new Set(["PRIMARY_TITLE", "TITLE_IDS"]);
  if (/(生死|活着|死亡|去世|life|alive|dead)/u.test(text)) return new Set(["LIFE_STATUS"]);
  if (/(配偶|妻子|丈夫|婚姻|spouse|marriage)/u.test(text)) return new Set(["SPOUSE"]);
  if (/(朋友|好友|挚友|friend)/u.test(text)) return new Set(["FRIEND"]);
  if (/(仇敌|宿敌|敌手|rival)/u.test(text)) return new Set(["RIVAL"]);
  if (/(领主|liege)/u.test(text)) return new Set(["LIEGE"]);
  if (/(宫廷|court)/u.test(text)) return new Set(["COURT_EMPLOYER"]);
  if (/(战争|战事|交战|war)/u.test(text)) return new Set(["WAR_PARTICIPATION"]);
  return new Set(CHARACTER_FIELDS);
}

function nodesByDate(index) {
  return index.nodes.slice().sort((left, right) => left.totalDays - right.totalDays || left.checkpointId.localeCompare(right.checkpointId));
}

function selectAsOf(index, requestedDate, currentDate) {
  const requested = normalizeGameDate(requestedDate);
  const current = normalizeGameDate(currentDate);
  if (!requested) return { error: "HISTORY_CHECKPOINT_NOT_FOUND" };
  if (current && requested.serial > current.serial) return { error: "HISTORY_FUTURE_BLOCKED" };
  const entries = nodesByDate(index);
  if (!entries.length || requested.serial < entries[0].totalDays) return { error: "HISTORY_UNAVAILABLE" };
  const entry = entries.filter(node => node.totalDays <= requested.serial).at(-1);
  return entry ? { entry, requested } : { error: "HISTORY_CHECKPOINT_NOT_FOUND" };
}

function selectRange(index, fromDate, toDate, currentDate, openStart = false) {
  const entries = nodesByDate(index);
  const from = openStart && !fromDate ? normalizeGameDate(entries[0]?.gameDate) : normalizeGameDate(fromDate);
  const to = normalizeGameDate(toDate);
  const current = normalizeGameDate(currentDate);
  if (!from || !to || from.serial > to.serial) return { error: "HISTORY_CHECKPOINT_NOT_FOUND" };
  if (current && (from.serial > current.serial || to.serial > current.serial)) return { error: "HISTORY_FUTURE_BLOCKED" };
  if (!entries.length || from.serial < entries[0].totalDays) return { error: "HISTORY_UNAVAILABLE" };
  const baseline = entries.filter(node => node.totalDays <= from.serial).at(-1);
  const within = entries.filter(node => node.totalDays > baseline.totalDays && node.totalDays <= to.serial);
  const all = [baseline, ...within];
  const trimmed = Math.max(0, all.length - MAX_RANGE_NODES);
  return { entries: all.slice(0, MAX_RANGE_NODES), from, to, trimmed };
}

function resolveCharacterIds(projections, queryPlan, queryAnalysis, query) {
  const explicit = sorted(queryPlan?.entities?.characters || []);
  if (explicit.length) return explicit.length === 1 ? { ids: explicit } : { ids: [], error: "HISTORY_AMBIGUOUS_IDENTITY", candidateIds: explicit };
  const candidates = sorted(queryPlan?.entities?.candidateCharacters || []);
  if (candidates.length === 1) return { ids: candidates };
  const names = new Map();
  const normalizedQuery = String(query || "").toLocaleLowerCase();
  const matchedDefinitionIds = new Set((queryAnalysis?.resolverTrace?.historical?.matchedDefinitionIds || []).map(String));
  for (const projection of projections) for (const [runtimeId, character] of Object.entries(projection.characters || {})) {
    const name = String(character.shortName || "").trim();
    const nameMatch = name && normalizedQuery.includes(name.toLocaleLowerCase());
    const definitionMatch = character.historicalDefinitionId && matchedDefinitionIds.has(String(character.historicalDefinitionId));
    if (nameMatch || definitionMatch) names.set(runtimeId, character);
  }
  const ids = [...names.keys()].sort();
  if (ids.length > 1) return { ids: [], error: "HISTORY_AMBIGUOUS_IDENTITY", candidateIds: ids };
  return { ids };
}

function resolveTitleIds(projections, queryPlan, query) {
  const explicit = sorted(queryPlan?.entities?.titles || queryPlan?.entities?.candidateTitles || []);
  if (explicit.length) return explicit;
  const normalizedQuery = String(query || "").toLocaleLowerCase();
  const found = new Set();
  for (const projection of projections) for (const [titleId, title] of Object.entries(projection.titles || {})) {
    if ([title.localizedName, title.rawKey].filter(Boolean).some(value => normalizedQuery.includes(String(value).toLocaleLowerCase()))) found.add(titleId);
  }
  return [...found].sort();
}

function candidateBase(type, projection, entityId, field, value, extra = {}) {
  const asOf = projection.gameDate;
  return {
    candidateId: `${type}:${entityId || "world"}:${field}:${asOf}:${hash(value)}`,
    type,
    factId: `history:${projection.campaignId}:${projection.branchId}:${projection.checkpointId}:${entityId || "world"}:${field}`,
    entityId: entityId === null || entityId === undefined ? null : String(entityId),
    entityType: extra.entityType || "CHARACTER",
    field,
    value,
    sourceType: "HISTORICAL_CHECKPOINT",
    asOf,
    validFrom: extra.validFrom || asOf,
    validTo: extra.validTo || asOf,
    campaignId: projection.campaignId,
    branchId: projection.branchId,
    checkpointId: projection.checkpointId,
    visibility: extra.visibility || "PUBLIC_WORLD",
    provenance: { sourceFingerprint: projection.sourceFingerprint, projectionKind: projection.projectionKind, ...(extra.provenance || {}) },
    confidence: "EXACT_CHECKPOINT",
    eventType: extra.eventType || null,
    importance: extra.importance || "NORMAL",
    entityRefs: extra.entityRefs || { characters: entityId ? [String(entityId)] : [], titles: [], factions: [] },
    displayName: extra.displayName || null,
    unresolvedActorCount: extra.unresolvedActorCount || 0,
    integrityWarning: extra.integrityWarning || null
  };
}

function characterStateCandidates(projection, characterId, fields) {
  const character = projection.characters?.[String(characterId)];
  if (!character) return [];
  return CHARACTER_FIELDS.filter(field => fields.has(field)).flatMap(field => {
    const value = characterValue(projection, characterId, field);
    if (value === undefined || value === null || Array.isArray(value) && !value.length) return [];
    return [candidateBase("HISTORICAL_CHARACTER_STATE", projection, characterId, field, value, {
      visibility: ["LOCATION", "COURT_EMPLOYER"].includes(field) ? "PERSONAL" : ["LIEGE", "SPOUSE", "FRIEND", "RIVAL"].includes(field) ? "REALM_PUBLIC" : "PUBLIC_WORLD",
      displayName: character.shortName || null
    })];
  });
}

function characterChangeCandidates(previous, current, characterId, fields) {
  const previousCharacter = previous.characters?.[String(characterId)] || null;
  const currentCharacter = current.characters?.[String(characterId)] || null;
  if (!previousCharacter && currentCharacter) return [candidateBase("HISTORICAL_CHARACTER_CHANGE", current, characterId, "IDENTITY", { before: null, after: "PRESENT" }, { validFrom: previous.gameDate, eventType: "HISTORY_ENTITY_FIRST_SEEN", importance: "HIGH", displayName: currentCharacter.shortName || null })];
  if (previousCharacter && !currentCharacter) return [candidateBase("HISTORICAL_CHARACTER_CHANGE", current, characterId, "IDENTITY", { before: "PRESENT", after: null }, { validFrom: previous.gameDate, eventType: "HISTORY_ENTITY_NO_LONGER_PRESENT", importance: "HIGH", displayName: previousCharacter.shortName || null })];
  if (!previousCharacter || !currentCharacter) return [];
  const output = [];
  const displayName = currentCharacter.shortName || previousCharacter.shortName || null;
  for (const field of CHARACTER_FIELDS.filter(item => fields.has(item))) {
    const before = characterValue(previous, characterId, field);
    const after = characterValue(current, characterId, field);
    if (same(before, after)) continue;
    if (field === "TITLE_IDS") {
      const beforeSet = new Set(sorted(before));
      const afterSet = new Set(sorted(after));
      for (const titleId of [...afterSet].filter(value => !beforeSet.has(value))) output.push(candidateBase("HISTORICAL_CHARACTER_CHANGE", current, characterId, field, { before: null, after: titleId }, { validFrom: previous.gameDate, eventType: "TITLE_GAINED", importance: "HIGH", displayName, entityRefs: { characters: [String(characterId)], titles: [titleId], factions: [] } }));
      for (const titleId of [...beforeSet].filter(value => !afterSet.has(value))) output.push(candidateBase("HISTORICAL_CHARACTER_CHANGE", current, characterId, field, { before: titleId, after: null }, { validFrom: previous.gameDate, eventType: "TITLE_LOST", importance: "HIGH", displayName, entityRefs: { characters: [String(characterId)], titles: [titleId], factions: [] } }));
      continue;
    }
    const eventType = ({ LOCATION: "LOCATION_CHANGED", PRIMARY_TITLE: "PRIMARY_TITLE_CHANGED", LIEGE: "LIEGE_CHANGED", COURT_EMPLOYER: "COURT_CHANGED", LIFE_STATUS: "LIFE_STATUS_CHANGED", SPOUSE: "SPOUSE_CHANGED", FRIEND: "FRIEND_CHANGED", RIVAL: "RIVAL_CHANGED", WAR_PARTICIPATION: "WAR_PARTICIPATION_CHANGED" })[field] || `${field}_CHANGED`;
    output.push(candidateBase("HISTORICAL_CHARACTER_CHANGE", current, characterId, field, { before: before ?? null, after: after ?? null }, {
      validFrom: previous.gameDate,
      eventType,
      importance: ["LIFE_STATUS", "PRIMARY_TITLE"].includes(field) ? "HIGH" : "NORMAL",
      displayName,
      integrityWarning: field === "LIFE_STATUS" && before === "DEAD" && after === "ALIVE" ? "DEAD_TO_ALIVE" : null
    }));
  }
  return output;
}

function titleStateCandidates(projection, titleIds) {
  return sorted(titleIds).flatMap(titleId => {
    const title = projection.titles?.[titleId];
    if (!title) return [];
    return [candidateBase("HISTORICAL_TITLE_STATE", projection, titleId, "TITLE_HOLDER", {
      holderId: title.holderId, liegeTitleId: title.liegeTitleId, realmRootTitleId: title.realmRootTitleId,
      rawKey: title.rawKey, localizedName: title.localizedName
    }, { entityType: "TITLE", importance: "HIGH", displayName: title.localizedName || title.rawKey || null, entityRefs: { characters: title.holderId ? [title.holderId] : [], titles: [titleId], factions: [] } })];
  });
}

function titleChangeCandidates(previous, current, titleIds) {
  const output = [];
  for (const titleId of sorted(titleIds)) {
    const before = previous.titles?.[titleId];
    const after = current.titles?.[titleId];
    if (!before && !after) continue;
    for (const [field, eventType] of [["holderId", "TITLE_HOLDER_CHANGED"], ["liegeTitleId", "LIEGE_TITLE_CHANGED"], ["realmRootTitleId", "REALM_ROOT_CHANGED"]]) {
      if (same(before?.[field], after?.[field])) continue;
      output.push(candidateBase("HISTORICAL_TITLE_CHANGE", current, titleId, "TITLE_CHANGE", { before: before?.[field] ?? null, after: after?.[field] ?? null }, {
        entityType: "TITLE", validFrom: previous.gameDate, eventType, importance: "HIGH", displayName: after?.localizedName || before?.localizedName || after?.rawKey || before?.rawKey || null,
        entityRefs: { characters: [before?.holderId, after?.holderId].filter(Boolean).map(String), titles: [titleId], factions: [] }
      }));
    }
  }
  return output;
}

function warCandidate(projection, warId, war, eventType, value, validFrom = null) {
  const unresolvedActorCount = [...(war.attackerActors || []), ...(war.defenderActors || [])].filter(actor => actor.type === "UNKNOWN").length;
  return candidateBase(eventType === "WAR_ACTIVE_AT" ? "HISTORICAL_WAR" : "HISTORICAL_DELTA", projection, warId, "WAR", value, {
    entityType: "WAR", validFrom: validFrom || projection.gameDate, eventType, importance: "HIGH", displayName: war.displayName || null, unresolvedActorCount, entityRefs: warActorIds(war)
  });
}

function warStateCandidates(projection) {
  return Object.entries(projection.wars || {}).map(([warId, war]) => warCandidate(projection, warId, war, "WAR_ACTIVE_AT", { warId, ...war }));
}

function warChangeCandidates(previous, current) {
  const output = [];
  const previousWars = previous.wars || {};
  const currentWars = current.wars || {};
  for (const [warId, war] of Object.entries(currentWars)) {
    const old = previousWars[warId];
    if (!old) output.push(warCandidate(current, warId, war, "WAR_FIRST_SEEN", { warId, ...war }, previous.gameDate));
    else {
      const oldSides = [sorted((old.attackerActors || []).map(actorKey)), sorted((old.defenderActors || []).map(actorKey))];
      const newSides = [sorted((war.attackerActors || []).map(actorKey)), sorted((war.defenderActors || []).map(actorKey))];
      if (!same(oldSides, newSides)) output.push(warCandidate(current, warId, war, "WAR_SIDE_CHANGED", { before: oldSides, after: newSides, war: { warId, ...war } }, previous.gameDate));
    }
  }
  for (const [warId, war] of Object.entries(previousWars)) if (!currentWars[warId]) output.push(warCandidate(current, warId, war, "WAR_NO_LONGER_ACTIVE", {
    warId, lastActiveAt: previous.gameDate, result: war.result || null, conclusion: war.result ? "EXPLICIT_RESULT" : "NO_LONGER_LISTED"
  }, previous.gameDate));
  return output;
}

function scoreCandidate(candidate, { characterIds, titleIds, query, requestedSerial, scopeReason }) {
  const text = String(query || "").toLocaleLowerCase();
  let score = 20;
  if ((candidate.entityRefs?.characters || []).some(id => characterIds.includes(String(id)))) score += 100;
  if ((candidate.entityRefs?.titles || []).some(id => titleIds.includes(String(id)))) score += 100;
  if (candidate.field === "LOCATION" && /(哪里|位置|行踪|where)/u.test(text)) score += 60;
  if (["PRIMARY_TITLE", "TITLE_IDS", "TITLE_HOLDER", "TITLE_CHANGE"].includes(candidate.field) && /(头衔|爵位|title)/u.test(text)) score += 60;
  if (candidate.field === "WAR" && /(战争|战事|交战|war)/u.test(text)) score += 60;
  if (candidate.field === "LIFE_STATUS" && /(生死|活着|死亡|dead|alive)/u.test(text)) score += 60;
  if (candidate.importance === "HIGH") score += 20;
  if (scopeReason && scopeReason !== "HISTORICAL_PUBLIC_WORLD") score += 10;
  const at = normalizeGameDate(candidate.asOf);
  if (at && requestedSerial !== null) score -= Math.min(30, Math.floor(Math.abs(requestedSerial - at.serial) / 365));
  return score;
}

function applyScope(candidates, projectionsByCheckpoint, responderId, memoryFacts) {
  let denied = 0;
  const allowed = [];
  for (const candidate of candidates) {
    if (candidate.entityType !== "CHARACTER") {
      allowed.push({ ...candidate, knowledgeDecision: "ALLOW", knowledgeReason: "HISTORICAL_PUBLIC_WORLD" });
      continue;
    }
    const projection = projectionsByCheckpoint.get(candidate.checkpointId);
    const decision = resolveHistoricalKnowledge({ projection, responderId: responderId || projection?.playerId, subjectId: candidate.entityId, field: candidate.field, memoryFacts });
    if (decision.decision !== "ALLOW") { denied++; continue; }
    allowed.push({ ...candidate, knowledgeDecision: decision.decision, knowledgeReason: decision.reason, knowledgeLevel: decision.knowledgeLevel });
  }
  return { allowed, denied };
}

function selectTopK(candidates, context) {
  const perEntity = new Map();
  const perYear = new Map();
  const selected = [];
  const trimmed = [];
  for (const candidate of candidates.map(item => ({ ...item, score: scoreCandidate(item, context) })).sort((left, right) => right.score - left.score || left.asOf.localeCompare(right.asOf) || left.candidateId.localeCompare(right.candidateId))) {
    const entityKey = `${candidate.entityType}:${candidate.entityId}`;
    const yearKey = String(normalizeGameDate(candidate.asOf)?.year || "unknown");
    if ((perEntity.get(entityKey) || 0) >= 10 || (perYear.get(yearKey) || 0) >= 12 || selected.length >= MAX_SELECTED) {
      trimmed.push({ candidateId: candidate.candidateId, reason: "HISTORY_TOKEN_BUDGET" });
      continue;
    }
    selected.push(candidate);
    perEntity.set(entityKey, (perEntity.get(entityKey) || 0) + 1);
    perYear.set(yearKey, (perYear.get(yearKey) || 0) + 1);
  }
  return { selected, trimmed };
}

function conflictCount(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    if (!["HISTORICAL_CHARACTER_STATE", "HISTORICAL_TITLE_STATE", "HISTORICAL_WAR"].includes(candidate.type)) continue;
    const key = `${candidate.campaignId}:${candidate.branchId}:${candidate.entityType}:${candidate.entityId}:${candidate.field}:${candidate.asOf}`;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(JSON.stringify(candidate.value));
  }
  return [...groups.values()].filter(values => values.size > 1).length;
}

function blockedResult(code, diagnostics) {
  return { success: false, status: "BLOCKED", reason: code, selected: [], trimmed: [], promptText: null, diagnostics: { ...diagnostics, selectedCount: 0, candidateCount: diagnostics?.candidateCount || 0, trimmedCount: 0, knowledgeDeniedCount: 0, futureBlockedCount: code === "HISTORY_FUTURE_BLOCKED" ? 1 : 0, conflictCount: 0, reasonCodes: [...new Set([...(diagnostics?.reasonCodes || []), code])] } };
}

function retrieveHistorical({ store, scope, queryPlan, queryAnalysis = {}, query = "", currentDate, responderId = null, memoryFacts = [], requestedFields = null } = {}) {
  const time = queryPlan?.time || {};
  const baseDiagnostics = { queryIntent: queryPlan?.intent || null, timeMode: time.mode || "UNSPECIFIED", requestedDate: time.mode === "RANGE" ? `${time.from}..${time.to}` : time.from || null,
    selectedHistoricalCheckpoint: null, checkpointDate: null, temporalDistance: null, campaignId: scope?.campaignId || null, branchId: scope?.branchId || null,
    archiveRevision: null, candidateCount: 0, selectedCount: 0, trimmedCount: 0, knowledgeDeniedCount: 0, futureBlockedCount: 0, conflictCount: 0, reasonCodes: [] };
  if (!store || !scope?.campaignId || !scope?.branchId || scope.reason) return blockedResult("HISTORY_BRANCH_MISMATCH", baseDiagnostics);
  if (!["AS_OF", "RANGE"].includes(time.mode)) return blockedResult("HISTORY_CHECKPOINT_NOT_FOUND", baseDiagnostics);
  let index;
  try { index = new HistoricalCheckpointIndex(store.root, scope).load(); }
  catch (_error) { return blockedResult("HISTORY_CHECKPOINT_NOT_FOUND", baseDiagnostics); }
  baseDiagnostics.archiveRevision = index.archiveRevision;
  const latestArchiveDate = nodesByDate(index).at(-1)?.gameDate || null;
  const effectiveCurrentDate = currentDate || latestArchiveDate;
  const selection = time.mode === "AS_OF" ? selectAsOf(index, time.from, effectiveCurrentDate) : selectRange(index, time.from, time.to, effectiveCurrentDate, time.openStart === true);
  if (selection.error) return blockedResult(selection.error, baseDiagnostics);
  const entries = time.mode === "AS_OF" ? [selection.entry] : selection.entries;
  const projections = [];
  for (const entry of entries) {
    const projection = store.read(scope, entry.checkpointId);
    if (!projection) return blockedResult("HISTORY_CHECKPOINT_NOT_FOUND", baseDiagnostics);
    projections.push(projection);
  }
  const projectionsByCheckpoint = new Map(projections.map(projection => [projection.checkpointId, projection]));
  const identity = resolveCharacterIds(projections, queryPlan, queryAnalysis, query);
  if (identity.error) return blockedResult(identity.error, { ...baseDiagnostics, candidateCount: identity.candidateIds?.length || 0 });
  const characterIds = identity.ids;
  const titleIds = resolveTitleIds(projections, queryPlan, query);
  const fields = new Set(Array.isArray(requestedFields) && requestedFields.length ? requestedFields.filter(field => CHARACTER_FIELDS.includes(field)) : fieldFilter(query));
  const wantsWar = queryPlan?.intent === "WAR_STATUS" || /(战争|战事|交战|war)/iu.test(query);
  let candidates = [];
  if (time.mode === "AS_OF") {
    const projection = projections[0];
    for (const characterId of characterIds) {
      if (!projection.characters?.[characterId]) return blockedResult("HISTORY_ENTITY_NOT_PRESENT", baseDiagnostics);
      candidates.push(...characterStateCandidates(projection, characterId, fields));
    }
    candidates.push(...titleStateCandidates(projection, titleIds));
    if (wantsWar) candidates.push(...warStateCandidates(projection));
    baseDiagnostics.selectedHistoricalCheckpoint = projection.checkpointId;
    baseDiagnostics.checkpointDate = projection.gameDate;
    baseDiagnostics.temporalDistance = selection.requested.serial - projection.totalDays;
  } else {
    const baseline = projections[0];
    for (const characterId of characterIds) if (!baseline.characters?.[characterId] && !projections.some(projection => projection.characters?.[characterId])) return blockedResult("HISTORY_ENTITY_NOT_PRESENT", baseDiagnostics);
    if (wantsWar) candidates.push(...warStateCandidates(baseline));
    for (let index2 = 1; index2 < projections.length; index2++) {
      const previous = projections[index2 - 1];
      const current = projections[index2];
      for (const characterId of characterIds) candidates.push(...characterChangeCandidates(previous, current, characterId, fields));
      candidates.push(...titleChangeCandidates(previous, current, titleIds));
      if (wantsWar) candidates.push(...warChangeCandidates(previous, current));
    }
    baseDiagnostics.selectedHistoricalCheckpoint = projections.map(item => item.checkpointId);
    baseDiagnostics.checkpointDate = projections.map(item => item.gameDate);
    baseDiagnostics.temporalDistance = 0;
    if (selection.trimmed) baseDiagnostics.reasonCodes.push("HISTORY_TOKEN_BUDGET");
  }
  if (wantsWar && (characterIds.length || titleIds.length)) candidates = candidates.filter(candidate => candidate.field !== "WAR" || (candidate.entityRefs?.characters || []).some(id => characterIds.includes(String(id))) || (candidate.entityRefs?.titles || []).some(id => titleIds.includes(String(id))));
  const scoped = applyScope(candidates, projectionsByCheckpoint, responderId, memoryFacts);
  const requestedSerial = normalizeGameDate(time.mode === "RANGE" ? time.to : time.from)?.serial ?? null;
  const ranked = selectTopK(scoped.allowed, { characterIds, titleIds, query, requestedSerial });
  const conflicts = conflictCount(ranked.selected);
  baseDiagnostics.candidateCount = candidates.length;
  baseDiagnostics.selectedCount = ranked.selected.length;
  baseDiagnostics.trimmedCount = ranked.trimmed.length + (selection.trimmed || 0);
  baseDiagnostics.knowledgeDeniedCount = scoped.denied;
  baseDiagnostics.conflictCount = conflicts;
  if (scoped.denied) baseDiagnostics.reasonCodes.push("HISTORY_SCOPE_DENIED");
  if (ranked.trimmed.length) baseDiagnostics.reasonCodes.push("HISTORY_TOKEN_BUDGET");
  if (conflicts) baseDiagnostics.reasonCodes.push("HISTORY_TEMPORAL_UNSAFE");
  if (candidates.some(candidate => candidate.unresolvedActorCount > 0)) baseDiagnostics.reasonCodes.push("WAR_ACTOR_UNRESOLVED");
  return {
    success: true,
    status: ranked.selected.length ? "READY" : "NO_MATCH",
    reason: ranked.selected.length ? null : candidates.length && scoped.denied === candidates.length ? "HISTORY_SCOPE_DENIED" : "HISTORY_ENTITY_NOT_PRESENT",
    selected: conflicts ? [] : ranked.selected,
    trimmed: ranked.trimmed,
    queryPlan,
    cacheKeyParts: { campaignId: scope.campaignId, branchId: scope.branchId, historicalArchiveRevision: index.archiveRevision, checkpoint: baseDiagnostics.selectedHistoricalCheckpoint, queryPlanFingerprint: hash(queryPlan), responderId: responderId === null ? null : String(responderId), knowledgePolicyVersion: HISTORICAL_KNOWLEDGE_POLICY_VERSION },
    diagnostics: baseDiagnostics,
    retrievalVersion: HISTORICAL_RETRIEVAL_VERSION
  };
}

function getCharacterStateAt({ store, scope, characterId, asOf, currentDate = null, responderId = characterId, memoryFacts = [] } = {}) {
  return retrieveHistorical({ store, scope, query: "人物历史状态", currentDate, responderId, memoryFacts, queryAnalysis: {}, queryPlan: { intent: "HISTORY_LOOKUP", entities: { characters: [String(characterId)], titles: [], candidateCharacters: [], candidateTitles: [] }, time: { mode: "AS_OF", from: asOf, to: null } } });
}

function getCharacterTimeline({ store, scope, characterId, from, to, fields = CHARACTER_FIELDS, currentDate = null, responderId = characterId, memoryFacts = [] } = {}) {
  const query = "人物历史变化";
  const result = retrieveHistorical({ store, scope, query, currentDate, responderId, memoryFacts, requestedFields: Array.isArray(fields) ? fields : CHARACTER_FIELDS, queryAnalysis: {}, queryPlan: { intent: "HISTORY_LOOKUP", entities: { characters: [String(characterId)], titles: [], candidateCharacters: [], candidateTitles: [] }, time: { mode: "RANGE", from, to } } });
  if (!result.success) return result;
  const allowedFields = new Set(Array.isArray(fields) ? fields : CHARACTER_FIELDS);
  return { ...result, selected: result.selected.filter(candidate => allowedFields.has(candidate.field) || candidate.eventType === "HISTORY_ENTITY_FIRST_SEEN" || candidate.eventType === "HISTORY_ENTITY_NO_LONGER_PRESENT") };
}

function getTitleTimeline({ store, scope, titleId, from, to, currentDate = null, responderId = null } = {}) {
  return retrieveHistorical({ store, scope, query: "头衔历史变化", currentDate, responderId, queryAnalysis: {}, queryPlan: { intent: "HISTORY_LOOKUP", entities: { characters: [], titles: [String(titleId)], candidateCharacters: [], candidateTitles: [] }, time: { mode: "RANGE", from, to } } });
}

function getWarTimeline({ store, scope, from, to, currentDate = null, responderId = null, characterIds = [], titleIds = [] } = {}) {
  return retrieveHistorical({ store, scope, query: "战争历史变化", currentDate, responderId, queryAnalysis: {}, queryPlan: { intent: "HISTORY_LOOKUP", entities: { characters: characterIds.map(String), titles: titleIds.map(String), candidateCharacters: [], candidateTitles: [] }, time: { mode: "RANGE", from, to } } });
}

module.exports = {
  CHARACTER_FIELDS,
  HISTORICAL_RETRIEVAL_VERSION,
  MAX_RANGE_NODES,
  getCharacterStateAt,
  getCharacterTimeline,
  getTitleTimeline,
  getWarTimeline,
  retrieveHistorical,
  selectAsOf,
  selectRange,
  warChangeCandidates
};
