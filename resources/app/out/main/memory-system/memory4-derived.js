"use strict";

const fs = require("fs");
const path = require("path");
const { assertScope, hash, ids, strings, legacySourceHash, sourceRevisionCurrent } = require("./memory4-contract");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { estimateTokens } = require("../token-estimator");
const { validateGenerationOutcome } = require("../providers/generation-outcome");

const serial = value => normalizeGameDate(value)?.serial;
const copy = value => JSON.parse(JSON.stringify(value));
const scopeKey = scope => hash([scope.campaignToken, scope.ownerId]);
const scopeDto = scope => { assertScope(scope); return { campaignToken: scope.campaignToken, ownerId: scope.ownerId }; };
const YEAR_MAX_TOKENS = 1500;
const LIFE_SEGMENT_MAX_TOKENS = 1000;
const YEAR_TARGET_TOKENS = 1200;
const LIFE_SEGMENT_TARGET_TOKENS = 700;
const derivedLimitFor = kind => kind === "year" ? YEAR_MAX_TOKENS : LIFE_SEGMENT_MAX_TOKENS;
const derivedTargetFor = kind => kind === "year" ? YEAR_TARGET_TOKENS : LIFE_SEGMENT_TARGET_TOKENS;

function eventYears(row) {
  const time = row?.eventTime;
  const from = normalizeGameDate(time?.from), to = normalizeGameDate(time?.to);
  if (!from || !to || !["observed", "reported"].includes(time.status) || from.year > to.year) return [];
  return Array.from({ length: to.year - from.year + 1 }, (_, index) => from.year + index);
}

function archiveYears(row) {
  const years = eventYears(row);
  if (years.length) return years;
  const time = row?.eventTime;
  if (!time || time.from || time.to || time.precision !== "unknown" || !["unknown", "observed", "reported"].includes(time.status)) return [];
  const acquired = normalizeGameDate(row.acquiredDate);
  return acquired ? [acquired.year] : [];
}

function archiveItem(item, entries) {
  const sources = entries.filter(entry => item.sourceEntryIds.includes(entry.entryId));
  const acquired = sources.filter(entry => !eventYears(entry).length && archiveYears(entry).length);
  if (!acquired.length) return { ...item, timeAxis: "event" };
  const dates = strings(acquired.map(entry => normalizeGameDate(entry.acquiredDate).canonical));
  const text = item.text.replace(/^【本年获知，事件日期未知；获知日期：[^】]+】\s*/, "");
  return { ...item, timeAxis: acquired.length === sources.length ? "acquired" : "mixed",
    text: `【本年获知，事件日期未知；获知日期：${dates.join("、")}】${text}` };
}

class Memory4DerivedService {
  constructor(coordinator) {
    this.coordinator = coordinator;
    this.store = coordinator.store;
    this.baseStore = coordinator.baseStore;
    this.options = {};
    this.jobs = new Map();
    this.active = new Map();
  }

  configure(options = {}) { this.options = { ...this.options, ...options }; }

  count(text) { return Math.ceil((this.options.estimateTokens || estimateTokens)(text)); }

  file(scope, kind, eventYear = null) {
    const directory = this.store.directory(scope);
    if (kind === "year" && (!Number.isSafeInteger(eventYear) || eventYear < 1 || eventYear > 9999)) throw new Error("memory4_year_invalid");
    const file = kind === "year" ? path.join(directory, "years", `${eventYear}.json`) : path.join(directory, "life.json");
    for (const target of [path.dirname(file), file]) if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error("memory4_symlink_path");
    return file;
  }

  read(scope, kind, eventYear = null) {
    const view = this.store.read(this.file(scope, kind, eventYear), null);
    if (view && (view.memory4SchemaVersion !== 1 || view.campaignToken !== scope.campaignToken || view.ownerId !== scope.ownerId
      || !Number.isSafeInteger(view.revision) || !Array.isArray(view.sourceRevisionSet)
      || kind === "year" && (view.eventYear !== eventYear || !Array.isArray(view.items))
      || kind === "life" && !Array.isArray(view.segments))) throw new Error("memory4_derived_invalid");
    return view;
  }

  sourceValid(scope, row, index, metadata) {
    if (!row || row.deleted || !ids(row.knownBy).includes(scope.ownerId)
      || !["private", "participants", "known_group"].includes(row.visibility)) return false;
    if (this.store.isEntryForgotten(scope, row)) return false;
    const record = index.finalizations[hash(row.finalizationId)];
    const revision = metadata?.knownEvidenceRevisions?.[hash([row.conversationId, scope.ownerId])];
    if (!record || revision && revision !== record.sourceRevision
      || row.stateSource && !sourceRevisionCurrent(row.stateSource, scope, index, metadata)
      || row.legacyMemoryIds?.length && row.legacyMemoryIds.length !== (row.legacyRefs || []).length) return false;
    return (row.legacyRefs || []).every(ref => {
      const memory = this.baseStore.getMemory(ref.memoryId);
      return memory && !memory.deleted && memory.provenance?.campaignToken === scope.campaignToken
        && memory.provenance?.folderOwnerId === scope.ownerId && ids(memory.knownBy).includes(scope.ownerId)
        && legacySourceHash(memory) === ref.sourceHash;
    });
  }

