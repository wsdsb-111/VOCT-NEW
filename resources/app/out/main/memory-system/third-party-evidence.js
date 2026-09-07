"use strict";

const { textFeatures } = require("./memory-ranker");

const CENTRALITY = Object.freeze({ PRIMARY_SUBJECT: 1, COUNTERPART: 0.8, PARTICIPANT_ONLY: 0.45, TEXT_MENTION_ONLY: 0.2 });
const SOURCE_AUTHORITY = Object.freeze({ game_fact: 1, witnessed: 1, letter: 0.9, spoken: 0.8, reported: 0.65, imported: 0.6, rumor: 0.35, inferred: 0.3 });

function uniqueNumbers(values) {
  return [...new Set((values || []).map(Number).filter(Number.isFinite))];
}

function overlap(left, right) {
  if (!left.size || !right.size) return 0;
  let matched = 0;
  for (const item of left) if (right.has(item)) matched++;
  return matched / Math.max(1, Math.min(left.size, right.size));
}

function centralityFor(memory, entityId, aliases = []) {
  const id = Number(entityId);
  const counterpartIds = uniqueNumbers([memory?.provenance?.counterpartId, ...(memory?.provenance?.counterpartIds || [])]);
  if (memory?.type !== "folder_summary" && uniqueNumbers(memory?.subjects).includes(id)) return "PRIMARY_SUBJECT";
  if (counterpartIds.includes(id)) return "COUNTERPART";
  if (uniqueNumbers(memory?.participants).includes(id) || uniqueNumbers(memory?.subjects).includes(id)) return "PARTICIPANT_ONLY";
  const body = String(memory?.canonicalText || memory?.content || "");
  return aliases.some((alias) => alias && body.includes(alias)) ? "TEXT_MENTION_ONLY" : null;
}

function recencyScore(memory, currentTotalDays) {
  const current = Number(currentTotalDays);
  const event = Number(memory?.totalDays);
  if (!Number.isFinite(current) || !Number.isFinite(event)) return 0.5;
  return 1 / (1 + Math.max(0, current - event) / 180);
}

function scoreEvidence(memory, { query = "", entityId, aliases = [], currentTotalDays = null } = {}) {
  const centrality = centralityFor(memory, entityId, aliases);
  if (!centrality) return null;
  const body = String(memory?.canonicalText || memory?.content || "");
  const queryRelevance = overlap(textFeatures(query), textFeatures(`${body} ${(memory?.tags || []).join(" ")}`));
  const importance = Math.max(0, Math.min(1, Number(memory?.importance) || 0));
  const confidence = Math.max(0, Math.min(1, Number(memory?.confidence) || 0));
  const recency = recencyScore(memory, currentTotalDays);
  const sourceAuthority = SOURCE_AUTHORITY[memory?.source] ?? 0.5;
  const score = 0.10 + 0.30 * queryRelevance + 0.20 * CENTRALITY[centrality] + 0.15 * sourceAuthority + 0.10 * importance + 0.10 * confidence + 0.05 * recency;
  return { memory, entityId: Number(entityId), aliases, centrality, queryRelevance, sourceAuthority, score };
}

function splitEvidence(content) {
  return String(content || "").split(/\n{2,}|(?<=[。！？!?])\s*/u).map((item) => item.trim()).filter(Boolean);
}

