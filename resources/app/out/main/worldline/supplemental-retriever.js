"use strict";

const { classifyKnowledge } = require("./character-knowledge-policy");
const { normalizeGameDate } = require("./character-temporal-facts");
const { isPotentialCurrentState } = require("./canon-contract");
const { textFeatures } = require("../memory-system/memory-ranker");

function buildSupplementalIndex(records) {
  const byTerm = new Map(), byEntity = new Map(), byConflict = new Map();
  const add = (map, key, record) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(record); };
  for (const record of records) {
    for (const term of textFeatures(`${record.title} ${record.content}`)) add(byTerm, term, record);
    for (const id of [...(record.entities || []), ...(record.entityRefs || []).filter(ref => ref.namespace === "character").map(ref => ref.id)]) add(byEntity, String(id), record);
    if (record.conflictKey) add(byConflict, record.conflictKey, record);
  }
  return { byTerm, byEntity, byConflict };
}

function supplementalCandidates(index, query, entityIds) {
  const found = new Set();
  for (const term of textFeatures(query)) for (const record of index.byTerm.get(term) || []) found.add(record);
  for (const id of entityIds) for (const record of index.byEntity.get(String(id)) || []) found.add(record);
  // A contrary record must not disappear merely because its wording differs.
  for (const record of [...found]) for (const other of index.byConflict.get(record.conflictKey) || []) found.add(other);
  return [...found];
}

function retrieveSupplemental({ records = [], campaignId, branchId, responderId, query = "", entityIds = [], currentTotalDays = null, currentGameDate = null, scopeResolver = () => ({}), currentTruth = () => undefined, selectionIds = null, tokenBudget = 512, estimateTokens = (text) => Math.ceil(text.length / 2) } = {}) {
  const result = { selected: [], text: null, tokens: 0, conflictCount: 0, temporalBlockedCount: 0, visibilityBlockedCount: 0 };
  if (!campaignId || !branchId || responderId == null) return result;
  const terms = textFeatures(query);
  const entities = new Set(entityIds.map(String));
  const allowed = [];
  for (const record of records) {
    if (record.campaignId !== campaignId || record.branchId !== branchId || record.status !== "ACTIVE") continue;
    const visibility = record.visibility === "PERSONAL" ? "PERSONAL_MEMORY" : record.visibility;
    const fact = { factId: record.recordId, field: "SUPPLEMENTAL", sourceTier: "PLAYER_SUPPLEMENTAL", knowledgeLevel: visibility, knownBy: record.knownBy, authorizationComplete: true, public: ["PUBLIC_WORLD", "REALM_PUBLIC", "COURT_PUBLIC"].includes(visibility), temporalSafe: true };
    if (classifyKnowledge(fact, { id: responderId }, scopeResolver(record)).decision !== "ALLOW") {
      result.visibilityBlockedCount++;
      continue;
    }
    const current = Number.isSafeInteger(currentTotalDays) ? currentTotalDays : null;
    const dated = record.totalDays !== null && Number.isSafeInteger(record.totalDays);
    const fallbackCurrent = normalizeGameDate(currentGameDate);
    const fallbackRecord = normalizeGameDate(record.gameDate);
    const dateSafe = record.temporalMode === "TIMELESS" || record.temporalMode === "PLANNED" ? true : dated ? current !== null && record.totalDays <= current : !!fallbackCurrent && !!fallbackRecord && fallbackRecord.serial <= fallbackCurrent.serial;
    const rangeSafe = (record.validFrom == null || current !== null && record.validFrom <= current) && (record.validUntil == null || current !== null && current <= record.validUntil);
    if (!dateSafe || !rangeSafe) { result.temporalBlockedCount++; continue; }
    const features = textFeatures(`${record.title} ${record.content}`);
    const overlap = [...terms].filter((term) => features.has(term)).length;
    const entityMatch = (record.entityRefs || []).some((ref) => ref.namespace === "character" && entities.has(ref.id)) || (record.entities || []).some((id) => entities.has(id));
    const relevant = (overlap > 0 || entityMatch) && (!selectionIds || selectionIds.has(record.recordId));
    // Current-state declarations require a verified structural value. Past RP
    // events and subjective memories are not rejected merely by present state.
    const claim = record.currentClaim;
    const unstructuredCurrent = isPotentialCurrentState(record.content);
    if (claim || unstructuredCurrent) {
      const actual = claim ? currentTruth(claim) : undefined;
      if (!claim || actual === undefined || String(actual) !== String(claim.value)) {
        if (relevant) result.conflictCount++;
        continue;
      }
    }
    allowed.push({ record, relevant, score: overlap + (entityMatch ? 3 : 0) + ({ LOW: 0, NORMAL: 0.1, HIGH: 0.2, CRITICAL: 0.3 }[record.importance] || 0) });
  }
  const conflictGroups = new Map();
  for (const entry of allowed) {
    if (!entry.record.conflictKey) continue;
    const group = conflictGroups.get(entry.record.conflictKey) || [];
    group.push(entry.record);
    conflictGroups.set(entry.record.conflictKey, group);
  }
  const blocked = new Set();
  for (const group of conflictGroups.values()) {
    if (group.some(record => allowed.some(entry => entry.record === record && entry.relevant)) && new Set(group.map((record) => record.content)).size > 1) {
      result.conflictCount++;
      for (const record of group) blocked.add(record.recordId);
    }
  }
  const header = "=== 本轮玩家 Canon / 补充世界记忆 ===\n当前 CK3 结构化事实优先；以下只补充 RP 事实，不能覆盖当前状态。过去经历与主观记忆分别保留。\n";
  const budget = Number.isFinite(tokenBudget) ? Math.min(640, Math.max(0, tokenBudget)) : 512;
  const rows = [];
  if (result.conflictCount) rows.push("CANON_CONFLICT：相关补充记录存在冲突或当前状态未经验证；以获准 CK3 事实为准，不得从补充记录推断或随机选边。");
  for (const { record, relevant } of allowed.sort((a, b) => b.score - a.score || a.record.recordId.localeCompare(b.record.recordId))) {
    if (!relevant || blocked.has(record.recordId) || result.selected.length >= 8) continue;
    // Verifying one structured claim does not authorize arbitrary prose attached
    // to it. Only render the verified field, never relabel the entire body as truth.
    const row = record.currentClaim
      ? `- CK3 结构化核对：角色 #${record.currentClaim.entityId} · ${record.currentClaim.field}=${String(record.currentClaim.value)}`
      : `- ${record.type === "PLANNED_DECISION" || record.temporalMode === "PLANNED" ? "计划/意图，尚未发生：" : ""}${record.title}：${record.content}`;
    if (estimateTokens(header + [...rows, row].join("\n")) > budget) continue;
    rows.push(row);
    result.selected.push({ recordId: record.recordId, revision: record.revision });
  }
  if (rows.length && estimateTokens(header + rows.join("\n")) <= budget) {
    result.text = header + rows.join("\n");
    result.tokens = estimateTokens(result.text);
  }
  return result;
}

module.exports = { retrieveSupplemental, buildSupplementalIndex, supplementalCandidates };
