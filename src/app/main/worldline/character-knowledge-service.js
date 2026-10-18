"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { classifyKnowledge } = require("./character-knowledge-policy");
const { resolveKnowledgeScope } = require("./knowledge-scope-resolver");
const { normalizeTraitKey, getTraitAliases, resolveTraitVisibility } = require("../prompts/trait-visibility-policy");
const { normalizeGameDate } = require("./character-temporal-facts");

const SCHEMA_VERSION = 1;
const MANUAL_STATUSES = new Set(["MANUAL_KNOWN", "MANUAL_HIDDEN"]);
const KNOWN_SECRET_TRAITS = Object.freeze({
  secret_bastard: "bastard",
  secret_disputed_heritage: "disputed_heritage",
  secret_witch: "witch",
  secret_cannibal: "cannibal",
  secret_deviant: "deviant",
  secret_incest: "incestuous",
  secret_adulterer: "adulterer"
});

function runtimeId(value, label) {
  const id = String(value ?? "").trim();
  if (!/^\d{1,20}$/.test(id)) throw new Error(`character_knowledge_${label}_invalid`);
  return id;
}

function sourceToken(value) {
  const token = String(value ?? "").trim();
  return token && token.length <= 160 ? token : null;
}

function factIdentity(record) {
  return JSON.stringify([record.campaignToken, record.ownerRuntimeId, record.targetRuntimeId, record.factType, record.factKey]);
}

function displayName(character) {
  return String(character?.fullName || character?.firstName || character?.shortName || "").trim() || "姓名未载入";
}

class CharacterKnowledgeService {
  constructor({ dataDir, worldlineService, getCurrentGameData = () => null, fs = nodeFs, path = nodePath, clock = () => new Date() } = {}) {
    if (typeof dataDir !== "string" || !dataDir) throw new Error("character_knowledge_data_dir_required");
    if (!worldlineService || typeof worldlineService.getCheckpointStatus !== "function") throw new Error("character_knowledge_worldline_service_required");
    this.filePath = path.join(dataDir, "character-knowledge", "records-v1.json");
    this.directory = path.dirname(this.filePath);
    this.worldlineService = worldlineService;
    this.getCurrentGameData = getCurrentGameData;
    this.fs = fs;
    this.path = path;
    this.clock = clock;
  }

  _activeSource() {
    const checkpoint = this.worldlineService.currentCheckpoint;
    const checkpointStatus = this.worldlineService.getCheckpointStatus()?.checkpoint || {};
    const snapshot = checkpoint?.snapshot;
    const settings = this.worldlineService.getSettings?.() || null;
    const savePath = settings?.autosavePath;
    const checkpointSource = checkpoint?.source || {};
    let sourceFileCurrent = false;
    try {
      const stat = savePath ? this.fs.statSync(savePath) : null;
      sourceFileCurrent = !!stat && stat.size === checkpointSource.fileSize
        && stat.mtime.toISOString() === checkpointSource.modifiedAt;
    } catch (_error) {}
    const freshness = checkpointStatus.freshnessStatus || checkpointStatus.freshness;
    const sourceMatches = savePath && checkpointSource.path
      && this.path.resolve(savePath).toLowerCase() === this.path.resolve(checkpointSource.path).toLowerCase();
    if (!snapshot?.characters || checkpointStatus.status !== "ACTIVE" || checkpoint?.state !== "ACTIVE"
      || !checkpoint?.id || checkpointStatus.checkpointId !== checkpoint.id
      || settings?.lastValidationStatus !== "VALID" || !sourceMatches || !sourceFileCurrent
      || this.path.basename(savePath || "").toLowerCase() !== "autosave.ck3"
      || !["FRESH", "AGING"].includes(freshness)) {
      throw new Error("character_knowledge_checkpoint_unavailable");
    }
    const campaignToken = sourceToken(snapshot.playthroughId);
    if (!campaignToken) throw new Error("character_knowledge_campaign_unavailable");
    return { checkpoint, checkpointStatus, snapshot, campaignToken, sourceSnapshotId: String(checkpoint.id) };
  }

  _validateExpectedScope(source, payload = {}) {
    if (payload.campaignToken !== undefined && String(payload.campaignToken) !== source.campaignToken) throw new Error("character_knowledge_campaign_changed");
    if (payload.sourceSnapshotId !== undefined && String(payload.sourceSnapshotId) !== source.sourceSnapshotId) throw new Error("character_knowledge_source_changed");
    return source;
  }

