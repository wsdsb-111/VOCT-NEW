"use strict";

const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { renderOfficialMemory } = require("./ck3-memory-text-renderer");
const { estimateTokens: defaultEstimate } = require("../token-estimator");

const PROMPT_HEADER = "【CK3 官方人物追忆】\n以下是该角色当前仍保留的个人往事，不等于当前世界状态；若与当前 CK3 游戏事实冲突，以当前事实为准。";

function compileOfficialRecollection({ snapshot, ownerCharacterId, saveFingerprint, localize, estimateTokens = defaultEstimate, tokenBudget = 800 } = {}) {
  const ownerId = String(ownerCharacterId || "");
  const character = snapshot?.characters?.[ownerId];
  if (!character || character.alive !== true) return { status: "UNAVAILABLE", reason: "HOLDER_UNAVAILABLE", entries: [], renderedSummary: null };
  const memories = (character.officialMemoryIds || []).map((id) => snapshot.officialMemoryDatabase?.[id])
    .filter((memory) => memory?.holderCharacterIds?.includes(ownerId))
    .sort((left, right) => (normalizeGameDate(right.creationDate)?.serial || 0) - (normalizeGameDate(left.creationDate)?.serial || 0));
  const entries = [];
  const unresolved = [];
  const hardBudget = Math.min(1000, Math.max(0, Number(tokenBudget) || 0));
  let used = estimateTokens(PROMPT_HEADER);
  let trimmedMemoryCount = 0;
  for (const memory of memories) {
    const rendered = renderOfficialMemory(memory, snapshot, localize);
    if (rendered.status !== "RENDERED") { unresolved.push({ memoryId: memory.memoryId, memoryType: memory.memoryType, reason: rendered.reason }); continue; }
    const cost = estimateTokens(rendered.renderedText);
    if (used + cost > hardBudget) { trimmedMemoryCount++; continue; }
    entries.push(rendered);
    used += cost;
  }
  return {
    status: "READY", ownerCharacterId: ownerId, sourceType: "CK3_OFFICIAL_RECOLLECTION",
    saveFingerprint: saveFingerprint || snapshot.contentFingerprint || null, gameDate: snapshot.gameDate,
    memoryCount: memories.length, entries, unresolved, trimmedMemoryCount,
    renderedSummary: entries.length ? `${PROMPT_HEADER}\n${entries.map((entry) => entry.renderedText).join("\n")}` : null,
    tokenEstimate: entries.length ? used : 0
  };
}

module.exports = { compileOfficialRecollection };
