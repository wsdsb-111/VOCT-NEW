"use strict";

const path = require("path");
const fs = require("fs");
const { assertScope, ids, hash, legacySourceHash, sourceRevisionCurrent } = require("./memory4-contract");
const { resolveTemporalFocus, detectTemporalAxisIntent } = require("./fuzzy-temporal-resolver");
const { gameDateFromSerial, hasFirstMeetingCue } = require("./temporal-anchor-extractor");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { buildLegacyBridge } = require("./memory4-legacy-bridge");
const { MemoryRanker } = require("./memory-ranker");
const { normalizePerspectiveTemporalRefs, isFirstMeetingSummary } = require("./summary-date-index");
const { removeEntityNames } = require("./turn-recall");
const projectionHash = memory => hash([memory.memoryId, memory.content, memory.eventDate, memory.knownBy, memory.provenance]);

const AXES = new Set(["EVENT", "CONVERSATION", "MIXED", "MEMORY_RECALL"]);
const GRANULARITIES = new Set(["LIFE", "PERIOD", "YEAR", "EVENT", "EXACT_DATE", "FOLLOW_UP"]);
const estimateDefault = text => Math.ceil(text.length / 2);
const serial = value => normalizeGameDate(value)?.serial;
const entitySet = memory => ids([...(memory.subjects || []), ...(memory.provenance?.counterpartIds || []), memory.provenance?.counterpartId]);

function parseRecallQuery(text, options = {}) {
  const query = String(text || "");
  const temporal = resolveTemporalFocus(query, null, options);
  const current = normalizeGameDate(options.currentGameDate);
  const today = Number(options.currentTotalDays) > 0 ? Number(options.currentTotalDays) : current?.serial;
  const toDate = days => current && Number.isFinite(days) ? gameDateFromSerial(current.serial + days - today)?.canonical : null;
  let window = temporal.triggered && temporal.mode !== "EARLIEST_AVAILABLE"
    ? { from: toDate(temporal.primaryWindow.fromTotalDays), to: toDate(temporal.primaryWindow.toTotalDays) } : null;
  const period = query.match(/(\d+)\s*年?\s*(?:至|到|[-–—])\s*(\d+)\s*年/)
    || query.match(/(?<![\d./])(\d{3,4})\s*(?:至|到|[-–—])\s*(\d{3,4})(?![\d./])/);
  let blockedReason = temporal.requested && !temporal.triggered ? temporal.reason : null;
  if (period) {
    window = { from: normalizeGameDate(`${period[1]}.1.1`)?.canonical, to: normalizeGameDate(`${period[2]}.12.31`)?.canonical };
    blockedReason = !current || !window.from || !window.to || serial(window.from) > serial(window.to)
      || Number(period[2]) > current.year ? "INVALID_PERIOD" : null;
    if (!blockedReason && serial(window.to) > current.serial) window.to = current.canonical;
  }
  const followUp = /^(?:那年|那一年|当时|那时|后来|之后|随后)(?:呢|如何|怎么样|发生了什么)?[？?。\s]*$/.test(query.trim());
  const exactDate = /\d+年\d+月\d+[日号]|\d+[./-]\d+[./-]\d+/.test(query.replace(/\s+/g, ""));
  const granularity = followUp ? "FOLLOW_UP" : exactDate ? "EXACT_DATE" : period ? "PERIOD"
    : window && (temporal.targetGameYear || ["EXPLICIT_YEAR", "PREVIOUS_YEAR"].includes(temporal.normalizedConcept)
      || serial(window.to) - serial(window.from) >= 364 && !/最近|过去|很久|这些|早年/.test(query)) ? "YEAR"
      : window ? "PERIOD" : /一生|生平|总体|一路|这些经历|还记得.{1,30}(?:吗|么)[？?]?$/.test(query) ? "LIFE" : "EVENT";
  return { axis: detectTemporalAxisIntent(query), granularity, entityIds: followUp && options.entityIdsExplicit === false ? [] : ids(options.entityIds),
    querySpeakerId: options.querySpeakerId, window, blockedReason: followUp ? null : blockedReason,
    firstMeeting: hasFirstMeetingCue(query), temporalRequested: temporal.requested, expression: period?.[0] || temporal.expression,
    topics: options.topics || [], text: query };
}

