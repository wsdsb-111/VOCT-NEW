"use strict";

const nodeCrypto = require("node:crypto");
const nodeFs = require("fs");
const nodePath = require("path");
const { Worker: NodeWorker } = require("worker_threads");
const { CanonService } = require("./canon-service");
const { readSavePreamble } = require("./save-container");
const { dateValue } = require("./game-state-adapter");
const { resolvePlayerPoliticalContext } = require("./political-context");
const { LocalizationWorkerClient } = require("./localization-worker-client");
const { HistoricalDefinitionIndexClient } = require("./historical-definition-index");
const { HistoricalEntityBindingCache, resolveHistoricalEntityBinding, createReverseDefinitionIndex } = require("./historical-entity-binding");
const { getCachedKinshipGraph, getTargetedKinshipGraph } = require("./kinship-graph-cache");
const { scanKinshipIntegrity } = require("./kinship-integrity-scan");
const { buildFamilyEntityFactBundle } = require("./family-entity-fact-bundle");
const { resolveRelationMention } = require("./relation-mention-resolver");
const { resolveCharacterAge } = require("./character-age-service");
const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");
const { resolveLifeStatus } = require("./character-temporal-facts");
const { attachRuntimeNameIndex } = require("./runtime-name-index");
const { getCheckpointFreshness } = require("./checkpoint-freshness");
const { analysisTextMatches, analyzeSharedQuery, collectTerms } = require("./shared-query-analyzer");
const { HISTORICAL_ALIAS_CATALOG } = require("./historical-alias-catalog");
const { KNOWLEDGE_POLICY_VERSION } = require("./character-knowledge-policy");
const { HISTORICAL_KNOWLEDGE_POLICY_VERSION } = require("./historical-scope-resolver");
const { createRealmRootIndex, resolveKnowledgeScope } = require("./knowledge-scope-resolver");
const { memoryFactsForResponder } = require("./personal-memory-policy-adapter");
const { createSharedCandidatePool } = require("./shared-candidate-pool");
const { buildSubjectiveWorldView } = require("./subjective-world-builder");
const { classifySelectedWorldFacts } = require("./world-knowledge-classifier");
const { buildHistoricalReferenceReplacement, buildSubjectiveWorldTurnRecall, buildSubjectiveWorldBaselinePrompt, buildWorldStablePrompt } = require("./subjective-prompt-context");
const { RETRIEVAL_POLICY_VERSION, buildWorldQueryPlan, parseTimeHint } = require("./world-query-planner");
const { buildWorldCandidates } = require("./world-retriever");
const { currentTruthFact } = require("./current-truth-adapter");
const { SOCIAL_FIELDS, buildSelfSocialTruth } = require("./self-social-truth");
const { localizeWarCandidate } = require("./war-facts");
const { rankWorldCandidates } = require("./world-ranker");
const { buildDeterministicWorldSummary } = require("./world-summary");
const { HistoricalCheckpointIndex, INDEX_LAYOUT_VERSION } = require("./historical-checkpoint-index");
const { TemporalArchiveStore } = require("./temporal-archive-store");
const { retrieveHistorical } = require("./historical-retriever");
const { buildHistoricalPrompt } = require("./historical-prompt-context");
const { createPlayerAnnualDelta, createPlayerHistoricalCharacters, createPlayerOverview, createPlayerWorldKnowledge } = require("./world-presentation");
const { estimateTokens } = require("../token-estimator");
const { compileOfficialRecollection } = require("../memory-system/official-recollection-provider");

const DEFAULT_SETTINGS = Object.freeze({
  autosavePath: null,
  baseGamePath: null,
  subjectiveWorldMode: "DIAGNOSTIC",
  autoWatchEnabled: true,
  promptIntegrationEnabled: false,
  v812TemporalArchiveEnabled: false,
  v812TemporalArchiveShadowMode: true,
  v812HistoricalRetrievalEnabled: true,
  v812HistoricalPromptInjection: false,
  v812HistoricalDiagnostics: true,
  v812HistoricalPromptIntegration: false,
  v812MemoryEngine3Enabled: true,
  v812OfficialRecollectionEnabled: true,
  v812OfficialRecollectionPromptEnabled: false,
  v812TemporalSummaryRecallEnabled: true,
  lastValidatedAt: null,
  lastValidationStatus: "UNCONFIGURED"
});
const VALID_VISIBILITY = new Set(["PUBLIC_WORLD", "COURT_PUBLIC", "PERSONAL", "SECRET"]);
const VALID_IMPORTANCE = new Set(["NORMAL", "HIGH"]);
const VALID_BINDING_STATUSES = new Set(["ALL", "DIRECT", "LIVE_CONFIRMED", "CONFLICT", "AMBIGUOUS_PROVENANCE"]);
const MAX_UI_BINDINGS = 500;
const MAX_UI_DELTA = 1000;
const TOKEN_BUDGETS = Object.freeze({ SIMPLE: 350, SINGLE_ENTITY: 550, COMPLEX: 900, HARD_MAX: 1200 });
const HISTORICAL_DEFINITION_METADATA = new Map(HISTORICAL_ALIAS_CATALOG.flatMap((entry) => entry.candidateDefinitionIds.map((definitionId) => [definitionId, { figureKey: entry.figureKey, aliases: [...entry.aliases] }])));

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function nowIso(clock) {
  return clock().toISOString();
}

function shortFingerprint(value) {
  const source = typeof value === "string" ? value : JSON.stringify(value);
  return nodeCrypto.createHash("sha256").update(source, "utf8").digest("hex").slice(0, 16);
}

function promptTokenBudget(plan) {
  const entityCount = (plan?.entities?.characters?.length || 0) + (plan?.entities?.titles?.length || 0);
  if (plan?.time?.mode === "AS_OF" || plan?.time?.mode === "RANGE" || entityCount > 1 || plan?.intent === "HISTORY_LOOKUP") return TOKEN_BUDGETS.COMPLEX;
  return entityCount === 1 ? TOKEN_BUDGETS.SINGLE_ENTITY : TOKEN_BUDGETS.SIMPLE;
}

function isHistoricalQueryPlan(plan) {
  return ["AS_OF", "RANGE"].includes(plan?.time?.mode);
}

function relevantSupplementalRevision(entries, analysis, includeScopedSupplemental = false) {
  const relevant = (entries || []).filter((entry) => !entry.hidden && (includeScopedSupplemental || entry.visibility === "PUBLIC_WORLD") && analysisTextMatches(analysis, `${entry.title}\n${entry.body}\n${Array.isArray(entry.entities) ? entry.entities.join(" ") : ""}`));
  const signature = JSON.stringify(relevant.map((entry) => [entry.id, entry.updatedAt || "", entry.title, entry.body, entry.gameDate || "", entry.dateRange || "", entry.importance, entry.source, entry.entities || []]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  return nodeCrypto.createHash("sha256").update(signature, "utf8").digest("hex").slice(0, 16);
}

function normalizeSettings(value) {
  const settings = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    autosavePath: typeof settings.autosavePath === "string" && settings.autosavePath ? settings.autosavePath : null,
    baseGamePath: typeof settings.baseGamePath === "string" && settings.baseGamePath ? settings.baseGamePath : null,
    subjectiveWorldMode: ["DIAGNOSTIC", "PRODUCTION"].includes(settings.subjectiveWorldMode) ? settings.subjectiveWorldMode : "DIAGNOSTIC",
    autoWatchEnabled: settings.autoWatchEnabled !== false,
    promptIntegrationEnabled: settings.promptIntegrationEnabled === true,
    v812TemporalArchiveEnabled: settings.v812TemporalArchiveEnabled === true,
    v812TemporalArchiveShadowMode: true,
    v812HistoricalRetrievalEnabled: settings.v812HistoricalRetrievalEnabled !== false,
    v812HistoricalPromptInjection: settings.v812HistoricalPromptInjection === true || settings.v812HistoricalPromptIntegration === true,
    v812HistoricalDiagnostics: settings.v812HistoricalDiagnostics !== false,
    v812HistoricalPromptIntegration: settings.v812HistoricalPromptInjection === true || settings.v812HistoricalPromptIntegration === true,
    v812MemoryEngine3Enabled: settings.v812MemoryEngine3Enabled !== false,
    v812OfficialRecollectionEnabled: settings.v812OfficialRecollectionEnabled !== false,
    v812OfficialRecollectionPromptEnabled: settings.v812OfficialRecollectionPromptEnabled === true,
    v812TemporalSummaryRecallEnabled: settings.v812TemporalSummaryRecallEnabled !== false,
    lastValidatedAt: typeof settings.lastValidatedAt === "string" ? settings.lastValidatedAt : null,
    lastValidationStatus: typeof settings.lastValidationStatus === "string" ? settings.lastValidationStatus : "UNCONFIGURED"
  };
}

function checkpointId(snapshot) {
  return nodeCrypto.createHash("sha256").update(`${snapshot.playthroughId || "UNKNOWN"}|${snapshot.gameDate || "UNKNOWN"}|${snapshot.contentFingerprint || "UNKNOWN"}`).digest("hex").slice(0, 24);
}

function formatCharacter(snapshot, id) {
  if (!id) return null;
  const character = snapshot.characters?.[String(id)];
  return character?.firstName ? `${character.firstName} (#${id})` : `#${id}`;
}

function readableName(value) {
  const text = String(value || "").trim();
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(text) && !/[_:#]/.test(text) ? text : null;
}

function historicalDisplayName({ indexed, currentCharacterName, metadata, query }) {
  const exactIndexedName = (indexed?.names || []).find((name) => String(name || "").toLocaleLowerCase() === String(query || "").toLocaleLowerCase());
  const soleIndexedName = indexed?.names?.length === 1 ? indexed.names[0] : null;
  return readableName(indexed?.displayName) || readableName(exactIndexedName) || readableName(soleIndexedName) || readableName(currentCharacterName) || (metadata?.aliases || []).map(readableName).find(Boolean) || "名称未解析";
}

function formatDeltaActors(snapshot, ids) {
  return [...new Set((ids || []).map((id) => String(id)))].flatMap((runtimeId) => {
    const character = snapshot?.characters?.[runtimeId];
    return character ? [{ runtimeId, rawName: character.firstName || null, displayName: formatCharacter(snapshot, runtimeId) }] : [];
  });
}

function latestHistoryHolder(title, afterDate, beforeDate) {
  return (title.history || []).filter((entry) => entry.holder && (dateValue(entry.date) || 0) > (dateValue(afterDate) || 0) && (dateValue(entry.date) || 0) <= (dateValue(beforeDate) || Number.MAX_SAFE_INTEGER)).at(-1) || null;
}

function readTail(fs, filePath, maxBytes = 1024 * 1024) {
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, "r");
  try {
    const size = Math.min(maxBytes, stat.size);
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, Math.max(0, stat.size - size));
    return {
      text: buffer.toString("utf8"),
      startOffset: Math.max(0, stat.size - size),
      fileIdentity: Number.isFinite(stat.birthtimeMs) ? Math.trunc(stat.birthtimeMs) : Number.isFinite(stat.ctimeMs) ? Math.trunc(stat.ctimeMs) : 0
    };
  } finally {
    fs.closeSync(fd);
  }
}

function readLiveProbe({ fs, debugLogPath }) {
  if (!debugLogPath || !fs.existsSync(debugLogPath)) return { connected: false, gameDate: null, totalDays: null, characters: [], loadSessionId: null };
  try {
    const tail = readTail(fs, debugLogPath);
    const text = tail.text;
    const inMatches = [...text.matchAll(/VOTC:IN\/;\/init\/;\/[^\r\n]*?\/;\/([^/\r\n]+)\/;\/[^/\r\n]*?\/;\/[^/\r\n]*?\/;\/(\d+)/g)];
    const dateMatches = [...text.matchAll(/VOTC:TEST_DATE\/;\/([^/\r\n]+)\/;\/(?:days=)?(\d+)/g)];
    const characterMatches = [...text.matchAll(/VOTC:TEST_CHAR\/;\/runtime=([^/\r\n]+)\/;\/history=([^/\r\n]*)\/;\/date=([^/\r\n]+)(?:\/;\/days=(\d+))?/g)];
    const loadMatches = [...text.matchAll(/VOTC:LOAD_SESSION\/;\/([A-Za-z0-9_.-]{8,160})(?:\/;\/[^\r\n]*)?/g)];
    const latestCharacterById = new Map();
    for (const match of characterMatches) latestCharacterById.set(match[1].trim(), { runtimeId: match[1].trim(), historyId: match[2].trim() || null, gameDate: match[3].trim(), totalDays: match[4] ? Number(match[4]) : null });
    const latestDate = dateMatches.at(-1);
    const latestIn = inMatches.at(-1);
    const latestCharacter = characterMatches.at(-1);
    const markers = [
      latestIn && { index: latestIn.index, gameDate: latestIn[1].trim(), totalDays: Number(latestIn[2]) },
      latestDate && { index: latestDate.index, gameDate: latestDate[1].trim(), totalDays: Number(latestDate[2]) },
      latestCharacter && { index: latestCharacter.index, gameDate: latestCharacter[3].trim(), totalDays: latestCharacter[4] ? Number(latestCharacter[4]) : null }
    ].filter(Boolean).sort((left, right) => left.index - right.index);
    const latestMarker = markers.at(-1) || null;
    const latestDayMarker = markers.filter((marker) => Number.isFinite(marker.totalDays)).at(-1) || null;
    return {
      connected: markers.length > 0,
      gameDate: latestMarker?.gameDate || null,
      totalDays: latestDayMarker?.totalDays ?? null,
      characters: [...latestCharacterById.values()],
      loadSessionId: loadMatches.length ? `session-${nodeCrypto.createHash("sha256").update(JSON.stringify([tail.fileIdentity, tail.startOffset + loadMatches.at(-1).index, loadMatches.at(-1)[1]])).digest("hex").slice(0, 32)}` : null
    };
  } catch (_error) {
    return { connected: false, gameDate: null, totalDays: null, characters: [], loadSessionId: null };
  }
}

class WorldlineService {
  constructor({ settingsRepository, dataDir, fs = nodeFs, path = nodePath, Worker = NodeWorker, dialog = null, clock = () => new Date(), stabilityDelayMs = 750, pollIntervalMs = 30000, workerTimeoutMs = 120000, getRuntimeNames = () => null, memoryEngine = null } = {}) {
    if (!settingsRepository || typeof settingsRepository.getWorldlineSettings !== "function" || typeof settingsRepository.saveWorldlineSettings !== "function") throw new Error("worldline_settings_repository_required");
    if (typeof dataDir !== "string" || !dataDir) throw new Error("worldline_data_dir_required");
    this.settingsRepository = settingsRepository;
    this.dataDir = dataDir;
    this.fs = fs;
    this.path = path;
    this.Worker = Worker;
    this.dialog = dialog;
    this.clock = clock;
    this.stabilityDelayMs = stabilityDelayMs;
    this.pollIntervalMs = pollIntervalMs;
    this.workerTimeoutMs = workerTimeoutMs;
    this.getRuntimeNames = getRuntimeNames;
    this.memoryEngine = memoryEngine;
    this.storageDir = path.join(dataDir, "worldline-v8.4");
    this.canon = new CanonService({ root: path.join(this.storageDir, "supplemental-v8.7"), getCheckpoint: () => this.currentCheckpoint, getLiveState: () => this.getLiveState() });
    this.historicalBindingCache = new HistoricalEntityBindingCache();
    this.checkpointPath = path.join(this.storageDir, "checkpoint.json");
    this.supplementalPath = path.join(this.storageDir, "supplemental.json");
    this.currentCheckpoint = null;
    this.annualDelta = [];
    this.supplemental = [];
    this.legacyMigrationTasks = new Map();
    this.lastError = null;
    this.buildState = "UNCONFIGURED";
    this.watcher = null;
    this.poller = null;
    this.pendingRefresh = null;
    this.buildPromise = null;
    this.buildRevision = null;
    this.buildSource = null;
    this.sourceRevision = 0;
    this.lastObservedFile = null;
    this.worldKnowledgeState = {
      stableRecallCache: new Map(),
      topicPatchCache: new Map(),
      turnRecallCache: new Map(),
      summaryCache: new Map(),
      sharedCandidateCache: new Map(),
      subjectiveViewCache: new Map(),
      historicalRecallCache: new Map(),
      checkpointId: null,
      deltaRevision: 0,
      currentCampaignDeltaRevision: 0,
      supplementalRevision: 0
    };
    this.liveCache = { key: null, value: null };
    this.localizationResolver = new LocalizationWorkerClient({
      getCK3UserFolderPath: () => this.settingsRepository.getCK3UserFolderPath?.() || null,
      onUpdated: () => {
        this.worldKnowledgeState.topicPatchCache.clear();
        this.worldKnowledgeState.summaryCache.clear();
        this.worldKnowledgeState.sharedCandidateCache.clear();
        this.worldKnowledgeState.subjectiveViewCache.clear();
        this.refreshRuntimeNameIndex();
        this._notifyStateChanged("localization_updated");
      }
    });
    this.historicalDefinitionIndex = new HistoricalDefinitionIndexClient({
      getCK3UserFolderPath: () => this.settingsRepository.getCK3UserFolderPath?.() || null,
      getBaseGamePath: () => this._settings().baseGamePath,
      onUpdated: () => {
        this.worldKnowledgeState.topicPatchCache.clear();
        this.worldKnowledgeState.summaryCache.clear();
        this.worldKnowledgeState.sharedCandidateCache.clear();
        this.worldKnowledgeState.subjectiveViewCache.clear();
        this._notifyStateChanged("historical_definition_index_updated");
      },
      onQueryReady: () => this._notifyStateChanged("historical_query_ready"),
      WorkerClass: this.Worker,
      aliases: HISTORICAL_ALIAS_CATALOG
    });
    this.historicalDefinitionIndex.start();
    this.stateListener = null;
    this._loadPersistedState();
    const configuredPath = this._settings().autosavePath;
    if (this.currentCheckpoint?.source?.path && (!configuredPath || this.path.resolve(this.currentCheckpoint.source.path).toLowerCase() !== this.path.resolve(configuredPath).toLowerCase())) {
      this.currentCheckpoint = null;
      this.buildState = "UNCONFIGURED";
    }
  }

  _settings() {
    return normalizeSettings(this.settingsRepository.getWorldlineSettings());
  }

  setRuntimeNameSource(source) {
    this.getRuntimeNames = typeof source === "function" ? source : () => null;
    this.refreshRuntimeNameIndex();
  }

  refreshRuntimeNameIndex() {
    if (!this.currentCheckpoint?.snapshot) return false;
    let live = null;
    try { live = this.getRuntimeNames?.() || null; } catch (_error) { return false; }
    const indexedSnapshot = attachRuntimeNameIndex(this.currentCheckpoint.snapshot, { live, localize: (type, key) => this.localizationResolver?.resolve(type, key) });
    const before = JSON.stringify(this.currentCheckpoint.snapshot.indexes || {});
    const after = JSON.stringify(indexedSnapshot.indexes || {});
    if (before === after) return false;
    this.currentCheckpoint = { ...this.currentCheckpoint, snapshot: indexedSnapshot };
    this.worldKnowledgeState.topicPatchCache.clear();
    this.worldKnowledgeState.summaryCache.clear();
    this.worldKnowledgeState.sharedCandidateCache.clear();
    this.worldKnowledgeState.subjectiveViewCache.clear();
    this._notifyStateChanged("runtime_name_index_updated");
    return true;
  }