function extractRelevantEvidenceWindow(content, { query = "", aliases = [], maxSegments = 3 } = {}) {
  const queryFeatures = textFeatures(query);
  const aliasFeatures = textFeatures(aliases.join(" "));
  const parts = splitEvidence(content);
  const ranked = parts.map((part, index) => {
    const features = textFeatures(part);
    const relevance = overlap(queryFeatures, features);
    const entityMatch = overlap(aliasFeatures, features);
    const durable = part.includes("【需要长期记住的事项】") ? 0.2 : 0;
    return { part, index, score: 0.65 * relevance + 0.25 * entityMatch + durable };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = ranked.slice(0, Math.max(1, Math.min(3, maxSegments))).sort((left, right) => left.index - right.index).map((item) => item.part);
  return selected.join("\n");
}

function truncateToBudget(value, budget, estimateTokens) {
  const estimate = estimateTokens || ((text) => Math.ceil(String(text || "").length / 2));
  const text = String(value || "");
  if (estimate(text) <= budget) return text;
  let low = 0;
  let high = text.length;
  let fitted = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${text.slice(0, middle).trimEnd()}…`;
    if (estimate(candidate) <= budget) {
      fitted = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }
  return fitted;
}

function epistemicInstruction(memory) {
  if (memory?.type === "rumor" || memory?.source === "rumor" || memory?.epistemicStatus === "unverified") return "传闻/未核实：只能说听闻且不能确认";
  if (["reported", "spoken", "letter"].includes(memory?.source)) return "转述/言谈记录：必须保留来源语气";
  if (["game_fact", "witnessed"].includes(memory?.source) || memory?.epistemicStatus === "asserted") return "已确认记录：涉及其明确内容时不得否认";
  return "既有记录：不得补造证据未说明的内容";
}

function hasEvidenceConflict(entries) {
  if (entries.some((entry) => entry.memory?.type === "conflict" || entry.memory?.unresolved === true)) return true;
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.memory?.conflictKey;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, new Set());
    if (entry.memory?.polarity) groups.get(key).add(entry.memory.polarity);
  }
  return [...groups.values()].some((polarities) => polarities.size > 1);
}

function auditEvidencePool(entries) {
  const explicit = entries.find((entry) => entry.memory?.type === "conflict" || entry.memory?.unresolved === true);
  if (explicit) return { conflict: true, forced: [explicit] };
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.memory?.conflictKey;
    const polarity = entry.memory?.polarity;
    if (!key || !polarity) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const group of groups.values()) {
    for (let leftIndex = 0; leftIndex < group.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex++) {
        const left = group[leftIndex];
        const right = group[rightIndex];
        if (left.memory.polarity !== right.memory.polarity && left.sourceAuthority === right.sourceAuthority) {
          return { conflict: true, forced: [left, right] };
        }
      }
    }
  }
  return { conflict: false, forced: [] };
}

function buildThirdPartyEvidencePatch({ query = "", entities = [], currentTotalDays = null, tokenBudget = 512, estimateTokens } = {}) {
  const estimate = estimateTokens || ((text) => Math.ceil(String(text || "").length / 2));
  const totalBudget = Math.min(512, Math.max(0, Number(tokenBudget) || 0));
  const authorityText = "权威边界：当前 CK3 结构化事实决定现在状态；本块只约束已记录的过去事实、承诺、关系和言行。";
  const evidenceBudget = Math.max(0, totalBudget - estimate(authorityText));
  const entityResults = [];
  let usedTokens = 0;
  for (const entity of (entities || []).slice(0, 8)) {
    if (usedTokens >= evidenceBudget) break;
    const entityId = Number(entity?.id);
    if (!Number.isFinite(entityId)) continue;
    const aliases = [...new Set((entity.aliases || []).map((value) => String(value || "").trim()).filter(Boolean))];
    const ranked = (entity.memories || []).map((memory) => scoreEvidence(memory, { query, entityId, aliases, currentTotalDays })).filter(Boolean).sort((left, right) => right.score - left.score || String(left.memory?.memoryId || "").localeCompare(String(right.memory?.memoryId || "")));
    if (!ranked.length) continue;
    const audit = auditEvidencePool(ranked);
    const top = ranked[0];
    const second = ranked[1];
    const selected = audit.forced.length ? audit.forced.slice(0, 2) : [top];
    if (!audit.forced.length && second && (second.queryRelevance >= 0.12 || second.memory?.type === "conflict" || second.memory?.conflictKey && second.memory.conflictKey === top.memory?.conflictKey)) selected.push(second);
    const conflict = audit.conflict || hasEvidenceConflict(selected);
    const label = aliases[0] || `#${entityId}`;
    const perEntityBudget = Math.min(320, evidenceBudget - usedTokens);
    const header = `=== 当前轮召回证据：第三人 ${label} ===\n以下记录与当前问题直接相关，回答涉及其明确内容时必须遵守；没有说明的内容必须承认不知道，不得补造。`;
    const rows = selected.slice(0, 2).map((entry) => {
      const excerpt = extractRelevantEvidenceWindow(entry.memory?.content, { query, aliases });
      return `- ${entry.memory?.eventDate || "日期不详"} / ${entry.memory?.source || "来源不详"} / ${entry.memory?.epistemicStatus || "状态不详"} / ${entry.centrality}\n  ${epistemicInstruction(entry.memory)}\n  ${excerpt}`;
    });
    if (conflict) rows.unshift("- EVIDENCE_CONFLICT：同权威记录存在冲突，不得随机选边；应明确表示无法确定。");
    const text = truncateToBudget(`${header}\n${rows.join("\n")}`, perEntityBudget, estimate);
    const tokens = text ? Math.max(1, estimate(text)) : 0;
    if (!text || tokens > perEntityBudget) continue;
    entityResults.push({ entityId, label, selected, conflict, text, tokens });
    usedTokens += tokens;
  }
  const text = entityResults.length ? `${entityResults.map((entry) => entry.text).join("\n\n")}\n${authorityText}` : null;
  return {
    triggered: entityResults.length > 0,
    reason: entityResults.length > 0 ? "ENTITY_GROUNDED_RECALL" : "NO_ACCESSIBLE_ENTITY_EVIDENCE",
    entities: entityResults,
    text,
    tokens: text ? Math.max(1, estimate(text)) : 0,
    conflict: entityResults.some((entry) => entry.conflict),
    candidateCount: entityResults.reduce((total, entry) => total + entry.selected.length, 0)
  };
}

module.exports = { CENTRALITY, SOURCE_AUTHORITY, auditEvidencePool, buildThirdPartyEvidencePatch, centralityFor, extractRelevantEvidenceWindow, scoreEvidence };