function temporalMatch(row, query, options) {
  const current = serial(options.currentGameDate);
  const dates = [];
  if (query.axis !== "EVENT" && row.conversationDate && serial(row.conversationDate) <= current) {
    dates.push({ axis: "conversation", from: row.conversationDate, to: row.conversationDate, precision: "day" });
  }
  if (query.axis !== "CONVERSATION" && row.eventTime?.status !== "unknown" && row.eventTime?.from
    && serial(row.eventTime.to) <= current && row.eventTime.status !== "planned") dates.push({ axis: "event", ...row.eventTime });
  const matches = dates.filter(date => !query.window || serial(date.from) <= serial(query.window.to) && serial(date.to) >= serial(query.window.from))
    .filter(date => query.granularity !== "EXACT_DATE" || ["day", "range"].includes(date.precision));
  if (!query.window && !query.firstMeeting) {
    // Undated commitments remain usable as undated reports, never as dated events.
    return matches[0] || { axis: "unknown", from: null, to: null, precision: "unknown" };
  }
  if (query.firstMeeting) return matches.find(date => date.axis === "conversation") || null;
  if (query.axis === "MEMORY_RECALL" && row.counterpartIds?.includes(query.querySpeakerId)) {
    return matches.find(date => date.axis === "conversation") || matches[0] || null;
  }
  return matches[0] || null;
}

function renderPacket(packet) {
  const items = [packet.overview, ...packet.details].filter(Boolean);
  if (!items.length && !packet.profileText && !packet.notice) return null;
  return ["【本轮个人记忆核对】历史记忆不是当前游戏状态；转述、传闻与计划不得当成已发生的事实。",
    packet.notice, packet.profileText, ...items.map(item => {
      const reason = item.reason;
      return `【${item === packet.overview ? "概览" : "细节"}；来源 ${item.memory.memoryId}；${reason.axis} ${reason.from || "时间未知"}${reason.to && reason.to !== reason.from ? `~${reason.to}` : ""}；${reason.precision}】\n${item.annotation}\n${item.memory.content}`;
    })].filter(Boolean).join("\n\n");
}

function fitRecallPacket(packet, budget, estimateTokens = estimateDefault) {
  const limit = Math.max(0, Math.min(1200, Number(budget) || 0));
  const result = { ...packet, details: [...packet.details] };
  const count = () => { result.text = renderPacket(result); result.tokens = result.text ? Math.ceil(estimateTokens(result.text)) : 0; };
  count();
  if (result.tokens > limit && result.overview && packet.query?.granularity === "EVENT") { result.overview = null; count(); }
  while (result.tokens > limit && result.details.length) { result.details.pop(); count(); }
  if (result.tokens > limit && result.overview) { result.overview = null; count(); }
  if (result.tokens > limit && result.profileText) { result.profileText = null; count(); }
  if (result.tokens > limit) { result.notice = null; count(); }
  result.items = [result.overview, ...result.details].filter(Boolean);
  result.sourceRefs = result.items.map(item => item.sourceRef);
  result.focus = result.items.length ? { ...packet.focus,
    entryIds: result.items.filter(item => item.sourceRef.kind === "detail").map(item => item.memory.memoryId),
    chainIds: [...new Set(result.items.map(item => item.chainId).filter(Boolean))],
    topics: [...new Set(result.items.flatMap(item => item.memory.tags || []))] } : null;
  if (result.focus) result.focus.sourceRefs = result.sourceRefs;
  return result;
}

class Memory4RecallPlanner {
  constructor(coordinator) {
    this.coordinator = coordinator;
    this.store = coordinator.store;
    this.baseStore = coordinator.baseStore;
    this.ranker = new MemoryRanker();
  }

