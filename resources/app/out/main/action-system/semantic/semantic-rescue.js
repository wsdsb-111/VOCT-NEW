"use strict";

const corpus = require("./semantic-corpus");
const actionCatalog = require("./action-catalog");

const THRESHOLDS = Object.freeze({ low: 0.85, medium: 0.9, high: 0.96 });

function grams(text) {
  const normalized = String(text || "").toLowerCase().replace(/\s+/g, "");
  const result = new Set();
  for (let index = 0; index < normalized.length - 1; index++) result.add(normalized.slice(index, index + 2));
  return result;
}

function similarity(left, right) {
  const a = grams(left);
  const b = grams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const value of a) if (b.has(value)) overlap++;
  return overlap / Math.max(a.size, b.size);
}

function shortlist({ event, actions, registry }) {
  const catalog = actionCatalog.build(actions, registry).entries;
  return catalog.filter((entry) => entry.categories.includes(event.category) && entry.risk !== "high").map((entry) => {
    const examples = corpus.forAction(entry.actionId);
    const score = Math.max(similarity(event.evidence?.text, entry.meaning), ...(examples?.positive || []).map((example) => similarity(event.evidence?.text, example)));
    return { ...entry, positive: examples?.positive || [], negative: examples?.negative || [], score };
  }).sort((left, right) => right.score - left.score || left.actionId.localeCompare(right.actionId)).slice(0, 3);
}

function parseResult(output, candidates) {
  const content = output && typeof output === "object" ? output.content : null;
  if (typeof content !== "string") return { matched: false, reason: "empty_response" };
  try {
    const parsed = JSON.parse(content);
    const candidate = candidates.find((entry) => entry.actionId === parsed.actionId);
    if (parsed.matched !== true || !candidate || !Number.isFinite(Number(parsed.confidence))) return { matched: false, reason: "invalid_response" };
    const confidence = Number(parsed.confidence);
    if (confidence < THRESHOLDS[candidate.risk]) return { matched: false, reason: "below_threshold", confidence };
    return { matched: true, actionId: candidate.actionId, confidence, risk: candidate.risk };
  } catch {
    return { matched: false, reason: "invalid_json" };
  }
}

async function resolve({ event, actions, registry, llmManager, sourceCharacter, targetCharacter, signal }) {
  const candidates = shortlist({ event, actions, registry });
  if (candidates.length === 0) return { matched: false, reason: "no_safe_candidates", candidates: [] };
  const messages = [
    { role: "system", content: "Judge only whether the exact current evidence proves one listed action has completed. Proposals, plans, requests, reports, memories, failed attempts and ambiguity are not completed actions. Return only JSON." },
    { role: "system", content: `Candidate modules:\n${JSON.stringify(candidates.map(({ score, ...entry }) => entry))}` },
    { role: "user", content: JSON.stringify({ evidence: event.evidence?.text || "", category: event.category, source: sourceCharacter?.shortName || null, resolvedTarget: targetCharacter?.shortName || null }) }
  ];
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["matched", "actionId", "confidence"],
    properties: {
      matched: { type: "boolean" },
      actionId: { anyOf: [{ type: "string", enum: candidates.map((entry) => entry.actionId) }, { type: "null" }] },
      confidence: { type: "number", minimum: 0, maximum: 1 }
    }
  };
  const output = await llmManager.sendActionsRequest(messages, "votc_action_semantic_rescue", schema, signal, { actionStage: "semantic_rescue", actionSystemMode: "performance", actionCategory: event.category });
  return { ...parseResult(output, candidates), candidates: candidates.map((entry) => entry.actionId) };
}

module.exports = { resolve, shortlist, parseResult, THRESHOLDS };