  _readState() {
    if (!this.fs.existsSync(this.filePath)) return { schemaVersion: SCHEMA_VERSION, records: [] };
    let state;
    try {
      state = JSON.parse(this.fs.readFileSync(this.filePath, "utf8"));
    } catch (_error) {
      throw new Error("character_knowledge_state_invalid");
    }
    if (state?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(state.records)) throw new Error("character_knowledge_state_invalid");
    const identities = new Set();
    for (const record of state.records) {
      if (!record || record.schemaVersion !== SCHEMA_VERSION || !sourceToken(record.campaignToken)
        || !/^\d{1,20}$/.test(String(record.ownerRuntimeId || "")) || !/^\d{1,20}$/.test(String(record.targetRuntimeId || ""))
        || !["TRAIT", "TITLE"].includes(record.factType) || typeof record.factKey !== "string" || !record.factKey
        || !MANUAL_STATUSES.has(record.status) || !sourceToken(record.sourceSnapshotId)
        || !/^fact:[a-f0-9]{64}$/.test(String(record.factSourceSnapshotId || ""))
        || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error("character_knowledge_state_invalid");
      const identity = factIdentity(record);
      if (identities.has(identity)) throw new Error("character_knowledge_state_invalid");
      identities.add(identity);
    }
    return state;
  }

  _writeState(state) {
    this.fs.mkdirSync(this.directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      this.fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
      this.fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try { this.fs.rmSync(temporaryPath, { force: true }); } catch (_cleanupError) {}
      throw error;
    }
  }

  _localize(type, value) {
    try {
      const result = this.worldlineService.localizationResolver?.resolveForDisplay(type, value);
      return String(result?.localizedValue || value);
    } catch (_error) {
      return String(value);
    }
  }

  _targets(source) {
    return Object.entries(source.snapshot.characters).flatMap(([runtimeId, character]) => {
      if (!/^\d{1,20}$/.test(String(runtimeId)) || !character || String(character.id || runtimeId) !== String(runtimeId)) return [];
      return [{ runtimeId: String(runtimeId), displayName: displayName(character) }];
    }).sort((left, right) => left.displayName.localeCompare(right.displayName) || left.runtimeId.localeCompare(right.runtimeId));
  }

  getOwnerView({ ownerRuntimeId, campaignToken, sourceSnapshotId } = {}) {
    const source = this._validateExpectedScope(this._activeSource(), { campaignToken, sourceSnapshotId });
    const ownerId = runtimeId(ownerRuntimeId, "owner_id");
    const owner = source.snapshot.characters[ownerId];
    if (!owner) throw new Error("character_knowledge_owner_unavailable");
    return {
      available: true,
      scope: { campaignToken: source.campaignToken, ownerRuntimeId: ownerId, sourceSnapshotId: source.sourceSnapshotId },
      owner: { runtimeId: ownerId, displayName: displayName(owner) },
      targets: this._targets(source).filter((target) => target.runtimeId !== ownerId),
      checkpointAsOf: source.snapshot.gameDate || null
    };
  }

  _knownSecretTraits(source, ownerId, targetId) {
    let gameData = null;
    try { gameData = this.getCurrentGameData?.() || null; } catch (_error) { return { traits: new Set(), sourceSnapshotId: null }; }
    const checkpointDate = normalizeGameDate(source.snapshot.gameDate);
    const logDate = normalizeGameDate(gameData?.date);
    const totalDays = Number(gameData?.totalDays);
    if (!gameData || gameData.campaignToken !== source.campaignToken || !checkpointDate || !logDate
      || checkpointDate.serial !== logDate.serial || !Number.isSafeInteger(totalDays) || totalDays < 0) {
      return { traits: new Set(), sourceSnapshotId: null };
    }
    const owner = gameData.characters instanceof Map ? gameData.characters.get(Number(ownerId)) || gameData.characters.get(ownerId) : null;
    if (!owner || String(owner.id) !== ownerId || !Array.isArray(owner.knownSecrets)) {
      return { traits: new Set(), sourceSnapshotId: null };
    }
    const targetTraits = new Set((source.snapshot.characters[targetId]?.traits || []).map(normalizeTraitKey));
    const provenTraits = [...new Set(owner.knownSecrets.flatMap((secret) => {
      const trait = KNOWN_SECRET_TRAITS[String(secret?.type || "")];
      if (!trait || String(secret?.ownerId ?? "") !== targetId || !targetTraits.has(trait)) return [];
      return [trait];
    }))].sort();
    const proofRevision = nodeCrypto.createHash("sha256").update(JSON.stringify(provenTraits), "utf8").digest("hex").slice(0, 16);
    return {
      traits: new Set(provenTraits),
      sourceSnapshotId: `${source.campaignToken}|${logDate.canonical}/${totalDays}|${proofRevision}`
    };
  }

  _candidateFacts(source, ownerId, targetId, state) {
    const snapshot = source.snapshot;
    const target = snapshot.characters[targetId];
    const realmEvidence = (runtimeId2) => {
      const trail = [];
      const visited = new Set();
      let currentId = runtimeId2;
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const character = snapshot.characters[currentId];
        if (!character) {
          trail.push([currentId, null]);
          break;
        }
        const nextId = String(character.liege || character.topLiege || character.realm || character.courtEmployer || "");
        trail.push([currentId, character.liege || null, character.topLiege || null, character.realm || null, character.courtEmployer || null]);
        if (!nextId || nextId === currentId) break;
        currentId = nextId;
      }
      return trail;
    };
    const titleEvidence = Object.entries(snapshot.titles || {}).flatMap(([titleId, title]) => {
      if (!title || String(title.holder || "") !== targetId || !/^\d{1,20}$/.test(titleId)) return [];
      return [[titleId, title.holder || null, title.key || null, title.localizationKey || null, title.displayName || null]];
    }).sort(([left], [right]) => left.localeCompare(right));
    const pairSourceRevision = nodeCrypto.createHash("sha256").update(JSON.stringify([
      source.sourceSnapshotId,
      source.campaignToken,
      snapshot.gameDate || null,
      ownerId,
      realmEvidence(ownerId),
      targetId,
      realmEvidence(targetId),
      [...new Set((target.traits || []).map((trait) => String(trait || "").trim()).filter(Boolean))].sort(),
      titleEvidence
    ]), "utf8").digest("hex");
    const scope = resolveKnowledgeScope({
      snapshot,
      responderId: ownerId,
      subjectId: targetId,
      live: this.worldlineService.getLiveState?.() || null,
      includeCloseKnowledge: true
    });
    const records = new Map(state.records.filter((record) => record.campaignToken === source.campaignToken
      && record.ownerRuntimeId === ownerId && record.targetRuntimeId === targetId).map((record) => [factIdentity(record), record]));
    const knownSecretSource = this._knownSecretTraits(source, ownerId, targetId);
    const knownSecretTraits = knownSecretSource.traits;
    const candidates = [];
    const add = (factType, factKey, value, knowledgeFact, sourceKind, { aliases = [], evidenceSourceSnapshotId = null, safeUnknown = true } = {}) => {
      const key = factIdentity({ campaignToken: source.campaignToken, ownerRuntimeId: ownerId, targetRuntimeId: targetId, factType, factKey });
      const record = records.get(key) || null;
      const sourceSnapshotId = evidenceSourceSnapshotId
        ? `${source.sourceSnapshotId}|${evidenceSourceSnapshotId}` : source.sourceSnapshotId;
      const classification = knowledgeFact ? classifyKnowledge(knowledgeFact, { id: ownerId }, scope) : null;
      const factSourceSnapshotId = `fact:${nodeCrypto.createHash("sha256").update(JSON.stringify([
        pairSourceRevision, factType, factKey, sourceSnapshotId, value, aliases, classification?.decision || "UNKNOWN"
      ]), "utf8").digest("hex")}`;
      const recordCurrent = !!record && record.factSourceSnapshotId === factSourceSnapshotId;
      const manualStatus = recordCurrent ? record.status : null;
      const automaticKnown = classification?.decision === "ALLOW";
      const hidden = manualStatus === "MANUAL_HIDDEN";
      const manuallyKnown = manualStatus === "MANUAL_KNOWN";
      const known = !hidden && (manuallyKnown || automaticKnown);
      if (!known && !manualStatus && !safeUnknown) return;
      candidates.push({
        factType,
        factKey,
        value,
        aliases,
        status: hidden ? "MANUAL_HIDDEN" : manuallyKnown ? "MANUAL_KNOWN" : known ? "KNOWN" : "UNKNOWN",
        effectiveKnown: known,
        source: hidden || manuallyKnown ? "MANUAL" : automaticKnown ? sourceKind : record ? "SOURCE_STALE" : "CHECKPOINT_CANDIDATE",
        sourceSnapshotId,
        factSourceSnapshotId,
        evidenceSourceSnapshotId,
        recordedSourceSnapshotId: record?.sourceSnapshotId || null,
        sourceStatus: record && !recordCurrent && !automaticKnown ? "STALE" : "CURRENT",
        firstAcquiredDate: (recordCurrent ? record.firstAcquiredDate : null) || (automaticKnown ? snapshot.gameDate || null : null),
        manualMarkedDate: recordCurrent ? record.manualMarkedDate || null : null,
        current: true,
        revision: recordCurrent ? record.revision : 0,
        evidenceCompleteness: manualStatus ? "EXPLICIT" : automaticKnown ? "VERIFIED" : "NONE"
      });
    };

    const traits = Array.isArray(target.traits) ? target.traits : [];
    for (const rawTrait of [...new Set(traits.map((value) => String(value || "").trim()).filter((value) => /^[A-Za-z0-9_.-]{1,120}$/.test(value)))].sort()) {
      const traitKey = normalizeTraitKey(rawTrait);
      const factKey = `trait_${traitKey}`;
      const localized = this._localize("trait", rawTrait);
      const knowledgeFact = knownSecretTraits.has(traitKey) ? {
        entityId: targetId,
        field: "TRAIT",
        value: localized,
        sourceTier: "GAMESTATE",
        knowledgeLevel: "SECRET",
        knownBy: [ownerId],
        authorizationComplete: true,
        temporalSafe: true,
        sourceComplete: true,
        candidateSetComplete: true,
        asOf: snapshot.gameDate || null
      } : null;
      const visualPolicy = resolveTraitVisibility(rawTrait).status;
      add("TRAIT", factKey, localized, knowledgeFact, knowledgeFact ? "GAME_DATA_KNOWN_SECRET" : "VISIBLE_TRAIT_CANDIDATE", {
        aliases: getTraitAliases(rawTrait),
        evidenceSourceSnapshotId: knowledgeFact ? knownSecretSource.sourceSnapshotId : null,
        safeUnknown: visualPolicy === "OBSERVABLE"
      });
    }

    for (const [titleId, title] of Object.entries(snapshot.titles || {}).sort(([left], [right]) => left.localeCompare(right))) {
      if (!title || String(title.holder || "") !== targetId || !/^\d{1,20}$/.test(titleId)) continue;
      const rawKey = String(title.key || title.localizationKey || title.displayName || titleId);
      const value = String(title.displayName || this._localize("title", rawKey) || rawKey);
      const aliases = [...new Set([value, rawKey, title.key, title.localizationKey, title.displayName]
        .filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()))];
      const knowledgeFact = {
        entityId: targetId,
        field: "TITLE",
        value,
        sourceTier: "GAMESTATE",
        knowledgeLevel: "REALM_PUBLIC",
        public: true,
        temporalSafe: true,
        sourceComplete: true,
        candidateSetComplete: true,
        asOf: snapshot.gameDate || null
      };
      add("TITLE", titleId, value, knowledgeFact, "WORLDLINE_REALM_PUBLIC", { aliases });
    }
    return candidates;
  }

  getTargetView({ campaignToken, ownerRuntimeId, targetRuntimeId, sourceSnapshotId } = {}) {
    const source = this._validateExpectedScope(this._activeSource(), { campaignToken, sourceSnapshotId });
    const ownerId = runtimeId(ownerRuntimeId, "owner_id");
    const targetId = runtimeId(targetRuntimeId, "target_id");
    const owner = source.snapshot.characters[ownerId];
    const target = source.snapshot.characters[targetId];
    if (!owner || !target) throw new Error("character_knowledge_target_unavailable");
    const state = this._readState();
    const facts = this._candidateFacts(source, ownerId, targetId, state);
    const currentSources = new Map(facts.map((fact) => [factIdentity({ campaignToken: source.campaignToken,
      ownerRuntimeId: ownerId, targetRuntimeId: targetId, factType: fact.factType, factKey: fact.factKey }), fact.factSourceSnapshotId]));
    const staleCount = state.records.filter((record) => record.campaignToken === source.campaignToken
      && record.ownerRuntimeId === ownerId && record.targetRuntimeId === targetId
      && currentSources.get(factIdentity(record)) !== record.factSourceSnapshotId).length;
    return {
      available: true,
      scope: { campaignToken: source.campaignToken, ownerRuntimeId: ownerId, targetRuntimeId: targetId, sourceSnapshotId: source.sourceSnapshotId },
      owner: { runtimeId: ownerId, displayName: displayName(owner) },
      target: { runtimeId: targetId, displayName: displayName(target) },
      checkpointAsOf: source.snapshot.gameDate || null,
      recognition: { level: "WORLDLINE_CHECKPOINT", evidenceCompleteness: staleCount ? "PARTIAL_SOURCE_CHANGED" : "PARTIAL", historyCountsAvailable: false },
      sourceInvalidatedCount: staleCount,
      facts
    };
  }

  getDisclosureProfile({ campaignToken, ownerRuntimeId, targetRuntimeId, sourceSnapshotId } = {}) {
    try {
      const profile = this.getTargetView({ campaignToken, ownerRuntimeId, targetRuntimeId, sourceSnapshotId });
      return {
        status: "READY",
        scope: profile.scope,
        checkpointAsOf: profile.checkpointAsOf,
        facts: profile.facts.filter((fact) => fact.sourceStatus === "CURRENT"
          && (fact.effectiveKnown || fact.status === "MANUAL_HIDDEN")).map((fact) => ({
          campaignToken: profile.scope.campaignToken,
          ownerId: profile.scope.ownerRuntimeId,
          entityId: profile.scope.targetRuntimeId,
          current: true,
          factType: fact.factType,
          factKey: fact.factKey,
          value: fact.value,
          aliases: fact.aliases,
          status: fact.status,
          effectiveKnown: fact.effectiveKnown,
          source: fact.source,
          sourceSnapshotId: fact.sourceSnapshotId,
          factSourceSnapshotId: fact.factSourceSnapshotId,
          evidenceSourceSnapshotId: fact.evidenceSourceSnapshotId,
          revision: fact.revision,
          recordRevision: fact.revision,
          firstAcquiredDate: fact.firstAcquiredDate
        }))
      };
    } catch (error) {
      const reason = String(error?.message || error);
      return { status: "BLOCKED", scope: null, facts: [], reason: /^character_knowledge_[a-z_]+$/.test(reason) ? reason : "character_knowledge_unavailable" };
    }
  }

  setManualStatus({ campaignToken, ownerRuntimeId, targetRuntimeId, sourceSnapshotId, factSourceSnapshotId, factType, factKey, status, expectedRevision } = {}) {
    if (!MANUAL_STATUSES.has(status)) throw new Error("character_knowledge_manual_status_invalid");
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("character_knowledge_revision_invalid");
    const source = this._validateExpectedScope(this._activeSource(), { campaignToken, sourceSnapshotId });
    const ownerId = runtimeId(ownerRuntimeId, "owner_id");
    const targetId = runtimeId(targetRuntimeId, "target_id");
    const normalizedType = String(factType || "");
    const normalizedKey = String(factKey || "");
    if (!source.snapshot.characters[ownerId] || !source.snapshot.characters[targetId]) throw new Error("character_knowledge_target_unavailable");
    if (!new Set(["TRAIT", "TITLE"]).has(normalizedType) || !normalizedKey || normalizedKey.length > 120) throw new Error("character_knowledge_fact_invalid");
    const state = this._readState();
    const identity = factIdentity({ campaignToken: source.campaignToken, ownerRuntimeId: ownerId, targetRuntimeId: targetId, factType: normalizedType, factKey: normalizedKey });
    const currentRecord = state.records.find((record) => factIdentity(record) === identity) || null;
    const candidate = this._candidateFacts(source, ownerId, targetId, state)
      .find((fact) => fact.factType === normalizedType && fact.factKey === normalizedKey);
    if (!candidate) throw new Error("character_knowledge_fact_not_available");
    if (typeof factSourceSnapshotId !== "string" || factSourceSnapshotId !== candidate.factSourceSnapshotId) {
      throw new Error("character_knowledge_source_changed");
    }
    const effectiveRevision = currentRecord?.factSourceSnapshotId === candidate.factSourceSnapshotId ? currentRecord.revision : 0;
    if (expectedRevision !== effectiveRevision) throw new Error("character_knowledge_revision_conflict");
    const now = this.clock();
    const markedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    const record = {
      schemaVersion: SCHEMA_VERSION,
      campaignToken: source.campaignToken,
      ownerRuntimeId: ownerId,
      targetRuntimeId: targetId,
      factType: normalizedType,
      factKey: normalizedKey,
      status,
      source: "MANUAL",
      sourceSnapshotId: source.sourceSnapshotId,
      factSourceSnapshotId: candidate.factSourceSnapshotId,
      firstAcquiredDate: status === "MANUAL_KNOWN" ? source.snapshot.gameDate || null : currentRecord?.firstAcquiredDate || null,
      manualMarkedDate: source.snapshot.gameDate || null,
      updatedAt: markedAt,
      revision: effectiveRevision + 1
    };
    state.records = state.records.filter((entry) => factIdentity(entry) !== identity);
    state.records.push(record);
    this._writeState(state);
    return this.getTargetView({ campaignToken: source.campaignToken, ownerRuntimeId: ownerId, targetRuntimeId: targetId, sourceSnapshotId: source.sourceSnapshotId });
  }
}

module.exports = { CharacterKnowledgeService, SCHEMA_VERSION };