  validLegacyRef(scope, ref) {
    const memory = this.baseStore.getMemory(ref.memoryId);
    return memory && !memory.deleted && memory.provenance?.campaignToken === scope.campaignToken
      && memory.provenance?.folderOwnerId === scope.ownerId && ids(memory.knownBy).includes(scope.ownerId)
      && ref.sourceHash === legacySourceHash(memory);
  }

  currentSource(scope, entry, index, metadata) {
    if (!sourceRevisionCurrent(entry.source, scope, index, metadata)
      || entry.state.source && !sourceRevisionCurrent(entry.state.source, scope, index, metadata)) return false;
    const refs = entry.source.legacyRefs || [];
    if (entry.source.legacyMemoryIds?.length && refs.length !== entry.source.legacyMemoryIds.length) return false;
    return refs.every(ref => this.validLegacyRef(scope, ref));
  }

  // Only a provably complete, independent legacy fact can be suppressed. An
  // unsplittable narrative stays intact, even when it shares a source ID.
  legacyCandidates(memories, scope, index) {
    const suppress = new Map();
    const trackedSources = new Set();
    const requestedSources = new Set(memories.flatMap(memory => memory.provenance?.perspectiveMemoryIds || []));
    for (const row of Object.values(index.entries)) for (const ref of row.legacyRefs || []) {
      if (!requestedSources.has(ref.memoryId)) continue;
      trackedSources.add(ref.memoryId);
      if (ref.complete && this.validLegacyRef(scope, ref)) suppress.set(ref.memoryId, ref.sourceHash);
    }
    return memories.flatMap(memory => {
      const sourceIds = memory.provenance?.perspectiveMemoryIds || [];
      if (!sourceIds.length) return [memory];
      const sources = sourceIds.map(id => this.baseStore.getMemory(id));
      if (sources.some(source => !source || source.provenance?.campaignToken !== scope.campaignToken
        || source.provenance?.folderOwnerId !== scope.ownerId || !ids(source.knownBy).includes(scope.ownerId))) {
        return sourceIds.some(id => trackedSources.has(id)) ? [] : [memory];
      }
      const header = memory.content.match(/^【[^\n]*能够知道并记住的本场内容】\n/);
      const staleTracked = sourceIds.some(id => trackedSources.has(id) && !suppress.has(id));
      if (staleTracked && (!header || memory.content !== header[0] + sources.map(source => `- ${source.content}`).join("\n"))) return [];
      if (!header || memory.content !== header[0] + sources.map(source => `- ${source.content}`).join("\n")) return [memory];
      return sources.flatMap(source => suppress.get(source.memoryId) === legacySourceHash(source) ? [] : [{ ...memory,
        memoryId: `${memory.memoryId}#${source.memoryId}`, content: source.content,
        provenance: { ...memory.provenance, legacyParentId: memory.memoryId, legacyParentHash: projectionHash(memory),
          perspectiveMemoryIds: [source.memoryId], temporalRefs: (memory.provenance.temporalRefs || [])
            .filter(ref => ref.sourceMemoryIds?.includes(source.memoryId)) } }]);
    });
  }

