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
const queues = new Map();

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
    if (this.observedCheckpoint === checkpoint) return this.scope;
    const input = { campaignToken: checkpoint.snapshot?.playthroughId, sourcePath: checkpoint.source?.path, fingerprint: checkpoint.source?.fingerprint, gameDate: checkpoint.snapshot?.gameDate };
    const scope = this.registry.observe(input);
    this.observedCheckpoint = checkpoint;
    this.input = input;
    this.scope = { ...scope, token: crypto.createHash("sha256").update(JSON.stringify([checkpoint.id, input, scope.branchId])).digest("hex"), gameDate: input.gameDate };
    this.snapshot = null;
    this.cache.clear();
    return this.scope;
  }

  confirm(token) {
    if (this.identityBusy) throw new Error("branch_identity_change_in_progress");
    const scope = this.branch();
    if (scope.token !== token || scope.reason !== "save_continuity_unverified") throw new Error("branch_confirmation_stale_or_invalid");
    const identity = this.registry.identity(this.input);
    const previous = this.registry.load().branches.find(item => item.archived !== true && item.campaignId === identity.campaignId && item.sourcePath === identity.sourcePath);
    if (!previous) throw new Error("branch_confirmation_invalid");
    const confirmed = this.registry.observe({ ...this.input, confirmedContinuationOf: previous.fingerprint });
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
      recallWarning: record.status !== "ACTIVE" ? null : conflicts.get(record.conflictKey)?.size > 1 ? "同事项存在不同 Canon，召回时禁止随机选边" : record.currentClaim || /(?:现在|目前|当前|如今).{0,12}(?:在|位于|活着|已死|信仰|文化|领主)/.test(record.content) ? "当前状态声明必须经过 CK3 验证；缺少结构化证据时不注入" : date && normalizeGameDate(record.gameDate)?.serial > date.serial || record.totalDays != null && Number.isSafeInteger(live.totalDays) && record.totalDays > live.totalDays ? "未来记录：当前不可召回" : null
    }));
    const renameCandidates = scope.branchId && !state?.revision ? this.registry.load().branches.filter(item => item.archived !== true && item.campaignId === scope.campaignId && item.branchId !== scope.branchId && item.fingerprint === this.input.fingerprint).map(item => ({ branchId: item.branchId, sourcePath: item.sourcePath })) : [];
    return { branch: scope, revision: state?.revision || 0, total: records.length, offset, records: page, defaultGameDate: gameDate, renameCandidates, promptEnabled: null };
  }

  async mutate({ token, operation, id, payload, revision } = {}) {
    if (this.identityBusy) throw new Error("branch_identity_change_in_progress");
    const scope = { ...this.branch() };
    if (!scope.branchId || token !== scope.token) throw new Error("branch_write_blocked_reload_editor");
    if (!["create", "update", "supersede"].includes(operation)) throw new Error("supplemental_operation_invalid");
    if (["COURT_PUBLIC", "REALM_PUBLIC"].includes(payload?.visibility) && !this.getCheckpoint()?.snapshot?.characters?.[payload.scopeEntityId]) throw new Error("supplemental_scope_character_required");
    // Capture the branch at invocation. A queued edit can never be retargeted to B.
    this.snapshot = null;
    this.cache.clear();
    try { return await this.run(scope, operation, { id, payload, revision }); }
    finally { this.snapshot = null; this.cache.clear(); }
  }

  history({ token, id, offset = 0 } = {}) {
    const scope = { ...this.branch() };
    if (!scope.branchId || token !== scope.token) throw new Error("branch_changed_reload_editor");
    return this.run(scope, "history", { id, options: { offset, limit: 20 } });
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
        currentTruth: claim => {
          const fact = currentFacts.find(item => String(item.entityId) === String(claim.entityId) && String(item.field).toLowerCase() === claim.field && ["GAME_TRUTH", "GAMESTATE"].includes(item.sourceTier));
          if (!fact) return undefined;
          if (fact.structuredValue !== undefined) return fact.structuredValue;
          // Never consult an unapproved character field to grant knowledge.
          return checkpoint.snapshot.characters?.[String(claim.entityId)]?.[claim.field] ?? undefined;
        }
      });
      const output = { ...result, revision: this.snapshot.revision, candidateCount: candidates.length, cacheHit: false };
      if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, output);
      return output;
    } catch (_error) { return { text: null, tokens: 0, selected: [], unavailable: true }; }
  }
}

module.exports = { CanonService };
