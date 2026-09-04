"use strict";

const nodeCrypto = require("node:crypto");
const nodeFs = require("fs");
const nodePath = require("path");
const { Worker: NodeWorker } = require("worker_threads");
const { readSavePreamble } = require("./save-container");
const { dateValue } = require("./game-state-adapter");
const { resolvePlayerPoliticalContext } = require("./political-context");
const { LocalizationWorkerClient } = require("./localization-worker-client");
const { getCheckpointFreshness } = require("./checkpoint-freshness");
const { analysisTextMatches, analyzeSharedQuery } = require("./shared-query-analyzer");
const { HISTORICAL_ALIAS_CATALOG } = require("./historical-alias-catalog");
const { RETRIEVAL_POLICY_VERSION, buildWorldQueryPlan } = require("./world-query-planner");
const { buildWorldCandidates } = require("./world-retriever");
const { rankWorldCandidates } = require("./world-ranker");
const { buildDeterministicWorldSummary } = require("./world-summary");
const { createPlayerAnnualDelta, createPlayerHistoricalCharacters, createPlayerOverview, createPlayerWorldKnowledge } = require("./world-presentation");
const { estimateTokens } = require("../token-estimator");

const DEFAULT_SETTINGS = Object.freeze({
  autosavePath: null,
  autoWatchEnabled: true,
  promptIntegrationEnabled: false,
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

function promptTokenBudget(plan) {
  const entityCount = (plan?.entities?.characters?.length || 0) + (plan?.entities?.titles?.length || 0);
  if (plan?.time?.mode === "AS_OF" || plan?.time?.mode === "RANGE" || entityCount > 1 || plan?.intent === "HISTORY_LOOKUP") return TOKEN_BUDGETS.COMPLEX;
  return entityCount === 1 ? TOKEN_BUDGETS.SINGLE_ENTITY : TOKEN_BUDGETS.SIMPLE;
}

function relevantSupplementalRevision(entries, analysis) {
  const relevant = (entries || []).filter((entry) => !entry.hidden && entry.visibility === "PUBLIC_WORLD" && analysisTextMatches(analysis, `${entry.title}\n${entry.body}\n${Array.isArray(entry.entities) ? entry.entities.join(" ") : ""}`));
  const signature = JSON.stringify(relevant.map((entry) => [entry.id, entry.updatedAt || "", entry.title, entry.body, entry.gameDate || "", entry.dateRange || "", entry.importance, entry.source, entry.entities || []]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  return nodeCrypto.createHash("sha256").update(signature, "utf8").digest("hex").slice(0, 16);
}

function normalizeSettings(value) {
  const settings = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    autosavePath: typeof settings.autosavePath === "string" && settings.autosavePath ? settings.autosavePath : null,
    autoWatchEnabled: settings.autoWatchEnabled !== false,
    promptIntegrationEnabled: settings.promptIntegrationEnabled === true,
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
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function readLiveProbe({ fs, debugLogPath }) {
  if (!debugLogPath || !fs.existsSync(debugLogPath)) return { connected: false, gameDate: null, totalDays: null, characters: [] };
  try {
    const text = readTail(fs, debugLogPath);
    const inMatches = [...text.matchAll(/VOTC:IN\/;\/init\/;\/[^\r\n]*?\/;\/([^/\r\n]+)\/;\/[^/\r\n]*?\/;\/[^/\r\n]*?\/;\/(\d+)/g)];
    const dateMatches = [...text.matchAll(/VOTC:TEST_DATE\/;\/([^/\r\n]+)\/;\/(?:days=)?(\d+)/g)];
    const characterMatches = [...text.matchAll(/VOTC:TEST_CHAR\/;\/runtime=([^/\r\n]+)\/;\/history=([^/\r\n]*)\/;\/date=([^/\r\n]+)(?:\/;\/days=(\d+))?/g)];
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
      characters: [...latestCharacterById.values()]
    };
  } catch (_error) {
    return { connected: false, gameDate: null, totalDays: null, characters: [] };
  }
}

class WorldlineService {
  constructor({ settingsRepository, dataDir, fs = nodeFs, path = nodePath, Worker = NodeWorker, dialog = null, clock = () => new Date(), stabilityDelayMs = 750, pollIntervalMs = 30000, workerTimeoutMs = 120000 } = {}) {
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
    this.storageDir = path.join(dataDir, "worldline-v8.4");
    this.checkpointPath = path.join(this.storageDir, "checkpoint.json");
    this.supplementalPath = path.join(this.storageDir, "supplemental.json");
    this.currentCheckpoint = null;
    this.annualDelta = [];
    this.supplemental = [];
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
        this._notifyStateChanged("localization_updated");
      }
    });
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
      if (oldCharacter.alive && currentCharacter && !currentCharacter.alive) entries.push({ id: `death:${id}:${toDate}`, type: "IMPORTANT_CHARACTER_DIED", date: currentCharacter.deathDate || toDate, actors: formatDeltaActors(nextSnapshot, [id]), source: "GAMESTATE", confidence: "CONFIRMED", reconciliationStatus: "CONFIRMED_BY_GAMESTATE" });
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
        this.currentCheckpoint = candidate;
        this.annualDelta = nextAnnualDelta;
        this.worldKnowledgeState.stableRecallCache.clear();
        this.worldKnowledgeState.topicPatchCache.clear();
        this.worldKnowledgeState.turnRecallCache.clear();
        this.worldKnowledgeState.summaryCache.clear();
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
      return { connected: false, gameDate: null, totalDays: null, characters: [] };
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

  getAnnualDelta() {
    const sorted = clone(this._currentCampaignDelta()).sort((left, right) => (dateValue(right.date) || 0) - (dateValue(left.date) || 0));
    const annualDelta = sorted.slice(0, MAX_UI_DELTA);
    return { annualDelta, total: sorted.length, truncated: sorted.length > MAX_UI_DELTA, playerView: { annualDelta: createPlayerAnnualDelta(annualDelta) } };
  }

  _currentCampaignDelta() {
    const campaignId = this.currentCheckpoint?.snapshot?.playthroughId || null;
    return this.annualDelta.filter((entry) => (entry.campaignId || null) === campaignId);
  }

  getHistoricalBindings({ query = "", status = "ALL" } = {}) {
    const snapshot = this.currentCheckpoint?.snapshot;
    if (!snapshot) return { bindings: [], total: 0 };
    const liveByRuntime = new Map(this.getLiveState().characters.map((item) => [String(item.runtimeId), item]));
    const definitions = snapshot.definitionToRuntime || {};
    const search = String(query || "").trim().toLocaleLowerCase().slice(0, 120);
    const rawStatus = String(status || "ALL").trim().toUpperCase();
    const statusFilter = VALID_BINDING_STATUSES.has(rawStatus) ? rawStatus : "ALL";
    const bindings = [];
    let total = 0;
    let matchedTotal = 0;
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
      const metadata = HISTORICAL_DEFINITION_METADATA.get(definitionId);
      const binding = {
        figureKey: definitionId,
        definitionId,
        historicalName: metadata?.aliases?.[0] || null,
        historicalAliases: metadata?.aliases || [],
        sourceMod: null,
        runtimeId: String(runtimeId),
        liveHistoryId: live?.historyId || null,
        status: ambiguous ? "AMBIGUOUS_PROVENANCE" : liveConflict ? "CONFLICT" : exactLiveMatch ? "LIVE_CONFIRMED" : "DIRECT",
        conflict: ambiguous ? `MULTIPLE_DEFINITIONS:${provenance.join(",")}` : liveConflict ? "LIVE_CONFLICT" : null
      };
      const character = snapshot.characters?.[String(runtimeId)];
      const currentCharacterName = character?.fullName || character?.firstName || null;
      const searchText = [metadata?.figureKey, ...(metadata?.aliases || []), currentCharacterName, definitionId, runtimeId, live?.historyId].filter(Boolean).join(" ").toLocaleLowerCase();
      if ((search && !searchText.includes(search)) || (statusFilter !== "ALL" && binding.status !== statusFilter)) continue;
      matchedTotal += 1;
      if (bindings.length >= MAX_UI_BINDINGS) continue;
      bindings.push({ ...binding, currentCharacterName });
    }
    const resultTotal = search || statusFilter !== "ALL" ? matchedTotal : total;
    return { bindings, total: resultTotal, truncated: resultTotal > MAX_UI_BINDINGS, query: search, status: statusFilter, playerView: { historicalCharacters: createPlayerHistoricalCharacters(bindings, snapshot) } };
  }

  listSupplemental() {
    const checkpointId2 = this.currentCheckpoint?.id || null;
    return { supplemental: clone(this.supplemental.filter((item) => item.checkpointId === checkpointId2)) };
  }

  _validateSupplemental(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("supplemental_payload_invalid");
    if (typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 160) throw new Error("supplemental_title_invalid");
    if (typeof payload.body !== "string" || !payload.body.trim() || payload.body.length > 12000) throw new Error("supplemental_body_invalid");
    if (!VALID_VISIBILITY.has(payload.visibility || "PUBLIC_WORLD")) throw new Error("supplemental_visibility_invalid");
    if (!VALID_IMPORTANCE.has(payload.importance || "NORMAL")) throw new Error("supplemental_importance_invalid");
    return {
      title: payload.title.trim(),
      body: payload.body.trim(),
      gameDate: typeof payload.gameDate === "string" && payload.gameDate ? payload.gameDate : null,
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
      ...this._validateSupplemental(payload),
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
    const validated = this._validateSupplemental(payload);
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

  getPromptContext({ query = "", assistContext = "", mentionedEntityIds = [], diagnostic = false } = {}) {
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
        localize: (type, rawKey) => this.localizationResolver?.resolve(type, rawKey),
        findLocalizedKeys: (type, value, options) => this.localizationResolver?.findRawKeysByLocalizedValue(type, value, options) || { status: "NO_MATCH", matches: [], sourceComplete: true, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] }
      });
      const queryPlan = buildWorldQueryPlan({ query, assistContext, analysis: queryAnalysis });
      const activeSupplemental = this.listSupplemental().supplemental;
      const supplementalRevision = relevantSupplementalRevision(activeSupplemental, queryAnalysis);
      const mentionedEntityKey = [...new Set(safeMentionedEntityIds.map((id) => String(id)))].sort().join(",");
      const queryFingerprint = nodeCrypto.createHash("sha256").update(queryAnalysis.normalizedQuery || "empty", "utf8").digest("hex").slice(0, 16);
      const mentionedEntityFingerprint = nodeCrypto.createHash("sha256").update(mentionedEntityKey || "none", "utf8").digest("hex").slice(0, 16);
      const liveFingerprint = `${live.connected ? "1" : "0"}:${live.gameDate || "none"}:${live.totalDays ?? "none"}:${freshness.freshnessStatus}:${freshness.ageDays ?? "none"}`;
      const cacheKey = `${checkpointId2}:${this.worldKnowledgeState.currentCampaignDeltaRevision}:${supplementalRevision}:${queryFingerprint}:${mentionedEntityFingerprint}:${liveFingerprint}:${RETRIEVAL_POLICY_VERSION}:${this.localizationResolver?.revision || 0}`;
      const cached = this.worldKnowledgeState.topicPatchCache.get(cacheKey);
      if (cached) return { ...cached, stableText, cacheHit: true };
      const candidates = buildWorldCandidates({ snapshot, analysis: queryAnalysis, annualDelta: this._currentCampaignDelta(), supplemental: activeSupplemental });
      const retrieval = rankWorldCandidates(candidates, { plan: queryPlan, checkpointDate: snapshot.gameDate });
      if (queryPlan.ambiguity) retrieval.trimmed.push({ type: "GAME_TRUTH_CHARACTER", id: "historical-candidates", title: "Historical identity candidates", reason: "AMBIGUOUS_IDENTITY" });
      const selected = {
        gameTruth: retrieval.selected.gameTruth.slice(),
        supplemental: retrieval.selected.supplemental.slice(),
        delta: retrieval.selected.delta.slice()
      };
      const targetTokenBudget = promptTokenBudget(queryPlan);
      let summaryCacheHit = false;
      const buildRecall = () => {
        const selectedKey = [...selected.gameTruth, ...selected.supplemental, ...selected.delta].map((candidate) => candidate.id).join(",") || "empty";
        const summaryKey = `${cacheKey}:${selectedKey}`;
        let summary = this.worldKnowledgeState.summaryCache.get(summaryKey);
        if (summary) summaryCacheHit = true;
        else {
          summary = buildDeterministicWorldSummary({ selected });
          this.worldKnowledgeState.summaryCache.set(summaryKey, summary);
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
      this.worldKnowledgeState.topicPatchCache.set(cacheKey, context);
      if (this.worldKnowledgeState.topicPatchCache.size > 8) this.worldKnowledgeState.topicPatchCache.delete(this.worldKnowledgeState.topicPatchCache.keys().next().value);
      return { ...context, stableText };
    } catch (_error) {
      return null;
    }
  }

  async getPromptDiagnosticsAsync(payload = {}) {
    const checkpoint = this.currentCheckpoint;
    const deadline = Date.now() + 8000;
    let result = this.getPromptDiagnostics(payload);
    while (this.localizationResolver.pending?.size && Date.now() < deadline) {
      await this.localizationResolver.settle(Math.max(1, deadline - Date.now()));
      if (this.currentCheckpoint !== checkpoint) return { promptDiagnostics: { available: false, reason: "CHECKPOINT_CHANGED", query: String(payload.query || "").slice(0, 1000) } };
      result = this.getPromptDiagnostics(payload);
    }
    result.promptDiagnostics.localizationPending = this.localizationResolver.pending?.size > 0;
    return result;
  }

  getPromptDiagnostics({ query = "", assistContext = "", trimmedPage = 0 } = {}) {
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
    const page = Math.min(Math.max(0, Math.floor(Number(trimmedPage) || 0)), Math.max(0, Math.ceil(trimmedItems.length / trimmedPageSize) - 1));
    const tokenBreakdown = [
      ["worldline-stable", "Stable World Checkpoint", context.stableText],
      ["worldline-topic", "Topic Game Truth", context.topicText],
      ["worldline-supplemental", "Supplemental", context.supplementalText],
      ["worldline-current", "Current World View", context.currentText]
    ].filter(([, , content]) => content).map(([id, label, content]) => ({ id, label, tokens: estimateTokens(content) }));
    return {
      promptDiagnostics: {
        available: true,
        query: safeQuery,
        queryAnalysis: analysis,
        localizationIncomplete: analysis.resolverTrace?.localization?.sourceComplete === false,
        queryPlan: context.queryPlan,
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
    this.stopWatcher();
    this.localizationResolver?.dispose?.();
  }
}

module.exports = { DEFAULT_SETTINGS, WorldlineService, normalizeSettings, readLiveProbe };