  validateHistory(scope, refs, { currentGameDate = null } = {}) {
    assertScope(scope);
    const index = this.store.loadIndex(scope);
    const metadata = this.store.read(path.join(this.store.directory(scope), "metadata.json"), null);
    const legacy = this.baseStore.loadFolderSummariesForCharacter(scope.ownerId);
    const availableLegacy = this.legacyCandidates(buildLegacyBridge(legacy, scope).memories, scope, index);
    return (refs || []).every(ref => {
      if (["year", "life", "conversation_year"].includes(ref.kind)) return this.coordinator.derived?.validateRef(scope, ref, { currentGameDate }) === true;
      if (ref.kind === "detail") {
        const row = index.entries[ref.id];
        if (!row || row.deleted || row.bodyHash !== ref.bodyHash) return false;
        const entry = this.store.readEntry(scope, ref.id, index);
        if (currentGameDate && [entry.conversationDate, entry.acquiredDate, entry.state.changedGameDate].some(date => serial(date) > serial(currentGameDate))) return false;
        return this.currentSource(scope, entry, index, metadata) && ids(entry.evidence.knownBy).includes(scope.ownerId);
      }
      return availableLegacy.some(memory => (memory.provenance?.legacyParentId || memory.memoryId) === ref.parentId
        && (!ref.id || memory.memoryId === ref.id) && (memory.provenance?.legacyParentHash || projectionHash(memory)) === ref.bodyHash
        && (!currentGameDate || !memory.eventDate || serial(memory.eventDate) <= serial(currentGameDate))
        && memory.provenance?.campaignToken === scope.campaignToken && memory.provenance?.folderOwnerId === scope.ownerId
        && ids(memory.knownBy).includes(scope.ownerId));
    });
  }

