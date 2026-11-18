"use strict";

const { createHash } = require("node:crypto");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");

const PREFIXES = ["POD_investigate.desc.", "POD_persistentpodlore.desc.", "POD_podlore.100.desc.", "POD_patronlore.100.desc."];
const captures = new WeakMap();
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const validHistory = value => /^(?:[1-9]\d*|[A-Za-z_][A-Za-z0-9_]*)$/.test(value);

function cleanText(value) {
  const text = String(value || "").replace(/\r\n?/g, "\n")
    .replace(/\u0015(?:ONCLICK|TOOLTIP):[^\u0015]*/g, "").replace(/\u0015L;?[ \t]*/g, "").replace(/\u0015!/g, "")
    .replace(/#[A-Za-z_][A-Za-z0-9_]*[ \t]+/g, "").replace(/#!/g, "").replace(/@[A-Za-z0-9_.]+!/g, "").trim();
  return text.includes("\u0015") ? "" : text;
}

function captureCharacterBackgrounds(gameData, historyRows, rows) {
  captures.delete(gameData);
  if (!validId(gameData?.playerID) || !gameData?.campaignToken || !normalizeGameDate(gameData.date)
    || !Number.isFinite(Number(gameData.totalDays))) return;
  const histories = new Map();
  const ownersByHistory = new Map();
  for (const [owner, rawHistory] of historyRows) {
    const ownerId = Number(owner), historyId = String(rawHistory || "").trim();
    if (!validId(ownerId) || !gameData.characters?.has(ownerId)) continue;
    if (!histories.has(ownerId)) histories.set(ownerId, new Set());
    histories.get(ownerId).add(historyId);
    if (!ownersByHistory.has(historyId)) ownersByHistory.set(historyId, new Set());
    ownersByHistory.get(historyId).add(ownerId);
  }
  const stories = new Map();
  for (const row of rows) {
    const ownerId = Number(row.ownerId), historyId = String(row.historyId || "").trim();
    if (!validHistory(historyId) || histories.get(ownerId)?.size !== 1 || !histories.get(ownerId).has(historyId)
      || ownersByHistory.get(historyId)?.size !== 1 || !PREFIXES.some(prefix => row.localizationKey === prefix + historyId)) continue;
    const text = cleanText(row.text);
    if (!text || text === row.localizationKey) continue;
    if (!stories.has(ownerId)) stories.set(ownerId, new Map());
    const sources = stories.get(ownerId);
    if (sources.has(row.localizationKey) && sources.get(row.localizationKey) !== text) sources.set(row.localizationKey, null);
    else if (!sources.has(row.localizationKey)) sources.set(row.localizationKey, text);
  }
  const owners = new Map();
  for (const [ownerId, sources] of stories) {
    const historyId = [...histories.get(ownerId)][0];
    const entries = PREFIXES.map(prefix => [prefix + historyId, sources.get(prefix + historyId)]).filter(([, text]) => !!text);
    if (!entries.length) continue;
    const sourceSnapshotId = `${gameData.date}/${Number(gameData.totalDays)}`;
    const fingerprint = createHash("sha256").update(JSON.stringify([gameData.campaignToken, gameData.playerID,
      sourceSnapshotId, ownerId, historyId, entries])).digest("hex");
    owners.set(ownerId, { character: gameData.characters.get(ownerId), background: Object.freeze({
      ownerId, historyId, campaignToken: gameData.campaignToken, sourceSnapshotId, fingerprint,
      text: [...new Set(entries.map(([, text]) => text))].join("\n\n")
    }) });
  }
  captures.set(gameData, { playerId: Number(gameData.playerID), campaignToken: gameData.campaignToken,
    date: gameData.date, totalDays: Number(gameData.totalDays), owners });
}

function getCharacterBackground(gameData, ownerId) {
  const capture = captures.get(gameData);
  if (!capture || capture.playerId !== Number(gameData.playerID) || capture.campaignToken !== gameData.campaignToken
    || capture.date !== gameData.date || capture.totalDays !== Number(gameData.totalDays)) return null;
  const entry = capture.owners.get(Number(ownerId));
  return entry && entry.character === gameData.characters?.get(Number(ownerId)) ? entry.background : null;
}

module.exports = { captureCharacterBackgrounds, getCharacterBackground };
