"use strict";

const fs = require("fs");
const path = require("path");
const { assertScope, hash, ids, strings, gameDate, sourceRevisionCurrent, validateEntry } = require("./memory4-contract");
const { updateKnownEntities, evidenceCompleteness } = require("./memory4-visibility");
const { getFactCandidates, disclosureFactId } = require("./memory4-disclosure");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");

const INDEX_KEYS = ["byCampaign", "byOwner", "byEntity", "byTopic", "byEventYear", "byEventDate", "byConversationYear", "byAcquiredYear", "byCounterpart", "byMemoryType", "byState", "bySourceFinalization"];
const DISCLOSURE_STATUSES = new Set(["AUTO_DISCLOSED", "MANUAL_KNOWN", "MANUAL_HIDDEN"]);
const UNCERTAIN_COMMITMENT = /[?？]|如果|假如|要是|倘若|是否|能否|会不会|听说|据说|传闻|声称|心想|心里|内心|打算|计划|希望|准备|明天|明日|明年|今后|以后|将来|届时|将要|将会|即将|尚未|还未|还没|没有|并未|未能|没能|不能|无法|从未|不曾|并非|不属实|不是真的|请|命令|要求|(?:不|未|没)(?:曾|是|能|会|再|愿|代表|意味着|完成|履行|兑现|归还|交还|交付|取消|撤销|释放|替代|取代)|(?:将|会).{0,16}(?:完成|履行|兑现|归还|交还|交付|取消|撤销|废止|作废|替代|取代)|\b(?:if|suppose|hypothetical|will|would|might|may|plan|intend|hope|tomorrow|rumor|rumour|heard|not|never|please)\b|n['’]t/i;
const COMMITMENT_CUE = /承诺|答应|许诺|保证|约定|\b(?:promise(?:s|d)?|pledge(?:s|d)?|agree(?:s|d)?|undertake|undertakes|undertook|undertaken|vow(?:s|ed)?)\b/gi;
const COMMITMENT_CONDITION = /(?:但(?:是)?(?:须|必须|需)?|须|必须|前提(?:是)?|条件(?:是)?|只有|只要|倘若|若|如果|\bunless\b|\bprovided\b|\bon condition\b|\bonly if\b|\bif\b)\s*([^。.!！?？;；]+)/gi;

function commitmentBinding(value) {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 256
    && !!value.replace(/事情|此事|承诺|约定|答应|完成|履行|取消|作废|替代|我|你|他|她|我们|双方|已经|了|的|原约|旧约|新约|\b(?:the|a|an|i|you|we|it|this|that|promise|commitment|agreement|pledge|fulfilled|completed|cancelled|canceled|superseded|done)\b|[\s,.。]/gi, "");
}

function commitmentCore(text) {
  const value = typeof text === "string" ? text : "";
  const cues = [...value.matchAll(COMMITMENT_CUE)];
  if (cues.length !== 1) return null;
  let core = value.slice(cues[0].index + cues[0][0].length);
  const sentenceEnd = core.search(/[。.!！?？;；\r\n]/);
  if (sentenceEnd >= 0) core = core.slice(0, sentenceEnd);
  const condition = [...core.matchAll(COMMITMENT_CONDITION)][0];
  if (condition) {
    if (condition.index === 0) return null;
    core = core.slice(0, condition.index);
  }
  core = core.trim().replace(/^[，,：:\s-]+/, "")
    .replace(/^(?:你|你们|我|我们|他|她|双方|对方)\s*/, "")
    .replace(/^[，,：:\s-]+/, "")
    .replace(/^(?:to|that)\s+/i, "")
    .replace(/^(?:将|会|必将|一定会|要)\s*/, "")
    .replace(/[，,：:;；]+$/, "").trim();
  return commitmentBinding(core) ? core : null;
}

function commitmentConditions(text) {
  return [...String(text).matchAll(COMMITMENT_CONDITION)]
    .map(match => match[1].split(/[,，]/)[0].trim().replace(/^(?:先|要|得|在)/, "")).filter(Boolean);
}

function commitmentOutcomeBound(text, core, status) {
  const clauses = String(text).split(/[，,。.!！?？;；\r\n]+/);
  return clauses.some(clause => {
    let start = 0;
    while ((start = clause.indexOf(core, start)) >= 0) {
      const before = clause.slice(Math.max(0, start - 96), start);
      const after = clause.slice(start + core.length, start + core.length + 48);
      if (status === "fulfilled" && (
        /(?:已经|已)(?:如约|依约|按约)?\s*$/.test(before)
        || /\b(?:have|has|had)\s+(?:already\s+)?$/i.test(before)
        || /^了(?:\s|$)/.test(after)
        || /(?:履行|兑现|完成)了(?:我|我们|你|你们|他|她)?\s*$/.test(before) && /^(?:的)?(?:承诺|约定|原约|旧约)/.test(after)
        || /\b(?:fulfilled|completed|kept)\s+(?:(?:my|our|the)\s+)?(?:promise|commitment|agreement)\s+to\s*$/i.test(before)
      )) return true;
      if (status === "cancelled" && (
        /(?:取消|撤销|废止|作废|解除)(?:了)?(?:我|我们|你|你们|他|她|双方|对方)?\s*$/.test(before)
        && /^(?:的)?(?:原约|旧约|承诺|约定)/.test(after)
        || /\b(?:cancelled|canceled|revoked|withdrawn|voided)\s+(?:(?:my|our|the)\s+)?(?:promise|commitment|agreement)\s+to\s*$/i.test(before)
        || /^(?:的)?(?:原约|旧约|承诺|约定).{0,8}(?:已经|已|正式)?(?:取消|撤销|废止|作废|解除)/.test(after)
      )) return true;
      if (status === "superseded" && (
        /(?:改为|替代|取代|废止|取消|作废)(?:了)?(?:我|我们|你|你们|他|她|双方|对方)?\s*$/.test(before)
        && /^(?:的)?(?:原约|旧约|承诺|约定)/.test(after)
        || /(?:现)?将[“"'‘「『]?\s*$/.test(before)
        && /^(?:[”"'’」』]\s*)?(?:的)?(?:原约|旧约|承诺|约定).{0,8}(?:已经|已|现|正式)?(?:改为|替代|取代|废止|取消|作废)/.test(after)
        || /\b(?:replaced|superseded)\s+(?:(?:my|our|the|previous|original)\s+)*(?:promise|commitment|agreement)\s+to\s*$/i.test(before)
        || /^(?:的)?(?:原约|旧约|承诺|约定).{0,8}(?:已经|已|现|正式)?(?:改为|替代|取代|废止|取消|作废)/.test(after)
      )) return true;
      start += core.length;
    }
    return false;
  });
}

function latestDate(left, right) {
  const a = normalizeGameDate(left), b = normalizeGameDate(right);
  if (!a) return b?.canonical || null;
  if (!b) return a.canonical;
  return (a.serial >= b.serial ? a : b).canonical;
}

function effectiveDisclosure(record, asOf, ownerId, metadata) {
  const current = normalizeGameDate(asOf);
  const evidenceBySource = Object.fromEntries(Object.entries(record.evidenceBySource || {}).filter(([, proof]) => {
    const acquired = normalizeGameDate(proof?.acquiredDate);
    const sourceCurrent = proof?.sourceKind !== "CONVERSATION"
      || metadata?.knownEvidenceRevisions?.[hash([proof.sourceConversationId, ownerId])] === proof.sourceRevision;
    return current && acquired && acquired.serial <= current.serial && ids(proof.knownBy).join() === String(ownerId) && sourceCurrent;
  }));
  const manualDate = normalizeGameDate(record.manualMarkedDate);
  const manualApplies = manualDate && current && manualDate.serial <= current.serial
    && ["MANUAL_KNOWN", "MANUAL_HIDDEN"].includes(record.status);
  const hasAutoEvidence = Object.keys(evidenceBySource).length > 0;
  const status = manualApplies ? record.status : hasAutoEvidence ? "AUTO_DISCLOSED" : null;
  if (!status) return { status: null, effectiveKnown: false, evidenceBySource, firstAcquiredDate: null, lastConfirmedDate: null };
  const dates = Object.values(evidenceBySource).map(proof => normalizeGameDate(proof.acquiredDate)).filter(Boolean);
  const evidenceDates = [...dates].sort((a, b) => a.serial - b.serial);
  if (manualApplies && record.status === "MANUAL_KNOWN") dates.push(manualDate);
  dates.sort((a, b) => a.serial - b.serial);
  return { status, effectiveKnown: status !== "MANUAL_HIDDEN", evidenceBySource,
    firstAcquiredDate: dates[0]?.canonical || null,
    lastConfirmedDate: evidenceDates.at(-1)?.canonical || null,
    tombstone: status === "MANUAL_HIDDEN" ? record.tombstone || null : null };
}

class Memory4Store {
  constructor(store) {
    this.store = store;
  }

  directory(scope) {
    assertScope(scope);
    if (!this.store.summaryFoldersDir) throw new Error("memory4_summary_root_missing");
    const root = path.resolve(this.store.summaryFoldersDir);
    const candidates = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith(`${scope.ownerId}_`)) : [];
    const canonical = path.join(root, ".memory4", String(scope.ownerId), hash(scope.campaignToken));
    const existing = [canonical, ...candidates.map(entry => path.join(root, entry.name, "memory4", hash(scope.campaignToken)))]
      .filter(directory => fs.existsSync(directory));
    if (existing.length > 1) throw new Error("memory4_owner_sidecar_not_unique");
    if (!candidates.length && !existing.length) throw new Error("memory4_owner_folder_not_unique");
    const directory = existing[0] || canonical;
    // Do not follow a sidecar junction outside the summary tree.
    let checked = directory;
    while (checked !== root) {
      if (fs.existsSync(checked) && fs.lstatSync(checked).isSymbolicLink()) throw new Error("memory4_symlink_path");
      checked = path.dirname(checked);
    }
    return directory;
  }

  read(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { throw new Error("memory4_corrupt_json"); }
  }

  loadIndex(scope) {
    const directory = this.directory(scope);
    const index = this.read(path.join(directory, "index.json"), null);
    if (!index) {
      if (fs.existsSync(path.join(directory, "metadata.json")) || fs.existsSync(path.join(directory, "entries"))) throw new Error("memory4_index_missing_rebuild_required");
      return { campaignToken: scope.campaignToken, ownerId: scope.ownerId, revision: 0, entries: {}, finalizations: {},
        ...Object.fromEntries(INDEX_KEYS.map(key => [key, {}])) };
    }
    if (index.campaignToken !== scope.campaignToken || index.ownerId !== scope.ownerId || !index.entries || !index.finalizations
      || INDEX_KEYS.some(key => !index[key] || typeof index[key] !== "object")) throw new Error("memory4_index_invalid");
    const metadata = this.read(path.join(directory, "metadata.json"), null);
    if (!metadata || metadata.campaignToken !== scope.campaignToken || metadata.ownerId !== scope.ownerId
      || metadata.indexHash !== hash(index) || metadata.revision !== index.revision) throw new Error("memory4_metadata_index_mismatch");
    return index;
  }

  ensureDisclosureScope(scope) {
    assertScope(scope);
    if (!this.store.summaryFoldersDir) throw new Error("memory4_summary_root_missing");
    const root = path.resolve(this.store.summaryFoldersDir);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) {
      throw new Error("memory4_summary_root_invalid");
    }
    let directory;
    try { directory = this.directory(scope); }
    catch (error) {
      if (error.message !== "memory4_owner_folder_not_unique") throw error;
      directory = path.join(root, ".memory4", String(scope.ownerId), hash(scope.campaignToken));
    }
    const target = path.resolve(directory);
    const relative = path.relative(root, target);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("memory4_disclosure_path_invalid");
    }
    const assertNoSymlink = () => {
      let checked = target;
      while (checked !== root) {
        if (!checked.startsWith(`${root}${path.sep}`)) throw new Error("memory4_disclosure_path_invalid");
        if (fs.existsSync(checked) && fs.lstatSync(checked).isSymbolicLink()) throw new Error("memory4_symlink_path");
        checked = path.dirname(checked);
      }
    };
    assertNoSymlink();
    fs.mkdirSync(target, { recursive: true });
    assertNoSymlink();
    const indexPath = path.join(target, "index.json");
    const metadataPath = path.join(target, "metadata.json");
    if (fs.existsSync(indexPath) || fs.existsSync(metadataPath) || fs.existsSync(path.join(target, "entries"))) {
      this.loadIndex(scope);
      return target;
    }
    const index = { campaignToken: scope.campaignToken, ownerId: scope.ownerId, revision: 0, entries: {}, finalizations: {},
      ...Object.fromEntries(INDEX_KEYS.map(key => [key, {}])) };
    const metadata = { memory4SchemaVersion: 1, campaignToken: scope.campaignToken, ownerId: scope.ownerId,
      revision: 0, indexHash: hash(index), knownEvidenceRevisions: {} };
    const known = { campaignToken: scope.campaignToken, ownerId: scope.ownerId, revision: 0, entities: {} };
    this.store.withSummaryMutation(null, () => {
      this.store.writeJson(path.join(target, "known-entities.json"), known);
      this.store.writeJson(metadataPath, metadata);
      this.store.writeJson(indexPath, index);
    });
    return target;
  }

  assertPersistedScope(scope) {
    const directory = this.directory(scope);
    const names = ["index.json", "metadata.json", "known-entities.json", "entries", "years", "life.json"];
    const existing = names.map(name => path.join(directory, name)).filter(file => fs.existsSync(file));
    if (!existing.length) throw new Error("memory4_scope_not_persisted");
    for (const file of existing) if (fs.lstatSync(file).isSymbolicLink()) throw new Error("memory4_symlink_path");
    if (!fs.existsSync(path.join(directory, "index.json")) || !fs.existsSync(path.join(directory, "metadata.json"))) {
      throw new Error("memory4_index_missing_rebuild_required");
    }
    this.loadIndex(scope);
    return directory;
  }

  entryPath(directory, id) {
    if (!/^m4_[a-f0-9]{64}$/.test(id)) throw new Error("memory4_invalid_entry_id");
    const entries = path.join(directory, "entries");
    const file = path.join(entries, `${id}.json`);
    for (const target of [entries, file]) {
      if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error("memory4_symlink_path");
    }
    return file;
  }

  reindex(index) {
    for (const key of INDEX_KEYS) index[key] = {};
    const add = (axis, key, id) => {
      if (key == null) return;
      const value = String(key);
      if (!Object.hasOwn(index[axis], value)) Object.defineProperty(index[axis], value, { value: [], enumerable: true, writable: true, configurable: true });
      index[axis][value].push(id);
    };
    for (const [id, row] of Object.entries(index.entries)) {
      if (row.deleted) continue;
      add("byCampaign", index.campaignToken, id); add("byOwner", index.ownerId, id);
      for (const entity of row.entityIds) add("byEntity", entity, id);
      for (const topic of row.topics) add("byTopic", topic, id);
      for (const counterpart of row.counterpartIds) add("byCounterpart", counterpart, id);
      if (row.eventTime.precision === "day") add("byEventDate", row.eventTime.from, id);
      if (row.eventTime.from) {
        const first = Number(row.eventTime.from.split(".")[0]);
        const last = Number(row.eventTime.to.split(".")[0]);
        for (let year = first; year <= last; year++) add("byEventYear", year, id);
      }
      add("byConversationYear", row.conversationDate?.split(".")[0], id);
      add("byAcquiredYear", row.acquiredDate?.split(".")[0], id);
      add("byMemoryType", row.memoryType, id); add("byState", row.status, id);
      add("bySourceFinalization", row.finalizationId, id);
    }
  }

  recordKnownEvidence(snapshot) {
    assertScope(snapshot);
    if (!snapshot.conversationId || !snapshot.sourceRevision) throw new Error("memory4_source_identity_missing");
    const index = this.loadIndex(snapshot);
    const directory = this.directory(snapshot);
    const metadata = this.read(path.join(directory, "metadata.json"), null);
    const evidenceKey = hash([snapshot.conversationId, snapshot.ownerId]);
    if (metadata?.knownEvidenceRevisions?.[evidenceKey] === snapshot.sourceRevision) return { alreadyRecorded: true };
    const known = updateKnownEntities(this.read(path.join(directory, "known-entities.json"), null), snapshot);
    index.revision++;
    const now = new Date().toISOString();
    this.store.withSummaryMutation(null, () => {
      this.store.writeJson(path.join(directory, "known-entities.json"), known);
      const affected = Object.keys(index.entries).filter(id => index.entries[id].conversationId === snapshot.conversationId);
      const derived = this.derived?.markDirty(snapshot, { index, metadata, entryIds: affected }) || {};
      this.store.writeJson(path.join(directory, "metadata.json"), { ...metadata, memory4SchemaVersion: 1,
        campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId, revision: index.revision, indexHash: hash(index),
        knownEvidenceRevisions: { ...metadata?.knownEvidenceRevisions, [evidenceKey]: snapshot.sourceRevision },
        ...derived, updatedAt: now });
      this.store.writeJson(path.join(directory, "index.json"), index);
    });
    return { alreadyRecorded: false, entityCount: Object.keys(known.entities).length };
  }

  activeCommitments(snapshot) {
    const index = this.loadIndex(snapshot), directory = this.directory(snapshot);
    const metadata = this.read(path.join(directory, "metadata.json"), null);
    const date = normalizeGameDate(snapshot.date);
    if (!date) return [];
    const text = snapshot.fragments.map(fragment => fragment.text).join("\n");
    return (index.byMemoryType.COMMITMENT || []).filter(id => {
      const row = index.entries[id];
      return !row.deleted && row.status === "active" && row.knownBy?.includes(snapshot.ownerId)
        && normalizeGameDate(row.acquiredDate)?.serial <= date.serial;
    }).sort((left, right) => {
      const score = row => row.topics.filter(topic => text.includes(topic)).length;
      return score(index.entries[right]) - score(index.entries[left])
        || (normalizeGameDate(index.entries[right].conversationDate)?.serial || 0) - (normalizeGameDate(index.entries[left].conversationDate)?.serial || 0)
        || left.localeCompare(right);
    }).slice(0, 32).flatMap(id => {
      const entry = this.readEntry(snapshot, id, index);
      return sourceRevisionCurrent(entry.source, snapshot, index, metadata) && !entry.source.legacyMemoryIds?.length
        ? [{ entryId: id, revision: entry.revision, text: entry.text, bodyHash: hash(entry) }] : [];
    });
  }

  commitmentChanges(snapshot, transitions, entries, index, metadata) {
    if (!Array.isArray(transitions) || transitions.length > 8 || new Set(transitions.map(item => item.entryId)).size !== transitions.length) throw new Error("memory4_commitment_transitions_invalid");
    const changes = [];
    for (const transition of transitions) {
      const row = index.entries[transition.entryId], offered = snapshot.activeCommitments?.find(entry => entry.entryId === transition.entryId);
      if (!row || row.deleted || row.memoryType !== "COMMITMENT" || row.status !== "active" || !offered
        || transition.expectedRevision !== row.revision || offered.revision !== row.revision || offered.bodyHash !== row.bodyHash) throw new Error("memory4_commitment_target_stale");
      const entry = this.readEntry(snapshot, transition.entryId, index);
      if (!entry.evidence.knownBy.includes(snapshot.ownerId) || !sourceRevisionCurrent(entry.source, snapshot, index, metadata)) throw new Error("memory4_commitment_target_source_invalid");
      const date = gameDate(snapshot.date);
      if (!date || normalizeGameDate(entry.acquiredDate)?.serial > normalizeGameDate(date).serial) throw new Error("memory4_commitment_date_invalid");
      const fragmentIds = strings(transition.fragmentIds), fragments = fragmentIds.map(id => snapshot.fragments.find(fragment => fragment.fragmentId === id));
      if (!fragmentIds.length || fragments.some(fragment => !fragment || !fragment.knownBy.includes(snapshot.ownerId)
        || !["spoken", "reported", "witnessed", "game_fact"].includes(fragment.sourceType)
        || ["spoken", "reported"].includes(fragment.sourceType) && (entry.evidence.reportedBy.length !== 1 || entry.evidence.reportedBy[0] !== fragment.speakerId)
        || fragment.visibilityEvidence === "finalization_validated_segment" && !fragment.sourceTextVerified
        || !Number.isSafeInteger(fragment.messageId) || fragment.messageId < 0)) throw new Error("memory4_commitment_evidence_invalid");
      const quote = typeof transition.evidenceQuote === "string" ? transition.evidenceQuote.trim() : "";
      const binding = typeof transition.commitmentQuote === "string" ? transition.commitmentQuote.trim() : "";
      const core = commitmentCore(entry.text);
      const bindingMatches = (index.byMemoryType.COMMITMENT || []).filter(id => index.entries[id].status === "active" && !index.entries[id].deleted)
        .filter(id => {
          const current = this.readEntry(snapshot, id, index);
          return current.evidence.knownBy.includes(snapshot.ownerId) && commitmentCore(current.text) === binding
            && normalizeGameDate(current.acquiredDate)?.serial <= normalizeGameDate(date).serial
            && sourceRevisionCurrent(current.source, snapshot, index, metadata);
        });
      if (!quote || !core || binding !== core || !quote.includes(core)
        || bindingMatches.length !== 1
        || !fragments.every(fragment => fragment.text.includes(quote))) throw new Error("memory4_commitment_binding_invalid");
      const replacement = transition.status === "superseded" ? entries[transition.replacementEntryIndex] : null;
      if (transition.status === "superseded" && (!Number.isInteger(transition.replacementEntryIndex) || !replacement
        || replacement.memoryType !== "COMMITMENT" || replacement.text === entry.text || !quote.includes(replacement.text)
        || !replacement.source.segmentIds.some(id => fragmentIds.includes(id)))) throw new Error("memory4_commitment_replacement_invalid");
      const paragraphs = fragments.flatMap(fragment => fragment.text.split(/\r?\n/).filter(paragraph => paragraph.includes(quote)));
      if (paragraphs.some(paragraph => UNCERTAIN_COMMITMENT.test(replacement ? paragraph.replace(replacement.text, "") : paragraph))) throw new Error("memory4_commitment_evidence_uncertain");
      const conditions = commitmentConditions(entry.text);
      if (transition.status === "fulfilled") {
        if (!commitmentOutcomeBound(quote, core, "fulfilled")
          || conditions.some(condition => !quote.includes(condition) || !quote.split(/[，,。.!！;；]/).some(clause => clause.includes(condition)
            && (clause.includes(`已经${condition}`) || clause.includes(`已${condition}`)
              || /已经满足|已满足|已经达成|已达成|已经完成|已完成|\b(?:satisfied|completed|fulfilled)\b/i.test(clause))))) throw new Error("memory4_commitment_fulfillment_unproven");
      } else if (transition.status === "cancelled") {
        if (!commitmentOutcomeBound(quote, core, "cancelled")) throw new Error("memory4_commitment_cancellation_unproven");
      } else if (transition.status === "superseded") {
        if (!commitmentOutcomeBound(quote, core, "superseded")) throw new Error("memory4_commitment_replacement_unproven");
      } else throw new Error("memory4_commitment_status_invalid");
      if (conditions.length && transition.status !== "fulfilled" && !/原约|旧约|原(?:有|先)?(?:约定|承诺)|此前的(?:约定|承诺)|\b(?:original|previous|prior|old)\s+(?:agreement|promise|commitment)\b/i.test(quote)
        || conditions.length && transition.status !== "fulfilled" && !/全部条件|所有条件|及其条件|连同.{0,12}条件|\b(?:all|its)\s+conditions\b/i.test(quote)) throw new Error("memory4_commitment_conditions_unproven");
      const now = new Date().toISOString(), evidenceEntryIds = entries.filter(item => item.source.segmentIds.some(id => fragmentIds.includes(id))).map(item => item.entryId);
      const sourceMessageIds = [...new Set(fragments.flatMap(fragment => fragment.sourceMessageIds || [fragment.messageId]))].sort((a, b) => a - b);
      const observed = fragments.every(fragment => ["witnessed", "game_fact"].includes(fragment.sourceType));
      entry.state = { ...entry.state, status: transition.status, revision: (entry.state.revision || 1) + 1,
        changedAt: now, changedGameDate: date, evidenceEntryIds, sourceMessageIds,
        supportedByEntryIds: strings([...entry.state.supportedByEntryIds, ...evidenceEntryIds]),
        commitmentQuote: binding, evidenceQuote: quote, source: { conversationId: snapshot.conversationId,
          finalizationId: snapshot.finalizationId, sourceRevision: snapshot.sourceRevision, fragmentIds, messageIds: sourceMessageIds,
          sourceType: observed ? "witnessed" : "reported", epistemicStatus: observed ? "observed" : "reported" },
        ...(replacement ? { supersededByEntryId: replacement.entryId } : {}) };
      if (replacement) replacement.state.supersedesEntryIds = strings([...replacement.state.supersedesEntryIds, entry.entryId]);
      entry.revision++; entry.updatedAt = now; changes.push(entry);
    }
    return changes;
  }

  commitOwner(snapshot, result) {
    assertScope(snapshot);
    if (!snapshot.finalizationId || !snapshot.conversationId || !snapshot.sourceRevision) throw new Error("memory4_source_identity_missing");
    if (!["STORE", "NO_DURABLE_CONTENT", "NOT_PRESENT"].includes(result?.status)) throw new Error("memory4_invalid_result_status");
    if (!Array.isArray(result.entries) || result.entries.length > 8 || (result.status === "STORE") !== (result.entries.length > 0)) throw new Error("memory4_invalid_result_entries");
    const hasSource = snapshot.presentMessageCount > 0 || snapshot.fragments.length > 0;
    if (result.status === "NOT_PRESENT" && hasSource || result.status !== "NOT_PRESENT" && !hasSource) throw new Error("memory4_presence_result_mismatch");
    if (!["complete", "partial"].includes(snapshot.completeness)) throw new Error("memory4_visibility_incomplete");
    const index = this.loadIndex(snapshot);
    const key = hash(snapshot.finalizationId);
    const committed = index.finalizations[key];
    if (committed) {
      if (committed.sourceRevision !== snapshot.sourceRevision) throw new Error("memory4_source_revision_conflict");
      return { ...committed, alreadyCommitted: true };
    }
    const entries = result.entries.map(candidate => validateEntry(candidate, snapshot));
    if (new Set(entries.map(entry => entry.entryId)).size !== entries.length) throw new Error("memory4_duplicate_fact");
    const directory = this.directory(snapshot);
    const metadata = this.read(path.join(directory, "metadata.json"), null);
    if (metadata && (metadata.campaignToken !== snapshot.campaignToken || metadata.ownerId !== snapshot.ownerId)) throw new Error("memory4_scope_mismatch");
    const changes = this.commitmentChanges(snapshot, result.commitmentTransitions || [], entries, index, metadata);
    const now = new Date().toISOString();
    const record = { status: result.status, entryIds: entries.map(entry => entry.entryId), sourceRevision: snapshot.sourceRevision, committedAt: now,
      completeness: snapshot.completeness, visibilityEvidence: snapshot.visibilityEvidence || null,
      evaluatedFragmentCount: snapshot.fragments.length, legacyRetained: snapshot.legacyRetained === true,
      changedEntryIds: changes.map(entry => entry.entryId), commitmentTransitionCount: changes.length, noDetailIsNotUnknown: true };
    this.store.withSummaryMutation(null, () => {
      for (const entry of [...entries, ...changes]) {
        // Tombstones survive re-extraction; a stale job cannot resurrect a fact.
        if (index.entries[entry.entryId]?.deleted) continue;
        this.store.writeJson(this.entryPath(directory, entry.entryId), entry);
        index.entries[entry.entryId] = this.indexRow(entry);
      }
      index.finalizations[key] = record;
      index.revision++;
      this.reindex(index);
      const priorKnown = this.read(path.join(directory, "known-entities.json"), null);
      const known = snapshot.skipKnownEvidence ? priorKnown || { campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId, revision: 0, entities: {} }
        : updateKnownEntities(priorKnown, snapshot);
      this.store.writeJson(path.join(directory, "known-entities.json"), known);
      const derived = this.derived?.markDirty(snapshot, { index, metadata, entryIds: [...entries, ...changes].map(entry => entry.entryId) }) || {};
      this.store.writeJson(path.join(directory, "metadata.json"), { ...metadata, memory4SchemaVersion: 1, campaignToken: snapshot.campaignToken,
        ownerId: snapshot.ownerId, revision: index.revision, indexHash: hash(index), lastFinalizationId: snapshot.finalizationId,
        knownEvidenceRevisions: { ...metadata?.knownEvidenceRevisions, [hash([snapshot.conversationId, snapshot.ownerId])]: snapshot.sourceRevision },
        derivedDirty: entries.length > 0 || changes.length > 0 || metadata?.derivedDirty === true, ...derived, updatedAt: now });
      this.store.writeJson(path.join(directory, "index.json"), index);
    });
    this.store.invalidateFolderSummaryCache([snapshot.ownerId]);
    return record;
  }

  indexRow(entry) {
    return { revision: entry.revision, entityIds: entry.entityIds, topics: entry.topics, counterpartIds: entry.counterpartIds,
      eventTime: entry.eventTime, conversationDate: entry.conversationDate, acquiredDate: entry.acquiredDate,
      memoryType: entry.memoryType, status: entry.state.status, finalizationId: entry.source.finalizationId,
      stateChangedGameDate: entry.state.changedGameDate || null, stateSource: entry.state.source || null,
      conversationId: entry.source.conversationId, legacyRefs: entry.source.legacyRefs || [],
      legacyMemoryIds: entry.source.legacyMemoryIds || [],
      knownBy: entry.evidence.knownBy, visibility: entry.evidence.visibility, importance: entry.importance,
      supportedByEntryIds: entry.state.supportedByEntryIds, supersedesEntryIds: entry.state.supersedesEntryIds,
      deleted: entry.deleted, bodyHash: hash(entry) };
  }

  getKnownEntityEvidence(scope, entityId, options = null) {
    assertScope(scope);
    if (!options?.readContext) this.loadIndex(scope);
    const known = options?.readContext?.known || this.read(path.join(this.directory(scope), "known-entities.json"), null);
    if (known && (known.campaignToken !== scope.campaignToken || known.ownerId !== scope.ownerId || !known.entities)) throw new Error("memory4_known_index_invalid");
    const entity = known?.entities?.[String(entityId)];
    if (!entity) return { status: "UNKNOWN", reason: "INSUFFICIENT_EVIDENCE", entityId, completeness: "partial" };
    if (options) {
      const current = normalizeGameDate(options.currentGameDate);
      const metadata = options.readContext?.metadata || this.read(path.join(this.directory(scope), "metadata.json"), null);
      const contributions = current ? Object.entries(entity.evidenceByConversation || {}).filter(([conversationId, evidence]) => {
        const date = normalizeGameDate(evidence.date);
        return date && date.serial <= current.serial && evidence.sourceRevision
          && evidence.sourceRevision === metadata?.knownEvidenceRevisions?.[hash([conversationId, scope.ownerId])];
      }).map(([, evidence]) => evidence) : [];
      if (!contributions.length) return { status: "UNKNOWN", reason: "INSUFFICIENT_EVIDENCE", entityId, completeness: "partial" };
      const directConversationCount = contributions.filter(evidence => evidence.types?.includes("direct_conversation")).length;
      const sharedSceneCount = contributions.filter(evidence => evidence.types?.includes("shared_scene")).length;
      const mentionCount = contributions.filter(evidence => evidence.types?.includes("mention")).length;
      const dates = contributions.map(evidence => normalizeGameDate(evidence.date)).sort((a, b) => a.serial - b.serial);
      return { ...entity, status: directConversationCount > 0 ? "DIRECT_INTERACTION" : sharedSceneCount > 0 ? "SHARED_SCENE" : "MENTION_ONLY",
        directConversationCount, sharedSceneCount, mentionCount, firstSeenDate: dates[0].canonical, lastSeenDate: dates.at(-1).canonical,
        completeness: evidenceCompleteness(contributions) };
    }
    return { ...entity, status: entity.directConversationCount > 0 ? "DIRECT_INTERACTION" : entity.sharedSceneCount > 0 ? "SHARED_SCENE" : "MENTION_ONLY",
      completeness: evidenceCompleteness(Object.values(entity.evidenceByConversation || {})) };
  }

  readKnownEntities(scope, readContext = null) {
    assertScope(scope);
    if (readContext && (readContext.scope?.campaignToken !== scope.campaignToken || readContext.scope?.ownerId !== scope.ownerId)) {
      throw new Error("memory4_profile_scope_mismatch");
    }
    if (!readContext) this.loadIndex(scope);
    const known = readContext && Object.hasOwn(readContext, "known")
      ? readContext.known : this.read(path.join(this.directory(scope), "known-entities.json"), null);
    if (known && (known.campaignToken !== scope.campaignToken || known.ownerId !== scope.ownerId
      || !known.entities || typeof known.entities !== "object" || Array.isArray(known.entities))) {
      throw new Error("memory4_known_index_invalid");
    }
    return known || { ...scope, revision: 0, entities: {} };
  }

  getDisclosedFacts(scope, entityId, { readContext = null } = {}) {
    assertScope(scope);
    const targetId = ids([entityId])[0];
    if (!targetId || targetId === scope.ownerId) throw new Error("memory4_profile_entity_invalid");
    const known = this.readKnownEntities(scope, readContext);
    const facts = known.entities[String(targetId)]?.disclosedFacts;
    if (facts && (typeof facts !== "object" || Array.isArray(facts))) throw new Error("memory4_disclosure_index_invalid");
    return Object.entries(facts || {}).map(([factId, fact]) => {
      const proofs = Object.entries(fact?.evidenceBySource || {});
      if (!fact || !DISCLOSURE_STATUSES.has(fact.status) || !["TITLE", "TRAIT"].includes(fact.factType)
        || typeof fact.factKey !== "string" || !fact.factKey || typeof fact.value !== "string" || !fact.value.trim()
        || fact.factId !== factId || fact.factId !== disclosureFactId(scope, targetId, fact.factType, fact.factKey)
        || ids(fact.knownBy).join() !== String(scope.ownerId)
        || !Number.isSafeInteger(fact.revision) || fact.revision < 1
        || !fact.evidenceBySource || typeof fact.evidenceBySource !== "object" || Array.isArray(fact.evidenceBySource)
        || fact.status === "AUTO_DISCLOSED" && !proofs.length
        || [fact.firstAcquiredDate, fact.lastConfirmedDate, fact.manualMarkedDate].some(date => date != null && !gameDate(date))
        || fact.status !== "AUTO_DISCLOSED" && !gameDate(fact.manualMarkedDate)
        || fact.status === "MANUAL_HIDDEN" && (fact.tombstone?.status !== "MANUAL_HIDDEN" || !gameDate(fact.tombstone.markedDate))) {
        throw new Error("memory4_disclosure_index_invalid");
      }
      for (const [sourceKey, proof] of proofs) {
        const conversation = proof?.sourceKind === "CONVERSATION";
        const letter = proof?.sourceKind === "LETTER";
        const sourceId = proof?.sourceId;
        if ((!conversation && !letter) || typeof sourceId !== "string" || !sourceId
          || sourceKey !== hash([proof.sourceKind, sourceId]) || !/^[a-f0-9]{64}$/.test(proof.sourceRevision || "")
          || !gameDate(proof.acquiredDate) || ids(proof.knownBy).join() !== String(scope.ownerId)
          || !Array.isArray(proof.sourceFragmentIds) || !proof.sourceFragmentIds.length
          || proof.sourceFragmentIds.some(id => typeof id !== "string" || !id)
          || !Array.isArray(proof.sourceTextHashes) || !proof.sourceTextHashes.length
          || proof.sourceTextHashes.some(value => !/^[a-f0-9]{64}$/.test(value))
          || !Array.isArray(proof.visibilityEvidence) || !proof.visibilityEvidence.length
          || conversation && (proof.sourceFinalizationId !== sourceId || typeof proof.sourceConversationId !== "string"
            || !proof.sourceConversationId || !Array.isArray(proof.sourceMessageIds) || !proof.sourceMessageIds.length
            || proof.sourceMessageIds.some(id => !Number.isSafeInteger(id) || id < 0)
            || proof.visibilityEvidence.some(value => !["application_fragment", "finalization_validated_segment"].includes(value)))
          || letter && (proof.sourceLetterId !== sourceId || proof.recipientId !== scope.ownerId
            || !Number.isSafeInteger(proof.senderId) || proof.senderId <= 0 || proof.senderId === scope.ownerId
            || !Array.isArray(proof.sourceMessageIds) || proof.sourceMessageIds.length !== 0
            || proof.visibilityEvidence.length !== 1 || proof.visibilityEvidence[0] !== "validated_letter")) {
          throw new Error("memory4_disclosure_proof_invalid");
        }
      }
      return JSON.parse(JSON.stringify(fact));
    });
  }

  getCurrentDisclosures(scope, entityId, gameData, { readContext = null, currentGameDate = null } = {}) {
    assertScope(scope);
    const records = this.getDisclosedFacts(scope, entityId, { readContext });
    if (gameData != null && (gameData.campaignToken !== scope.campaignToken || !normalizeGameDate(gameData.date))) {
      throw new Error("memory4_disclosure_current_scope_invalid");
    }
    const asOf = gameData == null ? normalizeGameDate(currentGameDate) : normalizeGameDate(gameData.date);
    if (!asOf) return [];
    const metadata = readContext ? readContext.metadata : this.read(path.join(this.directory(scope), "metadata.json"), null);
    if (gameData == null) return records.map(record => {
      const effective = effectiveDisclosure(record, asOf.canonical, scope.ownerId, metadata);
      return { ...scope, ...record, entityId, current: false, status: effective.status,
        effectiveKnown: effective.effectiveKnown, firstAcquiredDate: effective.firstAcquiredDate,
        lastConfirmedDate: effective.lastConfirmedDate, evidenceBySource: effective.evidenceBySource,
        tombstone: effective.tombstone || null };
    }).filter(record => record.status);
    const characters = gameData.characters instanceof Map ? gameData.characters
      : Array.isArray(gameData.characters) ? new Map(gameData.characters.map(character => [Number(character.id), character]))
        : gameData.characters && typeof gameData.characters === "object"
          ? new Map(Object.values(gameData.characters).map(character => [Number(character.id), character])) : new Map();
    const character = characters.get(entityId) || characters.get(String(entityId))
      || [...characters.values()].find(candidate => Number(candidate?.id) === entityId) || null;
    if (!character || Number(character.id) !== entityId) return [];
    const byId = new Map(records.map(record => [record.factId, record]));
    return getFactCandidates(character).map(candidate => {
      const factId = disclosureFactId(scope, entityId, candidate.factType, candidate.factKey);
      const record = byId.get(factId) || null;
      const effective = record ? effectiveDisclosure(record, gameData.date, scope.ownerId, metadata) : null;
      return { ...scope, entityId, ...candidate, factId, current: true, status: effective?.status || null,
        effectiveKnown: effective?.effectiveKnown || false, revision: record?.revision || 0,
        firstAcquiredDate: effective?.firstAcquiredDate || null, lastConfirmedDate: effective?.lastConfirmedDate || null,
        manualMarkedDate: effective?.status?.startsWith("MANUAL_") ? record.manualMarkedDate || null : null,
        evidenceBySource: effective?.evidenceBySource || {}, tombstone: effective?.tombstone || null };
    });
  }

  persistDisclosureState(scope, index, known, metadata) {
    index.revision++;
    known.revision = (Number.isSafeInteger(known.revision) ? known.revision : 0) + 1;
    const now = new Date().toISOString();
    const directory = this.directory(scope);
    this.store.withSummaryMutation(null, () => {
      this.store.writeJson(path.join(directory, "known-entities.json"), known);
      this.store.writeJson(path.join(directory, "metadata.json"), { ...metadata, memory4SchemaVersion: 1,
        campaignToken: scope.campaignToken, ownerId: scope.ownerId, revision: index.revision, indexHash: hash(index),
        disclosureRevision: (Number(metadata.disclosureRevision) || 0) + 1, updatedAt: now });
      this.store.writeJson(path.join(directory, "index.json"), index);
    });
    this.store.invalidateFolderSummaryCache([scope.ownerId]);
  }

  recordDisclosures(snapshot, disclosures) {
    assertScope(snapshot);
    const sourceKind = snapshot.sourceKind || "CONVERSATION";
    if (!["LETTER", "CONVERSATION"].includes(sourceKind)) throw new Error("memory4_disclosure_source_invalid");
    const sourceId = sourceKind === "LETTER" ? snapshot.letterId : snapshot.finalizationId;
    const sourceRevision = String(snapshot.sourceRevision || "");
    const acquiredDate = gameDate(snapshot.date);
    if (!sourceId || !/^[a-f0-9]{64}$/.test(sourceRevision) || !acquiredDate || !Array.isArray(disclosures)) throw new Error("memory4_disclosure_source_invalid");
    if (sourceKind === "CONVERSATION" && !snapshot.conversationId
      || sourceKind === "LETTER" && (Number(snapshot.ownerId) !== Number(snapshot.recipientId) || !snapshot.senderId || !snapshot.recipientId)) {
      throw new Error("memory4_disclosure_source_invalid");
    }
    const scope = { campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId };
    const index = this.loadIndex(scope);
    const directory = this.directory(scope);
    const metadata = this.read(path.join(directory, "metadata.json"), null) || { campaignToken: scope.campaignToken,
      ownerId: scope.ownerId, revision: index.revision, indexHash: hash(index), knownEvidenceRevisions: {} };
    if (sourceKind === "CONVERSATION"
      && metadata.knownEvidenceRevisions?.[hash([snapshot.conversationId, scope.ownerId])] !== sourceRevision) {
      return { changed: false, count: 0, entityIds: [], stale: true };
    }
    const previous = this.readKnownEntities(scope);
    const known = JSON.parse(JSON.stringify(previous));
    known.disclosureSchemaVersion = 1;
    const sourceKey = hash([sourceKind, sourceId]);
    const incomingFactIds = new Set(disclosures.map(disclosure => disclosure?.factId).filter(value => typeof value === "string"));
    let changed = false;
    const touched = new Set();
    for (const [entityKey, entity] of Object.entries(known.entities)) {
      const facts = entity.disclosedFacts || {};
      let entityChanged = false;
      for (const [factId, fact] of Object.entries(facts)) {
        const evidenceBySource = fact.evidenceBySource || {};
        let evidenceChanged = false;
        for (const [key, proof] of Object.entries(evidenceBySource)) {
          const staleConversation = sourceKind === "CONVERSATION" && proof?.sourceKind === "CONVERSATION"
            && proof.sourceConversationId === snapshot.conversationId
            && (proof.sourceFinalizationId !== snapshot.finalizationId || proof.sourceRevision !== sourceRevision);
          const staleSource = key === sourceKey && proof?.sourceRevision !== sourceRevision;
          if (staleConversation || staleSource) {
            delete evidenceBySource[key];
            evidenceChanged = true;
          }
        }
        if (!evidenceChanged) continue;
        fact.revision = (Number(fact.revision) || 0) + 1;
        if (fact.status === "AUTO_DISCLOSED" && !Object.keys(fact.evidenceBySource).length && !incomingFactIds.has(factId)) delete facts[factId];
        entity.revision = (Number(entity.revision) || 0) + 1;
        changed = true; entityChanged = true;
      }
      if (entity.disclosedFacts && !Object.keys(entity.disclosedFacts).length) delete entity.disclosedFacts;
      if (entityChanged && entityKey) touched.add(Number(entityKey));
    }
    const characterRows = snapshot.disclosureCharacters instanceof Map ? [...snapshot.disclosureCharacters.values()]
      : Array.isArray(snapshot.disclosureCharacters) ? snapshot.disclosureCharacters : [];
    const characterMap = new Map(characterRows.map(character => [Number(character.id), character]));
    for (const disclosure of disclosures) {
      const entityId = Number(disclosure?.entityId);
      if (!Number.isSafeInteger(entityId) || entityId <= 0 || entityId === scope.ownerId
        || !["TITLE", "TRAIT"].includes(disclosure.factType) || typeof disclosure.factKey !== "string"
        || typeof disclosure.value !== "string" || !disclosure.value.trim()
        || disclosure.factId !== disclosureFactId(scope, entityId, disclosure.factType, disclosure.factKey)) {
        throw new Error("memory4_disclosure_fact_invalid");
      }
      const current = getFactCandidates(characterMap.get(entityId)).find(candidate => candidate.factType === disclosure.factType
        && candidate.factKey === disclosure.factKey && candidate.value === disclosure.value);
      if (!current) throw new Error("memory4_disclosure_fact_not_current");
      const evidence = disclosure.evidence || {};
      const messageIds = Array.isArray(evidence.sourceMessageIds) ? evidence.sourceMessageIds : [];
      const fragmentIds = Array.isArray(evidence.sourceFragmentIds) ? evidence.sourceFragmentIds : [];
      const sourceTextHashes = Array.isArray(evidence.sourceTextHashes) ? evidence.sourceTextHashes : [];
      const visibilityEvidence = Array.isArray(evidence.visibilityEvidence) ? evidence.visibilityEvidence : [];
      if (sourceKind === "CONVERSATION" && (!messageIds.length || messageIds.some(id => !Number.isSafeInteger(id) || id < 0)
        || !fragmentIds.length || !visibilityEvidence.some(value => ["application_fragment", "finalization_validated_segment"].includes(value)))
        || sourceKind === "LETTER" && (!fragmentIds.length || visibilityEvidence.length !== 1 || visibilityEvidence[0] !== "validated_letter")) {
        throw new Error("memory4_disclosure_proof_invalid");
      }
      if (fragmentIds.some(id => typeof id !== "string" || !id) || sourceTextHashes.some(value => !/^[a-f0-9]{64}$/.test(value))) {
        throw new Error("memory4_disclosure_proof_invalid");
      }
      const sourceEvidence = { sourceKind, sourceId, sourceRevision,
        sourceConversationId: sourceKind === "CONVERSATION" ? snapshot.conversationId : null,
        sourceFinalizationId: sourceKind === "CONVERSATION" ? snapshot.finalizationId : null,
        sourceLetterId: sourceKind === "LETTER" ? snapshot.letterId : null,
        sourceMessageIds: [...new Set(messageIds)].sort((a, b) => a - b),
        sourceFragmentIds: [...new Set(fragmentIds)].sort(), knownBy: [scope.ownerId], acquiredDate,
        visibilityEvidence: [...new Set(visibilityEvidence)].sort(), sourceTextHashes: [...new Set(sourceTextHashes)].sort(),
        ...(sourceKind === "LETTER" ? { senderId: snapshot.senderId, recipientId: snapshot.recipientId } : {}) };
      const entityKey = String(entityId);
      const entity = known.entities[entityKey] || { entityId, evidenceTypes: [], directConversationCount: 0, sharedSceneCount: 0,
        mentionCount: 0, firstSeenDate: null, lastSeenDate: null, sourceEpisodeIds: [], sourceConversationIds: [],
        evidenceByConversation: {}, completeness: "partial", revision: 0 };
      const facts = entity.disclosedFacts || (entity.disclosedFacts = {});
      const previousFact = facts[disclosure.factId];
      const next = { ...(previousFact || {}), factId: disclosure.factId, factType: disclosure.factType,
        factKey: disclosure.factKey, value: disclosure.value,
        status: previousFact?.status === "MANUAL_KNOWN" || previousFact?.status === "MANUAL_HIDDEN" ? previousFact.status : "AUTO_DISCLOSED",
        firstAcquiredDate: previousFact?.firstAcquiredDate || acquiredDate,
        lastConfirmedDate: latestDate(previousFact?.lastConfirmedDate, acquiredDate), knownBy: [scope.ownerId],
        evidenceBySource: { ...(previousFact?.evidenceBySource || {}) }, tombstone: previousFact?.tombstone || null };
      const priorProof = next.evidenceBySource[sourceKey];
      const proofChanged = JSON.stringify(priorProof || null) !== JSON.stringify(sourceEvidence);
      const factChanged = !previousFact || previousFact.factType !== next.factType || previousFact.factKey !== next.factKey
        || previousFact.value !== next.value || previousFact.status !== next.status || proofChanged
        || previousFact.lastConfirmedDate !== next.lastConfirmedDate;
      if (!factChanged) continue;
      next.evidenceBySource[sourceKey] = sourceEvidence;
      next.revision = (Number(previousFact?.revision) || 0) + 1;
      if (next.status === "MANUAL_HIDDEN") next.tombstone = previousFact.tombstone || { status: "MANUAL_HIDDEN", markedDate: previousFact.manualMarkedDate || acquiredDate };
      else if (next.status !== "MANUAL_HIDDEN") next.tombstone = null;
      facts[disclosure.factId] = next;
      entity.revision = (Number(entity.revision) || 0) + 1;
      known.entities[entityKey] = entity;
      touched.add(entityId);
      changed = true;
    }
    if (changed) this.persistDisclosureState(scope, index, known, metadata);
    return { changed, count: disclosures.length, entityIds: [...touched].filter(Number.isSafeInteger).sort((a, b) => a - b) };
  }

  updateManualDisclosure(scope, entityId, fact, status, date, expectedRevision) {
    assertScope(scope);
    if (ids([entityId]).length !== 1 || entityId === scope.ownerId || !["MANUAL_KNOWN", "MANUAL_HIDDEN"].includes(status)
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !gameDate(date)) throw new Error("memory4_disclosure_manual_invalid");
    const candidate = getFactCandidates({ facts: [fact] })[0];
    if (!candidate || candidate.factType !== fact.factType || candidate.factKey !== fact.factKey || candidate.value !== fact.value) {
      throw new Error("memory4_disclosure_fact_invalid");
    }
    const factId = disclosureFactId(scope, entityId, candidate.factType, candidate.factKey);
    const index = this.loadIndex(scope);
    const directory = this.directory(scope);
    const metadata = this.read(path.join(directory, "metadata.json"), null) || { campaignToken: scope.campaignToken,
      ownerId: scope.ownerId, revision: index.revision, indexHash: hash(index), knownEvidenceRevisions: {} };
    const known = this.readKnownEntities(scope);
    const entityKey = String(entityId);
    const entity = known.entities[entityKey] || { entityId, evidenceTypes: [], directConversationCount: 0, sharedSceneCount: 0,
      mentionCount: 0, firstSeenDate: null, lastSeenDate: null, sourceEpisodeIds: [], sourceConversationIds: [],
      evidenceByConversation: {}, completeness: "partial", revision: 0 };
    const facts = entity.disclosedFacts || (entity.disclosedFacts = {});
    const previous = facts[factId];
    if ((Number(previous?.revision) || 0) !== expectedRevision) throw new Error("memory4_disclosure_revision_stale");
    const nextRevision = expectedRevision + 1;
    const next = { ...(previous || {}), factId, factType: candidate.factType, factKey: candidate.factKey, value: candidate.value,
      status, revision: nextRevision, firstAcquiredDate: previous?.firstAcquiredDate || (status === "MANUAL_KNOWN" ? gameDate(date) : null),
      lastConfirmedDate: previous?.lastConfirmedDate || null, manualMarkedDate: gameDate(date), knownBy: [scope.ownerId],
      evidenceBySource: { ...(previous?.evidenceBySource || {}) }, tombstone: status === "MANUAL_HIDDEN"
        ? { status, markedDate: gameDate(date), revision: nextRevision } : null };
    facts[factId] = next;
    entity.revision = (Number(entity.revision) || 0) + 1;
    known.entities[entityKey] = entity;
    this.persistDisclosureState(scope, index, known, metadata);
    return { ...next, effectiveKnown: status === "MANUAL_KNOWN", current: true };
  }

  query(scope, filters = {}) {
    const index = this.loadIndex(scope);
    let selected = new Set(index.byOwner[String(scope.ownerId)] || []);
    for (const [axis, value] of Object.entries(filters)) {
      if (!INDEX_KEYS.includes(axis)) throw new Error("memory4_invalid_index_axis");
      const allowed = new Set(Object.hasOwn(index[axis], String(value)) ? index[axis][String(value)] : []);
      if (axis === "byEventDate") {
        const target = normalizeGameDate(value);
        if (!target) throw new Error("memory4_invalid_event_date");
        for (const [id, row] of Object.entries(index.entries)) {
          if (!row.deleted && row.eventTime.precision === "range"
            && normalizeGameDate(row.eventTime.from)?.serial <= target.serial
            && normalizeGameDate(row.eventTime.to)?.serial >= target.serial) allowed.add(id);
        }
      }
      selected = new Set([...selected].filter(id => allowed.has(id)));
    }
    const directory = this.directory(scope);
    return [...selected].map(id => {
      if (!/^m4_[a-f0-9]{64}$/.test(id)) throw new Error("memory4_invalid_entry_id");
      const entry = this.read(this.entryPath(directory, id), null);
      if (!entry || entry.entryId !== id || entry.ownerId !== scope.ownerId || entry.campaignToken !== scope.campaignToken
        || entry.deleted || hash(entry) !== index.entries[id]?.bodyHash) throw new Error("memory4_index_body_mismatch");
      return entry;
    });
  }

  readEntry(scope, id, index = this.loadIndex(scope)) {
    const row = index.entries[id];
    const entry = this.read(this.entryPath(this.directory(scope), id), null);
    if (!row || !entry || entry.entryId !== id || entry.ownerId !== scope.ownerId || entry.campaignToken !== scope.campaignToken
      || entry.revision !== row.revision || entry.deleted !== row.deleted || hash(entry) !== row.bodyHash) throw new Error("memory4_index_body_mismatch");
    return entry;
  }

  updateEntry(scope, entryId, text, { expectedRevision } = {}) {
    if (typeof text !== "string" || !text.trim() || text.length > 65536) throw new Error("memory4_entry_text_invalid");
    const index = this.loadIndex(scope), entry = this.readEntry(scope, entryId, index);
    if (entry.deleted || !Number.isInteger(expectedRevision) || entry.revision !== expectedRevision) throw new Error("memory4_entry_edit_stale");
    const directory = this.directory(scope), metadata = this.read(path.join(directory, "metadata.json"), null);
    entry.text = text.trim(); entry.revision++; entry.updatedAt = new Date().toISOString();
    entry.edit = { mode: "manual_override", editedAt: entry.updatedAt, editedBy: "user" };
    index.entries[entryId] = this.indexRow(entry); index.revision++; this.reindex(index);
    this.store.withSummaryMutation(null, () => {
      this.store.writeJson(this.entryPath(directory, entryId), entry);
      const derived = this.derived?.markDirty(scope, { index, metadata, entryIds: [entryId] }) || {};
      this.store.writeJson(path.join(directory, "metadata.json"), { ...metadata, revision: index.revision, indexHash: hash(index), derivedDirty: true, ...derived });
      this.store.writeJson(path.join(directory, "index.json"), index);
    });
    this.store.invalidateFolderSummaryCache([scope.ownerId]);
    return { success: true, entryId, revision: entry.revision };
  }

  deleteEntry(scope, entryId, { expectedRevision } = {}) {
    if (!/^m4_[a-f0-9]{64}$/.test(entryId)) throw new Error("memory4_invalid_entry_id");
    const index = this.loadIndex(scope);
    if (!index.entries[entryId] || index.entries[entryId].deleted) return false;
    const directory = this.directory(scope);
    const file = this.entryPath(directory, entryId);
    const entry = this.read(file, null);
    if (!entry || entry.ownerId !== scope.ownerId || entry.campaignToken !== scope.campaignToken || hash(entry) !== index.entries[entryId].bodyHash) throw new Error("memory4_index_body_mismatch");
    if (expectedRevision != null && entry.revision !== expectedRevision) throw new Error("memory4_entry_edit_stale");
    entry.deleted = true; entry.revision++; entry.updatedAt = new Date().toISOString();
    index.entries[entryId] = this.indexRow(entry);
    index.revision++;
    this.reindex(index);
    const metadata = this.read(path.join(directory, "metadata.json"), null);
    if (!metadata) throw new Error("memory4_metadata_missing");
    this.store.withSummaryMutation(null, () => {
      this.store.writeJson(file, entry);
      const derived = this.derived?.markDirty(scope, { index, metadata, entryIds: [entryId] }) || {};
      this.store.writeJson(path.join(directory, "metadata.json"), { ...metadata, revision: index.revision, indexHash: hash(index), derivedDirty: true, ...derived });
      this.store.writeJson(path.join(directory, "index.json"), index);
    });
    this.store.invalidateFolderSummaryCache([scope.ownerId]);
    return true;
  }
}

module.exports = { Memory4Store, INDEX_KEYS };