  plan(options) {
    const started = Date.now();
    assertScope(options);
    const scope = { campaignToken: options.campaignToken, ownerId: options.ownerId };
    const root = this.baseStore.summaryFoldersDir;
    const ownerFolders = root && fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith(`${scope.ownerId}_`)) : [];
    if (root && !ownerFolders.length) return fitRecallPacket({ overview: null, details: [], profileText: null,
      notice: null, focus: null, diagnostics: { ownerId: scope.ownerId, reason: "OWNER_FOLDER_MISSING", bodyReads: 0 } }, 0);
    const index = this.store.loadIndex(scope);
    const metadata = this.store.read(path.join(this.store.directory(scope), "metadata.json"), null);
    const parsed = options.queryModel || parseRecallQuery(options.query, options);
    const query = { ...parsed, entityIds: [...parsed.entityIds], topics: [...(parsed.topics || [])] };
    if (!AXES.has(query.axis) || !GRANULARITIES.has(query.granularity) || ids(query.entityIds).length !== query.entityIds.length) throw new Error("memory4_recall_query_invalid");
    const focus = options.focus;
    const seen = new Set(options.excludedKeys || []);
    const diagnostics = { ownerId: scope.ownerId, indexRevision: index.revision, axis: query.axis, granularity: query.granularity,
      queryHash: hash(options.query || ""), candidateCount: 0, bodyReads: 0, rejected: {}, elapsedMs: 0 };
    const reject = name => { diagnostics.rejected[name] = (diagnostics.rejected[name] || 0) + 1; };
    const focusValid = query.granularity === "FOLLOW_UP" && focus && focus.campaignToken === scope.campaignToken && focus.ownerId === scope.ownerId
      && focus.conversationId === options.conversationId && focus.sceneRevision === options.sceneRevision
      && options.turnEpoch >= focus.turnEpoch && options.turnEpoch - focus.turnEpoch <= 3
      && (!query.entityIds.length || query.entityIds.every(id => focus.entityIds.includes(id)))
      && this.validateHistory(scope, focus.sourceRefs, options);
    if (query.granularity === "FOLLOW_UP" && focusValid) {
      query.entityIds = [...focus.entityIds]; query.topics = [...focus.topics]; query.axis = focus.axis;
    }
    const blocked = query.blockedReason || (!normalizeGameDate(options.currentGameDate) ? "GAME_DATE_UNAVAILABLE" : null)
      || (query.granularity === "FOLLOW_UP" && !focusValid ? "FOCUS_UNAVAILABLE" : null)
      || (options.temporalRecallEnabled === false && query.temporalRequested ? "TEMPORAL_RECALL_DISABLED" : null)
      || (options.identityUnresolved ? "IDENTITY_UNRESOLVED" : null);
    const relevantEntities = query.entityIds;
    const queryText = query.text || options.query || "";
    const commitmentQuery = /承诺|答应|约定|promise|commitment|pledge/i.test(queryText);
    const activeCommitmentQuery = commitmentQuery && /仍然|尚未|还未|还没|未完成|未履行|还欠|尚欠|有效|待履行|pending|outstanding|unfulfilled|still|active/i.test(queryText);
    const genericCommitmentQuery = commitmentQuery && !queryText.replace(/还有|哪些|以前|曾经|过去|当时|尚未|还未|还没|未完成|未履行|承诺|答应|约定|履行|仍然|有效|待履行|还欠|尚欠|过|什么|的|了|吗|呢|你|我|我们|[？?，。\s]|what|which|are|were|your|our|my|promises?|commitments?|pledges?|pending|outstanding|unfulfilled|still|active|before|previously|have|you|i|made/gi, "");
    diagnostics.blockedReason = blocked;
    const requested = query.temporalRequested || query.firstMeeting || query.granularity === "FOLLOW_UP"
      || /记得|记忆|回忆|答应|承诺|约定|后来|经历|往事|当时|还欠|remember|recall|promise/i.test(query.text || options.query || "")
      || relevantEntities.some(id => id !== query.querySpeakerId);
    const queryTopics = [...new Set([...query.topics, ...Object.keys(index.byTopic || {}).filter(topic => topic.length >= 2
      && (query.text || options.query || "").includes(topic))])];
    const matchesTopic = row => (row.topics || []).some(topic => queryTopics.includes(topic));
    const searchText = removeEntityNames(query.text || options.query, options.entityNames || [])
      .replace(query.expression || "\u0000", "")
      .replace(/\d+[./-]\d+[./-]\d+|\d+年(?:\d+月(?:\d+[日号])?)?/g, "")
      .replace(/你还记得|还记得|记得|记忆|回忆|我们|你我|他们|她们|你|我|他|她|一生|生平|总体|一路|这些|当时|当年|那年|事情|事件|发生|故事|情形|经历|往事|历史|聊过|谈过|说过|聊|什么|如何|怎么样|后来|之后|随后|[的了吗呢？?，。\s]/g, "");
    const rows = blocked ? [] : Object.entries(index.entries).flatMap(([id, row]) => {
      // Scope is authenticated by loadIndex; body ACL is verified again below.
      if (relevantEntities.length && !relevantEntities.some(entity => row.entityIds.includes(entity))) { reject("identity"); return []; }
      if (row.knownBy && (!row.knownBy.includes(scope.ownerId) || !["private", "participants", "known_group"].includes(row.visibility))) { reject("visibility"); return []; }
      if (row.deleted) { reject("deleted"); return []; }
      if (commitmentQuery && row.memoryType !== "COMMITMENT" || activeCommitmentQuery && row.status !== "active") { reject("state"); return []; }
      const record = index.finalizations[hash(row.finalizationId)];
      const revision = row.conversationId && metadata?.knownEvidenceRevisions?.[hash([row.conversationId, scope.ownerId])];
      if (!record || revision && revision !== record.sourceRevision
        || row.stateSource && !sourceRevisionCurrent(row.stateSource, scope, index, metadata)
        || (row.legacyRefs || []).some(ref => !this.baseStore.index.memories[ref.memoryId])) { reject("revision"); return []; }
      if ([row.conversationDate, row.acquiredDate, row.stateChangedGameDate].some(date => serial(date) > serial(options.currentGameDate))) { reject("future_knowledge"); return []; }
      const matched = temporalMatch(row, query, options);
      if (!matched) { reject("temporal"); return []; }
      if (query.firstMeeting && !row.counterpartIds.includes(query.querySpeakerId)) return [];
      if (query.granularity === "FOLLOW_UP" && (!row.topics.some(topic => focus.topics.includes(topic))
        || !(focus.chainIds.includes(row.finalizationId) || (row.supportedByEntryIds || []).some(key => focus.entryIds.includes(key))
          || (row.supersedesEntryIds || []).some(key => focus.entryIds.includes(key))))) { reject("chain"); return []; }
      if (/仍然|尚未|还未|有效|未完成|still|active/i.test(query.text || options.query || "") && row.status !== "active") { reject("state"); return []; }
      if (queryTopics.length && !matchesTopic(row)) return [];
      if (!requested && !matchesTopic(row)) return [];
      const entityScore = relevantEntities.filter(entity => row.entityIds.includes(entity)).length;
      const direct = query.axis === "MEMORY_RECALL" && matched.axis === "conversation" && row.counterpartIds.includes(query.querySpeakerId);
      return [{ id, row, matched, score: (direct ? 100 : 0) + (matchesTopic(row) ? 20 : 0) + entityScore * 5 + (row.importance || 0) }];
    });
    diagnostics.candidateCount = rows.length;
    rows.sort((a, b) => query.firstMeeting ? serial(a.row.conversationDate) - serial(b.row.conversationDate) || a.id.localeCompare(b.id)
      : b.score - a.score || (serial(b.row.conversationDate) || 0) - (serial(a.row.conversationDate) || 0) || a.id.localeCompare(b.id));
    diagnostics.shortlistLimited = rows.length > 32;
    let details = [];
    const verifiedEntries = new Map();
    const readCandidate = id => {
      if (!verifiedEntries.has(id)) {
        diagnostics.bodyReads++;
        verifiedEntries.set(id, this.store.readEntry(scope, id, index));
      }
      return verifiedEntries.get(id);
    };
    let firstMeetingDate = Infinity;
    for (const candidate of rows.slice(0, 32)) {
      const entry = readCandidate(candidate.id);
      if (!ids(entry.evidence?.knownBy).includes(scope.ownerId) || !["private", "participants", "known_group"].includes(entry.evidence?.visibility)) { reject("visibility"); continue; }
      if (!this.currentSource(scope, entry, index, metadata)) { reject("revision"); continue; }
      if (!genericCommitmentQuery && !query.firstMeeting && query.granularity !== "FOLLOW_UP" && !queryTopics.length && searchText
        && this.ranker.rank([{ content: entry.text, tags: entry.topics }], { query: searchText })[0].reason.query < 0.28) continue;
      if (query.firstMeeting && !isFirstMeetingSummary({ content: entry.text })) continue;
      if (query.firstMeeting) firstMeetingDate = serial(entry.conversationDate);
      const key = `memory4:${scope.campaignToken}:${scope.ownerId}:${entry.entryId}`;
      if (seen.has(key)) { reject("seen"); if (query.firstMeeting) break; continue; }
      details.push({ memory: { memoryId: entry.entryId, memory4Key: key, content: entry.text, tags: entry.topics,
        type: "memory4_detail", eventDate: entry.conversationDate, importance: entry.importance },
      score: candidate.score, reason: candidate.matched, chainId: entry.source.finalizationId,
      annotation: `对话日期 ${entry.conversationDate || "未知"}；获知日期 ${entry.acquiredDate || "未知"}；事件 ${entry.eventTime.status}；证据 ${entry.evidence.sourceType}/${entry.evidence.epistemicStatus}；状态 ${entry.state.status}。`,
      traitKnowledgeEvidence: { campaignToken: entry.campaignToken, ownerId: entry.ownerId, entityIds: entry.entityIds,
        acquiredDate: entry.acquiredDate, conversationDate: entry.conversationDate, text: entry.text, evidence: entry.evidence, source: entry.source },
      sourceRef: { kind: "detail", id: entry.entryId, bodyHash: candidate.row.bodyHash } });
      if (details.length >= (query.granularity === "LIFE" || query.firstMeeting ? 1 : 2)) break;
    }
    const bridge = buildLegacyBridge(options.legacyMemories || [], { ...scope, currentGameDate: options.currentGameDate, currentTotalDays: options.currentTotalDays });
    const legacy = blocked || activeCommitmentQuery ? [] : this.legacyCandidates(bridge.memories.filter(memory => !relevantEntities.length
      || relevantEntities.some(entity => entitySet(memory).includes(entity))), scope, index);
    const legacyRanked = this.ranker.rank(legacy, { query: query.text || options.query, entityIds: relevantEntities });
    let overview = blocked ? null : this.coordinator.derived?.selectSlice(scope, { query, index,
      eligibleEntryIds: rows.slice(0, Math.max(0, 32 - diagnostics.bodyReads)).map(candidate => candidate.id), currentGameDate: options.currentGameDate,
      maxTokens: Math.min(400, options.memoryEngineRemainingBudget || 0), estimateTokens: options.estimateTokens, excludedKeys: [...seen],
      verifiedEntries, maxBodyReads: 32 - diagnostics.bodyReads, onReadEntry: () => diagnostics.bodyReads++ }) || null;
    if (overview) {
      for (const id of overview.sourceRef.sourceEntryIds) {
        const entry = readCandidate(id);
        if (!this.currentSource(scope, entry, index, metadata) || !ids(entry.evidence.knownBy).includes(scope.ownerId)
          || !genericCommitmentQuery && !queryTopics.length && searchText && this.ranker.rank([{ content: entry.text, tags: entry.topics }], { query: searchText })[0].reason.query < 0.28) {
          reject("revision"); overview = null; break;
        }
      }
    }
    if (!overview && !blocked && query.axis === "CONVERSATION" && query.granularity === "YEAR" && rows.length > 2) {
      const items = [], texts = [];
      for (const candidate of rows.slice(0, Math.max(0, 32 - diagnostics.bodyReads))) {
        const entry = readCandidate(candidate.id);
        if (!this.currentSource(scope, entry, index, metadata) || !ids(entry.evidence.knownBy).includes(scope.ownerId)
          || !genericCommitmentQuery && !queryTopics.length && searchText && this.ranker.rank([{ content: entry.text, tags: entry.topics }], { query: searchText })[0].reason.query < 0.28) continue;
        const text = `${entry.conversationDate}（${entry.evidence.sourceType}/${entry.evidence.epistemicStatus}；${entry.state.status}）：${entry.text}`;
        if ((options.estimateTokens || estimateDefault)([...texts, text].join("\n")) > 400) continue;
        texts.push(text); items.push(entry.entryId);
      }
      const key = `memory4:${scope.campaignToken}:${scope.ownerId}:conversation_year:${hash([items, query.window])}`;
      if (items.length && !seen.has(key)) overview = { memory: { memoryId: key, memory4Key: key, content: texts.join("\n"), type: "memory4_conversation_year", tags: queryTopics },
        reason: { axis: "conversation", ...query.window, precision: "year" }, annotation: "交谈年份即时概览；不属于磁盘事件年度记忆。",
        sourceRef: { kind: "conversation_year", id: key, sourceEntryIds: items, sourceRowsHash: hash(items.map(id => index.entries[id])) } };
    }
    for (const candidate of legacyRanked) {
      const memory = candidate.memory;
      if (commitmentQuery && !/承诺|答应|约定|promise|commitment|pledge/i.test(memory.content)) continue;
      if (serial(memory.eventDate) > serial(options.currentGameDate)) continue;
      const key = memory.memoryId;
      if (seen.has(key) && !query.firstMeeting) continue;
      const eventRefs = normalizePerspectiveTemporalRefs(memory.provenance?.temporalRefs, memory.provenance?.perspectiveMemoryIds);
      const pseudo = { conversationDate: memory.eventDate, counterpartIds: ids([memory.provenance?.counterpartId, ...(memory.provenance?.counterpartIds || [])]) };
      let matched = null;
      for (const ref of eventRefs.filter(ref => ref.timeRole === "event" && (ref.segmentIds?.length || ref.sourceMemoryIds?.some(id => memory.provenance.perspectiveMemoryIds?.includes(id))))) {
        matched = temporalMatch({ ...pseudo, eventTime: { from: ref.fromGameDate, to: ref.toGameDate, precision: ref.precision, status: "reported" } }, query, options);
        if (matched) break;
      }
      if (!matched && (query.axis !== "EVENT" || !query.window && !query.firstMeeting)) matched = temporalMatch(pseudo, query, options);
      if (!matched || query.granularity === "FOLLOW_UP" || !requested && candidate.reason.query < 0.28) continue;
      if (queryTopics.length && !queryTopics.some(topic => memory.content.includes(topic))) continue;
      if (!genericCommitmentQuery && !query.firstMeeting && !queryTopics.length && searchText
        && this.ranker.rank([memory], { query: searchText })[0].reason.query < 0.28) continue;
      if (query.firstMeeting && (!pseudo.counterpartIds.includes(query.querySpeakerId) || !isFirstMeetingSummary(memory))) continue;
      const item = { memory: { ...memory, memory4Key: key }, reason: matched, score: candidate.score,
        annotation: `旧个人投影；可见性证据不完整；对话日期 ${memory.eventDate || "未知"}；时间引用不单独证明事件属实。`,
        chainId: memory.provenance?.finalizationId,
        sourceRef: { kind: "legacy", id: memory.memoryId, parentId: memory.provenance?.legacyParentId || memory.memoryId,
          bodyHash: memory.provenance?.legacyParentHash || projectionHash(memory) } };
      if (query.firstMeeting) {
        if (serial(memory.eventDate) < firstMeetingDate) {
          firstMeetingDate = serial(memory.eventDate); details = seen.has(key) ? [] : [item];
        }
        continue;
      }
      const canBeDetail = memory.provenance?.legacyParentId || query.granularity === "EXACT_DATE" || query.firstMeeting;
      if (canBeDetail && details.length < (query.granularity === "LIFE" || query.firstMeeting ? 1 : 2)) details.push(item);
      else if (!canBeDetail && query.granularity !== "EXACT_DATE" && !overview) overview = item;
    }
    let profileText = null;
    if (!blocked && requested && relevantEntities.some(entity => entity !== query.querySpeakerId)) {
      profileText = relevantEntities.filter(entity => entity !== scope.ownerId).slice(0, 3).map(entity => {
        const profile = this.coordinator.getKnownEntityProfile(scope, entity, { gameData: options.gameData, currentGameDate: options.currentGameDate, legacyMemories: bridge.memories });
        return `人物 ${entity}：认知 ${profile.recognition.level}；本轮回读的当前关系 ${profile.relationship.status === "CONFIRMED" ? profile.relationship.types.join("、") : "未知"}。后续以新 CK3 状态为准。无细节不等于不认识，未知不等于从未见过。`;
      }).join("\n");
    }
    const notice = blocked ? "无法确认本轮时间、人物或已成功建立的事件焦点；不得用无关年份、人物或日历下一条记录代答。"
      : query.firstMeeting ? "以下仅为正文明确记载初次相识的最早可用记录，不保证人生中真正的第一次。"
        : query.window && !details.length && !overview ? "本轮没有可新增的目标时段证据；此前已注入的匹配历史仍可用，不代表当时没有发生。" : null;
    const packet = fitRecallPacket({ query, overview, details, profileText, notice, diagnostics,
      focus: { ...scope, conversationId: options.conversationId, sceneRevision: options.sceneRevision,
        turnEpoch: options.turnEpoch, axis: query.axis, entityIds: [...relevantEntities] } },
    Math.min(1200, Number(options.memoryEngineRemainingBudget) || 0, Number(options.providerRemainingSafeBudget ?? 1200)), options.estimateTokens);
    if (packet.focus) packet.focus.sourceRefs = packet.sourceRefs;
    diagnostics.selectedIds = packet.items.map(item => item.memory.memoryId); diagnostics.tokens = packet.tokens; diagnostics.elapsedMs = Date.now() - started;
    this.coordinator.trace?.record("memory4_recall", diagnostics);
    return packet;
  }
}

module.exports = { Memory4RecallPlanner, parseRecallQuery, fitRecallPacket };
