"use strict";

function characterName(character = {}) {
  return character.fullName || character.shortName || character.firstName || `#${character.id}`;
}

function titleAliases(character = {}) {
  const title = String(character.primaryTitle || "").trim();
  if (!title) return [];
  const aliases = new Set([title]);
  if (title.endsWith("府")) aliases.add(title.slice(0, -1));
  else aliases.add(`${title}府`);
  if (title.length > 2 && /[王公侯伯]$/.test(title)) {
    aliases.add(title.slice(-2));
    aliases.add(`${title.slice(-2)}府`);
  }
  return [...aliases].filter((alias) => alias.length >= 2);
}

function resolveRelationAnchor({ query = "", intent = null, responderId = null, graph = null } = {}) {
  if (!intent?.detected || !graph) return { status: "ANCHOR_UNKNOWN", mention: null, runtimeId: null, source: null, confidence: "NONE" };
  if (intent.anchorMode === "RESPONDER") {
    return responderId === null || responderId === undefined
      ? { status: "ANCHOR_UNKNOWN", mention: null, runtimeId: null, source: null, confidence: "NONE" }
      : { status: "ANCHOR_RESOLVED", mention: "你", runtimeId: String(responderId), source: "RESPONDER_PRONOUN", confidence: "HIGH" };
  }
  const text = String(query || "");
  const matches = [];
  for (const [runtimeId, character] of graph.nodes) {
    const aliases = [
      { value: character.fullName, source: "FULL_NAME" },
      { value: character.shortName, source: "SHORT_NAME" },
      { value: character.firstName, source: "FIRST_NAME" },
      ...titleAliases(character).map((value) => ({ value, source: "TITLE_MATCH" }))
    ];
    for (const alias of aliases) {
      const value = String(alias.value || "").trim();
      if (value.length < 2) continue;
      const index = text.lastIndexOf(value);
      if (index < 0) continue;
      const beforeIntent = Number.isFinite(intent.sourceIndex) && index <= intent.sourceIndex;
      matches.push({ runtimeId: String(runtimeId), mention: value, source: alias.source, confidence: beforeIntent ? "HIGH" : "MEDIUM", score: value.length * 10 + (beforeIntent ? 5 : 0) + (alias.source === "TITLE_MATCH" ? 2 : 0) });
    }
  }
  const scopedMatches = matches.filter((match) => Number.isFinite(intent.sourceIndex) && text.lastIndexOf(match.mention) <= intent.sourceIndex);
  const eligible = scopedMatches.length ? scopedMatches : [];
  const bestScore = Math.max(...eligible.map((match) => match.score), -Infinity);
  const best = eligible.filter((match) => match.score === bestScore);
  const runtimeIds = [...new Set(best.map((match) => match.runtimeId))];
  if (runtimeIds.length !== 1) return { status: runtimeIds.length ? "ANCHOR_AMBIGUOUS" : "ANCHOR_UNKNOWN", mention: best[0]?.mention || null, runtimeId: null, source: best[0]?.source || null, confidence: best[0]?.confidence || "NONE", candidates: runtimeIds.map((runtimeId) => ({ runtimeId, name: characterName(graph.nodes.get(runtimeId) || {}) })) };
  const resolved = best[0];
  return { status: "ANCHOR_RESOLVED", mention: resolved.mention, runtimeId: resolved.runtimeId, source: resolved.source, confidence: resolved.confidence };
}

module.exports = { resolveRelationAnchor };
