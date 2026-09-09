"use strict";
const path = require("path");
const crypto = require("crypto");
const { Worker } = require("worker_threads");
const { BranchRegistry } = require("./branch-registry");
const { supplementalCandidates, retrieveSupplemental } = require("./supplemental-retriever");
const { KNOWLEDGE_POLICY_VERSION } = require("./character-knowledge-policy");
const { resolveKnowledgeScope } = require("./knowledge-scope-resolver");
const { estimateTokens } = require("../token-estimator");
const { normalizeGameDate } = require("./character-temporal-facts");
const { isPotentialCurrentState, normalizeCanonPayload } = require("./canon-contract");
const { getCurrentTruth } = require("./current-truth-adapter");
const queues = new Map();
const NORMALIZATION_INPUT_FIELDS = new Set(["title", "content", "type", "entities", "entityRefs", "gameDate", "totalDays", "temporalMode", "temporalSemantics", "currentClaim", "conflictKey", "legacyMigrationId", "legacyContentFingerprint"]);
const NORMALIZED_OUTPUT_FIELDS = ["gameDate", "totalDays", "temporalMode", "temporalSemantics", "currentClaim", "conflictKey"];

function queryCharacterIds(snapshot, query) {
  const normalized = String(query || "").trim().toLocaleLowerCase();
  if (!normalized) return [];
  const ids = [];
  for (const [runtimeId, character] of Object.entries(snapshot?.characters || {})) {
    const names = [character?.fullName, character?.firstName, character?.shortName].filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim().toLocaleLowerCase());
    if (names.some((name) => normalized.includes(name))) ids.push(String(runtimeId));
    if (ids.length >= 64) break;
  }
  return ids;
}

class CanonService {
  constructor({ root, getCheckpoint, getLiveState }) {
    this.root = root;
    this.getCheckpoint = getCheckpoint;
    this.getLiveState = getLiveState;
    this.registry = new BranchRegistry({ root });
    this.snapshot = null;
    this.cache = new Map();
    this.pending = null;
  }

  branch() {
    const checkpoint = this.getCheckpoint();
    if (!checkpoint) return { state: "BRANCH_UNKNOWN", token: null, branchId: null };
    const live = this.getLiveState();
    const checkpointDate = normalizeGameDate(checkpoint.snapshot?.gameDate);
    const input = { campaignToken: checkpoint.snapshot?.playthroughId, sourcePath: checkpoint.source?.path, fingerprint: checkpoint.source?.fingerprint, gameDate: checkpointDate?.canonical || checkpoint.snapshot?.gameDate, loadSessionId: live?.loadSessionId || checkpoint.snapshot?.loadSessionId || null };
    const observedIdentityKey = JSON.stringify([checkpoint.id, input]);
    if (this.observedIdentityKey === observedIdentityKey) return this.scope;
    const scope = this.registry.observe(input);
    this.observedIdentityKey = observedIdentityKey;
    this.input = input;
    this.scope = { ...scope, token: crypto.createHash("sha256").update(JSON.stringify([checkpoint.id, input, scope.branchId])).digest("hex"), gameDate: input.gameDate };
    this.snapshot = null;
    this.cache.clear();
    return this.scope;
  }

  confirm(token) {
    if (this.identityBusy) throw new Error("branch_identity_change_in_progress");
    const scope = this.branch();
    if (scope.token !== token || !["save_continuity_unverified", "load_session_changed", "load_session_unavailable"].includes(scope.reason)) throw new Error("branch_confirmation_stale_or_invalid");
    const identity = this.registry.identity(this.input);
    const previous = this.registry.load().branches.find(item => item.archived !== true && item.campaignId === identity.campaignId && item.sourcePath === identity.sourcePath);
    if (!previous) throw new Error("branch_confirmation_invalid");
    const confirmed = this.registry.confirmContinuation(this.input, previous.branchId);
    this.scope = { ...scope, ...confirmed, reason: null, token: crypto.randomUUID() };
    this.snapshot = null;
    this.cache.clear();
    return this.scope;
  }

  fork(token) {
    if (this.identityBusy) throw new Error("branch_identity_change_in_progress");
    const scope = this.branch();
    if (!scope.token || scope.token !== token) throw new Error("branch_confirmation_stale_or_invalid");
    const created = this.registry.fork(this.input);
    this.scope = { ...scope, ...created, reason: null, token: crypto.randomUUID() };
    this.snapshot = null;
    this.cache.clear();
    return this.scope;
  }

  resume({ token, branchId } = {}) {
    if (this.identityBusy) throw new Error("branch_identity_change_in_progress");
    const scope = this.branch();
    if (!scope.token || scope.token !== token) throw new Error("branch_confirmation_stale_or_invalid");
    const resumed = this.registry.resume(this.input, branchId);
    this.scope = { ...scope, ...resumed, reason: null, token: crypto.randomUUID() };
    this.snapshot = null;
    this.cache.clear();
    return this.scope;
  }