  setStateListener(listener) {
    this.stateListener = typeof listener === "function" ? listener : null;
  }

  _notifyStateChanged(reason) {
    try {
      this.stateListener?.({ reason, checkpointId: this.currentCheckpoint?.id || null, checkpointState: this.buildState, validationStatus: this._settings().lastValidationStatus });
    } catch (_error) {
      // Renderer updates are best-effort and must not affect checkpoint durability.
    }
  }

  _samePath(left, right) {
    if (!left || !right) return left === right;
    return this.path.resolve(left).toLowerCase() === this.path.resolve(right).toLowerCase();
  }

  _defaultAutosavePath(ck3Folder) {
    return ck3Folder ? this.path.join(ck3Folder, "save games", "autosave.ck3") : null;
  }

  _isCurrentBuild(buildRevision, buildSource) {
    const settings = this._settings();
    return this.sourceRevision === buildRevision && this._samePath(settings.autosavePath, buildSource);
  }

  _saveSettings(next) {
    const normalized = normalizeSettings(next);
    this.settingsRepository.saveWorldlineSettings(normalized);
    return normalized;
  }

  _atomicWrite(filePath, value) {
    this.fs.mkdirSync(this.path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    this.fs.writeFileSync(temporary, JSON.stringify(value), "utf8");
    this.fs.renameSync(temporary, filePath);
  }

  _loadJson(filePath, fallback) {
    try {
      if (!this.fs.existsSync(filePath)) return fallback;
      return JSON.parse(this.fs.readFileSync(filePath, "utf8"));
    } catch (_error) {
      return fallback;
    }
  }

  _loadPersistedState() {
    const checkpointState = this._loadJson(this.checkpointPath, null);
    if (checkpointState?.schemaVersion === 1 && checkpointState.currentCheckpoint?.snapshot) {
      this.currentCheckpoint = checkpointState.currentCheckpoint;
      const campaignId = checkpointState.currentCheckpoint.snapshot.playthroughId || null;
      this.annualDelta = Array.isArray(checkpointState.annualDelta) ? checkpointState.annualDelta.map((entry) => entry.campaignId === undefined ? { ...entry, campaignId, checkpointId: checkpointState.currentCheckpoint.id } : entry) : [];
      this.buildState = "STALE";
    }
    const supplementalState = this._loadJson(this.supplementalPath, null);
    this.supplemental = supplementalState?.schemaVersion === 1 && Array.isArray(supplementalState.entries) ? supplementalState.entries : [];
    this.worldKnowledgeState.currentCampaignDeltaRevision = this._currentCampaignDelta().length ? 1 : 0;
  }

  _persistCheckpoint(currentCheckpoint = this.currentCheckpoint, annualDelta = this.annualDelta) {
    this._atomicWrite(this.checkpointPath, { schemaVersion: 1, currentCheckpoint, annualDelta });
  }

  _persistSupplemental(entries = this.supplemental) {
    this._atomicWrite(this.supplementalPath, { schemaVersion: 1, entries });
  }

  getSettings() {
    const checkpoint = this.currentCheckpoint;
    return {
      ...this._settings(),
      fileSize: checkpoint?.source?.fileSize || null,
      modifiedAt: checkpoint?.source?.modifiedAt || null,
      container: checkpoint?.source?.container || null,
      gameDate: checkpoint?.snapshot?.gameDate || null,
      lastParsedAt: checkpoint?.builtAt || null,
      checkpointId: checkpoint?.id || null
    };
  }

  setRecallSettings(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("worldline_recall_settings_invalid");
    const { promptIntegrationEnabled, subjectiveWorldMode } = input;
    const archiveKeys = ["v812TemporalArchiveEnabled", "v812TemporalArchiveShadowMode", "v812HistoricalRetrievalEnabled", "v812HistoricalPromptInjection", "v812HistoricalDiagnostics", "v812HistoricalPromptIntegration", "v812MemoryEngine3Enabled", "v812OfficialRecollectionEnabled", "v812OfficialRecollectionPromptEnabled", "v812TemporalSummaryRecallEnabled"];
    if (promptIntegrationEnabled === undefined && subjectiveWorldMode === undefined && !archiveKeys.some(key => Object.hasOwn(input, key))) throw new Error("worldline_recall_settings_empty");
    for (const key of archiveKeys) if (Object.hasOwn(input, key) && typeof input[key] !== "boolean") throw new Error("worldline_archive_flag_invalid");
    if (input.v812TemporalArchiveShadowMode === false) throw new Error("v812_temporal_archive_shadow_required");
    if (promptIntegrationEnabled !== undefined && typeof promptIntegrationEnabled !== "boolean") throw new Error("worldline_prompt_integration_invalid");
    const current = this._settings();
    const next = { ...current };
    if (input.v812TemporalArchiveEnabled !== undefined) next.v812TemporalArchiveEnabled = input.v812TemporalArchiveEnabled;
    if (input.v812HistoricalRetrievalEnabled !== undefined) next.v812HistoricalRetrievalEnabled = input.v812HistoricalRetrievalEnabled;
    if (input.v812HistoricalDiagnostics !== undefined) next.v812HistoricalDiagnostics = input.v812HistoricalDiagnostics;
    const historicalPromptInjection = input.v812HistoricalPromptInjection ?? input.v812HistoricalPromptIntegration;
    if (historicalPromptInjection !== undefined) next.v812HistoricalPromptInjection = historicalPromptInjection;
    if (input.v812OfficialRecollectionEnabled !== undefined) next.v812OfficialRecollectionEnabled = input.v812OfficialRecollectionEnabled;
    if (input.v812MemoryEngine3Enabled !== undefined) next.v812MemoryEngine3Enabled = input.v812MemoryEngine3Enabled;
    if (input.v812OfficialRecollectionPromptEnabled !== undefined) next.v812OfficialRecollectionPromptEnabled = input.v812OfficialRecollectionPromptEnabled;
    if (input.v812TemporalSummaryRecallEnabled !== undefined) next.v812TemporalSummaryRecallEnabled = input.v812TemporalSummaryRecallEnabled;
    if (next.v812OfficialRecollectionPromptEnabled && !next.v812OfficialRecollectionEnabled) throw new Error("official_recollection_reader_required");
    if (next.v812HistoricalPromptInjection && !next.v812HistoricalRetrievalEnabled) throw new Error("v812_historical_retrieval_required");
    next.v812HistoricalPromptIntegration = next.v812HistoricalPromptInjection;
    if (promptIntegrationEnabled !== undefined) next.promptIntegrationEnabled = promptIntegrationEnabled === true;
    if (subjectiveWorldMode !== undefined) {
      if (!["DIAGNOSTIC", "PRODUCTION"].includes(subjectiveWorldMode)) throw new Error("worldline_subjective_mode_invalid");
      next.subjectiveWorldMode = subjectiveWorldMode;
    }
    const changed = next.promptIntegrationEnabled !== current.promptIntegrationEnabled || next.subjectiveWorldMode !== current.subjectiveWorldMode || next.v812HistoricalRetrievalEnabled !== current.v812HistoricalRetrievalEnabled || next.v812HistoricalPromptInjection !== current.v812HistoricalPromptInjection || next.v812HistoricalDiagnostics !== current.v812HistoricalDiagnostics || next.v812MemoryEngine3Enabled !== current.v812MemoryEngine3Enabled || next.v812OfficialRecollectionEnabled !== current.v812OfficialRecollectionEnabled || next.v812OfficialRecollectionPromptEnabled !== current.v812OfficialRecollectionPromptEnabled || next.v812TemporalSummaryRecallEnabled !== current.v812TemporalSummaryRecallEnabled;
    const saved = this._saveSettings(next);
    if (changed) {
      this.worldKnowledgeState.stableRecallCache.clear();
      this.worldKnowledgeState.turnRecallCache.clear();
      this.worldKnowledgeState.subjectiveViewCache.clear();
      this.worldKnowledgeState.historicalRecallCache.clear();
      this._notifyStateChanged("recall_settings_updated");
    }
    return { ...this.getSettings(), ...saved };
  }

  setAutosavePath(candidatePath) {
    if (candidatePath !== null && (typeof candidatePath !== "string" || !candidatePath.trim())) throw new Error("worldline_autosave_path_invalid");
    const settings = this._settings();
    const autosavePath = candidatePath === null ? null : this.path.resolve(candidatePath.trim());
    const sourceChanged = String(settings.autosavePath || "").toLowerCase() !== String(autosavePath || "").toLowerCase();
    const next = this._saveSettings({ ...settings, autosavePath, lastValidationStatus: autosavePath ? "UNCONFIGURED" : "UNCONFIGURED", lastValidatedAt: null });
    this.stopWatcher();
    if (sourceChanged) {
      this.sourceRevision += 1;
      this.localizationResolver.invalidate();
      this.currentCheckpoint = null;
      this.buildState = "UNCONFIGURED";
      this.lastObservedFile = null;
      this.worldKnowledgeState.stableRecallCache.clear();
      this.worldKnowledgeState.topicPatchCache.clear();
      this.worldKnowledgeState.turnRecallCache.clear();
      this.worldKnowledgeState.summaryCache.clear();
      this.worldKnowledgeState.sharedCandidateCache.clear();
      this.worldKnowledgeState.subjectiveViewCache.clear();
      this.historicalBindingCache.clear();
      this.worldKnowledgeState.checkpointId = null;
      this.worldKnowledgeState.currentCampaignDeltaRevision = 0;
    }
    this.startWatcher();
    this._notifyStateChanged("source_changed");
    return next;
  }

  async syncAutosaveFromCK3Folder(previousFolder = null) {
    const settings = this._settings();
    const currentFolder = this.settingsRepository.getCK3UserFolderPath?.() || null;
    this.historicalDefinitionIndex.start();
    const previousDefault = this._defaultAutosavePath(previousFolder);
    const currentIsManaged = !settings.autosavePath || !!previousDefault && this._samePath(settings.autosavePath, previousDefault);
    if (!currentIsManaged) return { success: true, preservedExplicitSource: true, settings: this.getSettings() };
    const candidate = this._defaultAutosavePath(currentFolder);
    if (!this._samePath(settings.autosavePath, candidate)) this.setAutosavePath(candidate);
    if (!candidate) {
      this.buildState = "UNCONFIGURED";
      this._notifyStateChanged("source_unconfigured");
      return { success: false, error: "ck3_user_folder_unconfigured", settings: this.getSettings() };
    }
    return this.rebuildCheckpoint();
  }

  validateAutosavePath(candidatePath = null) {
    const settings = candidatePath === null ? this._settings() : this.setAutosavePath(candidatePath);
    const target = settings.autosavePath;
    const validatedAt = nowIso(this.clock);
    let validationStatus = "VALID";
    let manualDiagnostic = false;
    let details = {};
    try {
      if (!target || !this.fs.existsSync(target)) validationStatus = "NOT_FOUND";
      else {
        const stat = this.fs.statSync(target);
        if (!stat.isFile()) validationStatus = "NOT_FOUND";
        else if (this.path.extname(target).toLowerCase() !== ".ck3") validationStatus = "NOT_AUTOSAVE";
        else {
          const preamble = readSavePreamble(target, { fs: this.fs });
          const baseName = this.path.basename(target).toLowerCase();
          if (!["PLAIN_TEXT_SAVE", "UNIFIED_TEXT_ZIP"].includes(preamble.containerKind)) validationStatus = "UNSUPPORTED_CONTAINER";
          else {
            validationStatus = baseName === "autosave.ck3" ? "VALID" : "NOT_AUTOSAVE";
            manualDiagnostic = validationStatus === "NOT_AUTOSAVE";
          }
          details = { fileSize: stat.size, modifiedAt: stat.mtime.toISOString(), container: preamble.containerKind, metadataGameDate: preamble.metadata.metaDate };
        }
      }
    } catch (error) {
      validationStatus = /unsupported|binary/i.test(error.message) ? "UNSUPPORTED_CONTAINER" : "READ_ERROR";
      details = { error: error.message };
    }
    const next = this._saveSettings({ ...settings, lastValidationStatus: validationStatus, lastValidatedAt: validatedAt });
    this.stopWatcher();
    this.startWatcher();
    this._notifyStateChanged("source_validated");
    return { success: validationStatus === "VALID" || manualDiagnostic, settings: next, validationStatus, ...details, manualDiagnostic };
  }

  async selectAutosaveFile() {
    if (!this.dialog || typeof this.dialog.showOpenDialog !== "function") return null;
    const result = await this.dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "CK3 Save", extensions: ["ck3"] }] });
    if (result.canceled || !result.filePaths?.[0]) return null;
    return { path: result.filePaths[0] };
  }

  async _fileIsStable(savePath) {
    const first = this.fs.statSync(savePath);
    await new Promise((resolve) => setTimeout(resolve, this.stabilityDelayMs));
    const second = this.fs.statSync(savePath);
    return first.size === second.size && first.mtimeMs === second.mtimeMs && second.size > 0;
  }

  _runWorker(savePath) {
    const workerPath = this.path.join(__dirname, "parser-worker.js");
    return new Promise((resolve, reject) => {
      const worker = new this.Worker(workerPath, { workerData: { savePath }, resourceLimits: { maxOldGenerationSizeMb: 1536 } });
      let settled = false;
      const timeout = setTimeout(() => {
        worker.terminate();
        finish(reject, new Error("worldline_worker_timeout"));
      }, this.workerTimeoutMs);
      timeout.unref?.();
      const finish = (handler, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        handler(value);
      };
      worker.once("message", (message) => finish(resolve, message));
      worker.once("error", (error) => finish(reject, error));
      worker.once("exit", (code) => {
        if (code !== 0) finish(reject, new Error(`worldline_worker_exit_${code}`));
      });
    });
  }

  _delta(previous, next) {
    if (!previous) return [];
    const entries = [];
    const previousSnapshot = previous.snapshot;
    const nextSnapshot = next.snapshot;
    const fromDate = previousSnapshot.gameDate;
    const toDate = nextSnapshot.gameDate;
    if (!fromDate || !toDate || (dateValue(toDate) || 0) <= (dateValue(fromDate) || 0)) return [];
    for (const [id, oldCharacter] of Object.entries(previousSnapshot.characters || {})) {
      const currentCharacter = nextSnapshot.characters?.[id];
      const previousLife = resolveLifeStatus(oldCharacter);
      const currentLife = currentCharacter ? resolveLifeStatus(currentCharacter) : null;
      if (previousLife.alive === true && currentLife?.alive === false) entries.push({ id: `death:${id}:${toDate}`, type: "IMPORTANT_CHARACTER_DIED", date: currentCharacter.deathDate || toDate, actors: formatDeltaActors(nextSnapshot, [id]), source: "GAMESTATE", confidence: "CONFIRMED", reconciliationStatus: "CONFIRMED_BY_GAMESTATE" });
    }
    for (const [id, currentWar] of Object.entries(nextSnapshot.wars || {})) {
      if (previousSnapshot.wars?.[id]) continue;
      const startedInWindow = (dateValue(currentWar.startDate) || 0) > (dateValue(fromDate) || 0) && (dateValue(currentWar.startDate) || 0) <= (dateValue(toDate) || Number.MAX_SAFE_INTEGER);
      entries.push({ id: `war-start:${id}:${toDate}`, type: "WAR_STARTED", date: currentWar.startDate || toDate, actors: formatDeltaActors(nextSnapshot, [...(currentWar.attacker || []), ...(currentWar.defender || [])]), source: "GAMESTATE", confidence: startedInWindow ? "CONFIRMED" : "PARTIAL", reconciliationStatus: startedInWindow ? "CONFIRMED_BY_GAMESTATE" : "RECONCILIATION_UNKNOWN" });
    }
    for (const [id, previousWar] of Object.entries(previousSnapshot.wars || {})) {
      if (nextSnapshot.wars?.[id]) continue;
      entries.push({ id: `war-missing:${id}:${toDate}`, type: "WAR_NO_LONGER_ACTIVE", date: toDate, actors: formatDeltaActors(nextSnapshot, [...(previousWar.attacker || []), ...(previousWar.defender || [])]), source: "DERIVED_GAMESTATE", confidence: "UNKNOWN", reconciliationStatus: "RECONCILIATION_PENDING", detail: "War is absent from the next active-war list; no end date or result was inferred." });
    }
    for (const [id, previousTitle] of Object.entries(previousSnapshot.titles || {})) {
      const currentTitle = nextSnapshot.titles?.[id];
      if (!currentTitle || String(previousTitle.holder || "") === String(currentTitle.holder || "")) continue;
      const history = latestHistoryHolder(currentTitle, fromDate, toDate);
      entries.push({ id: `title-holder:${id}:${toDate}`, type: "TITLE_HOLDER_CHANGED", date: history?.date || toDate, actors: formatDeltaActors(nextSnapshot, [previousTitle.holder, currentTitle.holder]), source: history ? "GAMESTATE" : "DERIVED_GAMESTATE", confidence: history ? "CONFIRMED" : "PARTIAL", reconciliationStatus: history ? "CONFIRMED_BY_GAMESTATE" : "RECONCILIATION_PENDING", titleId: id, detail: history ? null : "Current holder changed without history evidence in the checkpoint window." });
    }
    return entries.map((entry) => ({ ...entry, campaignId: nextSnapshot.playthroughId || null, checkpointId: next.id }));
  }

  async rebuildCheckpoint() {
    const settings = this._settings();
    if (!settings.autosavePath) return { success: false, error: "autosave_path_not_configured" };
    const buildRevision = this.sourceRevision;
    const buildSource = settings.autosavePath;
    if (this.buildPromise && this.buildRevision === buildRevision && this._samePath(this.buildSource, buildSource)) return this.buildPromise;
    const buildPromise = (async () => {
      const validation = this.validateAutosavePath();
      if (!this._isCurrentBuild(buildRevision, buildSource)) return { success: false, error: "worldline_build_superseded", superseded: true };
      if (!validation.success) {
        this.lastError = validation.validationStatus;
        this.buildState = this.currentCheckpoint ? "STALE" : "FAILED";
        this._notifyStateChanged("checkpoint_failed");
        return { success: false, error: validation.validationStatus };
      }
      try {
        if (!await this._fileIsStable(buildSource)) {
          if (!this._isCurrentBuild(buildRevision, buildSource)) return { success: false, error: "worldline_build_superseded", superseded: true };
          this.lastError = "save_write_in_progress";
          this.buildState = this.currentCheckpoint ? "STALE" : "FAILED";
          this._notifyStateChanged("checkpoint_deferred");
          return { success: false, error: this.lastError };
        }
        if (!this._isCurrentBuild(buildRevision, buildSource)) return { success: false, error: "worldline_build_superseded", superseded: true };
        this.buildState = "BUILDING";
        this._notifyStateChanged("checkpoint_building");
        const parsed = await this._runWorker(buildSource);
        if (!parsed?.success) throw new Error(parsed?.error || "worldline_parse_failed");
        if (!parsed.snapshot?.gameDate) throw new Error("gamestate_date_missing");
        if (!this._isCurrentBuild(buildRevision, buildSource)) return { success: false, error: "worldline_build_superseded", superseded: true };
        const candidate = {
          id: checkpointId(parsed.snapshot),
          state: "ACTIVE",
          builtAt: nowIso(this.clock),
          source: parsed.source,
          snapshot: parsed.snapshot,
          diagnostics: parsed.diagnostics
        };
        const previous = this.currentCheckpoint;
        const sameCampaign = previous?.snapshot?.playthroughId && candidate.snapshot.playthroughId && previous.snapshot.playthroughId === candidate.snapshot.playthroughId;
        const delta = validation.manualDiagnostic || !sameCampaign ? [] : this._delta(previous, candidate);
        const nextAnnualDelta = [...this.annualDelta, ...delta];
        this._persistCheckpoint(candidate, nextAnnualDelta);
        let liveNames = null;
        try { liveNames = this.getRuntimeNames?.() || null; } catch (_error) { liveNames = null; }
        this.currentCheckpoint = { ...candidate, snapshot: attachRuntimeNameIndex(candidate.snapshot, { live: liveNames, localize: (type, key) => this.localizationResolver?.resolve(type, key) }) };
        this.historicalBindingCache.clear();
        this.annualDelta = nextAnnualDelta;
        this.worldKnowledgeState.stableRecallCache.clear();
        this.worldKnowledgeState.topicPatchCache.clear();
        this.worldKnowledgeState.turnRecallCache.clear();
        this.worldKnowledgeState.summaryCache.clear();
        this.worldKnowledgeState.sharedCandidateCache.clear();
        this.worldKnowledgeState.subjectiveViewCache.clear();
        this.worldKnowledgeState.checkpointId = candidate.id;
        this.worldKnowledgeState.deltaRevision = this.annualDelta.length;
        this.worldKnowledgeState.currentCampaignDeltaRevision = sameCampaign ? this.worldKnowledgeState.currentCampaignDeltaRevision + (delta.length ? 1 : 0) : 0;
        this.lastError = null;
        this.buildState = "ACTIVE";
        try {
          const activeStat = this.fs.statSync(buildSource);
          this.lastObservedFile = `${activeStat.size}:${activeStat.mtimeMs}`;
        } catch (_error) {
          this.lastObservedFile = null;
        }
        this._notifyStateChanged("checkpoint_active");
        if (this._settings().v812TemporalArchiveEnabled) await this.runTemporalArchive({ operation: "capture" });
        return { success: true, checkpoint: this.getCheckpointStatus().checkpoint, deltaAdded: delta.length };
      } catch (error) {
        if (!this._isCurrentBuild(buildRevision, buildSource)) return { success: false, error: "worldline_build_superseded", superseded: true };
        this.lastError = error.message || "worldline_parse_failed";
        this.buildState = this.currentCheckpoint ? "STALE" : "FAILED";
        this._notifyStateChanged("checkpoint_failed");
        return { success: false, error: this.lastError };
      }
    })();
    this.buildPromise = buildPromise;
    this.buildRevision = buildRevision;
    this.buildSource = buildSource;
    try {
      return await buildPromise;
    } finally {
      if (this.buildPromise === buildPromise) {
        this.buildPromise = null;
        this.buildRevision = null;
        this.buildSource = null;
      }
    }
  }

  getCheckpointStatus() {
    const checkpoint = this.currentCheckpoint;
    const snapshot = checkpoint?.snapshot;
    const bindings = Object.keys(snapshot?.definitionToRuntime || {}).length;
    const live = this.getLiveState();
    const freshness = getCheckpointFreshness({ pipelineState: this.buildState, checkpointAsOf: snapshot?.gameDate || null, liveDate: live.gameDate });
    return {
      checkpoint: {
        id: checkpoint?.id || null,
        checkpointId: checkpoint?.id || null,
        status: this.buildState,
        state: this.buildState,
        pipelineState: this.buildState,
        gameDate: snapshot?.gameDate || null,
        checkpointAsOf: freshness.checkpointAsOf,
        liveDate: freshness.liveDate,
        ageDays: freshness.ageDays,
        freshnessStatus: freshness.freshnessStatus,
        verificationMode: freshness.verificationMode,
        freshnessReason: freshness.reason,
        totalDays: live.totalDays || null,
        container: checkpoint?.source?.container || null,
        fileSize: checkpoint?.source?.fileSize || null,
        characters: snapshot?.diagnostics?.characterCount || 0,
        titles: snapshot?.diagnostics?.titleCount || 0,
        activeWars: snapshot?.diagnostics?.activeWarCount || 0,
        historicalBindings: bindings,
        parseDurationMs: checkpoint?.diagnostics?.parseDurationMs || null,
        lastParseDuration: checkpoint?.diagnostics?.parseDurationMs || null,
        freshness: freshness.freshnessStatus,
        lastError: this.lastError
      }
    };
  }

  getLiveState() {
    const debugLogPath = this.settingsRepository.getCK3DebugLogPath?.() || null;
    try {
      const stat = debugLogPath ? this.fs.statSync(debugLogPath) : null;
      const key = stat ? `${debugLogPath}:${stat.size}:${stat.mtimeMs}` : String(debugLogPath || "unconfigured");
      if (this.liveCache.key === key && this.liveCache.value) return clone(this.liveCache.value);
      const value = readLiveProbe({ fs: this.fs, debugLogPath });
      this.liveCache = { key, value };
      return clone(value);
    } catch (_error) {
      return { connected: false, gameDate: null, totalDays: null, characters: [], loadSessionId: null };
    }
  }

  getOverview() {
    const snapshot = this.currentCheckpoint?.snapshot;
    const live = this.getLiveState();
    const checkpoint = this.getCheckpointStatus().checkpoint;
    const politicalContext = snapshot ? resolvePlayerPoliticalContext(snapshot, { localize: (type, rawKey) => this.localizationResolver?.resolveForDisplay(type, rawKey) }) : null;
    const overview = {
      currentPlayer: snapshot ? formatCharacter(snapshot, snapshot.playerId) : null,
      primaryTitle: politicalContext?.primaryTitle?.rawKey || null,
      directLiege: politicalContext?.directLiege?.ruler?.displayName || politicalContext?.directLiege?.title?.rawKey || null,
      topRealmTitle: politicalContext?.topRealmTitle?.rawKey || null,
      currentRuler: politicalContext?.topRealmRuler?.displayName || null,
      politicalContext,
      importantWars: snapshot?.diagnostics?.activeWarCount ?? null,
      historicalBindingStatus: snapshot ? `${Object.keys(snapshot.definitionToRuntime || {}).length} DIRECT` : null,
      pipelineState: checkpoint.pipelineState || checkpoint.status || null,
      checkpointAsOf: checkpoint.checkpointAsOf || snapshot?.gameDate || null,
      ageDays: checkpoint.ageDays ?? null,
      freshness: checkpoint.freshnessStatus || checkpoint.freshness || "UNAVAILABLE",
      freshnessReason: checkpoint.freshnessReason || null,
      verificationMode: checkpoint.verificationMode || "STALE",
      deltaPending: this._currentCampaignDelta().filter((entry) => entry.reconciliationStatus === "PENDING" || entry.reconciliationStatus === "RECONCILIATION_UNKNOWN" || entry.reconciliationStatus === "RECONCILIATION_PENDING").length,
      supplementalCount: this.listSupplemental().supplemental.length,
      liveGameDate: live.gameDate,
      liveConnected: live.connected
    };
    return {
      overview,
      playerView: createPlayerOverview({ snapshot, politicalContext, checkpoint, deltaPending: overview.deltaPending })
    };
  }

  getSubjectiveResponderOptions({ query = "" } = {}) {
    const snapshot = this.currentCheckpoint?.snapshot;
    const characters = snapshot?.characters && typeof snapshot.characters === "object" ? snapshot.characters : {};
    const currentPlayerId = snapshot?.playerId === null || snapshot?.playerId === undefined ? null : String(snapshot.playerId);
    const normalizedQuery = String(query || "").trim().toLocaleLowerCase().slice(0, 120);
    const responders = [];
    let total = 0;
    const matches = (runtimeId, character) => !normalizedQuery || [runtimeId, character?.firstName, character?.fullName].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalizedQuery);
    const add = (runtimeId, character) => {
      if (!matches(runtimeId, character)) return;
      total += 1;
      if (responders.length < 50) responders.push({ responderId: String(runtimeId), displayName: formatCharacter(snapshot, runtimeId) });
    };
    if (currentPlayerId && Object.hasOwn(characters, currentPlayerId)) add(currentPlayerId, characters[currentPlayerId]);
    for (const runtimeId in characters) {
      if (!Object.hasOwn(characters, runtimeId) || runtimeId === currentPlayerId) continue;
      add(runtimeId, responders.length < 50 || normalizedQuery ? characters[runtimeId] : null);
    }
    return {
      responders,
      total,
      truncated: total > responders.length,
      currentPlayerId,
      checkpointId: this.currentCheckpoint?.id || null
    };
  }

  listCanonCharacterOptions({ query = "" } = {}) {
    const snapshot = this.currentCheckpoint?.snapshot;
    const characters = snapshot?.characters && typeof snapshot.characters === "object" ? snapshot.characters : {};
    const playerId = snapshot?.playerId === null || snapshot?.playerId === undefined ? null : String(snapshot.playerId);
    const liveIds = new Set((this.getLiveState().characters || []).map((item) => String(item.runtimeId || "")).filter(Boolean));
    const presentIds = new Set((Array.isArray(snapshot?.presentCharacterIds) ? snapshot.presentCharacterIds : []).map(String));
    const search = String(query || "").trim().toLocaleLowerCase().slice(0, 120);
    const options = [];
    let total = 0;
    const add = (runtimeId, character) => {
      character ||= {};
      const title = Array.isArray(character.domainTitles) ? character.domainTitles[0] || null : null;
      const court = character.courtEmployer || null;
      const realm = character.liege || null;
      const displayName = character.fullName || character.firstName || `#${runtimeId}`;
      const searchable = [runtimeId, displayName, character.firstName, title, court, realm].filter(Boolean).join(" ").toLocaleLowerCase();
      if (search && !searchable.includes(search)) return;
      total += 1;
      if (options.length >= 50) return;
      options.push({ runtimeId: String(runtimeId), displayName, title, alive: character.alive === true, court, realm, recentlyMentioned: liveIds.has(String(runtimeId)), currentlyPresent: presentIds.has(String(runtimeId)) });
    };
    if (playerId && Object.hasOwn(characters, playerId)) add(playerId, characters[playerId]);
    for (const runtimeId in characters) {
      if (!Object.hasOwn(characters, runtimeId) || runtimeId === playerId) continue;
      add(runtimeId, characters[runtimeId]);
    }
    return { options, total, truncated: total > options.length, checkpointId: this.currentCheckpoint?.id || null };
  }

  getAnnualDelta() {
    const sorted = clone(this._currentCampaignDelta()).sort((left, right) => (dateValue(right.date) || 0) - (dateValue(left.date) || 0));
    const annualDelta = sorted.slice(0, MAX_UI_DELTA);
    return { annualDelta, total: sorted.length, truncated: sorted.length > MAX_UI_DELTA, playerView: { annualDelta: createPlayerAnnualDelta(annualDelta) } };
  }

  _currentCampaignDelta() {
    const campaignId = this.currentCheckpoint?.snapshot?.playthroughId || null;
    return this.annualDelta.filter((entry) => (entry.campaignId || null) === campaignId);
  }

  async getHistoricalBindingsAsync(payload = {}) {
    const checkpoint = this.currentCheckpoint;
    await this.historicalDefinitionIndex?.prepare?.([String(payload.query || "").slice(0, 240)], 1500);
    if (checkpoint !== this.currentCheckpoint) return { bindings: [], total: 0, truncated: false };
    return this.getHistoricalBindings(payload);
  }

  getHistoricalBindings({ query = "", status = "ALL" } = {}) {
    const snapshot = this.currentCheckpoint?.snapshot;
    if (!snapshot) return { bindings: [], total: 0 };
    const liveByRuntime = new Map(this.getLiveState().characters.map((item) => [String(item.runtimeId), item]));
    const definitions = snapshot.definitionToRuntime || {};
    const reverseDefinitionIndex = createReverseDefinitionIndex(snapshot);
    const search = String(query || "").trim().toLocaleLowerCase().slice(0, 120);
    const indexedResult = search ? this.historicalDefinitionIndex?.find(search) : null;
    const indexedById = new Map((indexedResult?.candidates || []).map(record => [record.definitionId, record]));
    const branch = this.canon?.branch?.() || { campaignId: snapshot.playthroughId || null, branchId: null };
    const rawStatus = String(status || "ALL").trim().toUpperCase();
    const statusFilter = VALID_BINDING_STATUSES.has(rawStatus) ? rawStatus : "ALL";
    const bindings = [];
    const boundDefinitionIds = new Set();
    let total = 0;
    let matchedTotal = 0;
    let matchedRuntimeTotal = 0;
    for (const definitionId in definitions) {
      if (!Object.prototype.hasOwnProperty.call(definitions, definitionId)) continue;
      total += 1;
      if (!search && statusFilter === "ALL" && bindings.length >= MAX_UI_BINDINGS) continue;
      const runtimeId = definitions[definitionId];
      const live = liveByRuntime.get(String(runtimeId));
      const exactLiveMatch = live?.historyId === definitionId;
      const provenance = snapshot.runtimeToDefinitions?.[String(runtimeId)] || [];
      const ambiguous = provenance.length > 1;
      const liveConflict = !!live?.historyId && !exactLiveMatch;
      const indexed = indexedById.get(definitionId);
      const metadata = HISTORICAL_DEFINITION_METADATA.get(definitionId);
      const binding = {
        figureKey: definitionId,
        definitionId,
        historicalName: historicalDisplayName({ indexed, currentCharacterName: snapshot.characters?.[String(runtimeId)]?.fullName || snapshot.characters?.[String(runtimeId)]?.firstName, metadata, query: search }),
        historicalAliases: metadata?.aliases || [],
        sourceMod: null,
        runtimeId: String(runtimeId),
        liveHistoryId: live?.historyId || null,
        status: ambiguous ? "AMBIGUOUS_PROVENANCE" : liveConflict ? "CONFLICT" : exactLiveMatch ? "LIVE_CONFIRMED" : "DIRECT",
        conflict: ambiguous ? `MULTIPLE_DEFINITIONS:${provenance.join(",")}` : liveConflict ? "LIVE_CONFLICT" : null
      };
      const bindingInput = {
        snapshot,
        reverseDefinitionIndex,
        candidateDefinitionIds: [definitionId],
        definitionRecord: indexedById.get(definitionId) || null,
        scope: { campaignId: branch.campaignId, branchId: branch.branchId, checkpointId: this.currentCheckpoint?.id, datasetRevision: this.historicalDefinitionIndex?.meta?.revision || null }
      };
      const bindingValidation = this.historicalBindingCache?.resolve?.(bindingInput) || resolveHistoricalEntityBinding(bindingInput);
      binding.bindingStatus = bindingValidation.status;
      binding.bindingScope = bindingValidation.bindingScope;
      if (bindingValidation.status !== "RESOLVED_RUNTIME") binding.conflict ||= bindingValidation.reason;
      const character = snapshot.characters?.[String(runtimeId)];
      const currentCharacterName = character?.fullName || character?.firstName || null;
      const searchText = [indexed?.displayName, ...(indexed?.names || []), metadata?.figureKey, ...(metadata?.aliases || []), currentCharacterName, definitionId, runtimeId, live?.historyId].filter(Boolean).join(" ").toLocaleLowerCase();
      if ((search && !searchText.includes(search)) || (statusFilter !== "ALL" && binding.status !== statusFilter)) continue;
      matchedTotal += 1;
      matchedRuntimeTotal += 1;
      if (bindings.length >= MAX_UI_BINDINGS) continue;
      boundDefinitionIds.add(definitionId);
      bindings.push({ ...binding, currentCharacterName });
    }
    if (search && statusFilter === "ALL" && indexedResult?.status === "FOUND") for (const indexed of indexedResult.candidates || []) {
      if (boundDefinitionIds.has(indexed.definitionId)) continue;
      matchedTotal += 1;
      if (bindings.length >= MAX_UI_BINDINGS) continue;
      const metadata = HISTORICAL_DEFINITION_METADATA.get(indexed.definitionId);
      bindings.push({
        figureKey: indexed.definitionId,
        definitionId: indexed.definitionId,
        historicalName: historicalDisplayName({ indexed, currentCharacterName: null, metadata, query: search }),
        historicalAliases: metadata?.aliases || [],
        sourceMod: indexed.sourceRows?.[0]?.source?.modId || null,
        runtimeId: null,
        liveHistoryId: null,
        status: "NO_MATCH",
        conflict: "DEFINITION_FOUND_RUNTIME_MISSING",
        currentCharacterName: null
      });
    }
    const resultTotal = search || statusFilter !== "ALL" ? matchedTotal : total;
    const coverageStatus = indexedResult?.sourceComplete === false || indexedResult?.candidateSetComplete === false ? "SOURCE_INCOMPLETE" : indexedResult?.status === "FOUND" && !matchedRuntimeTotal ? "DEFINITION_FOUND_RUNTIME_MISSING" : indexedResult?.status;
    return { bindings, total: resultTotal, truncated: resultTotal > MAX_UI_BINDINGS, query: search, status: statusFilter, coverageStatus, playerView: { historicalCharacters: createPlayerHistoricalCharacters(bindings, snapshot), coverageStatus } };
  }

  async getEntityKinshipInspectorAsync(payload = {}) {
    const query = String(payload?.query || "").trim().slice(0, 240);
    await this.historicalDefinitionIndex?.prepare?.([query], 1500);
    return this.getEntityKinshipInspector({ ...payload, query });
  }

  getEntityKinshipInspector({ query = "", responderId = null, targetId = null } = {}) {
    const inspectionStartedAt = Date.now();
    const snapshot = this.currentCheckpoint?.snapshot;
    const safeQuery = String(query || "").trim().slice(0, 240);
    const safeId = value => {
      const text = String(value ?? "").trim();
      return /^\d{1,32}$/.test(text) ? text : null;
    };
    const responderRuntimeId = safeId(responderId);
    const explicitTargetId = safeId(targetId);
    if (!snapshot?.characters || !responderRuntimeId || !Object.hasOwn(snapshot.characters, responderRuntimeId)) {
      return { available: false, reason: "RESPONDER_NOT_FOUND", query: safeQuery, checkpointId: this.currentCheckpoint?.id || null };
    }
    const resolver = analyzeSharedQuery({
      snapshot,
      query: safeQuery,
      runtimeContext: { activeParticipantIds: [responderRuntimeId, explicitTargetId].filter(Boolean) },
      localize: (type, rawKey) => this.localizationResolver?.resolve(type, rawKey),
      findLocalizedKeys: (type, value, options) => this.localizationResolver?.findRawKeysByLocalizedValue(type, value, options) || { status: "NO_MATCH", matches: [], sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] },
      historicalDefinitionLookup: typeof this.historicalDefinitionIndex?.find === "function" && !["UNCONFIGURED", "FAILED", "FAILED_TRANSIENT", "FAILED_STABLE"].includes(this.historicalDefinitionIndex.status) ? value => this.historicalDefinitionIndex.find(value) : null,
      historicalNameScan: !["UNCONFIGURED", "FAILED", "FAILED_TRANSIENT", "FAILED_STABLE"].includes(this.historicalDefinitionIndex?.status) && this.historicalDefinitionIndex?.scan ? value => this.historicalDefinitionIndex.scan(value) : null
    });
    const resolvedByQuery = resolver.resolvedCharacters?.length === 1 && resolver.identityResolution?.status !== "AMBIGUOUS" ? String(resolver.resolvedCharacters[0].id) : null;
    let resolvedTargetId = explicitTargetId && Object.hasOwn(snapshot.characters, explicitTargetId) ? explicitTargetId : resolvedByQuery;
    const responder = snapshot.characters[responderRuntimeId];
    const identityCandidates = (resolver.candidateCharacters || []).slice(0, 50).map(candidate => ({
      runtimeId: String(candidate.runtimeId),
      displayName: snapshot.characters?.[String(candidate.runtimeId)]?.fullName || snapshot.characters?.[String(candidate.runtimeId)]?.firstName || `#${candidate.runtimeId}`,
      definitionId: candidate.definitionId || null,
      evidence: candidate.evidence || [],
      conflicts: candidate.conflicts || []
    }));
    const reference = value => {
      if (value && typeof value === "object") return value.displayName || value.fullName || value.name || value.key || value.id || value.runtimeId || null;
      return value === null || value === undefined || value === "" ? null : String(value);
    };
    const relatedReference = value => {
      const raw = value && typeof value === "object" ? value.id ?? value.runtimeId ?? value.characterId : value;
      return formatCharacter(snapshot, raw) || reference(value);
    };
    const relationStartedAt = Date.now();
    const graph = getTargetedKinshipGraph(snapshot, [responderRuntimeId, resolvedTargetId].filter(Boolean));
    const integrity = scanKinshipIntegrity(graph);
    const relationMention = graph ? resolveRelationMention({ query: safeQuery, responderId: responderRuntimeId, graph, recentTargetId: explicitTargetId }) : null;
    if (!explicitTargetId && relationMention?.status === "RELATION_RESOLVED") resolvedTargetId = relationMention.targetRuntimeId;
    const target = resolvedTargetId ? snapshot.characters[resolvedTargetId] : null;
    const targetDefinitionIds = resolvedTargetId ? [...new Set((snapshot.runtimeToDefinitions?.[resolvedTargetId] || []).map(String))] : [];
    const exactEntity = resolver.entityResolutions?.find(item => String(item?.subjectName || "").toLocaleLowerCase() === safeQuery.toLocaleLowerCase()) || null;
    const resolvedEntity = resolvedTargetId ? resolver.entityResolutions?.find(item => (item?.runtimeIds || []).map(String).includes(resolvedTargetId) || targetDefinitionIds.some(id => (item?.historicalDefinitionIds || []).map(String).includes(id))) || null : exactEntity;
    const historicalDefinitionIds = [...new Set((target ? targetDefinitionIds : [...(resolvedEntity?.historicalDefinitionIds || []), ...(resolver.identityResolution?.historicalDefinitionIds || [])]).map(String).filter(Boolean))];
    const explicitTargetResolved = explicitTargetId && target && explicitTargetId === resolvedTargetId;
    const identityStatus = explicitTargetResolved ? "RESOLVED_RUNTIME" : resolvedEntity?.resolutionStatus || resolver.identityResolution?.status || (resolvedTargetId ? "RESOLVED_RUNTIME" : "UNRESOLVED");
    const identityRule = explicitTargetResolved ? "EXPLICIT_RUNTIME_ID" : relationMention?.status === "RELATION_RESOLVED" && !explicitTargetId ? "RELATION_MENTION_UNIQUE" : resolvedEntity?.resolutionMode || resolvedEntity?.identityEvidence?.[0]?.code || resolver.identityResolution?.reason || "NO_MATCH";
    const identityConflicts = explicitTargetResolved ? [] : [...new Set([
      ...(resolver.identityResolution?.status === "AMBIGUOUS" ? [resolver.identityResolution.reason || "MULTIPLE_CANDIDATES"] : []),
      ...(resolvedEntity?.identityEvidence || []).filter(item => item?.category === "IDENTITY_CONFLICT").map(item => item.code),
      ...identityCandidates.flatMap(candidate => candidate.conflicts)
    ].filter(Boolean))];
    const sex = target ? resolveCharacterSexConsensus({ snapshot: target }) : null;
    const life = target ? resolveLifeStatus(target) : null;
    const age = target ? resolveCharacterAge(target, { currentGameDate: snapshot.gameDate, currentTotalDays: snapshot.totalDays }) : null;
    const scopedRelationTypes = relationMention?.status === "RELATION_RESOLVED" ? relationMention.intent?.relationTypes || null : null;
    const relationAnchorId = relationMention?.status === "RELATION_RESOLVED" ? relationMention.relationAnchorRuntimeId : responderRuntimeId;
    const relationResult = resolvedTargetId ? (Array.isArray(scopedRelationTypes) && typeof graph?.relationBetweenOfTypes === "function"
      ? graph.relationBetweenOfTypes(resolvedTargetId, relationAnchorId, scopedRelationTypes)
      : graph?.relationBetween(resolvedTargetId, relationAnchorId)) : null;
    const relation = ["RELATION_AMBIGUOUS", "RELATION_GENDER_CONFLICT", "RELATION_SOURCE_INCOMPLETE"].includes(relationMention?.status) ? {
      status: relationMention.status,
      type: null,
      label: null,
      path: [],
      distance: null,
      source: "RELATION_MENTION",
      conflict: relationMention.status,
      candidates: relationMention.candidates || [],
      candidateTotal: relationMention.candidateTotal ?? relationMention.candidates?.length ?? 0,
      truncated: relationMention.truncated === true
    } : relationResult?.relation ? {
      status: relationResult.relation.source === "SNAPSHOT_DIRECT" || relationResult.relation.source === "LOG_DIRECT" ? "DIRECT" : "DERIVED",
      type: relationResult.relation.type,
      label: relationResult.relation.label,
      relationshipKind: relationResult.relation.relationshipKind || "UNSPECIFIED",
      path: relationResult.relation.structuredPath || [],
      distance: relationResult.relation.structuredPath?.length || 0,
      source: relationResult.relation.source,
      conflict: relationResult.diagnostic || null,
      candidates: relationMention?.candidates || []
    } : {
      status: relationResult?.diagnostic ? "CONFLICT" : resolvedTargetId ? "UNKNOWN" : "TARGET_REQUIRED",
      type: null,
      label: null,
      path: [],
      distance: null,
      source: null,
      conflict: relationResult?.diagnostic || (relationMention?.status && relationMention.status !== "RELATION_UNKNOWN" ? relationMention.status : null),
      candidates: relationMention?.candidates || []
    };
    const relationLatencyMs = Math.max(0, Date.now() - relationStartedAt);
    const familyBundle = resolvedTargetId ? buildFamilyEntityFactBundle({ graph, responderId: responderRuntimeId, relationAnchorId, targetRuntimeId: resolvedTargetId, relationTypes: scopedRelationTypes, temporal: { currentGameDate: snapshot.gameDate, currentTotalDays: snapshot.totalDays } }) : null;
    const branch = this.canon?.branch?.() || { campaignId: snapshot.playthroughId || null, branchId: null };
    const indexed = safeQuery && typeof this.historicalDefinitionIndex?.find === "function" ? this.historicalDefinitionIndex.find(safeQuery) : null;
    const indexedById = new Map((indexed?.candidates || []).map(record => [String(record.definitionId), record]));
    const bindingRows = historicalDefinitionIds.map(definitionId => {
      const validation = this.historicalBindingCache?.resolve?.({
        snapshot,
        candidateDefinitionIds: [definitionId],
        definitionRecord: indexedById.get(definitionId) || null,
        scope: { campaignId: branch.campaignId, branchId: branch.branchId, checkpointId: this.currentCheckpoint?.id, datasetRevision: this.historicalDefinitionIndex?.meta?.revision || null }
      }) || resolveHistoricalEntityBinding({ snapshot, candidateDefinitionIds: [definitionId], definitionRecord: indexedById.get(definitionId) || null, scope: { campaignId: branch.campaignId, branchId: branch.branchId, checkpointId: this.currentCheckpoint?.id, datasetRevision: this.historicalDefinitionIndex?.meta?.revision || null } });
      return { definitionId, status: validation.status, reason: validation.reason, bindingScope: validation.bindingScope };
    });
    const differences = resolvedEntity?.worldlineDifferences || [];
    const entityLatencyMs = Math.max(0, Date.now() - inspectionStartedAt);
    return {
      available: true,
      checkpointId: this.currentCheckpoint?.id || null,
      checkpointAsOf: snapshot.gameDate || null,
      query: safeQuery,
      responder: { runtimeId: responderRuntimeId, displayName: responder.fullName || responder.firstName || `#${responderRuntimeId}` },
      target: target ? { runtimeId: resolvedTargetId, displayName: target.fullName || target.firstName || `#${resolvedTargetId}` } : null,
      identity: {
        input: safeQuery || null,
        runtimeCandidates: explicitTargetResolved ? [] : identityCandidates,
        historicalDefinitionIds,
        resolvedRuntimeId: resolvedTargetId,
        resolutionStatus: identityStatus,
        resolutionRule: identityRule,
        conflicts: identityConflicts,
        evidence: explicitTargetResolved ? [] : resolver.identityResolution?.evidence || []
      },
      state: target ? {
        alive: life?.alive ?? null,
        lifeStatus: life?.status || "UNKNOWN",
        gender: sex?.sex || null,
        genderStatus: sex?.status || "UNKNOWN",
        age: familyBundle?.age ?? age?.age ?? null,
        ageLabel: familyBundle?.ageLabel || age?.label || "age",
        ageSource: age?.source || null,
        location: reference(target.locationName || target.location || target.currentLocation),
        liege: relatedReference(target.liege || target.liegeId || target.directLiege),
        court: reference(target.courtEmployer || target.court || target.courtName),
        death: familyBundle?.death || null
      } : null,
      relation,
      difference: {
        status: resolvedEntity && historicalDefinitionIds.length ? differences.length ? "DIFFERENT" : "NO_DIFFERENCE_DETECTED" : "UNAVAILABLE",
        items: differences,
        bindings: bindingRows
      },
      familyFact: familyBundle ? { relation: familyBundle.relation, relationLabel: familyBundle.relationLabel, relationshipKind: familyBundle.relationshipKind, lifeStatus: familyBundle.lifeStatus, age: familyBundle.age, ageLabel: familyBundle.ageLabel, death: familyBundle.death, sourceTier: familyBundle.sourceTier, sourceComplete: familyBundle.sourceComplete } : null,
      integrity,
      profiling: {
        entityLatencyMs,
        relationLatencyMs,
        bindingCacheSize: this.historicalBindingCache?.entries?.size ?? null,
        kinshipCacheScope: graph?.scopeTruncated ? "REVISION_SCOPED_TARGETED_TRUNCATED" : "REVISION_SCOPED_TARGETED"
      }
    };
  }

  getKinshipIntegrityReport() {
    const snapshot = this.currentCheckpoint?.snapshot;
    if (!snapshot?.characters) return { available: false, status: "UNAVAILABLE", reason: "CHECKPOINT_UNAVAILABLE", checkpointId: this.currentCheckpoint?.id || null, issues: [] };
    const report = scanKinshipIntegrity(getCachedKinshipGraph(snapshot));
    return { ...report, checkpointId: this.currentCheckpoint?.id || null, checkpointAsOf: snapshot.gameDate || null };
  }

  listSupplemental() {
    const checkpointId2 = this.currentCheckpoint?.id || null;
    const supplemental = this.supplemental.filter((item) => item.checkpointId === checkpointId2);
    return { supplemental: clone(supplemental), readOnly: true, legacyCount: supplemental.length };
  }

  _activeLegacySupplemental() {
    const migratedIds = new Set((this.canon.snapshot?.records || []).map((record) => record.legacyMigrationId).filter(Boolean));
    return this.listSupplemental().supplemental.filter((item) => item.hidden !== true && item.migration?.status !== "MIGRATED" && !migratedIds.has(item.id));
  }

  _validateSupplemental(payload, { checkpointDate = null } = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("supplemental_payload_invalid");
    if (typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 160) throw new Error("supplemental_title_invalid");
    if (typeof payload.body !== "string" || !payload.body.trim() || payload.body.length > 12000) throw new Error("supplemental_body_invalid");
    if (!VALID_VISIBILITY.has(payload.visibility || "PUBLIC_WORLD")) throw new Error("supplemental_visibility_invalid");
    if (!VALID_IMPORTANCE.has(payload.importance || "NORMAL")) throw new Error("supplemental_importance_invalid");
    return {
      title: payload.title.trim(),
      body: payload.body.trim(),
      gameDate: typeof payload.gameDate === "string" && payload.gameDate ? payload.gameDate : checkpointDate,
      dateRange: typeof payload.dateRange === "string" && payload.dateRange ? payload.dateRange : null,
      entities: Array.isArray(payload.entities) ? payload.entities.filter((item) => typeof item === "string" && item).slice(0, 32) : [],
      visibility: payload.visibility || "PUBLIC_WORLD",
      importance: payload.importance || "NORMAL",
      hidden: typeof payload.hidden === "boolean" ? payload.hidden : undefined
    };
  }

  _invalidateSupplementalRecall() {
    this.worldKnowledgeState.supplementalRevision += 1;
    this.worldKnowledgeState.turnRecallCache.clear();
  }

  createSupplemental(payload) {
    if (!this.currentCheckpoint) throw new Error("supplemental_checkpoint_unavailable");
    const entry = {
      id: nodeCrypto.randomUUID(),
      ...this._validateSupplemental(payload, { checkpointDate: this.currentCheckpoint?.snapshot?.gameDate || null }),
      source: "PLAYER_SUPPLEMENTAL",
      scope: "CHECKPOINT",
      checkpointScope: "CURRENT_CHECKPOINT",
      checkpointId: this.currentCheckpoint.id,
      createdAt: nowIso(this.clock),
      updatedAt: nowIso(this.clock),
      hidden: false
    };
    const nextEntries = [...this.supplemental, entry];
    this._persistSupplemental(nextEntries);
    this.supplemental = nextEntries;
    this._invalidateSupplementalRecall();
    this._notifyStateChanged("supplemental_created");
    return { supplemental: clone(entry) };
  }

  updateSupplemental(id, payload) {
    const index = this.supplemental.findIndex((item) => item.id === id && item.checkpointId === this.currentCheckpoint?.id);
    if (index < 0) throw new Error("supplemental_not_found");
    const current = this.supplemental[index];
    const validated = this._validateSupplemental(payload, { checkpointDate: current.gameDate || this.currentCheckpoint?.snapshot?.gameDate || null });
    const next = { ...current, ...validated, hidden: typeof validated.hidden === "boolean" ? validated.hidden : current.hidden, updatedAt: nowIso(this.clock) };
    const nextEntries = this.supplemental.slice();
    nextEntries[index] = next;
    this._persistSupplemental(nextEntries);
    this.supplemental = nextEntries;
    this._invalidateSupplementalRecall();
    this._notifyStateChanged("supplemental_updated");
    return { supplemental: clone(next) };
  }

  deleteSupplemental(id) {
    const index = this.supplemental.findIndex((item) => item.id === id && item.checkpointId === this.currentCheckpoint?.id);
    if (index < 0) throw new Error("supplemental_not_found");
    const deleted = this.supplemental[index];
    const nextEntries = this.supplemental.filter((_item, entryIndex) => entryIndex !== index);
    this._persistSupplemental(nextEntries);
    this.supplemental = nextEntries;
    this._invalidateSupplementalRecall();
    this._notifyStateChanged("supplemental_deleted");
    return { success: true, deletedId: deleted.id };
  }

  _legacyMigrationDraft(entry) {
    const visibility = entry.visibility || "PUBLIC_WORLD";
    const entities = (entry.entities || []).map(String).filter((id) => /^\d+$/.test(id)).slice(0, 32);
    const fingerprint = nodeCrypto.createHash("sha256").update(JSON.stringify([entry.id, entry.title, entry.body, entry.gameDate, entry.dateRange, visibility, entities]), "utf8").digest("hex");
    const draft = {
      title: entry.title,
      content: entry.body,
      type: "PLAYER_CANON",
      entities,
      visibility,
      importance: entry.importance || "NORMAL",
      temporalMode: entry.gameDate ? "SPECIFIC_DATE" : "TIMELESS",
      gameDate: entry.gameDate || null,
      knownBy: ["PERSONAL", "SECRET"].includes(visibility) ? entities : [],
      scopeEntityId: ["COURT_PUBLIC", "REALM_PUBLIC"].includes(visibility) ? entities[0] || null : null,
      legacyMigrationId: entry.id,
      legacyContentFingerprint: fingerprint,
      revisionReason: "迁移旧 Supplemental"
    };
    const requiresReview = visibility !== "PUBLIC_WORLD";
    return { status: requiresReview ? "MIGRATION_REVIEW_REQUIRED" : "MIGRATION_READY", legacyId: entry.id, fingerprint, draft, requiresReview };
  }

  getLegacySupplementalMigrationPlan({ id } = {}) {
    const entry = this.listSupplemental().supplemental.find((item) => item.id === id);
    if (!entry) throw new Error("legacy_supplemental_not_found");
    if (entry.migration?.status === "MIGRATED") return { status: "MIGRATED", legacyId: entry.id, canonRecordId: entry.migration.canonRecordId || null };
    return this._legacyMigrationDraft(entry);
  }

  _markLegacyMigrated(id, canonRecordId, fingerprint) {
    const index = this.supplemental.findIndex((item) => item.id === id && item.checkpointId === this.currentCheckpoint?.id);
    if (index < 0) throw new Error("legacy_supplemental_not_found");
    const next = { ...this.supplemental[index], hidden: true, migration: { status: "MIGRATED", canonRecordId, fingerprint, migratedAt: nowIso(this.clock) }, updatedAt: nowIso(this.clock) };
    const nextEntries = this.supplemental.slice();
    nextEntries[index] = next;
    this._persistSupplemental(nextEntries);
    this.supplemental = nextEntries;
    this._invalidateSupplementalRecall();
    this._notifyStateChanged("legacy_supplemental_migrated");
    return next;
  }

  async _migrateLegacySupplementalEntry({ token, id, payload = null } = {}) {
    const prepared = this.getLegacySupplementalMigrationPlan({ id });
    if (prepared.status === "MIGRATED") return prepared;
    if (prepared.requiresReview && !payload) return prepared;
    let reviewedPayload = payload;
    if (prepared.requiresReview) {
      if (!payload || payload.reviewConfirmed !== true) throw new Error("legacy_migration_review_required");
      const visibility = payload.visibility || prepared.draft.visibility;
      const characters = this.currentCheckpoint?.snapshot?.characters || {};
      if (["PERSONAL", "SECRET"].includes(visibility)) {
        if (!Array.isArray(payload.knownBy) || !payload.knownBy.length || payload.knownBy.some((value) => !characters[String(value)])) throw new Error("legacy_migration_acl_review_required");
      }
      if (["COURT_PUBLIC", "REALM_PUBLIC"].includes(visibility) && !characters[String(payload.scopeEntityId || "")]) throw new Error("legacy_migration_scope_review_required");
      const { reviewConfirmed: _reviewConfirmed, ...safePayload } = payload;
      reviewedPayload = safePayload;
    }
    const scope = this.canon.branch();
    if (!scope.branchId || scope.token !== token) throw new Error("branch_write_blocked_reload_editor");
    const state = await this.canon.prepare();
    const existing = state?.records.find((record) => record.legacyMigrationId === prepared.legacyId);
    if (existing) {
      this._markLegacyMigrated(prepared.legacyId, existing.recordId, prepared.fingerprint);
      return { status: "MIGRATED", legacyId: prepared.legacyId, canonRecordId: existing.recordId, deduplicated: true };
    }
    const record = await this.canon.mutate({ token, operation: "create", payload: { ...prepared.draft, ...(reviewedPayload || {}), legacyMigrationId: prepared.legacyId, legacyContentFingerprint: prepared.fingerprint } });
    this._markLegacyMigrated(prepared.legacyId, record.recordId, prepared.fingerprint);
    return { status: "MIGRATED", legacyId: prepared.legacyId, canonRecordId: record.recordId, deduplicated: false };
  }

  migrateLegacySupplementalEntry(input = {}) {
    const id = String(input.id || "");
    if (this.legacyMigrationTasks.has(id)) return this.legacyMigrationTasks.get(id);
    const task = this._migrateLegacySupplementalEntry(input).finally(() => {
      if (this.legacyMigrationTasks.get(id) === task) this.legacyMigrationTasks.delete(id);
    });
    this.legacyMigrationTasks.set(id, task);
    return task;
  }

  getWorldKnowledge() {
    const snapshot = this.currentCheckpoint?.snapshot;
    const politicalContext = snapshot ? resolvePlayerPoliticalContext(snapshot, { localize: (type, rawKey) => this.localizationResolver?.resolveForDisplay(type, rawKey) }) : null;
    const facts = snapshot ? [
      { id: "game-date", field: "GAME_DATE", value: snapshot.gameDate, source: "GAME_TRUTH" },
      { id: "player", field: "CURRENT_PLAYER", value: formatCharacter(snapshot, snapshot.playerId), source: "GAME_TRUTH" },
      { id: "primary-title", field: "PRIMARY_TITLE", value: politicalContext?.primaryTitle?.rawKey || null, displayName: politicalContext?.primaryTitle?.displayName || null, localization: politicalContext?.primaryTitle?.localization || null, source: "GAME_TRUTH" },
      { id: "active-wars", field: "ACTIVE_WARS", value: String(snapshot.diagnostics?.activeWarCount || 0), source: "GAME_TRUTH" }
    ] : [];
    const supplemental = this.listSupplemental().supplemental.map((item) => ({ id: item.id, title: item.title, body: item.body, source: item.source, visibility: item.visibility, hidden: item.hidden }));
    const worldKnowledge = [...facts, ...supplemental];
    return { worldKnowledge, playerView: { worldKnowledge: createPlayerWorldKnowledge(worldKnowledge) } };
  }

  getOfficialRecollectionForResponder(responderId, { estimateTokens: estimate = estimateTokens } = {}) {
    const settings = this._settings();
    const checkpoint = this.currentCheckpoint;
    const sourceMatches = settings.autosavePath && checkpoint?.source?.path && this._samePath(settings.autosavePath, checkpoint.source.path);
    if (!settings.v812OfficialRecollectionEnabled || settings.lastValidationStatus !== "VALID" || this.buildState !== "ACTIVE" || !sourceMatches || !checkpoint?.snapshot) {
      return { status: "UNAVAILABLE", reason: "CHECKPOINT_OR_FEATURE_UNAVAILABLE", entries: [], renderedSummary: null };
    }
    const freshness = getCheckpointFreshness({ pipelineState: this.buildState, checkpointAsOf: checkpoint.snapshot.gameDate, liveDate: this.getLiveState().gameDate });
    if (["STALE", "UNAVAILABLE"].includes(freshness.freshnessStatus)) return { status: "UNAVAILABLE", reason: "CHECKPOINT_STALE", entries: [], renderedSummary: null };
    return compileOfficialRecollection({ snapshot: checkpoint.snapshot, ownerCharacterId: responderId,
      saveFingerprint: checkpoint.source.fingerprint,
      localize: (type, key) => this.localizationResolver?.resolveForDisplay(type, key), estimateTokens: estimate });
  }

  getPromptContext({ query = "", assistContext = "", mentionedEntityIds = [], runtimeContext = null, diagnostic = false, includeScopedSupplemental = false } = {}) {
    const settings = this._settings();
    const safeMentionedEntityIds = Array.isArray(mentionedEntityIds) ? mentionedEntityIds : [];
    const sourceMatches = settings.autosavePath && this.currentCheckpoint?.source?.path && this.path.resolve(settings.autosavePath).toLowerCase() === this.path.resolve(this.currentCheckpoint.source.path).toLowerCase();
    if ((!settings.promptIntegrationEnabled && diagnostic !== true) || settings.lastValidationStatus !== "VALID" || this.buildState !== "ACTIVE" || !sourceMatches || this.path.basename(settings.autosavePath).toLowerCase() !== "autosave.ck3" || !this.currentCheckpoint?.snapshot) return null;
    try {
      const snapshot = this.currentCheckpoint.snapshot;
      const checkpointId2 = this.currentCheckpoint.id;
      const live = this.getLiveState();
      const freshness = getCheckpointFreshness({ pipelineState: this.buildState, checkpointAsOf: snapshot.gameDate, liveDate: live.gameDate });
      if (freshness.freshnessStatus === "STALE" || freshness.freshnessStatus === "UNAVAILABLE") return null;
      if (this.worldKnowledgeState.checkpointId !== checkpointId2) {
        this.worldKnowledgeState.stableRecallCache.clear();
        this.worldKnowledgeState.topicPatchCache.clear();
        this.worldKnowledgeState.turnRecallCache.clear();
        this.worldKnowledgeState.checkpointId = checkpointId2;
        this.worldKnowledgeState.summaryCache.clear();
        this.worldKnowledgeState.sharedCandidateCache.clear();
        this.worldKnowledgeState.subjectiveViewCache.clear();
      }
      let stableText = this.worldKnowledgeState.stableRecallCache.get(checkpointId2);
      if (!stableText) {
        stableText = `=== 世界知识：已确认 Checkpoint（只读 CK3 事实） ===\n- Checkpoint 世界事实截至：${snapshot.gameDate}\n- 当前玩家：${formatCharacter(snapshot, snapshot.playerId) || "未知"}\n- 已索引角色：${snapshot.diagnostics?.characterCount || 0}\n- 活跃战争：${snapshot.diagnostics?.activeWarCount || 0}\n此区块是截至上述日期的年度存档事实；其中的可变事实不得表述为 Live 当前状态。\n事实优先级：本轮 Live、回应角色权威游戏资料与场景直接事实 > 本 Checkpoint > Supplemental > Personal Memory > 模型推断。\n玩家 Canon 或 Supplemental 文本不得覆盖本 Checkpoint；冲突时按上述优先级处理。`;
        this.worldKnowledgeState.stableRecallCache.set(checkpointId2, stableText);
      }
      const queryAnalysis = analyzeSharedQuery({
        snapshot,
        query,
        assistContext,
        mentionedEntityIds: safeMentionedEntityIds,
        runtimeContext,
        localize: (type, rawKey) => this.localizationResolver?.resolve(type, rawKey),
        findLocalizedKeys: (type, value, options) => this.localizationResolver?.findRawKeysByLocalizedValue(type, value, options) || { status: "NO_MATCH", matches: [], sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] },
        historicalDefinitionLookup: !["UNCONFIGURED", "FAILED", "FAILED_TRANSIENT", "FAILED_STABLE"].includes(this.historicalDefinitionIndex?.status) ? (value) => this.historicalDefinitionIndex.find(value) : null,
        historicalNameScan: !["UNCONFIGURED", "FAILED", "FAILED_TRANSIENT", "FAILED_STABLE"].includes(this.historicalDefinitionIndex?.status) && this.historicalDefinitionIndex?.scan ? (value) => this.historicalDefinitionIndex.scan(value) : null
      });
      const queryPlan = buildWorldQueryPlan({ query, assistContext, analysis: queryAnalysis, checkpointDate: snapshot.gameDate });
      const activeSupplemental = this._activeLegacySupplemental();
      const supplementalRevision = relevantSupplementalRevision(activeSupplemental, queryAnalysis, includeScopedSupplemental);
      const mentionedEntityKey = [...new Set(safeMentionedEntityIds.map((id) => String(id)))].sort().join(",");
      const queryFingerprint = nodeCrypto.createHash("sha256").update(queryAnalysis.normalizedQuery || "empty", "utf8").digest("hex").slice(0, 16);
      const mentionedEntityFingerprint = nodeCrypto.createHash("sha256").update(mentionedEntityKey || "none", "utf8").digest("hex").slice(0, 16);
      const audienceFingerprint = nodeCrypto.createHash("sha256").update([...new Set((runtimeContext?.activeParticipantIds || []).map(String))].sort().join(",") || "none", "utf8").digest("hex").slice(0, 16);
      const liveFingerprint = `${live.connected ? "1" : "0"}:${live.gameDate || "none"}:${live.totalDays ?? "none"}:${freshness.freshnessStatus}:${freshness.ageDays ?? "none"}`;
      const cacheKey = `${checkpointId2}:${this.worldKnowledgeState.currentCampaignDeltaRevision}:${supplementalRevision}:${includeScopedSupplemental ? "scoped" : "public"}:${queryFingerprint}:${mentionedEntityFingerprint}:${audienceFingerprint}:${liveFingerprint}:${RETRIEVAL_POLICY_VERSION}:${this.localizationResolver?.revision || 0}:${this.historicalDefinitionIndex?.meta?.revision || this.historicalDefinitionIndex?.status || "none"}`;
      const cached = queryAnalysis.historicalPending ? null : this.worldKnowledgeState.topicPatchCache.get(cacheKey);
      if (cached) return { ...cached, stableText, cacheHit: true };
      const candidateDiagnostics = [];
      const candidates = buildWorldCandidates({ snapshot, analysis: queryAnalysis, queryPlan, annualDelta: this._currentCampaignDelta(), supplemental: activeSupplemental, diagnostics: candidateDiagnostics });
      if (candidates.some(candidate => candidate.kind === "WAR") && runtimeContext?.activeParticipantIds?.length) {
        const roots = createRealmRootIndex(snapshot);
        const audienceRealms = new Set(runtimeContext.activeParticipantIds.map(id => roots.get(String(id))).filter(Boolean));
        for (const candidate of candidates) if (candidate.kind === "WAR" && candidate.entityRefs.characters.some(id => audienceRealms.has(roots.get(id)))) candidate.responderRelationScore = 20;
      }
      const retrieval = rankWorldCandidates(candidates, { plan: queryPlan, checkpointDate: snapshot.gameDate, includeScopedSupplemental });
      retrieval.trimmed.push(...candidateDiagnostics);
      if (queryPlan.ambiguity) retrieval.trimmed.push({ type: "GAME_TRUTH_CHARACTER", id: "historical-candidates", title: "Historical identity candidates", reason: "AMBIGUOUS_IDENTITY" });
      const selected = {
        gameTruth: retrieval.selected.gameTruth.map(candidate => candidate.kind === "WAR" ? localizeWarCandidate(candidate, (type, key) => this.localizationResolver?.resolve(type, key), queryPlan) : candidate),
        supplemental: retrieval.selected.supplemental.slice(),
        delta: retrieval.selected.delta.slice()
      };
      const targetTokenBudget = promptTokenBudget(queryPlan);
      let summaryCacheHit = false;
      const buildRecall = () => {
        const selectedKey = [...selected.gameTruth, ...selected.supplemental, ...selected.delta].map((candidate) => candidate.id).join(",") || "empty";
        const summaryKey = `${cacheKey}:${selectedKey}`;
        let summary = queryAnalysis.historicalPending ? null : this.worldKnowledgeState.summaryCache.get(summaryKey);
        if (summary) summaryCacheHit = true;
        else {
          summary = buildDeterministicWorldSummary({ selected });
          if (!queryAnalysis.historicalPending) this.worldKnowledgeState.summaryCache.set(summaryKey, summary);
          if (this.worldKnowledgeState.summaryCache.size > 64) this.worldKnowledgeState.summaryCache.delete(this.worldKnowledgeState.summaryCache.keys().next().value);
        }
        const topicText = summary.topicItems.length ? `=== 与当前话题相关的 CK3 Checkpoint 事实（截至 ${snapshot.gameDate}） ===\n若与本轮 Live、回应角色权威游戏资料或场景直接事实冲突，必须以后者为准。\n${summary.topicItems.map((item) => item.text).join("\n")}` : null;
        const supplementalText = summary.supplementalItems.length ? `=== 公开 Supplemental 世界知识（叙事来源） ===\n以下内容不能覆盖、修正或否定任何当前 Live、GameState、角色自身资料或场景直接事实；发生冲突时必须忽略冲突的 Supplemental 主张。\n${summary.supplementalItems.map((item) => item.text).join("\n")}` : null;
        const currentDeltaText = [...summary.summaryLines, ...summary.deltaItems.map((item) => item.text)].join("\n");
        const liveDateText = live.gameDate || "Live Probe 未提供";
        const ageText = freshness.ageDays === null ? "无法计算（Live Probe 未提供）" : `${freshness.ageDays} 天`;
        const currentText = `=== 当前世界视图 ===\n- Checkpoint 世界事实截至：${freshness.checkpointAsOf}\n- Live 当前日期：${liveDateText}\n- Checkpoint 新鲜度：${freshness.freshnessStatus}${freshness.ageDays === null ? "" : `（相差 ${ageText}）`}\n${currentDeltaText ? `${currentDeltaText}\n` : ""}只有 Live Probe 直接提供的信息可表述为 Live 当前日期的实时状态；未被 Live Probe 更新的可变事实仍仅截至 Checkpoint 日期。`;
        return { summary, topicText, supplementalText, currentText };
      };
      let recall = buildRecall();
      let worldPromptTokens = estimateTokens([stableText, recall.topicText, recall.supplementalText, recall.currentText].filter(Boolean).join("\n"));
      while (worldPromptTokens > targetTokenBudget) {
        const category = ["supplemental", "delta", "gameTruth"].find((key) => selected[key].length > 0);
        if (!category) break;
        const removed = selected[category].pop();
        retrieval.trimmed.push({ type: removed.category, id: removed.payload?.id || removed.id, title: removed.title, reason: "TOKEN_BUDGET", score: removed.score });
        recall = buildRecall();
        worldPromptTokens = estimateTokens([stableText, recall.topicText, recall.supplementalText, recall.currentText].filter(Boolean).join("\n"));
      }
      if (worldPromptTokens > TOKEN_BUDGETS.HARD_MAX) return null;
      const context = {
        topicText: recall.topicText,
        supplementalText: recall.supplementalText,
        currentText: recall.currentText,
        queryFingerprint,
        queryAnalysis,
        queryPlan,
        retrieval: {
          selected,
          trimmedItems: retrieval.trimmed,
          targetTokenBudget,
          hardTokenBudget: TOKEN_BUDGETS.HARD_MAX,
          supplementalRevision,
          worldPromptTokens,
          summaryCacheHit,
          tokenBudgetExceeded: worldPromptTokens > TOKEN_BUDGETS.HARD_MAX
        },
        checkpointAsOf: freshness.checkpointAsOf,
        liveDate: freshness.liveDate,
        ageDays: freshness.ageDays,
        freshnessStatus: freshness.freshnessStatus,
        verificationMode: freshness.verificationMode,
        cacheHit: false
      };
      if (!queryAnalysis.historicalPending) this.worldKnowledgeState.topicPatchCache.set(cacheKey, context);
      if (this.worldKnowledgeState.topicPatchCache.size > 8) this.worldKnowledgeState.topicPatchCache.delete(this.worldKnowledgeState.topicPatchCache.keys().next().value);
      return { ...context, stableText };
    } catch (_error) {
      return null;
    }
  }

  _sharedPolicyFacts(selected = {}, queryPlan = null) {
    return classifySelectedWorldFacts(selected, this.currentCheckpoint?.snapshot?.gameDate || null, this.currentCheckpoint?.snapshot || null, queryPlan);
  }

  _selfPolicyFacts(snapshot, responderId, runtimeGameData = null) {
    const character = snapshot?.characters?.[String(responderId)];
    if (!character) return [];
    const nameOf = id => snapshot.characters[String(id)]?.fullName || snapshot.characters[String(id)]?.firstName || `#${id}`;
    const fields = [["NAME", character.firstName], ["CHILDREN", character.children?.length ? `子女：${character.children.map(nameOf).join("、")}` : null]];
    const facts = fields.filter(([, value]) => value !== null && value !== undefined && value !== "").map(([field, value]) => ({
      factId: `self:${responderId}:${field}`,
      entityId: String(responderId),
      field,
      value,
      sourceTier: "GAME_TRUTH",
      knowledgeLevel: "SELF",
      selfKnowledgeVerified: true,
      asOf: snapshot.gameDate,
      temporalSafe: true
    }));
    for (const [field, label] of [["location", "所在地点"], ["alive", "生死状态"], ["culture", "文化"], ["faith", "信仰"]]) {
      const fact = currentTruthFact(snapshot, responderId, field, { factId: `self:${responderId}:${field}`, knowledgeLevel: "SELF", selfKnowledgeVerified: true, temporalSafe: true });
      if (fact) facts.push({ ...fact, value: `${nameOf(responderId)}的${label}：${fact.structuredDisplayValue}（截至 ${snapshot.gameDate}）` });
    }
    return [...facts, ...buildSelfSocialTruth(snapshot, responderId, runtimeGameData)];
  }

  _hydrateScopedSupplementalFacts(candidates = []) {
    const entries = new Map(this.listSupplemental().supplemental.map((entry) => [String(entry.id), entry]));
    return (Array.isArray(candidates) ? candidates : []).flatMap((fact) => {
      if (fact?.sourceTier !== "PLAYER_SUPPLEMENTAL" || !fact?.contentRef || fact?.value) return [];
      const entry = entries.get(String(fact.contentRef));
      if (!entry || entry.hidden === true || !["PERSONAL", "SECRET"].includes(entry.visibility)) return [];
      const audienceIds = [...new Set((entry.entities || []).map((value) => String(value || "").trim().replace(/^#/, "")).filter((value) => /^\d+$/.test(value)))];
      if (!audienceIds.length) return [];
      return [{
        ...fact,
        entityId: audienceIds[0],
        value: `${entry.title}：${entry.body}`,
        knowledgeLevel: entry.visibility === "SECRET" ? "SECRET" : "PERSONAL_MEMORY",
        knownBy: audienceIds,
        ownerId: entry.visibility === "PERSONAL" && audienceIds.length === 1 ? audienceIds[0] : null,
        authorizationComplete: true,
        public: false,
        sourceComplete: true,
        candidateSetComplete: true,
        temporalSafe: dateValue(entry.gameDate || this.currentCheckpoint?.snapshot?.gameDate) !== null && dateValue(entry.gameDate || this.currentCheckpoint?.snapshot?.gameDate) <= dateValue(this.currentCheckpoint?.snapshot?.gameDate),
        asOf: entry.gameDate || this.currentCheckpoint?.snapshot?.gameDate || null
      }];
    });
  }

  getSharedCandidatePool({ query = "", assistContext = "", mentionedEntityIds = [], runtimeContext = null } = {}) {
    const startedAt = Date.now();
    const safeQuery = String(query || "").slice(0, 1000);
    const safeAssistContext = String(assistContext || "").slice(0, 2000);
    const safeMentionedEntityIds = [...new Set((Array.isArray(mentionedEntityIds) ? mentionedEntityIds : []).map((id) => String(id)).filter(Boolean))].sort().slice(0, 64);
    const settings = this._settings();
    const live = this.getLiveState();
    const queryFingerprint = shortFingerprint(`${safeQuery}\n${safeAssistContext}`);
    const key = `v8.6-shared:${shortFingerprint({
      checkpointId: this.currentCheckpoint?.id || null,
      checkpointSource: this.currentCheckpoint?.source?.path || null,
      configuredSource: settings.autosavePath,
      validationStatus: settings.lastValidationStatus,
      buildState: this.buildState,
      sourceRevision: this.sourceRevision,
      deltaRevision: this.worldKnowledgeState.currentCampaignDeltaRevision,
      supplementalRevision: this.worldKnowledgeState.supplementalRevision,
      localizationRevision: this.localizationResolver?.revision || 0,
      historicalRevision: this.historicalDefinitionIndex?.meta?.revision || this.historicalDefinitionIndex?.status || "none",
      retrievalPolicyVersion: RETRIEVAL_POLICY_VERSION,
      query: safeQuery,
      assistContext: safeAssistContext,
      mentionedEntityIds: safeMentionedEntityIds,
      runtimeContext: runtimeContext && { activeParticipantIds: Array.isArray(runtimeContext.activeParticipantIds) ? runtimeContext.activeParticipantIds.map(String).sort() : [], recentRuntimeIds: Array.isArray(runtimeContext.recentRuntimeIds) ? runtimeContext.recentRuntimeIds.map(String).sort() : [] },
      live: [live.connected === true, live.gameDate || null, live.totalDays ?? null]
    })}`;
    if (this.worldKnowledgeState.sharedCandidateCache.has(key)) {
      const pool = createSharedCandidatePool({ cache: this.worldKnowledgeState.sharedCandidateCache, key, build: () => [] });
      return { ...pool, key, checkpointId: this.currentCheckpoint?.id || null, queryFingerprint: pool.queryFingerprint || queryFingerprint, sharedRetrievalMs: Date.now() - startedAt };
    }
    const context = this.getPromptContext({ query: safeQuery, assistContext: safeAssistContext, mentionedEntityIds: safeMentionedEntityIds, runtimeContext, diagnostic: true, includeScopedSupplemental: true });
    if (!context?.retrieval) return null;
    const subjectId = context.queryPlan?.entities?.characters?.[0] || null;
    const pool = createSharedCandidatePool({
      cache: this.worldKnowledgeState.sharedCandidateCache,
      key,
      build: () => ({ candidates: this._sharedPolicyFacts(context.retrieval.selected, context.queryPlan), subjectId, queryPlan: context.queryPlan, queryFingerprint: context.queryFingerprint || queryFingerprint })
    });
    return { ...pool, key, checkpointId: this.currentCheckpoint?.id || null, queryFingerprint: pool.queryFingerprint || queryFingerprint, sharedRetrievalMs: Date.now() - startedAt };
  }

  _baselinePolicyFacts(responderId, activeParticipantIds, queryPlan = null) {
    const snapshot = this.currentCheckpoint.snapshot;
    const queryCharacterIds = (queryPlan?.entities?.characters || []).map(String);
    const primary = [...new Set([String(responderId), String(snapshot.playerId || ""), ...queryCharacterIds, ...activeParticipantIds.map(String)].filter(id => snapshot.characters[id]))].slice(0, 8);
    const close = primary.flatMap(id => {
      const character = snapshot.characters[id] || {};
      return [character.spouse, character.liege, character.parents?.father, character.parents?.mother, ...(character.children || []).slice(0, 2)].map(String);
    }).filter(id => snapshot.characters[id] && !primary.includes(id));
    const ids = [...primary, ...new Set(close)].slice(0, 12);
    const titleEntries = Object.entries(snapshot.titles || {});
    const titleRank = entry => ({ h: 6, e: 5, k: 4, d: 3, c: 2, b: 1 })[String(entry?.[1]?.key || entry[0])[0]] || 0;
    const titlesByHolder = new Map();
    for (const entry of titleEntries.filter(([, title]) => ids.includes(String(title?.holder || "")))) {
      const holder = String(entry[1]?.holder || "");
      if (!titlesByHolder.has(holder)) titlesByHolder.set(holder, []);
      titlesByHolder.get(holder).push(entry);
    }
    const heldTitleEntries = [...titlesByHolder.values()].map(entries => entries.sort((a, b) => titleRank(b) - titleRank(a) || a[0].localeCompare(b[0]))[0]);
    const explicitTitleEntries = (queryPlan?.entities?.titles || []).map(id => [String(id), snapshot.titles?.[String(id)]]).filter(([, title]) => title);
    const titles = [...new Map([...explicitTitleEntries, ...heldTitleEntries].map(([id, title]) => [String(id), { id: String(id), displayName: title.key || id }])).values()];
    const plan = { intent: "WAR_STATUS", entities: { characters: ids, titles: [], realms: [], wars: [] }, eventTypes: [], time: { mode: "UNSPECIFIED" }, broadWorldIntent: true };
    const candidates = buildWorldCandidates({ snapshot, analysis: {
      resolvedCharacters: ids.map(id => ({ id, displayName: snapshot.characters[id].fullName || snapshot.characters[id].firstName || `#${id}` })), resolvedTitles: titles
    }, queryPlan: plan, annualDelta: this._currentCampaignDelta(), supplemental: this._activeLegacySupplemental() });
    for (const candidate of candidates) if (candidate.kind === "WAR" && candidate.entityRefs.characters.some(id => primary.includes(String(id)))) candidate.responderRelationScore = 30;
    const ranked = rankWorldCandidates(candidates, { plan, checkpointDate: snapshot.gameDate, includeScopedSupplemental: true }).ranked;
    const requestedTitleHolders = new Set(queryCharacterIds);
    const titleCandidates = ranked.filter(item => item.kind === "TITLE");
    const selectedTitles = [...titleCandidates.filter(item => requestedTitleHolders.has(String(item.payload?.holderId || ""))), ...titleCandidates]
      .filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index).slice(0, 4);
    const selected = {
      gameTruth: [...ranked.filter(item => item.kind === "CHARACTER").slice(0, 12), ...ranked.filter(item => item.kind === "WAR").slice(0, 3), ...selectedTitles],
      delta: ranked.filter(item => item.category === "DELTA").slice(0, 3),
      supplemental: ranked.filter(item => item.category === "SUPPLEMENTAL").slice(0, 2)
    };
    const allFacts = classifySelectedWorldFacts({
      gameTruth: ranked.filter(item => ["CHARACTER", "WAR", "TITLE"].includes(item.kind)),
      delta: ranked.filter(item => item.category === "DELTA"),
      supplemental: ranked.filter(item => item.category === "SUPPLEMENTAL")
    }, snapshot.gameDate, snapshot);
    const selectedFacts = classifySelectedWorldFacts(selected, snapshot.gameDate, snapshot).map(fact => ({ ...fact,
      queryPriority: fact.entityId === String(responderId) ? 60 : fact.entityId === String(snapshot.playerId) ? 50 : primary.includes(String(fact.entityId)) ? 40 : fact.field === "WAR" ? 35 : 20
    }));
    const laneFor = fact => fact.field === "WAR" ? "WAR" : fact.field === "WORLD_EVENT" ? "WORLD_EVENT"
      : fact.field === "LOCATION" ? "LOCATION" : fact.field === "ALIVE" ? "ALIVE"
        : ["NAME", "IDENTITY"].includes(fact.field) ? "IDENTITY" : fact.field === "PRIMARY_TITLE" ? "PRIMARY_TITLE" : null;
    const laneCount = (facts, lane) => new Set(facts.filter(fact => laneFor(fact) === lane)
      .map(fact => ["WAR", "WORLD_EVENT"].includes(lane) ? fact.factId : fact.entityId)).size;
    const skippedActiveWar = Object.values(snapshot.wars || {}).some(war => !war?.endDate)
      && candidates.filter(candidate => candidate.kind === "WAR").length < Object.values(snapshot.wars || {}).filter(war => !war?.endDate).length;
    Object.defineProperty(selectedFacts, "laneSourceCoverage", { value: Object.fromEntries(["WAR", "WORLD_EVENT", "LOCATION", "ALIVE", "IDENTITY", "PRIMARY_TITLE"].map(lane => {
      const candidateCount = laneCount(allFacts, lane), selectedCount = laneCount(selectedFacts, lane);
      return [lane, { candidateCount, selectedCount, complete: candidateCount === selectedCount && !(lane === "WAR" && skippedActiveWar) }];
    })) });
    return selectedFacts;
  }

  getSubjectiveWorldView({ responderId, query = "", assistContext = "", mentionedEntityIds = [], activeParticipantIds = [], conversationId = null, turnEpoch = null, sceneRevision = null, presenceRevision = null, directObservationFactIds = [], directObservationFacts = [], runtimeGameData = null, snapshotMode = null } = {}) {
    const mode = this._settings().subjectiveWorldMode;
    if (!['DIAGNOSTIC', 'PRODUCTION'].includes(mode) || responderId === null || responderId === undefined) return null;
    const snapshot = this.currentCheckpoint?.snapshot;
    const responderId2 = String(responderId);
    if (!snapshot?.characters || !Object.hasOwn(snapshot.characters, responderId2)) return null;
    const startedAt = Date.now();
    const pool = this.getSharedCandidatePool({ query, assistContext, mentionedEntityIds, runtimeContext: { activeParticipantIds } });
    if (!pool) return null;
    const live = this.getLiveState();
    const scopeStartedAt = Date.now();
    const realmRootByCharacter = createRealmRootIndex(snapshot);
    const scope = resolveKnowledgeScope({ snapshot, responderId: responderId2, subjectId: pool.subjectId, live, realmRootByCharacter });
    const memoryStartedAt = Date.now();
    const memoryFacts = memoryFactsForResponder(this.memoryEngine, responderId2);
    const memoryRecallMs = Date.now() - memoryStartedAt;
    const selfFacts = this._selfPolicyFacts(snapshot, responderId2, runtimeGameData);
    const hydratedScopedSupplemental = this._hydrateScopedSupplementalFacts(pool.candidates);
    // Personal and secret Supplemental entries are deliberately body-less in
    // the shared pool. Never pass an unhydrated placeholder to policy: it
    // cannot be displayed safely and must not become a different responder's
    // cache-visible candidate.
    const redactedScopedFactIds = new Set((pool.candidates || []).filter((fact) => fact?.sourceTier === "PLAYER_SUPPLEMENTAL" && ["PERSONAL_MEMORY", "SECRET"].includes(fact?.knowledgeLevel) && !fact?.value).map((fact) => String(fact.factId || "")));
    const querySubjectIds = new Set((pool.queryPlan?.entities?.characters?.length ? pool.queryPlan.entities.characters : pool.candidates.filter(fact => ["NAME", "IDENTITY", "ALIVE", "LOCATION"].includes(fact.field) && snapshot.characters[String(fact.entityId)]).map(fact => fact.entityId)).map(String));
    const safeDirectObservationFacts = (Array.isArray(directObservationFacts) ? directObservationFacts : []).filter((fact) => fact && typeof fact === "object" && fact.knowledgeLevel === "DIRECT_OBSERVATION" && querySubjectIds.has(String(fact.entityId || "")) && Array.isArray(fact.directObserverIds) && fact.directObserverIds.map(String).includes(responderId2)).map((fact) => ({ ...fact, factId: String(fact.factId || ""), entityId: String(fact.entityId), directObserverIds: [responderId2], observationEvidenceComplete: true, temporalSafe: fact.temporalSafe === true, queryPriority: 100 })).sort((left, right) => left.factId.localeCompare(right.factId)).slice(0, 16);
    const baselineFacts = snapshotMode === "CONVERSATION_BASELINE" ? this._baselinePolicyFacts(responderId2, activeParticipantIds, pool.queryPlan) : [];
    const candidates = [...selfFacts, ...memoryFacts, ...baselineFacts, ...pool.candidates.filter((fact) => !redactedScopedFactIds.has(String(fact.factId || ""))), ...hydratedScopedSupplemental, ...safeDirectObservationFacts].filter(fact => !(String(fact.entityId) === responderId2 && SOCIAL_FIELDS.has(fact.field) && fact.verificationMode !== "LIVE_RUNTIME"));
    const closeScopeIds = new Set(pool.candidates.filter(fact => ["LOCATION", "COURT_EMPLOYER", "IDENTITY", "ALIVE"].includes(fact.field)).map(fact => String(fact.entityId)));
    const scopeIds = [...new Set(candidates.flatMap(fact => [String(fact.entityId || ""), ...(fact.scopeEntityIds || [])]).filter(Boolean))];
    const scopeByEntity = new Map(scopeIds.map(entityId => [entityId, resolveKnowledgeScope({ snapshot, responderId: responderId2, subjectId: entityId, live, realmRootByCharacter, runtimeGameData, includeCloseKnowledge: closeScopeIds.has(entityId) })]));
    const scopeResolveMs = Date.now() - scopeStartedAt;
    const safeDirectObservationFactIds = [...new Set((Array.isArray(directObservationFactIds) ? directObservationFactIds : []).map((id) => String(id)).filter(Boolean))].sort().slice(0, 128);
    const memoryRevision = shortFingerprint(memoryFacts.map((fact) => [fact.factId, fact.contentRef, fact.knowledgeLevel, fact.ownerId, fact.knownBy, fact.participantIds, fact.asOf]));
    const scopeRevision = shortFingerprint([...scopeByEntity.entries()].map(([entityId, value]) => [entityId, value.sameCourt, value.sameRealm, value.closeKnowledge, value.asOf, value.verificationMode, value.completeness]));
    const key = `v8.6-subjective:${shortFingerprint({
      sharedKey: pool.key,
      responderId: responderId2,
      conversationId: String(conversationId || "none").slice(0, 128),
      turnEpoch: turnEpoch ?? null,
      sceneRevision: sceneRevision ?? null,
      presenceRevision: presenceRevision ?? null,
      directObservationFactIds: safeDirectObservationFactIds,
      directObservationFacts: safeDirectObservationFacts.map((fact) => [fact.factId, fact.value, fact.asOf]),
      memoryRevision,
      selfRevision: shortFingerprint(selfFacts),
      scopeRevision,
      snapshotMode,
      mode,
      knowledgePolicyVersion: KNOWLEDGE_POLICY_VERSION
    })}`;
    if (this.worldKnowledgeState.subjectiveViewCache.has(key)) {
      const cached = clone(this.worldKnowledgeState.subjectiveViewCache.get(key));
      return { ...cached, cacheHit: true, sharedCacheHit: pool.cacheHit, metrics: { ...cached.metrics, subjectiveCacheHit: true, sharedWorldCacheHit: pool.cacheHit } };
    }
    const policyStartedAt = Date.now();
    const view = buildSubjectiveWorldView({
      responder: { id: responderId2 },
      candidates,
      scope,
      scopeResolver: (fact) => fact.scopeEntityIds?.length ? { sameRealm: fact.scopeEntityIds.some(id => scopeByEntity.get(String(id))?.sameRealm === true) } : scopeByEntity.get(String(fact.entityId || "")) || { sameCourt: null, sameRealm: null, completeness: "INCOMPLETE" },
      checkpointId: this.currentCheckpoint.id,
      directObservationFactIds: safeDirectObservationFactIds,
      snapshotMode,
      baselineLaneSourceCoverage: baselineFacts.laneSourceCoverage || null
    });
    const knowledgePolicyMs = Date.now() - policyStartedAt;
    const result = {
      mode,
      ...view,
      queryIntent: pool.queryPlan?.intent || null,
      whereaboutsBlockedCount: view.diagnostics.filter(item => item.reason === "WHEREABOUTS_NOT_KNOWN").length,
      queryFingerprint: pool.queryFingerprint || null,
      cacheHit: false,
      sharedCacheHit: pool.cacheHit,
      metrics: {
        sharedRetrievalMs: pool.sharedRetrievalMs || 0,
        knowledgePolicyMs,
        scopeResolveMs,
        memoryRecallMs,
        subjectiveSummaryMs: 0,
        subjectiveCacheHit: false,
        sharedWorldCacheHit: pool.cacheHit,
        candidateInputCount: candidates.length,
        knownCount: view.allowedFacts.length,
        filteredCount: view.filteredCount,
        secretBlockedCount: view.secretBlockedCount,
        ipcBytes: 0,
        totalMs: Date.now() - startedAt
      }
    };
    result.metrics.ipcBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (result.metrics.ipcBytes > 500 * 1024) return null;
    this.worldKnowledgeState.subjectiveViewCache.set(key, result);
    const responderKeys = [...this.worldKnowledgeState.subjectiveViewCache.entries()].filter(([, entry]) => entry.responderId === responderId2).map(([cacheKey]) => cacheKey);
    while (responderKeys.length > 8) this.worldKnowledgeState.subjectiveViewCache.delete(responderKeys.shift());
    if (this.worldKnowledgeState.subjectiveViewCache.size > 128) this.worldKnowledgeState.subjectiveViewCache.delete(this.worldKnowledgeState.subjectiveViewCache.keys().next().value);
    return clone(result);
  }

  isSubjectivePromptIntegrationEnabled() {
    const settings = this._settings();
    return settings.promptIntegrationEnabled === true && settings.subjectiveWorldMode === "PRODUCTION";
  }

  async listCanon(options) {
    return { ...await this.canon.list(options), promptEnabled: this.isSubjectivePromptIntegrationEnabled() };
  }

  mutateCanon(payload) { return this.canon.mutate(payload); }
  getCanonCurrentTruth(payload) { return this.canon.getCurrentTruth(payload); }
  getCanonHistory(payload) { return this.canon.history(payload); }
  getLegacySupplementalMigration(payload) { return this.getLegacySupplementalMigrationPlan(payload); }
  migrateLegacySupplemental(payload) { return this.migrateLegacySupplementalEntry(payload); }
  confirmCanonBranch(token) { return this.canon.confirm(token); }
  forkCanonBranch(token) { return this.canon.fork(token); }
  resumeCanonBranch(payload) { return this.canon.resume(payload); }
  renameCanonBranch(payload) { return this.canon.rename(payload); }
  async testCanonRecall(payload) {
    const responderId = String(payload?.responderId || "");
    if (!this.currentCheckpoint?.snapshot?.characters?.[responderId]) throw new Error("canon_test_responder_not_found");
    const result = await this.canon.testRecall(payload);
    if (!this.isSubjectivePromptIntegrationEnabled()) return { ...result, matched: false, selected: false, tokens: 0, promptText: null, reason: "RECALL_DISABLED", recallEnabled: false };
    return { ...result, recallEnabled: true };
  }
  async prepareCanon() {
    let timer;
    try {
      await Promise.race([this.canon.prepare(), new Promise(resolve => { timer = setTimeout(resolve, 1500); })]);
    } catch (_error) { /* Optional Canon failure must not suppress CK3 recall. */ }
    finally { clearTimeout(timer); }
  }

  getHistoricalQueryContext({ responderId = null, query = "", assistContext = "", queryPlan = null, queryAnalysis = null, directObservationFacts = [], tokenBudget = null, precomputed = null } = {}) {
    const settings = this._settings();
    if (!settings.v812HistoricalRetrievalEnabled || !this.currentCheckpoint?.snapshot) return null;
    const base = queryPlan && queryAnalysis ? { queryPlan, queryAnalysis } : this.getPromptContext({ query, assistContext, diagnostic: true });
    if (!base?.queryPlan || !isHistoricalQueryPlan(base.queryPlan)) return null;
    const scope = this.canon.branch();
    const archiveRoot = this.path.join(this.dataDir, "worldline-v8.12");
    let archiveRevision = 0;
    if (precomputed) archiveRevision = Number(precomputed.retrieval?.cacheKeyParts?.historicalArchiveRevision) || 0;
    else try { archiveRevision = new HistoricalCheckpointIndex(archiveRoot, scope).load().archiveRevision; }
    catch (_error) { /* The retriever returns a stable reason code below. */ }
    const effectiveResponderId = responderId === null || responderId === undefined ? this.currentCheckpoint.snapshot.playerId : responderId;
    const memoryFacts = memoryFactsForResponder(this.memoryEngine, effectiveResponderId);
    const safeDirectObservationFacts = (Array.isArray(directObservationFacts) ? directObservationFacts : []).filter(fact => fact && typeof fact === "object" && fact.knowledgeLevel === "DIRECT_OBSERVATION" && fact.entityId !== undefined && Array.isArray(fact.directObserverIds) && fact.directObserverIds.map(String).includes(String(effectiveResponderId)) && ["LOCATION"].includes(String(fact.field || "").toLocaleUpperCase())).map(fact => ({ ...fact, factId: String(fact.factId || ""), entityId: String(fact.entityId), directObserverIds: [String(effectiveResponderId)], observationEvidenceComplete: true })).slice(0, 16);
    const canonRevision = this.canon.snapshot?.revision || 0;
    const cacheKey = `v8.12-history:${shortFingerprint({
      campaignId: scope.campaignId,
      branchId: scope.branchId,
      archiveRevision,
      historicalIndexLayoutVersion: INDEX_LAYOUT_VERSION,
      historicalKnowledgePolicyVersion: HISTORICAL_KNOWLEDGE_POLICY_VERSION,
      queryPlan: base.queryPlan,
      realmRefs: base.queryPlan.entities?.realms || [],
      responderId: effectiveResponderId === null || effectiveResponderId === undefined ? null : String(effectiveResponderId),
      memoryRevision: shortFingerprint(memoryFacts.map(fact => [fact.factId, fact.asOf, fact.ownerId, fact.knownBy, fact.participantIds, fact.field, fact.structured])),
      directObservationRevision: shortFingerprint(safeDirectObservationFacts.map(fact => [fact.factId, fact.entityId, fact.field, fact.asOf])),
      canonRevision,
      tokenBudget: tokenBudget == null ? 900 : Number(tokenBudget)
    })}`;
    if (this.worldKnowledgeState.historicalRecallCache.has(cacheKey)) return { ...clone(this.worldKnowledgeState.historicalRecallCache.get(cacheKey)), cacheHit: true };
    const store = new TemporalArchiveStore({ root: archiveRoot });
    const retrieval = precomputed?.retrieval || retrieveHistorical({
      store,
      scope,
      queryPlan: base.queryPlan,
      queryAnalysis: base.queryAnalysis,
      query: `${query}\n${assistContext}`,
      currentDate: this.currentCheckpoint.snapshot.gameDate,
      responderId: effectiveResponderId,
      memoryFacts,
      directObservationFacts: safeDirectObservationFacts,
      memoryRevision: shortFingerprint(memoryFacts.map(fact => [fact.factId, fact.asOf, fact.ownerId, fact.knownBy, fact.participantIds, fact.field, fact.structured])),
      canonRevision
    });
    let canon = { text: null, tokens: 0, selected: [], revision: canonRevision };
    if (retrieval.success && retrieval.diagnostics?.selectedHistoricalCheckpoint) {
      const checkpointIds = Array.isArray(retrieval.diagnostics.selectedHistoricalCheckpoint) ? retrieval.diagnostics.selectedHistoricalCheckpoint : [retrieval.diagnostics.selectedHistoricalCheckpoint];
      const projections = precomputed ? precomputed.projections || [] : checkpointIds.map(checkpointId => store.read(scope, checkpointId)).filter(Boolean);
      const projection = projections.at(-1);
      if (projection && effectiveResponderId !== null && effectiveResponderId !== undefined) canon = this.canon.recallHistorical({
        responderId: String(effectiveResponderId),
        query: `${query}\n${assistContext}`,
        entityIds: base.queryPlan.entities?.characters || [],
        asOf: Array.isArray(retrieval.diagnostics.checkpointDate) ? retrieval.diagnostics.checkpointDate.at(-1) : retrieval.diagnostics.checkpointDate,
        from: base.queryPlan.time?.mode === "RANGE" ? base.queryPlan.time.from : null,
        projection,
        projections,
        tokenBudget: Math.min(320, Math.max(0, (tokenBudget == null ? 900 : Number(tokenBudget)) - 480))
      });
    }
    const formatted = buildHistoricalPrompt(retrieval, { tokenBudget: tokenBudget == null ? 900 : Number(tokenBudget), canonText: canon.text });
    const result = {
      ...retrieval,
      selected: formatted.selected,
      trimmed: formatted.trimmed,
      promptText: formatted.text,
      promptTokens: formatted.tokens,
      canon: { selected: (canon.selected || []).map(item => ({ type: "HISTORICAL_CANON", recordId: item.recordId, revision: item.revision })), selectedCount: canon.selected?.length || 0, tokens: canon.tokens || 0, revision: canon.revision || canonRevision, conflictCount: canon.conflictCount || 0, temporalBlockedCount: canon.temporalBlockedCount || 0, visibilityBlockedCount: canon.visibilityBlockedCount || 0 },
      diagnostics: { ...retrieval.diagnostics, selectedCount: formatted.selected.length, trimmedCount: formatted.trimmed.length, canonRevision: canon.revision || canonRevision },
      stablePrefixFingerprint: shortFingerprint(buildWorldStablePrompt({ checkpointId: this.currentCheckpoint.id, checkpointAsOf: this.currentCheckpoint.snapshot.gameDate, hasStableCanon: false }) || ""),
      dynamicTailFingerprint: shortFingerprint(formatted.text || retrieval.reason || "empty"),
      cacheHit: false
    };
    this.worldKnowledgeState.historicalRecallCache.set(cacheKey, result);
    if (this.worldKnowledgeState.historicalRecallCache.size > 32) this.worldKnowledgeState.historicalRecallCache.delete(this.worldKnowledgeState.historicalRecallCache.keys().next().value);
    return clone(result);
  }

  async getHistoricalQueryContextAsync(args = {}) {
    const settings = this._settings();
    if (!settings.v812HistoricalRetrievalEnabled || !this.currentCheckpoint?.snapshot) return null;
    const base = args.queryPlan && args.queryAnalysis ? { queryPlan: args.queryPlan, queryAnalysis: args.queryAnalysis }
      : this.getPromptContext({ query: args.query || "", assistContext: args.assistContext || "", diagnostic: true });
    if (!isHistoricalQueryPlan(base?.queryPlan)) return null;
    const checkpoint = this.currentCheckpoint;
    const scope = this.canon.branch();
    const responderId = args.responderId ?? checkpoint.snapshot.playerId;
    const memoryFacts = memoryFactsForResponder(this.memoryEngine, responderId);
    const directObservationFacts = (Array.isArray(args.directObservationFacts) ? args.directObservationFacts : [])
      .filter(fact => fact && fact.knowledgeLevel === "DIRECT_OBSERVATION" && ["LOCATION"].includes(String(fact.field || "").toLocaleUpperCase())
        && Array.isArray(fact.directObserverIds) && fact.directObserverIds.map(String).includes(String(responderId)))
      .map(fact => ({ ...fact, directObserverIds: [String(responderId)], observationEvidenceComplete: true })).slice(0, 16);
    let precomputed;
    try {
      precomputed = await new Promise((resolve, reject) => {
        const worker = new this.Worker(this.path.join(__dirname, "historical-retrieval-worker.js"), {
          workerData: { root: this.path.join(this.dataDir, "worldline-v8.12"), includeCanonProjections: (this.canon.snapshot?.records?.length || 0) > 0, input: {
            scope, queryPlan: base.queryPlan, queryAnalysis: base.queryAnalysis, query: `${args.query || ""}\n${args.assistContext || ""}`,
            currentDate: checkpoint.snapshot.gameDate, responderId, memoryFacts, directObservationFacts,
            memoryRevision: shortFingerprint(memoryFacts.map(fact => [fact.factId, fact.asOf, fact.ownerId, fact.knownBy, fact.participantIds, fact.field, fact.structured])),
            canonRevision: this.canon.snapshot?.revision || 0
          } }, resourceLimits: { maxOldGenerationSizeMb: 1024 }
        });
        const timeout = setTimeout(() => { worker.terminate(); reject(new Error("HISTORY_WORKER_TIMEOUT")); }, this.workerTimeoutMs);
        let received = false;
        worker.once("message", value => { received = true; clearTimeout(timeout); if (value.error) reject(new Error(value.error)); else resolve(value); });
        worker.once("error", error => { clearTimeout(timeout); reject(error); });
        worker.once("exit", () => { clearTimeout(timeout); if (!received) reject(new Error("HISTORY_WORKER_STOPPED")); });
      });
    } catch (error) {
      return { success: false, status: "BLOCKED", reason: error.message || "HISTORY_WORKER_STOPPED", selected: [], trimmed: [], promptText: null, diagnostics: { reasonCodes: [error.message || "HISTORY_WORKER_STOPPED"], selectedCount: 0 } };
    }
    const currentScope = this.canon.branch();
    if (this.currentCheckpoint !== checkpoint || currentScope.campaignId !== scope.campaignId || currentScope.branchId !== scope.branchId) return { success: false, status: "BLOCKED", reason: "HISTORY_CHECKPOINT_CHANGED", selected: [], trimmed: [], promptText: null };
    return this.getHistoricalQueryContext({ ...args, queryPlan: base.queryPlan, queryAnalysis: base.queryAnalysis, precomputed });
  }

  async getSubjectivePromptContextAsync(args = {}) {
    if (!this.isSubjectivePromptIntegrationEnabled()) return null;
    const settings = this._settings();
    const historicalHint = settings.v812HistoricalRetrievalEnabled && settings.v812HistoricalPromptInjection
      ? parseTimeHint(`${args.query || ""}\n${args.assistContext || ""}`, this.currentCheckpoint?.snapshot?.gameDate) : null;
    if (!settings.v812HistoricalPromptInjection || !isHistoricalQueryPlan({ time: historicalHint })) return this.getSubjectivePromptContext(args);
    const historicalBase = this.getPromptContext({ query: args.query || "", assistContext: args.assistContext || "", mentionedEntityIds: args.mentionedEntityIds || [], runtimeContext: { activeParticipantIds: args.activeParticipantIds || [] }, diagnostic: true, includeScopedSupplemental: true });
    if (!isHistoricalQueryPlan(historicalBase?.queryPlan)) return this.getSubjectivePromptContext(args);
    const historical = await this.getHistoricalQueryContextAsync({ ...args, queryPlan: historicalBase.queryPlan, queryAnalysis: historicalBase.queryAnalysis });
    return this.getSubjectivePromptContext({ ...args, historicalPrecomputed: historical });
  }

  getSubjectiveCoveragePatch({ excludeFactIds = [], missingFields = [], tokenBudget = 300, ...args } = {}) {
    if (!this.isSubjectivePromptIntegrationEnabled()) return null;
    const view = this.getSubjectiveWorldView({ ...args, snapshotMode: "CONVERSATION_BASELINE" });
    if (!view) return null;
    const frozenIds = new Set(excludeFactIds.map(String));
    const facts = view.promptFacts.filter((fact) => !frozenIds.has(String(fact.factId || "")) && (!missingFields.length || missingFields.some((missing) => {
      if (fact.field !== missing.field && !(missing.field === "LOCATION" && fact.field === "PRESENCE")) return false;
      if (!missing.entityId && !missing.entityIds?.length) return true;
      if (missing.entityIds?.length) return fact.field === "WAR" && missing.entityIds.every(id => fact.scopeEntityIds?.map(String).includes(String(id)) || fact.scopeTitleIds?.map(String).includes(String(id)) || String(fact.entityId) === String(id) || String(fact.entityId) === `war:${id}`);
      return String(fact.entityId) === String(missing.entityId) || fact.field === "PRIMARY_TITLE" && String(fact.factId || "").includes(`title:${missing.entityId}:`);
    })));
    const header = "=== 本轮世界知识补充 ===\n以下是当前回应角色获准知晓、但开场冻结视图未收录的事实；其中可能包含本轮直接观察。除明确标记的当前观察外，不应将这些内容理解为刚刚发生的新世界事件。\n";
    const partialWarning = "【完整性提示】以下仅为当前上下文预算内可提供的部分获准事实，不代表完整列表。\n";
    const format = prefix => buildSubjectiveWorldTurnRecall({ ...view, promptFacts: facts }, { tokenBudget: Math.max(0, tokenBudget - estimateTokens(prefix)) });
    let prefix = header;
    let formatted = format(prefix);
    let patchTruncated = formatted.selectedFacts.length < facts.length || formatted.trimmed.length > 0;
    if (patchTruncated) {
      prefix = header + partialWarning;
      formatted = format(prefix);
      patchTruncated = formatted.selectedFacts.length < facts.length || formatted.trimmed.length > 0;
    }
    const fullPatchText = formatted.text && estimateTokens(prefix + formatted.text) <= tokenBudget ? prefix + formatted.text : null;
    const noFactsFitText = facts.length ? `${header}${partialWarning}当前补充预算未能容纳任何事实；这不代表事实不存在。\n` : null;
    const patchText = fullPatchText || (!formatted.text && patchTruncated && noFactsFitText && estimateTokens(noFactsFitText) <= tokenBudget ? noFactsFitText : null);
    const patchSelectedCount = fullPatchText ? formatted.selectedFacts.length : 0;
    patchTruncated = patchTruncated || patchSelectedCount < facts.length;
    return { patchText, patchFacts: patchText ? formatted.selectedFacts : [], patchTokens: patchText ? estimateTokens(patchText) : 0,
      patchCandidateCount: facts.length, patchSelectedCount, patchTruncated,
      checkpointId: view.checkpointId, cacheHit: view.cacheHit === true,
      filteredCount: view.filteredCount, secretBlockedCount: view.secretBlockedCount };
  }

  getSubjectivePromptContext({ responderId, query = "", assistContext = "", mentionedEntityIds = [], activeParticipantIds = [], conversationId = null, turnEpoch = null, sceneRevision = null, presenceRevision = null, directObservationFactIds = [], directObservationFacts = [], historicalReferenceInfo = null, tokenBudget = null, runtimeGameData = null, historicalPrecomputed = undefined, snapshotMode = null } = {}) {
    if (!this.isSubjectivePromptIntegrationEnabled()) return null;
    const settings = this._settings();
    const historicalHint = settings.v812HistoricalRetrievalEnabled && settings.v812HistoricalPromptInjection
      ? parseTimeHint(`${query}\n${assistContext}`, this.currentCheckpoint?.snapshot?.gameDate) : null;
    const historicalBase = isHistoricalQueryPlan({ time: historicalHint })
      ? this.getPromptContext({ query, assistContext, mentionedEntityIds, runtimeContext: { activeParticipantIds }, diagnostic: true, includeScopedSupplemental: true }) : null;
    if (settings.v812HistoricalPromptInjection && isHistoricalQueryPlan(historicalBase?.queryPlan)) {
      const historical = historicalPrecomputed === undefined ? this.getHistoricalQueryContext({ responderId, query, assistContext, queryPlan: historicalBase.queryPlan, queryAnalysis: historicalBase.queryAnalysis, directObservationFacts, tokenBudget }) : historicalPrecomputed;
      const blockedText = historical?.promptText || `=== 本轮历史检索（CK3 存档时间线 / Dynamic Tail） ===\n未获得可安全使用的历史事实（${historical?.reason || "HISTORY_UNAVAILABLE"}）。不得用现实历史传记、当前关系或未来节点补全答案；应明确说明存档历史资料不足。`;
      const referenceDate = Array.isArray(historical?.diagnostics?.checkpointDate) ? historical.diagnostics.checkpointDate.at(-1) : historical?.diagnostics?.checkpointDate || this.currentCheckpoint.snapshot.gameDate;
      return {
        worldStableText: buildWorldStablePrompt({ checkpointId: this.currentCheckpoint.id, checkpointAsOf: this.currentCheckpoint.snapshot.gameDate, hasStableCanon: false }),
        worldTurnRecallText: blockedText,
        worldTurnRecallTokens: estimateTokens(blockedText),
        worldTurnRecallTrimmed: historical?.trimmed || [],
        historicalReferenceInfo: buildHistoricalReferenceReplacement(historicalReferenceInfo, referenceDate),
        queryFingerprint: historicalBase.queryFingerprint || shortFingerprint(`${query}\n${assistContext}`),
        cacheHit: historical?.cacheHit === true,
        metrics: {
          queryIntent: historicalBase.queryPlan.intent,
          historicalTimeMode: historicalBase.queryPlan.time.mode,
          historicalCandidateCount: historical?.diagnostics?.candidateCount || 0,
          historicalSelectedCount: historical?.diagnostics?.selectedCount || 0,
          historicalTrimmedCount: historical?.diagnostics?.trimmedCount || 0,
          historicalKnowledgeDeniedCount: historical?.diagnostics?.knowledgeDeniedCount || 0,
          historicalConflictCount: historical?.diagnostics?.conflictCount || 0,
          worldFactsRendered: historical?.diagnostics?.selectedCount || 0,
          worldFactsTrimmed: historical?.diagnostics?.trimmedCount || 0,
          worldRetrievalMs: 0,
          worldPolicyMs: 0,
          worldFormatMs: 0,
          worldTurnRecallTokens: estimateTokens(blockedText)
        }
      };
    }
    const view = this.getSubjectiveWorldView({ responderId, query, assistContext, mentionedEntityIds, activeParticipantIds, conversationId, turnEpoch, sceneRevision, presenceRevision, directObservationFactIds, directObservationFacts, runtimeGameData, snapshotMode });
    if (!view) return null;
    const formatStartedAt = Date.now();
    const baseline = snapshotMode === "CONVERSATION_BASELINE";
    const formatted = baseline ? buildSubjectiveWorldBaselinePrompt(view, { tokenBudget }) : buildSubjectiveWorldTurnRecall(view, { tokenBudget });
    const remaining = tokenBudget == null ? 512 : Math.max(0, tokenBudget - formatted.tokens - 2);
    const stableCanon = this.canon.recall({ responderId, stable: true, conversationId, tokenBudget: 192, currentFacts: view.allowedFacts || [] });
    const canon = baseline ? { text: null, selected: [] } : this.canon.recall({ responderId, query, entityIds: mentionedEntityIds, tokenBudget: Math.min(512, remaining), currentFacts: view.allowedFacts || [], excludeIds: stableCanon.selected.map(item => item.recordId) });
    const turnText = [formatted.text, canon.text].filter(Boolean).join("\n\n") || null;
    const turnTokens = turnText ? estimateTokens(turnText) : 0;
    return {
      worldStableText: [buildWorldStablePrompt({ checkpointId: view.checkpointId, checkpointAsOf: view.asOf, hasStableCanon: !!stableCanon.text }), stableCanon.text?.replace("本轮玩家 Canon", "会话固定玩家 Canon（V8.7）")].filter(Boolean).join("\n\n") || null,
      worldTurnRecallText: turnText,
      worldTurnRecallTokens: turnTokens,
      ...(baseline ? { baselineFacts: formatted.selectedFacts, baselineLanes: formatted.lanes, baselineLaneCoverage: formatted.laneCoverage,
        baselineTruncated: formatted.trimmed || view.truncated, baselineCandidateSetComplete: view.candidateSetComplete, checkpointId: view.checkpointId } : {}),
      worldTurnRecallTrimmed: formatted.trimmed,
      historicalReferenceInfo: buildHistoricalReferenceReplacement(historicalReferenceInfo, view.asOf),
      queryFingerprint: view.queryFingerprint || null,
      cacheHit: view.cacheHit === true,
      metrics: {
        ...view.metrics,
        queryIntent: view.queryIntent,
        whereaboutsBlockedCount: view.whereaboutsBlockedCount,
        worldFactsRendered: formatted.selectedCount,
        worldFactsTrimmed: formatted.trimmed.length,
        worldRetrievalMs: view.metrics?.sharedRetrievalMs || 0,
        worldPolicyMs: view.metrics?.knowledgePolicyMs || 0,
        worldFormatMs: Date.now() - formatStartedAt,
        worldTurnRecallTokens: turnTokens,
        supplementalCandidateCount: canon.candidateCount || 0,
        supplementalSelectedCount: canon.selected.length,
        supplementalTokens: canon.tokens,
        supplementalStableTokens: stableCanon.tokens,
        supplementalStableCacheHit: stableCanon.cacheHit === true,
        supplementalCacheHit: canon.cacheHit === true,
        supplementalRevision: canon.revision || 0,
        canonConflictCount: canon.conflictCount || 0,
        canonTemporalBlockedCount: canon.temporalBlockedCount || 0,
        canonVisibilityBlockedCount: canon.visibilityBlockedCount || 0
      }
    };
  }

  async getPromptDiagnosticsAsync(payload = {}) {
    const checkpoint = this.currentCheckpoint;
    const deadline = Date.now() + 8000;
    const historicalBudgetMs = Math.min(1500, Math.max(0, deadline - Date.now()));
    const query = `${String(payload.query || "").slice(0, 1000)}\n${String(payload.assistContext || "").slice(0, 2000)}`;
    if (this.historicalDefinitionIndex?.prepareQuery) {
      await this.historicalDefinitionIndex.prepareQuery(query, historicalBudgetMs);
      const overrides = HISTORICAL_ALIAS_CATALOG.flatMap(entry => entry.aliases.filter(alias => query.includes(alias)));
      await this.historicalDefinitionIndex.prepare([query.trim(), ...overrides], Math.max(1, Math.min(1500, deadline - Date.now())));
    } else await this.historicalDefinitionIndex?.prepare?.(collectTerms(query), historicalBudgetMs);
    if (this.localizationResolver.pending?.size) await this.localizationResolver.settle(Math.max(1, deadline - Date.now()));
    if (this.currentCheckpoint !== checkpoint) return { promptDiagnostics: { available: false, reason: "CHECKPOINT_CHANGED", query: String(payload.query || "").slice(0, 1000) } };
    let historicalPrecomputed;
    if (this._settings().v812HistoricalDiagnostics) {
      const context = this.getPromptContext({ query: String(payload.query || "").slice(0, 1000), assistContext: String(payload.assistContext || "").slice(0, 2000), diagnostic: true });
      if (isHistoricalQueryPlan(context?.queryPlan)) historicalPrecomputed = await this.getHistoricalQueryContextAsync({ query: String(payload.query || "").slice(0, 1000), assistContext: String(payload.assistContext || "").slice(0, 2000), queryPlan: context.queryPlan, queryAnalysis: context.queryAnalysis, tokenBudget: TOKEN_BUDGETS.COMPLEX });
    }
    if (this.currentCheckpoint !== checkpoint) return { promptDiagnostics: { available: false, reason: "CHECKPOINT_CHANGED", query: String(payload.query || "").slice(0, 1000) } };
    const result = this.getPromptDiagnostics({ ...payload, historicalPrecomputed });
    result.promptDiagnostics.localizationPending = this.localizationResolver.pending?.size > 0;
    return result;
  }

  getPromptDiagnostics({ query = "", assistContext = "", trimmedPage = 0, historicalPrecomputed = undefined } = {}) {
    const safeQuery = String(query || "").slice(0, 1000);
    const context = this.getPromptContext({ query: safeQuery, assistContext: String(assistContext || "").slice(0, 2000), diagnostic: true });
    const runtime = this.getDiagnostics().diagnostics;
    if (!context) {
      const reason = runtime.freshnessStatus === "STALE" ? "CHECKPOINT_STALE" : runtime.freshnessStatus === "UNAVAILABLE" ? "CHECKPOINT_UNAVAILABLE" : "PROMPT_CONTEXT_UNAVAILABLE";
      return {
        promptDiagnostics: {
          available: false,
          query: safeQuery,
          reason,
          checkpointAsOf: runtime.checkpointAsOf,
          liveDate: runtime.liveDate,
          ageDays: runtime.ageDays,
          freshnessStatus: runtime.freshnessStatus,
          verificationMode: runtime.verificationMode,
          worldPromptTokens: 0,
          cacheHit: false,
          queryAnalysis: { normalizedQuery: safeQuery.trim().toLocaleLowerCase(), terms: [], characters: [], titles: [], resolvedCharacters: [], candidateCharacters: [], resolvedTitles: [], candidateTitles: [], identityResolution: { status: "NO_MATCH", reason: "CONTEXT_UNAVAILABLE", evidence: [], candidates: [] }, matchedAliases: [] },
          resolverTrace: { localization: { status: "NO_MATCH", sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] }, historical: { status: "NO_MATCH", aliases: [], matchedDefinitionIds: [], matchedRuntimeIds: [], matchSources: [] }, runtime: { status: "NO_MATCH" } },
          gameTruth: { characters: [], titles: [] },
          supplemental: [],
          tokenBreakdown: [],
          trimmedItems: []
        }
      };
    }
    const analysis = context.queryAnalysis || { normalizedQuery: safeQuery.trim().toLocaleLowerCase(), terms: [], characters: [], titles: [], matchedAliases: [] };
    const selected = context.retrieval?.selected || { gameTruth: [], supplemental: [], delta: [] };
    const selectedSupplemental = selected.supplemental.map((candidate) => candidate.payload);
    const trimmedItems = (context.retrieval?.trimmedItems || []).slice();
    const gameTruth = {
      characters: selected.gameTruth.filter((candidate) => candidate.kind === "CHARACTER").map((candidate) => candidate.payload.match),
      titles: selected.gameTruth.filter((candidate) => candidate.kind === "TITLE").map((candidate) => candidate.payload.match)
    };
    for (const id of (analysis.candidateCharacterIds || []).slice((analysis.limits?.maxCharacters || 4))) {
      const character = this.currentCheckpoint?.snapshot?.characters?.[id];
      if (character) trimmedItems.push({ type: "GAME_TRUTH_CHARACTER", id, title: character.fullName || character.firstName || `#${id}`, reason: "QUERY_RESULT_LIMIT" });
    }
    for (const id of (analysis.candidateTitleIds || []).slice((analysis.limits?.maxTitles || 3))) {
      const title = this.currentCheckpoint?.snapshot?.titles?.[id];
      if (title) trimmedItems.push({ type: "GAME_TRUTH_TITLE", id, title: title.key || `#${id}`, reason: "QUERY_RESULT_LIMIT" });
    }
    const trimmedPageSize = 50;
    const candidateTotal = Math.max(analysis.identityResolution?.candidates?.length || 0, analysis.candidateCharacters?.length || 0);
    const page = Math.min(Math.max(0, Math.floor(Number(trimmedPage) || 0)), Math.max(0, Math.ceil(Math.max(trimmedItems.length, candidateTotal) / trimmedPageSize) - 1));
    const diagnosticAnalysis = { ...analysis, candidateCharacters: (analysis.candidateCharacters || []).slice(page * 50, (page + 1) * 50), identityResolution: { ...analysis.identityResolution, candidateTotal, candidates: (analysis.identityResolution?.candidates || []).slice(page * 50, (page + 1) * 50), evidence: (analysis.identityResolution?.evidence || []).slice(0, 200) } };
    const historical = this._settings().v812HistoricalDiagnostics && isHistoricalQueryPlan(context.queryPlan)
      ? historicalPrecomputed === undefined ? this.getHistoricalQueryContext({ query: safeQuery, assistContext: String(assistContext || "").slice(0, 2000), queryPlan: context.queryPlan, queryAnalysis: context.queryAnalysis, tokenBudget: TOKEN_BUDGETS.COMPLEX }) : historicalPrecomputed : null;
    const tokenBreakdown = [
      ["worldline-stable", "Stable World Checkpoint", context.stableText],
      ["worldline-topic", "Topic Game Truth", context.topicText],
      ["worldline-supplemental", "Supplemental", context.supplementalText],
      ["worldline-current", "Current World View", context.currentText],
      ["worldline-historical-preview", "Historical Dynamic Tail Preview", historical?.promptText]
    ].filter(([, , content]) => content).map(([id, label, content]) => ({ id, label, tokens: estimateTokens(content) }));
    return {
      promptDiagnostics: {
        available: true,
        query: safeQuery,
        queryAnalysis: diagnosticAnalysis,
        candidateTotal,
        historicalCoverage: analysis.historicalCoverage || [],
        historicalIndex: {
          status: this.historicalDefinitionIndex?.status || "UNCONFIGURED",
          sourceComplete: ["READY", "PARTIAL"].includes(this.historicalDefinitionIndex?.status) && this.historicalDefinitionIndex?.meta?.sourceComplete === true,
          revision: this.historicalDefinitionIndex?.meta?.revision || null,
          diagnostics: this.historicalDefinitionIndex?.meta?.diagnostics || null
        },
        localizationIncomplete: analysis.resolverTrace?.localization?.sourceComplete === false,
        queryPlan: context.queryPlan,
        historicalRetrieval: historical ? {
          success: historical.success,
          status: historical.status,
          reason: historical.reason,
          diagnostics: historical.diagnostics,
          selected: historical.selected,
          trimmed: historical.trimmed,
          promptText: historical.promptText,
          promptTokens: historical.promptTokens,
          cacheHit: historical.cacheHit === true,
          stablePrefixFingerprint: historical.stablePrefixFingerprint,
          dynamicTailFingerprint: historical.dynamicTailFingerprint,
          canon: historical.canon
        } : null,
        retrieval: {
          selected: {
            gameTruth: selected.gameTruth.map((candidate) => ({ id: candidate.id, kind: candidate.kind, score: candidate.score, scoreBreakdown: candidate.scoreBreakdown })),
            supplemental: selected.supplemental.map((candidate) => ({ id: candidate.id, score: candidate.score, scoreBreakdown: candidate.scoreBreakdown })),
            delta: selected.delta.map((candidate) => ({ id: candidate.id, eventType: candidate.eventType, score: candidate.score, scoreBreakdown: candidate.scoreBreakdown }))
          },
          targetTokenBudget: context.retrieval?.targetTokenBudget || null,
          hardTokenBudget: context.retrieval?.hardTokenBudget || null,
          summaryCacheHit: context.retrieval?.summaryCacheHit === true,
          tokenBudgetExceeded: context.retrieval?.tokenBudgetExceeded === true
        },
        resolverTrace: analysis.resolverTrace,
        gameTruth,
        supplemental: selectedSupplemental.map((entry) => ({ id: entry.id, title: entry.title, body: entry.body, visibility: entry.visibility })),
        checkpointAsOf: context.checkpointAsOf,
        liveDate: context.liveDate,
        ageDays: context.ageDays,
        freshnessStatus: context.freshnessStatus,
        verificationMode: context.verificationMode,
        worldPromptTokens: tokenBreakdown.reduce((total, block) => total + block.tokens, 0),
        cacheHit: context.cacheHit === true,
        tokenBreakdown,
        trimmedTotal: trimmedItems.length,
        trimmedPage: page,
        trimmedPageSize,
        trimmedItems: clone(trimmedItems.slice(page * trimmedPageSize, (page + 1) * trimmedPageSize))
      }
    };
  }

  async runTemporalArchive({ operation = "inspect" } = {}) {
    let ownedWorker = null;
    try {
      if (!["capture", "inspect"].includes(operation)) throw new Error("history_operation_invalid");
      if (this.archiveWorker) throw new Error("HISTORY_BUSY");
      const settings = this._settings();
      if (operation === "capture" && !settings.v812TemporalArchiveEnabled) throw new Error("HISTORY_DISABLED");
      const checkpoint = this.currentCheckpoint;
      const scope = this.canon.branch();
      const freshness = getCheckpointFreshness({ pipelineState: this.buildState, checkpointAsOf: checkpoint?.snapshot?.gameDate, liveDate: this.getLiveState().gameDate });
      const input = { checkpoint, scope, pipelineState: this.buildState, freshness: freshness.freshnessStatus,
        parserComplete: this.buildState === "ACTIVE", sourceMatches: settings.lastValidationStatus === "VALID" && this._samePath(checkpoint?.source?.path, settings.autosavePath) };
      const result = await new Promise((resolve, reject) => {
        const worker = new NodeWorker(this.path.join(__dirname, "temporal-archive-worker.js"), { workerData: { root: this.path.join(this.dataDir, "worldline-v8.12"), operation, input: operation === "capture" ? input : { scope } }, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
        ownedWorker = worker;
        this.archiveWorker = worker;
        const timeout = setTimeout(() => { worker.terminate(); reject(new Error("HISTORY_WORKER_TIMEOUT")); }, this.workerTimeoutMs);
        let received = false;
        worker.once("message", value => { received = true; clearTimeout(timeout); resolve(value); });
        worker.once("error", error => { clearTimeout(timeout); reject(error); });
        worker.once("exit", () => { clearTimeout(timeout); if (!received) reject(new Error("HISTORY_WORKER_STOPPED")); });
      });
      this.archiveResult = result;
      return result;
    } catch (error) {
      const result = { success: false, status: "BLOCKED", error: error.message };
      if (error.message !== "HISTORY_BUSY") this.archiveResult = result;
      return result;
    } finally {
      // A concurrent diagnostic must not release another operation's worker.
      if (ownedWorker && this.archiveWorker === ownedWorker) this.archiveWorker = null;
    }
  }

  getDiagnostics() {
    const settings = this._settings();
    const live = this.getLiveState();
    const freshness = getCheckpointFreshness({ pipelineState: this.buildState, checkpointAsOf: this.currentCheckpoint?.snapshot?.gameDate || null, liveDate: live.gameDate });
    return {
      diagnostics: {
        savePath: settings.autosavePath,
        validationStatus: settings.lastValidationStatus,
        lastValidatedAt: settings.lastValidatedAt,
        watcherStatus: this.watcher ? "WATCHING" : settings.autoWatchEnabled ? "IDLE" : "DISABLED",
        parserState: this.buildState,
        container: this.currentCheckpoint?.source?.container || null,
        parseDurationMs: this.currentCheckpoint?.diagnostics?.parseDurationMs || null,
        checkpointId: this.currentCheckpoint?.id || null,
        checkpointGameDate: this.currentCheckpoint?.snapshot?.gameDate || null,
        pipelineState: freshness.pipelineState,
        checkpointAsOf: freshness.checkpointAsOf,
        liveDate: freshness.liveDate,
        ageDays: freshness.ageDays,
        freshnessStatus: freshness.freshnessStatus,
        verificationMode: freshness.verificationMode,
        freshnessReason: freshness.reason,
        deltaRevision: this.worldKnowledgeState.currentCampaignDeltaRevision,
        deltaStoredTotal: this.annualDelta.length,
        retrievalPolicyVersion: RETRIEVAL_POLICY_VERSION,
        temporalArchive: {
          enabled: settings.v812TemporalArchiveEnabled,
          shadowMode: true,
          historicalRetrievalEnabled: settings.v812HistoricalRetrievalEnabled,
          historicalPromptInjection: settings.v812HistoricalPromptInjection,
          historicalPromptIntegration: settings.v812HistoricalPromptInjection,
          historicalDiagnostics: settings.v812HistoricalDiagnostics,
          historicalCacheEntries: this.worldKnowledgeState.historicalRecallCache.size,
          result: this.archiveResult || null
        },
        memoryEngine3: {
          enabled: settings.v812MemoryEngine3Enabled,
          officialRecollectionEnabled: settings.v812OfficialRecollectionEnabled,
          officialRecollectionPromptEnabled: settings.v812OfficialRecollectionPromptEnabled,
          temporalSummaryRecallEnabled: settings.v812TemporalSummaryRecallEnabled,
          officialMemoryCount: Object.keys(this.currentCheckpoint?.snapshot?.officialMemoryDatabase || {}).length
        },
        catalogStatus: "NOT_CONNECTED",
        branchStatus: "UNKNOWN_WITHOUT_SAVE_AB_GATE",
        lastError: this.lastError
      }
    };
  }

  _scheduleRefresh() {
    if (this.pendingRefresh) clearTimeout(this.pendingRefresh);
    this.pendingRefresh = setTimeout(async () => {
      this.pendingRefresh = null;
      const settings = this._settings();
      try {
        const previousLiveKey = this.liveCache.key;
        this.getLiveState();
        if (previousLiveKey !== null && this.liveCache.key !== previousLiveKey) this._notifyStateChanged("live_updated");
        const stat = this.fs.statSync(settings.autosavePath);
        const nextObserved = `${stat.size}:${stat.mtimeMs}`;
        if (nextObserved === this.lastObservedFile) return;
        const result = await this.rebuildCheckpoint();
        if (result?.success) this.lastObservedFile = nextObserved;
      } catch (_error) {
        this.lastError = "autosave_watch_read_failed";
        this._notifyStateChanged("watcher_failed");
      }
    }, 500);
  }

  startWatcher() {
    const settings = this._settings();
    if (!settings.autoWatchEnabled || settings.lastValidationStatus !== "VALID" || !settings.autosavePath || this.path.basename(settings.autosavePath).toLowerCase() !== "autosave.ck3" || this.watcher) return;
    try {
      const directory = this.path.dirname(settings.autosavePath);
      const baseName = this.path.basename(settings.autosavePath);
      this.watcher = this.fs.watch(directory, (_event, fileName) => {
        if (!fileName || String(fileName).toLowerCase() === baseName.toLowerCase()) this._scheduleRefresh();
      });
      this.poller = setInterval(() => this._scheduleRefresh(), this.pollIntervalMs);
      this.poller.unref?.();
    } catch (_error) {
      this.lastError = "autosave_watcher_unavailable";
    }
  }

  stopWatcher() {
    if (this.pendingRefresh) clearTimeout(this.pendingRefresh);
    if (this.watcher) this.watcher.close();
    if (this.poller) clearInterval(this.poller);
    this.pendingRefresh = null;
    this.watcher = null;
    this.poller = null;
  }

  async start() {
    const settings = this._settings();
    if (!settings.autosavePath) return this.syncAutosaveFromCK3Folder();
    return this.rebuildCheckpoint();
  }

  dispose() {
    this.archiveWorker?.terminate();
    this.stopWatcher();
    this.localizationResolver?.dispose?.();
    this.historicalDefinitionIndex?.dispose?.();
  }
}

module.exports = { DEFAULT_SETTINGS, WorldlineService, normalizeSettings, readLiveProbe };