  snapshot(scope, { eventYear = null, period = null } = {}, index = this.store.loadIndex(scope), readContext = null) {
    const cacheKey = JSON.stringify([eventYear, period]);
    if (readContext?.snapshots.has(cacheKey)) return readContext.snapshots.get(cacheKey);
    const metadata = readContext?.metadata || this.store.read(path.join(this.store.directory(scope), "metadata.json"), null);
    const entryIds = Object.keys(index.entries).filter(id => {
      const row = index.entries[id], years = archiveYears(row);
      return years.length && (eventYear == null || years.includes(eventYear))
        && (!period || years.some(year => year >= period.fromYear && year <= period.toYear))
        && this.sourceValid(scope, row, index, metadata);
    }).sort();
    const stamps = entryIds.map(id => {
      const row = index.entries[id];
      return [id, row.revision, row.bodyHash, row.knownBy, row.visibility, row.status,
        index.finalizations[hash(row.finalizationId)]?.sourceRevision,
        metadata?.knownEvidenceRevisions?.[hash([row.conversationId, scope.ownerId])] || null,
        row.stateSource || null, row.stateSource ? metadata?.knownEvidenceRevisions?.[hash([row.stateSource.conversationId, scope.ownerId])] || null : null,
        (row.legacyRefs || []).map(ref => [ref.memoryId, ref.sourceHash]),
        ...(!eventYears(row).length ? [row.acquiredDate] : [])];
    });
    const result = { index, entryIds, sourceRevisionSet: entryIds.map(id => `${id}@${index.entries[id].revision}`), sourceHash: hash(stamps) };
    if (readContext) readContext.snapshots.set(cacheKey, result);
    return result;
  }

  validView(scope, view, kind, readContext = null) {
    if (!view || view.dirty) return false;
    const snapshot = this.snapshot(scope, kind === "year" ? { eventYear: view.eventYear } : {}, readContext?.index, readContext);
    return view.sourceHash === snapshot.sourceHash && hash(view.sourceRevisionSet) === hash(snapshot.sourceRevisionSet)
      && (kind !== "life" || view.segments.every(segment => this.validSegment(scope, segment, readContext)));
  }

  validSegment(scope, segment, readContext = null) {
    const snapshot = this.snapshot(scope, { period: segment.period }, readContext?.index, readContext);
    if (segment.sourceHash !== snapshot.sourceHash || hash(segment.sourceRevisionSet) !== hash(snapshot.sourceRevisionSet)) return false;
    return (segment.sourceYears || []).every(source => {
      const year = readContext?.rawYears.has(source.eventYear) ? readContext.rawYears.get(source.eventYear) : this.read(scope, "year", source.eventYear);
      return this.validView(scope, year, "year", readContext) && hash(year) === source.viewHash;
    });
  }