  async rename({ token, sourceBranchId } = {}) {
    const scope = { ...this.branch() };
    if (this.identityBusy || !scope.branchId || token !== scope.token) throw new Error("branch_rename_invalid");
    this.identityBusy = true;
    try {
      const state = await this.run(scope, "read");
      if (state.revision !== 0 || state.records.length || this.branch().token !== token) throw new Error("branch_rename_requires_empty_unchanged_target");
      const renamed = this.registry.adoptRename(this.input, sourceBranchId, scope.branchId);
      this.scope = { ...scope, ...renamed, token: crypto.randomUUID(), reason: null };
      return this.scope;
    } finally { this.identityBusy = false; this.snapshot = null; this.cache.clear(); }
  }

  run(scope, operation, args = {}) {
    args = structuredClone(args);
    // One queue across all worker lifetimes: no simultaneous writers to a file.
    const key = this.root;
    const pending = (queues.get(key) || Promise.resolve()).catch(() => {}).then(() => new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "supplemental-worker.js"), { workerData: { root: this.root, scope, operation, ...args } });
      let received = false;
      worker.once("message", message => { received = true; message.error ? reject(new Error(message.error)) : resolve(message.result); });
      worker.once("error", reject);
      worker.once("exit", () => { if (!received) reject(new Error("supplemental_worker_stopped_no_replay")); });
    }));
    queues.set(key, pending);
    pending.finally(() => { if (queues.get(key) === pending) queues.delete(key); }).catch(() => {});
    return pending;
  }

  async prepare() {
    const scope = this.branch();
    if (!scope.branchId) return null;
    if (this.snapshot?.token === scope.token) return this.snapshot;
    if (this.pending?.token === scope.token) return this.pending.promise;
    const promise = this.run(scope, "read").then(state => {
      if (this.branch().token !== scope.token) return null;
      this.snapshot = { ...state, token: scope.token, stableRecords: state.records.filter(record => record.conversationStable === true) };
      return this.snapshot;
    });
    this.pending = { token: scope.token, promise };
    try { return await promise; } finally { if (this.pending?.promise === promise) this.pending = null; }
  }

  async list(options = {}) {
    const scope = { ...this.branch() };
    this.snapshot = null;
    this.cache.clear();
    const state = await this.prepare();
    if (this.branch().token !== scope.token) throw new Error("branch_changed_reload_editor");
    const offset = Number.isSafeInteger(options.offset) && options.offset >= 0 ? options.offset : 0;
    const records = state?.records || [];
    const live = this.getLiveState();
    const gameDate = live.gameDate || scope.gameDate;
    const date = normalizeGameDate(gameDate);
    const conflicts = new Map();
    for (const record of records) if (record.status === "ACTIVE" && record.conflictKey) {
      if (!conflicts.has(record.conflictKey)) conflicts.set(record.conflictKey, new Set());
      conflicts.get(record.conflictKey).add(record.content);
    }
    const page = records.slice(offset, offset + 20).map(record => ({ ...record,
      recallWarning: record.status !== "ACTIVE" ? null : conflicts.get(record.conflictKey)?.size > 1 ? "同事项存在不同 Canon，召回时禁止随机选边" : record.currentClaim || isPotentialCurrentState(record.content) ? "当前状态声明必须经过 CK3 验证；缺少结构化证据时不注入" : record.temporalMode === "TIMELESS" ? null : record.temporalMode === "PLANNED" ? "未来计划将以“尚未发生”的方式召回" : date && normalizeGameDate(record.gameDate)?.serial > date.serial || record.totalDays != null && Number.isSafeInteger(live.totalDays) && record.totalDays > live.totalDays ? "未来记录：当前不可召回" : null
    }));
    const renameCandidates = scope.branchId && !state?.revision ? this.registry.load().branches.filter(item => item.archived !== true && item.campaignId === scope.campaignId && item.branchId !== scope.branchId && item.fingerprint === this.input.fingerprint).map(item => ({ branchId: item.branchId, sourcePath: item.sourcePath })) : [];
    return { branch: scope, revision: state?.revision || 0, total: records.length, offset, records: page, defaultGameDate: gameDate, renameCandidates, promptEnabled: null };
  }

  async mutate({ token, operation, id, payload, revision } = {}) {
    if (this.identityBusy) throw new Error("branch_identity_change_in_progress");
    const scope = { ...this.branch() };
    if (!scope.branchId || token !== scope.token) throw new Error("branch_write_blocked_reload_editor");
    if (!["create", "update", "supersede"].includes(operation)) throw new Error("supplemental_operation_invalid");
    const checkpoint = this.getCheckpoint();
    const live = this.getLiveState();
    const normalizationContext = { gameDate: live.gameDate || checkpoint?.snapshot?.gameDate || scope.gameDate, totalDays: Number.isSafeInteger(live.totalDays) ? live.totalDays : checkpoint?.snapshot?.totalDays };
    let normalizedPayload;
    let effectiveRecord;
    if (operation === "create") normalizedPayload = normalizeCanonPayload(payload, normalizationContext);
    else {
      const state = await this.prepare();
      if (!state || this.branch().token !== scope.token) throw new Error("branch_write_blocked_reload_editor");
      const existing = state.records.find((record) => record.recordId === id);
      if (!existing) throw new Error("supplemental_not_found");
      if (Object.keys(payload || {}).some((field) => NORMALIZATION_INPUT_FIELDS.has(field))) {
        const normalized = normalizeCanonPayload({ ...existing, ...payload }, normalizationContext);
        normalizedPayload = { ...payload };
        for (const field of NORMALIZED_OUTPUT_FIELDS) normalizedPayload[field] = normalized[field] === undefined ? null : normalized[field];
      } else normalizedPayload = payload;
      effectiveRecord = { ...existing, ...normalizedPayload };
    }
    effectiveRecord ||= normalizedPayload;
    if (effectiveRecord.currentClaim) {
      const truth = getCurrentTruth(checkpoint?.snapshot, effectiveRecord.currentClaim.entityId, effectiveRecord.currentClaim.field);
      if (truth.reason === "CURRENT_TRUTH_CHARACTER_UNAVAILABLE") throw new Error("supplemental_current_claim_character_required");
      if (!truth.available) throw new Error(`supplemental_${truth.reason.toLocaleLowerCase()}`);
      if (effectiveRecord.currentClaim.value !== undefined && String(effectiveRecord.currentClaim.value) !== String(truth.rawValue)) throw new Error("supplemental_current_claim_value_mismatch");
      const claim = { entityId: truth.entityId, field: truth.field, value: truth.rawValue, displayValue: truth.displayValue };
      normalizedPayload = { ...normalizedPayload, currentClaim: claim };
      effectiveRecord = { ...effectiveRecord, currentClaim: claim };
    }
    if (["COURT_PUBLIC", "REALM_PUBLIC"].includes(effectiveRecord.visibility) && !checkpoint?.snapshot?.characters?.[effectiveRecord.scopeEntityId]) throw new Error("supplemental_scope_character_required");
    // Capture the branch at invocation. A queued edit can never be retargeted to B.
    this.snapshot = null;
    this.cache.clear();
    try { return await this.run(scope, operation, { id, payload: normalizedPayload, revision }); }
    finally { this.snapshot = null; this.cache.clear(); }
  }

  history({ token, id, offset = 0 } = {}) {
    const scope = { ...this.branch() };
    if (!scope.branchId || token !== scope.token) throw new Error("branch_changed_reload_editor");
    return this.run(scope, "history", { id, options: { offset, limit: 20 } });
  }

  _currentTruthValue(claim, currentFacts = []) {
    const claimField = String(claim.field || "").replace(/_/g, "").toLocaleLowerCase();
    const fact = currentFacts.find((item) => String(item.entityId) === String(claim.entityId) && String(item.field).replace(/_/g, "").toLocaleLowerCase() === claimField && ["GAME_TRUTH", "GAMESTATE"].includes(item.sourceTier));
    if (fact) return fact.structuredValue !== undefined ? fact.structuredValue : fact.value;
    const truth = getCurrentTruth(this.getCheckpoint()?.snapshot, claim?.entityId, claim?.field);
    if (truth.available) return truth.rawValue;
    return undefined;
  }

  getCurrentTruth({ entityId, field } = {}) {
    const checkpoint = this.getCheckpoint();
    if (!checkpoint?.snapshot) throw new Error("supplemental_current_claim_checkpoint_unavailable");
    const truth = getCurrentTruth(checkpoint.snapshot, entityId, field);
    if (!truth.available) throw new Error(`supplemental_${truth.reason.toLocaleLowerCase()}`);
    return truth;
  }

  async testRecall({ token, recordId, responderId, query = "", currentFacts = [] } = {}) {
    const scope = { ...this.branch() };
    if (!scope.branchId || token !== scope.token) throw new Error("branch_changed_reload_editor");
    if (typeof recordId !== "string" || !/^swm_[a-f0-9-]+$/.test(recordId) || !/^\d+$/.test(String(responderId || "")) || typeof query !== "string" || query.length > 1000) throw new Error("canon_test_request_invalid");
    const state = await this.prepare();
    if (!state || this.branch().token !== scope.token) throw new Error("branch_changed_reload_editor");
    const record = state.records.find((item) => item.recordId === recordId);
    if (!record) throw new Error("supplemental_not_found");
    const checkpoint = this.getCheckpoint();
    const live = this.getLiveState();
    const entityIds = queryCharacterIds(checkpoint?.snapshot, query);
    const recordEntityIds = new Set([...(record.entities || []), ...(record.entityRefs || []).filter((item) => item.namespace === "character").map((item) => item.id)].map(String));
    const entityMatch = entityIds.some((id) => recordEntityIds.has(id));
    const result = retrieveSupplemental({ records: [record], ...scope, responderId: String(responderId), query, entityIds, currentTotalDays: live.totalDays, currentGameDate: live.gameDate || checkpoint?.snapshot?.gameDate, tokenBudget: 640, estimateTokens,
      scopeResolver: (item) => item.scopeEntityId ? resolveKnowledgeScope({ snapshot: checkpoint?.snapshot, responderId: String(responderId), subjectId: item.scopeEntityId }) : {},
      currentTruth: (claim) => this._currentTruthValue(claim, currentFacts)
    });
    const selected = result.selected.some((item) => item.recordId === recordId);
    const candidate = supplementalCandidates(state.index, query, entityIds).some((item) => item.recordId === recordId);
    const visibilityAllowed = result.visibilityBlockedCount === 0;
    const actualCurrentValue = visibilityAllowed && record.currentClaim ? this._currentTruthValue(record.currentClaim, currentFacts) : undefined;
    const reason = !candidate ? "QUERY_NOT_RELEVANT" : result.visibilityBlockedCount ? "NPC_NOT_AUTHORIZED" : result.temporalBlockedCount ? "TEMPORAL_BLOCKED" : result.conflictCount ? "CURRENT_TRUTH_CONFLICT" : selected ? entityMatch ? "RELEVANT_ENTITY_MATCH" : "RELEVANT_TEXT_MATCH" : record.status !== "ACTIVE" ? "RECORD_NOT_ACTIVE" : "NOT_SELECTED";
    return {
      matched: selected,
      visibility: result.visibilityBlockedCount ? "DENY" : "ALLOW",
      temporal: result.temporalBlockedCount ? "BLOCKED" : "SAFE",
      branch: record.campaignId === scope.campaignId && record.branchId === scope.branchId ? "MATCH" : "MISMATCH",
      currentTruth: result.conflictCount ? "CONFLICT" : "NO_CONFLICT",
      selected,
      tokens: selected ? result.tokens : 0,
      promptText: selected ? result.text : null,
      currentTruthValue: actualCurrentValue === undefined ? null : actualCurrentValue,
      claimValue: visibilityAllowed && record.currentClaim ? record.currentClaim.value : null,
      reason
    };
  }

  recall({ responderId, query = "", entityIds = [], tokenBudget = 512, currentFacts = [], stable = false, conversationId = null, excludeIds = [] } = {}) {
    try {
      const scope = this.branch();
      if (!scope.branchId || this.snapshot?.token !== scope.token) return { text: null, tokens: 0, selected: [] };
      if (stable && !conversationId) return { text: null, tokens: 0, selected: [] };
      // Only explicitly pinned high-frequency rules may enter a query-free,
      // conversation-local cache; ordinary Canon always stays in the turn tail.
      if (stable) { query = this.snapshot.stableRecords.map(record => record.title).join(" "); entityIds = []; currentFacts = []; }
      const live = this.getLiveState();
      const checkpoint = this.getCheckpoint();
      const key = crypto.createHash("sha256").update(JSON.stringify([scope.token, this.snapshot.revision, KNOWLEDGE_POLICY_VERSION, responderId, entityIds, stable ? null : query, stable, conversationId, excludeIds, live.gameDate, live.totalDays, currentFacts, tokenBudget])).digest("hex");
      if (this.cache.has(key)) return { ...this.cache.get(key), cacheHit: true };
      const candidates = supplementalCandidates(this.snapshot.index, query, entityIds).filter(record => !excludeIds.includes(record.recordId));
      const result = retrieveSupplemental({ records: candidates, ...scope, responderId, query, entityIds, selectionIds: stable ? new Set(this.snapshot.stableRecords.map(record => record.recordId)) : null, currentTotalDays: live.totalDays, currentGameDate: live.gameDate || checkpoint.snapshot.gameDate, tokenBudget, estimateTokens,
        scopeResolver: record => record.scopeEntityId ? resolveKnowledgeScope({ snapshot: checkpoint.snapshot, responderId, subjectId: record.scopeEntityId }) : {},
        currentTruth: claim => this._currentTruthValue(claim, currentFacts)
      });
      const output = { ...result, revision: this.snapshot.revision, candidateCount: candidates.length, cacheHit: false };
      if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, output);
      return output;
    } catch (_error) { return { text: null, tokens: 0, selected: [], unavailable: true }; }
  }
}

module.exports = { CanonService };
