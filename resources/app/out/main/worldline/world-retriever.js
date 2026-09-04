"use strict";

const { analysisTextMatches } = require("./shared-query-analyzer");

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function characterDisplay(character, id, match) {
  return match?.displayName || character?.fullName || character?.firstName || `#${id}`;
}

function actorIds(entry) {
  return uniqueStrings((entry?.actors || []).map((actor) => actor?.runtimeId));
}

function buildWorldCandidates({ snapshot, analysis, annualDelta = [], supplemental = [] } = {}) {
  const candidates = [];
  const characters = snapshot?.characters || {};
  const titles = snapshot?.titles || {};
  const resolvedCharacters = analysis?.resolvedCharacters || analysis?.characters || [];
  const resolvedTitles = analysis?.resolvedTitles || analysis?.titles || [];

  for (const match of resolvedCharacters) {
    const id = String(match?.id || "");
    const character = characters[id];
    if (!character) continue;
    candidates.push({
      id: `character:${id}`,
      category: "GAME_TRUTH",
      kind: "CHARACTER",
      sourceTier: "GAME_TRUTH",
      entityRefs: { characters: [id], titles: [], keys: uniqueStrings([match.rawKey, match.displayName, ...(match.aliases || [])]) },
      gameDate: snapshot?.gameDate || null,
      importance: "HIGH",
      title: characterDisplay(character, id, match),
      payload: { id, character, match }
    });
  }

  for (const match of resolvedTitles) {
    const id = String(match?.id || "");
    const title = titles[id];
    if (!title) continue;
    const holderId = title.holder ? String(title.holder) : null;
    const holder = holderId ? characters[holderId] : null;
    candidates.push({
      id: `title:${id}`,
      category: "GAME_TRUTH",
      kind: "TITLE",
      sourceTier: "GAME_TRUTH",
      entityRefs: { characters: holderId ? [holderId] : [], titles: [id], keys: uniqueStrings([match.rawKey, match.displayName, title.key]) },
      gameDate: snapshot?.gameDate || null,
      importance: "HIGH",
      title: match.displayName || title.key || `#${id}`,
      payload: { id, title, match, holderId, holder }
    });
  }

  annualDelta.forEach((entry, index) => {
    const titleId = entry?.titleId ? String(entry.titleId) : null;
    candidates.push({
      id: `delta:${entry?.id || index}`,
      category: "DELTA",
      kind: "DELTA",
      sourceTier: entry?.source === "GAMESTATE" ? "GAMESTATE" : "ANNUAL_DELTA",
      entityRefs: { characters: actorIds(entry), titles: titleId ? [titleId] : [], keys: uniqueStrings([entry?.type, entry?.detail]) },
      eventType: entry?.type || "UNKNOWN_EVENT",
      gameDate: entry?.date || null,
      importance: entry?.type === "IMPORTANT_CHARACTER_DIED" || entry?.type === "WAR_STARTED" ? "HIGH" : "NORMAL",
      recencyRank: index + 1,
      title: entry?.type || "WORLD_DELTA",
      payload: entry
    });
  });

  for (const entry of supplemental) {
    const text = `${entry?.title || ""}\n${entry?.body || ""}\n${Array.isArray(entry?.entities) ? entry.entities.join(" ") : ""}`;
    candidates.push({
      id: `supplemental:${entry?.id || "unknown"}`,
      category: "SUPPLEMENTAL",
      kind: "SUPPLEMENTAL",
      sourceTier: "PLAYER_SUPPLEMENTAL",
      entityRefs: { characters: [], titles: [], keys: uniqueStrings([entry?.title, ...(entry?.entities || [])]) },
      gameDate: entry?.gameDate || null,
      dateRange: entry?.dateRange || null,
      visibility: entry?.visibility || "UNKNOWN",
      hidden: Boolean(entry?.hidden),
      importance: entry?.importance || "NORMAL",
      lexicalMatch: analysisTextMatches(analysis, text),
      title: entry?.title || "Supplemental",
      payload: entry
    });
  }

  return candidates;
}

module.exports = { buildWorldCandidates };