  list(scope, { readContext = null } = {}) {
    scope = scopeDto(scope);
    const index = readContext?.index || this.store.loadIndex(scope);
    const metadata = readContext?.metadata || this.store.read(path.join(this.store.directory(scope), "metadata.json"), null);
    const context = readContext || { index, metadata, snapshots: new Map(), rawYears: new Map() };
    const directory = path.dirname(this.file(scope, "year", 1));
    const years = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => /^[1-9]\d{0,3}\.json$/.test(name))
      .map(name => {
        const view = this.read(scope, "year", Number(name.slice(0, -5)));
        if (view) context.rawYears.set(view.eventYear, view);
        return view;
      }).filter(Boolean).map(view => ({ ...view, dirty: !this.validView(scope, view, "year", context) }))
      .sort((a, b) => a.eventYear - b.eventYear) : [];
    const life = this.read(scope, "life");
    const lifeDirty = !!life && !this.validView(scope, life, "life", context);
    return { ...scope, indexRevision: index.revision, derivedRevision: metadata?.derivedRevision || 0,
      dirty: metadata?.derivedDirty === true || years.some(view => view.dirty) || lifeDirty,
      years, life: life ? { ...life, dirty: lifeDirty } : null,
      jobs: this.jobs.has(scopeKey(scope)) ? [copy(this.jobs.get(scopeKey(scope)))] : [] };
  }

  // Called inside the canonical mutation journal, so dirty publication cannot
  // be lost while the corresponding Detail edit survives a crash.
  markDirty(scope, { index, metadata, entryIds = [] } = {}) {
    const changed = new Set(entryIds);
    const directory = path.dirname(this.file(scope, "year", 1));
    const affectedYears = new Set(entryIds.flatMap(id => archiveYears(index.entries[id])));
    if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory).filter(name => /^[1-9]\d{0,3}\.json$/.test(name))) {
      const year = Number(name.slice(0, -5)), view = this.read(scope, "year", year);
      if (affectedYears.has(year) || view.items.some(item => item.sourceEntryIds.some(id => changed.has(id)))) {
        this.baseStore.writeJson(this.file(scope, "year", year), { ...view, dirty: true });
      }
    }
    const life = this.read(scope, "life");
    if (life && entryIds.length) this.baseStore.writeJson(this.file(scope, "life"), { ...life, dirty: true });
    return { derivedDirty: entryIds.length > 0 || metadata?.derivedDirty === true,
      derivedRevision: (metadata?.derivedRevision || 0) + (entryIds.length ? 1 : 0) };
  }

  forgetEntries(scope, { forgottenEntryIds = [] } = {}) {
    const forgotten = new Set(strings(forgottenEntryIds));
    if (!forgotten.size) return 0;
    let changedCount = 0;
    const scrub = (kind, eventYear = null) => {
      const view = this.read(scope, kind, eventYear);
      if (!view) return;
      const collection = kind === "year" ? view.items : view.segments;
      let changed = false;
      const retained = collection.flatMap(item => {
        const sourceIds = strings(item.sourceEntryIds);
        const ambiguous = !sourceIds.length && (view.sourceRevisionSet || []).some(stamp =>
          forgotten.has(String(stamp).split("@")[0]));
        if (ambiguous || sourceIds.some(id => forgotten.has(id))) { changed = true; return []; }
        if (kind !== "life" || !Array.isArray(item.items)) return [item];
        const items = item.items.filter(child => !strings(child.sourceEntryIds).some(id => forgotten.has(id)));
        if (items.length === item.items.length) return [item];
        changed = true;
        if (!items.length) return [];
        const nextIds = strings(items.flatMap(child => child.sourceEntryIds));
        return [{ ...item, items, sourceEntryIds: nextIds, text: items.map(child => child.text).join("\n") }];
      });
      if (!changed) return;
      const next = { ...view, revision: view.revision + 1, dirty: true,
        ...(kind === "year" ? { items: retained, tokens: this.count(retained.map(item => item.text).join("\n")) } : { segments: retained }) };
      this.baseStore.writeJson(this.file(scope, kind, eventYear), next);
      changedCount++;
    };
    const yearsDir = path.dirname(this.file(scope, "year", 1));
    if (fs.existsSync(yearsDir)) for (const name of fs.readdirSync(yearsDir).filter(value => /^[1-9]\d{0,3}\.json$/.test(value))) {
      scrub("year", Number(name.slice(0, -5)));
    }
    scrub("life");
    return changedCount;
  }

  getPointers(scope, entityId, { currentGameDate = null, readContext = null } = {}) {
    const views = readContext?.derived || this.list(scope, { readContext });
    const index = readContext?.index || this.store.loadIndex(scope), current = serial(currentGameDate);
    const visible = item => ids(item.entityIds).includes(entityId) && item.sourceEntryIds?.every(id => index.entries[id]
      && [index.entries[id].conversationDate, index.entries[id].acquiredDate].every(date => serial(date) <= current)
      && (!index.entries[id].stateChangedGameDate || serial(index.entries[id].stateChangedGameDate) <= current));
    return { yearKeys: views.years.filter(view => !view.dirty && view.items.some(visible)).map(view => view.eventYear),
      lifeItemIds: views.life && !views.life.dirty ? views.life.segments.filter(visible).map(item => item.segmentId) : [] };
  }

  getSources(scope, { kind, eventYear = null, year = null, segmentId = null } = {}) {
    if (!["year", "life"].includes(kind)) throw new Error("memory4_derived_kind_invalid");
    eventYear ??= year;
    const view = this.read(scope, kind, eventYear);
    if (!view) throw new Error("memory4_derived_missing");
    const selected = kind === "year" ? view.items : view.segments.filter(item => !segmentId || item.segmentId === segmentId);
    const sourceIds = strings(selected.flatMap(item => item.sourceEntryIds));
    const index = this.store.loadIndex(scope), entries = [], missingEntryIds = [];
    const metadata = this.store.read(path.join(this.store.directory(scope), "metadata.json"), null);
    for (const id of sourceIds) {
      if (!index.entries[id]) { missingEntryIds.push(id); continue; }
      if (!this.sourceValid(scope, index.entries[id], index, metadata)) { missingEntryIds.push(id); continue; }
      const entry = this.store.readEntry(scope, id, index);
      if (!ids(entry.evidence.knownBy).includes(scope.ownerId)) { missingEntryIds.push(id); continue; }
      entries.push({ ...entry, sourceValid: true });
    }
    const current = this.snapshot(scope, kind === "year" ? { eventYear } : {}, index);
    return { kind, eventYear, segmentId, sourceRevisionSet: [...view.sourceRevisionSet], currentRevisionSet: current.sourceRevisionSet,
      changed: !this.validView(scope, view, kind), entries, missingEntryIds };
  }

  persist(scope, kind, view) {
    const directory = this.store.directory(scope);
    const metadata = this.store.read(path.join(directory, "metadata.json"), null);
    this.baseStore.withSummaryMutation(null, () => {
      this.baseStore.writeJson(this.file(scope, kind, view.eventYear), view);
      if (kind === "year") {
        const life = this.read(scope, "life");
        if (life) this.baseStore.writeJson(this.file(scope, "life"), { ...life, dirty: true });
      }
      this.baseStore.writeJson(path.join(directory, "metadata.json"), { ...metadata,
        derivedRevision: (metadata?.derivedRevision || 0) + 1, derivedDirty: kind === "year" || view.dirty });
    });
    this.coordinator.profiles.invalidate(scope);
  }

  edit(scope, kind, request) {
    const view = this.read(scope, kind, request.eventYear);
    if (!view || view.revision !== request.expectedRevision) throw new Error("memory4_derived_edit_stale");
    if (typeof request.text !== "string" || !request.text.trim() || request.text.length > 65536) throw new Error("memory4_derived_text_invalid");
    const next = copy(view), collection = kind === "year" ? next.items : next.segments;
    const item = collection.find(item => kind === "year" ? item.itemId === request.itemId : item.segmentId === request.segmentId);
    if (!item) throw new Error("memory4_derived_item_missing");
    item.text = request.text.trim();
    const manual = { mode: "manual_override", editedAt: new Date().toISOString() };
    if (kind === "life") item.manual = manual;
    if (kind === "life") item.items = [{ ...item, items: undefined, itemId: item.segmentId, text: item.text }];
    next.manual = manual; next.generationMode = "manual_override"; next.revision++;
    next.dirty = !this.validView(scope, view, kind);
    next.tokens = this.count(collection.map(item => item.text).join("\n"));
    if (kind === "year" && next.tokens > YEAR_MAX_TOKENS) throw new Error("memory4_year_budget_exceeded");
    this.persist(scope, kind, next);
    return { success: true, kind, revision: next.revision, dirty: next.dirty };
  }

  updateYear(scope, request) { return this.edit(scope, "year", request); }
  updateLife(scope, request) { return this.edit(scope, "life", request); }

  keepManual(scope, request) {
    const view = this.read(scope, request.kind, request.eventYear);
    if (!view || view.revision !== request.expectedRevision) throw new Error("memory4_derived_edit_stale");
    const next = { ...view, manual: { ...view.manual, mode: "manual_override" }, generationMode: "manual_override", revision: view.revision + 1,
      dirty: !this.validView(scope, view, request.kind) };
    this.persist(scope, request.kind, next);
    return { success: true, revision: next.revision, dirty: next.dirty };
  }

  cancel(scope) {
    assertScope(scope);
    const task = this.active.get(scopeKey(scope));
    if (task) { task.cancelled = true; task.controller.abort(); }
    return { cancelled: !!task };
  }

  committedProof(scope, proof) {
    if (!proof?.finalizationId || !proof.sourceRevision) return false;
    const record = this.store.loadIndex(scope).finalizations[hash(proof.finalizationId)];
    return !!record && record.sourceRevision === proof.sourceRevision;
  }

  current(scope, task) {
    if (task.cancelled) return false;
    try {
      return task.committedFinalization ? this.committedProof(scope, task.finalizationProof)
        : !this.options.isCampaignCurrent || this.options.isCampaignCurrent(scope.campaignToken);
    } catch { return false; }
  }

  schedule(scope, options = {}) {
    const finalizationProof = options.committedFinalization ? { finalizationId: scope.finalizationId, sourceRevision: scope.sourceRevision } : null;
    if (options.committedFinalization && !this.committedProof(scope, finalizationProof)) {
      return Promise.resolve({ status: "FAILED", kind: "all", reason: "COMMITTED_SOURCE_PROOF_UNAVAILABLE" });
    }
    if (!options.committedFinalization && (!this.options.isCampaignCurrent || !this.options.isCampaignCurrent(scope.campaignToken))) {
      return Promise.resolve({ status: "CANCELLED", kind: "all", reason: "CAMPAIGN_NOT_CURRENT" });
    }
    return new Promise(resolve => setImmediate(() => {
      this.rebuild(scopeDto(scope), { kind: "all", ...options, finalizationProof }).then(resolve).catch(error => {
        this.coordinator.trace?.record("memory4_derived", { ownerId: scope.ownerId, status: "FAILED", errorCode: error.message });
        resolve({ status: "FAILED", kind: "all", reason: String(error?.message || error) });
      });
    }));
  }

  guardedText(entries, text) {
    const guards = entries.flatMap(entry => entry.text.match(/(?:除非|必须|须|前提|但|只有|只要|如果|倘若|若|并非|尚未|不曾|未曾|未|不|没有|听说|声称|传闻|unless|only if|if|not)[^，。；;\r\n]*/gi) || []);
    return guards.every(guard => text.includes(guard));
  }

  async compress(scope, kind, items, entries, task, providerSnapshot) {
    scope = scopeDto(scope);
    const hardLimit = derivedLimitFor(kind), softTarget = derivedTargetFor(kind);
    if (this.count(items.map(item => item.text).join("\n")) <= hardLimit) return items;
    if (typeof this.options.requestCompression !== "function") throw new Error("memory4_compression_unavailable");
    providerSnapshot ||= this.options.getProviderSnapshot ? await this.options.getProviderSnapshot() : null;
    const prompt = [
      { role: "system", content: `Compress this owner's supplied historical memory items into JSON {\"items\":[{\"text\":\"...\",\"sourceEntryIds\":[\"...\"]}]}. Use only supplied facts. Retain every source ID exactly once, all commitment conditions, negations, reported/rumor uncertainty and status. For acquisition-dated sources retain the exact qualifier 本年获知，事件日期未知 in the item's text: acquiredDate is when this Owner learned the fact, never proof the event happened then. Do not merge acquisition-dated and event-dated items. Do not invent events, motives, dates, identities, knowledge or CK3 truth. Prefer merging duplicate text. Preserve Chinese source language. Text total must fit ${softTarget} tokens and never exceed ${hardLimit}. Return only JSON.` },
      { role: "user", content: JSON.stringify({ ...scope, items: items.map(item => ({ ...item,
        evidence: entries.filter(entry => item.sourceEntryIds.includes(entry.entryId)).map(entry => ({ sourceEntryId: entry.entryId,
          sourceType: entry.evidence.sourceType, epistemicStatus: entry.evidence.epistemicStatus,
          stateStatus: entry.state.status, eventTimeStatus: entry.eventTime.status,
          eventTime: entry.eventTime, acquiredDate: entry.acquiredDate, timeAxis: eventYears(entry).length ? "event" : "acquired" })) })) }) }
    ];
    const response = await this.options.requestCompression(prompt, { signal: task.controller.signal, maxTokens: 4096, providerSnapshot,
      requestType: kind === "year" ? "memory4_year" : "memory4_life", ownerId: scope.ownerId });
    if (!this.current(scope, task)) throw new Error("memory4_derived_cancelled");
    const outcome = typeof response === "string" ? { content: response, complete: true, truncated: false } : validateGenerationOutcome(response);
    if (!outcome.complete || outcome.truncated) throw new Error("memory4_compression_incomplete");
    let result;
    try { result = JSON.parse(outcome.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
    catch { throw new Error("memory4_compression_invalid"); }
    if (!Array.isArray(result?.items) || !result.items.length || result.items.some(item => typeof item.text !== "string" || !item.text.trim()
      || !Array.isArray(item.sourceEntryIds) || !item.sourceEntryIds.length)) throw new Error("memory4_compression_invalid");
    const sourceIds = strings(items.flatMap(item => item.sourceEntryIds));
    const generatedIds = result.items.flatMap(item => item.sourceEntryIds);
    if (new Set(generatedIds).size !== generatedIds.length || hash(strings(generatedIds)) !== hash(sourceIds)) throw new Error("memory4_compression_source_mismatch");
    const text = result.items.map(item => item.text).join("\n");
    if (this.count(text) > hardLimit || result.items.some(item => {
      const sources = entries.filter(entry => item.sourceEntryIds.includes(entry.entryId));
      const acquiredCount = sources.filter(entry => !eventYears(entry).length).length;
      return !this.guardedText(sources, item.text) || acquiredCount &&
        (acquiredCount !== sources.length || !item.text.includes("本年获知，事件日期未知"));
    })) throw new Error("memory4_compression_quality_failed");
    const compressed = result.items.map(item => {
      const sources = entries.filter(entry => item.sourceEntryIds.includes(entry.entryId));
      return archiveItem({ itemId: `year_item_${hash(item.sourceEntryIds)}`, text: item.text.trim(), sourceEntryIds: strings(item.sourceEntryIds),
        entityIds: ids(sources.flatMap(entry => entry.entityIds)), topics: strings(sources.flatMap(entry => entry.topics)),
        importance: Math.max(...sources.map(entry => entry.importance)) }, sources);
    });
    if (this.count(compressed.map(item => item.text).join("\n")) > hardLimit) throw new Error("memory4_compression_quality_failed");
    return compressed;
  }

  async buildYear(scope, eventYear, task, request, providerSnapshot) {
    scope = scopeDto(scope);
    const prior = this.read(scope, "year", eventYear);
    if (this.validView(scope, prior, "year") && !request.overwriteManual) return { status: "COMPLETE", eventYear, revision: prior.revision, alreadyCurrent: true };
    if (prior?.manual?.mode === "manual_override" && !request.overwriteManual) return { status: "MANUAL_OVERRIDE", eventYear };
    if (request.overwriteManual && (request.expectedRevision == null || prior?.revision !== request.expectedRevision)) throw new Error("memory4_derived_edit_stale");
    const snapshot = this.snapshot(scope, { eventYear });
    const entries = snapshot.entryIds.map(id => this.store.readEntry(scope, id, snapshot.index));
    if (entries.some(entry => entry.source.legacyMemoryIds?.length
      && entry.source.legacyMemoryIds.length !== (entry.source.legacyRefs || []).length)) throw new Error("memory4_derived_source_unproven");
    let items = entries.map(entry => archiveItem({ itemId: `year_item_${hash([eventYear, entry.entryId])}`, text: entry.text,
      sourceEntryIds: [entry.entryId], entityIds: [...entry.entityIds], topics: [...entry.topics], importance: entry.importance }, [entry]));
    items = await this.compress(scope, "year", items, entries, task, providerSnapshot);
    if (!this.current(scope, task)) throw new Error("memory4_derived_cancelled");
    if (hash(this.read(scope, "year", eventYear)) !== hash(prior) || this.snapshot(scope, { eventYear }).sourceHash !== snapshot.sourceHash) throw new Error("memory4_derived_source_changed");
    const view = { memory4SchemaVersion: 1, ...scope, eventYear, revision: (prior?.revision || 0) + 1, dirty: false,
      generationMode: "auto", sourceRevisionSet: snapshot.sourceRevisionSet, sourceHash: snapshot.sourceHash, items,
      manual: { mode: "auto", editedAt: null }, tokens: this.count(items.map(item => item.text).join("\n")) };
    this.persist(scope, "year", view);
    return { status: "COMPLETE", eventYear, revision: view.revision };
  }

  async buildLife(scope, task, request, providerSnapshot) {
    scope = scopeDto(scope);
    const prior = this.read(scope, "life");
    if (this.validView(scope, prior, "life") && !request.overwriteManual && !request.segmentId) return { status: "COMPLETE", revision: prior.revision, alreadyCurrent: true };
    if (prior?.manual?.mode === "manual_override" && !request.overwriteManual && !request.segmentId) return { status: "MANUAL_OVERRIDE" };
    if (request.overwriteManual && (request.expectedRevision == null || prior?.revision !== request.expectedRevision)) throw new Error("memory4_derived_edit_stale");
    const snapshot = this.snapshot(scope);
    const views = this.list(scope).years;
    if (views.some(view => view.dirty)) throw new Error("memory4_life_year_dirty");
    const yearStamp = hash(views.map(view => [view.eventYear, view.revision, view.sourceHash, view.items]));
    const grouped = new Map();
    for (const view of views) for (const item of view.items) {
      const decade = Math.floor(view.eventYear / 10) * 10;
      if (!grouped.has(decade)) grouped.set(decade, []);
      grouped.get(decade).push({ ...item, sourceYearItemId: `${view.eventYear}:${item.itemId}` });
    }
    const segments = [];
    for (const [decade, items] of grouped) {
      const segmentId = `life_${decade}s`, existing = prior?.segments.find(segment => segment.segmentId === segmentId);
      if ((request.segmentId && segmentId !== request.segmentId || existing?.manual?.mode === "manual_override" && !request.overwriteManual) && existing) {
        segments.push(existing); continue;
      }
      const unique = [...new Map(items.map(item => [hash([item.text, item.sourceEntryIds]), item])).values()];
      const sourceIds = strings(items.flatMap(item => item.sourceEntryIds));
      const entries = sourceIds.map(id => this.store.readEntry(scope, id, snapshot.index));
      const compressed = await this.compress(scope, "life", unique, entries, task, providerSnapshot);
      const segmentSnapshot = this.snapshot(scope, { period: { fromYear: decade, toYear: decade + 9 } }, snapshot.index);
      segments.push({ segmentId, period: { fromYear: decade, toYear: decade + 9 }, text: compressed.map(item => item.text).join("\n"),
        sourceYearItemIds: strings(items.map(item => item.sourceYearItemId)), sourceEntryIds: sourceIds,
        entityIds: ids(items.flatMap(item => item.entityIds)), topics: strings(items.flatMap(item => item.topics)),
        items: compressed, sourceRevisionSet: segmentSnapshot.sourceRevisionSet, sourceHash: segmentSnapshot.sourceHash,
        sourceYears: views.filter(view => view.eventYear >= decade && view.eventYear <= decade + 9).map(view => ({ eventYear: view.eventYear, viewHash: hash(view) })),
        manual: { mode: "auto", editedAt: null } });
    }
    if (!this.current(scope, task)) throw new Error("memory4_derived_cancelled");
    const currentYears = this.list(scope).years;
    if (hash(this.read(scope, "life")) !== hash(prior) || this.snapshot(scope).sourceHash !== snapshot.sourceHash
      || hash(currentYears.map(view => [view.eventYear, view.revision, view.sourceHash, view.items])) !== yearStamp) throw new Error("memory4_derived_source_changed");
    const manual = segments.some(item => item.manual?.mode === "manual_override");
    const view = { memory4SchemaVersion: 1, ...scope, revision: (prior?.revision || 0) + 1, dirty: segments.some(segment => !this.validSegment(scope, segment)),
      sourceRevisionSet: snapshot.sourceRevisionSet, sourceHash: snapshot.sourceHash, yearStamp, segments,
      generationMode: manual ? "manual_override" : "auto", manual: { mode: manual ? "manual_override" : "auto", editedAt: manual ? prior.manual.editedAt : null } };
    this.persist(scope, "life", view);
    return { status: "COMPLETE", revision: view.revision };
  }

  async rebuild(scope, request = {}) {
    scope = scopeDto(scope);
    const kind = request.kind || "all";
    if (!["all", "year", "life"].includes(kind)) throw new Error("memory4_derived_kind_invalid");
    const key = scopeKey(scope);
    if (this.active.has(key)) {
      this.active.get(key).queuedRequest = request;
      return { status: "QUEUED", reason: "OWNER_JOB_IN_PROGRESS" };
    }
    const started = Date.now();
    const task = { controller: new AbortController(), cancelled: false, committedFinalization: request.committedFinalization === true,
      finalizationProof: request.finalizationProof || null };
    this.active.set(key, task);
    this.jobs.set(key, { kind, status: "RUNNING", reason: null, eventYear: request.eventYear, segmentId: request.segmentId });
    try {
      if (!this.current(scope, task)) throw new Error("memory4_derived_cancelled");
      const providerSnapshot = request.providerSnapshot || null;
      const results = [];
      if (kind !== "life") {
        const views = this.list(scope).years, index = this.store.loadIndex(scope);
        const years = kind === "year" ? [request.eventYear] : [...new Set([...Object.values(index.entries).flatMap(archiveYears), ...views.map(view => view.eventYear)])].sort((a, b) => a - b);
        for (const year of years) results.push(await this.buildYear(scope, year, task, kind === "all" ? {} : request, providerSnapshot));
      }
      if (kind !== "year") results.push(await this.buildLife(scope, task, request, providerSnapshot));
      const status = results.some(result => result.status === "MANUAL_OVERRIDE") ? "MANUAL_OVERRIDE" : "COMPLETE";
      const sourceCount = kind === "year" ? this.snapshot(scope, { eventYear: request.eventYear }).entryIds.length : this.snapshot(scope).entryIds.length;
      const result = { status, kind, results, sourceCount, ...(sourceCount ? {} : { reason: "NO_ELIGIBLE_SOURCES" }) };
      this.jobs.set(key, { kind, status, reason: null });
      const metadata = this.store.read(path.join(this.store.directory(scope), "metadata.json"), null);
      this.coordinator.trace?.record("memory4_derived", { ownerId: scope.ownerId, status, kind, count: results.length,
        indexRevision: metadata?.revision, derivedRevision: metadata?.derivedRevision, durationMs: Date.now() - started });
      return result;
    } catch (error) {
      const status = !this.current(scope, task) ? "CANCELLED" : error.message === "memory4_derived_source_changed" ? "REQUEUED" : "FAILED";
      this.jobs.set(key, { kind, status, reason: error.message });
      this.coordinator.trace?.record("memory4_derived", { ownerId: scope.ownerId, status, kind, errorCode: error.message, durationMs: Date.now() - started });
      if (status === "REQUEUED" && !request.requeued) setImmediate(() => this.rebuild(scope, { ...request, overwriteManual: false, requeued: true }).catch(() => {}));
      return { status, kind, reason: error.message };
    } finally {
      this.active.delete(key);
      if (task.queuedRequest && this.current(scope, task)) setImmediate(() => this.rebuild(scope, task.queuedRequest).catch(() => {}));
    }
  }

  selectSlice(scope, { query, index, eligibleEntryIds = [], currentGameDate, maxTokens = 400, estimateTokens: count = estimateTokens, excludedKeys = [],
    verifiedEntries = new Map(), maxBodyReads = 32, onReadEntry = () => {} } = {}) {
    scope = scopeDto(scope);
    if (!["LIFE", "PERIOD", "YEAR"].includes(query.granularity) || query.firstMeeting || query.axis === "CONVERSATION") return null;
    const allowed = new Set(eligibleEntryIds), current = serial(currentGameDate);
    const views = this.list(scope);
    const sourcesCurrent = item => item.sourceEntryIds?.length && item.sourceEntryIds.every(id => {
      const row = index.entries[id];
      return allowed.has(id) && row && [row.conversationDate, row.acquiredDate].every(date => serial(date) <= current)
        && (!row.stateChangedGameDate || serial(row.stateChangedGameDate) <= current)
        && (!query.window || serial(row.eventTime.from) <= serial(query.window.to) && serial(row.eventTime.to) >= serial(query.window.from))
        && (!query.entityIds.length || row.entityIds.some(entity => query.entityIds.includes(entity)));
    });
    const candidates = [];
    if (["LIFE", "PERIOD"].includes(query.granularity) && views.life && !views.life.dirty) {
      for (const segment of views.life.segments) for (const item of segment.manual?.mode === "manual_override" ? [{ ...segment, itemId: segment.segmentId }] : segment.items || []) {
        if (sourcesCurrent(item)) candidates.push({ ...item, kind: "life", view: views.life, segmentId: segment.segmentId });
      }
    }
    if (!candidates.length) for (const view of views.years.filter(view => !view.dirty)) for (const item of view.items) {
      if (sourcesCurrent(item)) candidates.push({ ...item, kind: "year", view });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => (b.importance || 0) - (a.importance || 0));
    const chosen = [], texts = [];
    let bodyReads = 0;
    const metadata = this.store.read(path.join(this.store.directory(scope), "metadata.json"), null);
    for (const candidate of candidates) {
      const key = `memory4:${scope.campaignToken}:${scope.ownerId}:${candidate.kind}:${candidate.view.revision}:${candidate.itemId}`;
      if (excludedKeys.includes(key)) continue;
      if (count([...texts, candidate.text].join("\n")) > Math.min(400, maxTokens)) continue;
      if (chosen.length && (candidate.kind !== chosen[0].kind || candidate.view.eventYear !== chosen[0].view.eventYear)) continue;
      if (candidate.sourceEntryIds.filter(id => !verifiedEntries.has(id)).length > maxBodyReads - bodyReads) continue;
      try {
        let valid = true;
        for (const id of candidate.sourceEntryIds) {
          if (!verifiedEntries.has(id)) {
            bodyReads++; onReadEntry(id);
            verifiedEntries.set(id, this.store.readEntry(scope, id, index));
          }
          const entry = verifiedEntries.get(id);
          if (!this.sourceValid(scope, index.entries[id], index, metadata) || !ids(entry.evidence.knownBy).includes(scope.ownerId)
            || entry.source.legacyMemoryIds?.length && entry.source.legacyMemoryIds.length !== (entry.source.legacyRefs || []).length) valid = false;
        }
        if (!valid) continue;
      } catch { continue; }
      const sources = candidate.sourceEntryIds.map(id => verifiedEntries.get(id));
      const sourceLabels = { witnessed: "亲历", game_fact: "游戏事实", spoken: "言语自述", reported: "转述", rumor: "传闻" };
      const annotation = `来源状态 ${strings(sources.map(entry => entry.state.status)).join("/")}；事件 ${strings(sources.map(entry => `${entry.eventTime.from || "时间未知"}~${entry.eventTime.to || "时间未知"} ${entry.eventTime.precision}/${entry.eventTime.status}`)).join("；")}；证据 ${strings(sources.map(entry => `${entry.evidence.sourceType}（${sourceLabels[entry.evidence.sourceType] || "未知"}）/${entry.evidence.epistemicStatus}`)).join("；")}；概览不高于其详细来源。`;
      const text = `${annotation}\n${candidate.text}`;
      if (count([...texts, text].join("\n")) > Math.min(400, maxTokens)) continue;
      chosen.push({ ...candidate, key }); texts.push(text);
    }
    if (!chosen.length) return null;
    const first = chosen[0], sourceIds = strings(chosen.flatMap(item => item.sourceEntryIds));
    const acquiredCount = sourceIds.filter(id => !eventYears(index.entries[id]).length).length;
    const axis = !acquiredCount ? "event" : acquiredCount === sourceIds.length ? "acquired" : "mixed";
    const dates = (axis === "mixed" ? [] : sourceIds.flatMap(id => axis === "acquired" ? [index.entries[id].acquiredDate]
      : [index.entries[id].eventTime.from, index.entries[id].eventTime.to])).filter(Boolean).sort((a, b) => serial(a) - serial(b));
    const memoryId = `${first.kind}_${hash([scope, first.view.revision, chosen.map(item => item.itemId)])}`;
    return { memory: { memoryId, memory4Key: first.key, content: texts.join("\n"), tags: strings(chosen.flatMap(item => item.topics)), type: `memory4_${first.kind}` },
      reason: { axis, from: query.window?.from || dates[0] || null,
        to: query.window?.to || dates.at(-1) || null, precision: axis === "mixed" ? "unknown" : first.kind === "year" ? "year" : "range" },
      annotation: `${first.kind === "year" ? "年度" : "人生"}派生片段；来源版本 ${first.view.revision}。${acquiredCount ? "获知日期不是事件发生日期，未知事件日期保持未知。" : ""}`,
      sourceRef: { kind: first.kind, id: memoryId, eventYear: first.view.eventYear, revision: first.view.revision,
        viewHash: hash(first.view), sourceEntryIds: sourceIds, sourceRowsHash: hash(sourceIds.map(id => index.entries[id])) },
      score: first.importance || 0 };
  }

  validateRef(scope, ref, { currentGameDate = null } = {}) {
    try {
    if (ref.kind === "conversation_year") {
      const index = this.store.loadIndex(scope);
      const metadata = this.store.read(path.join(this.store.directory(scope), "metadata.json"), null);
      return !!currentGameDate && Array.isArray(ref.sourceEntryIds) && ref.sourceEntryIds.length > 0 && ref.sourceEntryIds.length <= 32
        && hash(ref.sourceEntryIds.map(id => index.entries[id])) === ref.sourceRowsHash
        && ref.sourceEntryIds.every(id => this.sourceValid(scope, index.entries[id], index, metadata)
          && [index.entries[id].conversationDate, index.entries[id].acquiredDate].every(date => serial(date) <= serial(currentGameDate))
          && (!index.entries[id].stateChangedGameDate || serial(index.entries[id].stateChangedGameDate) <= serial(currentGameDate))
          && !!this.store.readEntry(scope, id, index));
    }
    const view = this.read(scope, ref.kind, ref.eventYear);
    if (!this.validView(scope, view, ref.kind) || view.revision !== ref.revision || hash(view) !== ref.viewHash || !currentGameDate) return false;
    const index = this.store.loadIndex(scope);
    const metadata = this.store.read(path.join(this.store.directory(scope), "metadata.json"), null);
    return hash((ref.sourceEntryIds || []).map(id => index.entries[id])) === ref.sourceRowsHash
      && ref.sourceEntryIds.length > 0 && ref.sourceEntryIds.length <= 32
      && ref.sourceEntryIds.every(id => this.sourceValid(scope, index.entries[id], index, metadata)
        && [index.entries[id].conversationDate, index.entries[id].acquiredDate].every(date => serial(date) <= serial(currentGameDate))
        && (!index.entries[id].stateChangedGameDate || serial(index.entries[id].stateChangedGameDate) <= serial(currentGameDate))
        && !!this.store.readEntry(scope, id, index));
    } catch { return false; }
  }
}

module.exports = { Memory4DerivedService, eventYears, YEAR_MAX_TOKENS, LIFE_SEGMENT_MAX_TOKENS };
