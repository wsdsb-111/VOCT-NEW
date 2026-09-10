"use strict";

const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");

function createReverseDefinitionIndex(snapshot) {
  const index = new Map();
  for (const [runtimeId, ids] of Object.entries(snapshot?.runtimeToDefinitions || {})) {
    for (const definitionId of new Set((Array.isArray(ids) ? ids : []).map(String))) {
      if (!index.has(definitionId)) index.set(definitionId, []);
      index.get(definitionId).push(String(runtimeId));
    }
  }
  return index;
}

function resolveHistoricalEntityBinding({ snapshot = null, candidateDefinitionIds = [], definitionRecord = null, scope = {}, reverseDefinitionIndex = null } = {}) {
  const definitionIds = [...new Set((Array.isArray(candidateDefinitionIds) ? candidateDefinitionIds : []).map(String).filter(Boolean))];
  const branchId = scope?.branchId ? String(scope.branchId) : null;
  const campaignId = scope?.campaignId ? String(scope.campaignId) : snapshot?.playthroughId ? String(snapshot.playthroughId) : null;
  const bindingScope = { campaignId, branchId, checkpointId: scope?.checkpointId ? String(scope.checkpointId) : null, datasetRevision: scope?.datasetRevision ? String(scope.datasetRevision) : null };
  if (!branchId || !campaignId) return { status: "STALE_BINDING", runtimeId: null, bindingScope, reason: "BRANCH_SCOPE_UNAVAILABLE" };
  if (!definitionIds.length) return { status: "DEFINITION_ID_MISSING", runtimeId: null, bindingScope, reason: "DEFINITION_ID_MISSING" };
  if (definitionIds.length > 1) return { status: "AMBIGUOUS", runtimeId: null, bindingScope, reason: "DEFINITION_ID_DUPLICATE" };
  const definitionId = definitionIds[0];
  const forwardRuntimeId = snapshot?.definitionToRuntime?.[definitionId];
  const reverseRuntimeIds = (reverseDefinitionIndex || createReverseDefinitionIndex(snapshot)).get(definitionId) || [];
  if (!forwardRuntimeId && !reverseRuntimeIds.length) return { status: "RUNTIME_ENTITY_MISSING", runtimeId: null, definitionId, bindingScope, reason: "RUNTIME_ENTITY_MISSING" };
  const runtimeId = forwardRuntimeId ? String(forwardRuntimeId) : null;
  const reciprocalDefinitions = [...new Set((snapshot?.runtimeToDefinitions?.[runtimeId] || []).map(String).filter(Boolean))];
  if (!runtimeId || reverseRuntimeIds.length !== 1 || reverseRuntimeIds[0] !== runtimeId || reciprocalDefinitions.length !== 1 || reciprocalDefinitions[0] !== definitionId) return { status: "AMBIGUOUS", runtimeId: null, definitionId, bindingScope, reason: "DEFINITION_RUNTIME_BINDING_CONFLICT" };
  const character = snapshot?.characters?.[runtimeId];
  if (!character) return { status: "RUNTIME_ENTITY_MISSING", runtimeId: null, definitionId, bindingScope, reason: "RUNTIME_CHARACTER_MISSING" };
  const gender = resolveCharacterSexConsensus({ snapshot: character, historical: definitionRecord?.metadata });
  if (gender.conflict) return { status: "IDENTITY_CONFLICT_GENDER", runtimeId: null, definitionId, bindingScope, reason: "RELATION_GENDER_CONFLICT", gender };
  return { status: "RESOLVED_RUNTIME", runtimeId, definitionId, bindingScope, gender, reason: "DEFINITION_RUNTIME_BINDING_CONFIRMED" };
}

class HistoricalEntityBindingCache {
  constructor({ maxEntries = 256 } = {}) { this.maxEntries = maxEntries; this.entries = new Map(); }
  resolve(input) {
    const definitionIds = [...new Set((input.candidateDefinitionIds || []).map(String).filter(Boolean))];
    const definitionId = definitionIds.length === 1 ? definitionIds[0] : null;
    const reverseDefinitionIndex = input.reverseDefinitionIndex || createReverseDefinitionIndex(input.snapshot);
    const forwardRuntimeId = definitionId ? input.snapshot?.definitionToRuntime?.[definitionId] : null;
    const reverseRuntimeIds = definitionId ? reverseDefinitionIndex.get(definitionId) || [] : [];
    const reciprocalDefinitions = forwardRuntimeId === null || forwardRuntimeId === undefined ? [] : [...new Set((input.snapshot?.runtimeToDefinitions?.[String(forwardRuntimeId)] || []).map(String).filter(Boolean))];
    const character = forwardRuntimeId === null || forwardRuntimeId === undefined ? null : input.snapshot?.characters?.[String(forwardRuntimeId)];
    const key = JSON.stringify([
      input.scope || {}, definitionIds, forwardRuntimeId === null || forwardRuntimeId === undefined ? null : String(forwardRuntimeId), reverseRuntimeIds, reciprocalDefinitions,
      character?.gender ?? character?.sex ?? character?.female ?? null, character?.evidence?.conflicts?.gender === true,
      input.definitionRecord?.metadata?.gender ?? input.definitionRecord?.metadata?.sex ?? input.definitionRecord?.metadata?.female ?? null
    ]);
    const existing = this.entries.get(key);
    if (existing) return existing;
    const value = resolveHistoricalEntityBinding({ ...input, reverseDefinitionIndex });
    this.entries.set(key, value);
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    return value;
  }
  clear() { this.entries.clear(); }
}

module.exports = { HistoricalEntityBindingCache, resolveHistoricalEntityBinding, createReverseDefinitionIndex };
